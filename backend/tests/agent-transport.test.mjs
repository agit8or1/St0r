// npm run build && node --experimental-test-module-mocks tests/agent-transport.test.mjs
// Starts only local test servers on 127.0.0.1 with a throwaway certificate (needs openssl).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { X509Certificate } from 'node:crypto';
mock.module('../dist/utils/logger.js', { namedExports: { logger: { warn() {} } } });
const { agentGet, agentPost, agentTransport, normalizeFingerprint } = await import('../dist/services/agentClient.js');

// The same command agent/install.sh runs.
const dir = mkdtempSync(join(tmpdir(), 'stor-agent-tls-test-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1',
  '-subj', '/CN=stor-agent', '-keyout', join(dir, 'agent.key'), '-out', join(dir, 'agent.crt')], { stdio: 'ignore' });
const cert = readFileSync(join(dir, 'agent.crt'));
const key = readFileSync(join(dir, 'agent.key'));
const opensslFingerprint = execFileSync('openssl', ['x509', '-in', join(dir, 'agent.crt'), '-noout', '-fingerprint', '-sha256']).toString().trim();
const pin = normalizeFingerprint(new X509Certificate(cert).fingerprint256);

async function listen(t, server, host = '127.0.0.1') {
  const requests = [];
  server.on('request', (req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, key: req.headers['x-stor-agent-key'], body });
      if (req.url === '/redirect') { res.writeHead(302, { Location: 'https://elsewhere.invalid/' }); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });
  });
  server.listen(0, host);
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { port: server.address().port, requests };
}
const agent = (host, port, extra = {}) => ({ id: 'test', host, agent_port: port, decryptedKey: 'synthetic-key', ...extra });

test('fingerprints from openssl, Node and the database all normalise to the same value', () => {
  assert.match(pin, /^[0-9a-f]{64}$/);
  assert.equal(normalizeFingerprint(opensslFingerprint), pin);
  assert.equal(normalizeFingerprint(opensslFingerprint.split('=')[1]), pin);
  assert.equal(normalizeFingerprint(pin.toUpperCase()), pin);
  assert.equal(normalizeFingerprint('not a fingerprint'), null);
  assert.equal(normalizeFingerprint(pin.slice(2)), null);
});

test('transport: a pin wins, loopback is plain HTTP, anything else is CA-verified TLS', () => {
  delete process.env.STOR_AGENT_ALLOW_INSECURE_HTTP;
  assert.equal(agentTransport(agent('agent.example.invalid', 7420)), 'https');
  assert.equal(agentTransport(agent('2001:db8::1', 7420)), 'https');
  assert.equal(agentTransport(agent('::1', 7420)), 'http');
  assert.equal(agentTransport(agent('127.0.0.1', 7420, { tls_fingerprint: pin })), 'pinned');
  process.env.STOR_AGENT_ALLOW_INSECURE_HTTP = 'true';
  assert.equal(agentTransport(agent('agent.example.invalid', 7420)), 'http');
  assert.equal(agentTransport(agent('agent.example.invalid', 7420, { tls_fingerprint: pin })), 'pinned');
  delete process.env.STOR_AGENT_ALLOW_INSECURE_HTTP;
});

test('pinned agent: the matching certificate gets the request, key and body', async t => {
  const { port, requests } = await listen(t, createHttpsServer({ cert, key }));
  const server = agent('127.0.0.1', port, { tls_fingerprint: pin });
  assert.deepEqual(await agentGet(server, '/health'), { ok: true, path: '/health' });
  assert.deepEqual(await agentPost(server, '/test', { a: 1 }), { ok: true, path: '/test' });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].key, 'synthetic-key');
  assert.deepEqual([requests[1].method, requests[1].body], ['POST', '{"a":1}']);
});

test('pinned agent: a different certificate is refused before anything is sent', async t => {
  const { port, requests } = await listen(t, createHttpsServer({ cert, key }));
  const wrong = 'ab'.repeat(32);
  await assert.rejects(agentGet(agent('127.0.0.1', port, { tls_fingerprint: wrong }), '/health'),
    /does not match the pinned fingerprint/);
  assert.equal(requests.length, 0);
});

test('unpinned self-signed agent is refused with a hint, and receives nothing', async t => {
  // 127.0.0.1 counts as loopback and would get plain HTTP; Linux answers on all of 127/8.
  const { port, requests } = await listen(t, createHttpsServer({ cert, key }), '127.0.0.2');
  await assert.rejects(agentGet(agent('127.0.0.2', port), '/health'), /self-signed and no fingerprint is pinned/);
  assert.equal(requests.length, 0);
});

test('redirects are not followed', async t => {
  const { port, requests } = await listen(t, createHttpsServer({ cert, key }));
  await assert.rejects(agentGet(agent('127.0.0.1', port, { tls_fingerprint: pin }), '/redirect'), /HTTP 302/);
  assert.equal(requests.length, 1);
});

test('loopback agents still use plain HTTP', async t => {
  const { port, requests } = await listen(t, createHttpServer());
  assert.deepEqual(await agentGet(agent('127.0.0.1', port), '/health'), { ok: true, path: '/health' });
  assert.equal(requests[0].key, 'synthetic-key');
});
