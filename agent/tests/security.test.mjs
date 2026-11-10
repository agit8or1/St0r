// npm run build && node tests/security.test.mjs
// Starts only a local test agent with a temporary config. No management calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';

let lastDir = '';
async function startAgent(t, allowed, env = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'stor-agent-test-'));
  lastDir = dir;
  const allocator = createServer();
  allocator.listen(0, '127.0.0.1');
  await once(allocator, 'listening');
  const port = allocator.address().port;
  await new Promise(resolve => allocator.close(resolve));
  await writeFile(join(dir, 'config.json'), JSON.stringify({ api_key: 'synthetic-test-key', port, allowed_ips: allowed }));
  const child = spawn(process.execPath, ['dist/index.js'], {
    env: { ...process.env, STOR_AGENT_CONFIG_DIR: dir, PORT: String(port),
           STOR_AGENT_TLS_CERT: '', STOR_AGENT_TLS_KEY: '', STOR_AGENT_BIND_HOST: '127.0.0.1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit'); }
    await rm(dir, { recursive: true, force: true });
  });
  await Promise.race([
    new Promise((resolve, reject) => {
      child.stdout.on('data', d => { if (d.toString().includes('Listening')) resolve(); });
      child.on('exit', code => reject(new Error(`Agent exited ${code}: ${output}`)));
    }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Agent start timed out')), 5000); timer.unref(); }),
  ]);
  assert.equal(output.includes('synthetic-test-key'), false);
  return `http://127.0.0.1:${port}`;
}
test('valid key cannot bypass configured source allowlist', async t => {
  const url = await startAgent(t, ['192.0.2.10']);
  assert.equal((await fetch(url + '/health')).status, 200);
  assert.equal((await fetch(url + '/no-management-action', { headers: { 'x-stor-agent-key': 'synthetic-test-key' } })).status, 403);
});
test('allowed source still needs a valid key', async t => {
  const url = await startAgent(t, ['127.0.0.1']);
  assert.equal((await fetch(url + '/no-management-action')).status, 401);
  assert.equal((await fetch(url + '/no-management-action', { headers: { 'x-stor-agent-key': 'synthetic-test-key' } })).status, 404);
});
test('cleartext non-loopback listener is refused', async t => {
  await assert.rejects(startAgent(t, [], { STOR_AGENT_BIND_HOST: '0.0.0.0' }), /Cleartext agent must bind to loopback/);
});

// GHSA-27r3-jxmh-p828: express.json() runs ahead of the key check, so any caller that can
// reach the port could end the agent with a compressed body followed by trailing bytes.
test('compressed body with trailing bytes cannot crash the agent before authentication', async t => {
  const url = await startAgent(t, ['127.0.0.1'], { NODE_ENV: 'production' });
  const body = Buffer.concat([gzipSync('{"a":1}'), Buffer.from([0]), Buffer.alloc(100 * 1024, 0x58)]);
  const res = await fetch(url + '/no-management-action', { method: 'POST', body,
    headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' } });
  assert.equal(res.status, 401);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal((await fetch(url + '/health')).status, 200);
});
test('malformed compressed body gets a 400 without a stack trace', async t => {
  const url = await startAgent(t, ['127.0.0.1'], { NODE_ENV: 'production' });
  for (const body of [Buffer.from('not gzip'), gzipSync('{"a":1}').subarray(0, 12)]) {
    const res = await fetch(url + '/no-management-action', { method: 'POST', body,
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'x-stor-agent-key': 'synthetic-test-key' } });
    assert.equal(res.status, 400);
    assert.equal((await res.text()).includes('node_modules'), false);
  }
  assert.equal((await fetch(url + '/health')).status, 200);
});

/** GET from a chosen loopback source address (Linux routes all of 127/8 to lo). */
function getFrom(url, path, localAddress, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url + path, { localAddress, headers }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end();
  });
}
const KEY = { 'x-stor-agent-key': 'synthetic-test-key' };

test('authentication runs before the body is parsed', async t => {
  const url = await startAgent(t, ['127.0.0.1']);
  // Before: express.json() ran first and answered 400 to anyone who could connect.
  const res = await fetch(url + '/no-management-action', { method: 'POST', body: '{not json',
    headers: { 'Content-Type': 'application/json' } });
  assert.equal(res.status, 401);
});
test('an empty allowlist is not open to everyone: it pins the first source with the key', async t => {
  const url = await startAgent(t, []);
  assert.equal(await getFrom(url, '/no-management-action', '127.0.0.2'), 401);          // no key: nothing pinned
  assert.deepEqual(JSON.parse(await readFile(join(lastDir, 'config.json'), 'utf-8')).allowed_ips, []);
  assert.equal(await getFrom(url, '/no-management-action', '127.0.0.1', KEY), 404);     // St0r's first call
  const saved = JSON.parse(await readFile(join(lastDir, 'config.json'), 'utf-8'));
  assert.deepEqual(saved.allowed_ips, ['127.0.0.1']);
  assert.equal(saved.api_key, 'synthetic-test-key');
  assert.equal(await getFrom(url, '/no-management-action', '127.0.0.2', KEY), 403);     // key alone no longer enough
});
test('"*" in the allowlist allows any source explicitly', async t => {
  const url = await startAgent(t, ['*']);
  assert.equal(await getFrom(url, '/no-management-action', '127.0.0.2', KEY), 404);
});
test('health reports the packaged agent version', async t => {
  const url = await startAgent(t, ['127.0.0.1']);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf-8'));
  assert.deepEqual(await (await fetch(url + '/health')).json(), { ok: true, version: pkg.version });
});

// install.sh: the config it writes, run on its own (no root, no systemd).
async function runInstallConfig(t, env, existing) {
  const dir = await mkdtemp(join(tmpdir(), 'stor-agent-cfg-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  if (existing) await writeFile(join(dir, 'config.json'), JSON.stringify(existing));
  const src = await readFile(new URL('../install.sh', import.meta.url), 'utf-8');
  const block = src.slice(src.indexOf('# Generate config'), src.indexOf('# TLS. St0r'));
  const { execFileSync } = await import('node:child_process');
  execFileSync('bash', ['-c', 'set -e\n' + block], { env: { ...process.env, CONFIG_DIR: dir, PORT: '7420', ...env }, stdio: 'pipe' });
  return JSON.parse(await readFile(join(dir, 'config.json'), 'utf-8'));
}
test('install.sh writes the St0r address it is given into allowed_ips', async t => {
  assert.deepEqual((await runInstallConfig(t, { STOR_AGENT_ALLOWED_IPS: '198.51.100.7' })).allowed_ips, ['198.51.100.7']);
  const kept = await runInstallConfig(t, { STOR_AGENT_ALLOWED_IPS: '198.51.100.7' }, { api_key: 'k', port: 7420, allowed_ips: [] });
  assert.deepEqual(kept, { api_key: 'k', port: 7420, allowed_ips: ['198.51.100.7'] });
  await assert.rejects(runInstallConfig(t, { STOR_AGENT_ALLOWED_IPS: '1.2.3.4;id' }));
});
