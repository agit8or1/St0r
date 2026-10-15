// npm run build && node tests/security.test.mjs
// Starts only a local test agent with a temporary config. No management calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';

async function startAgent(t, allowed, env = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'stor-agent-test-'));
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
