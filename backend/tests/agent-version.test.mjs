// npm run build && node --experimental-test-module-mocks tests/agent-version.test.mjs
// St0r tells the UI when a remote agent is older than the one it ships, and the
// SSH installer hands the agent St0r's own address as its source allowlist.
// Mocks the database, logger and agent transport only.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let health = { ok: true, latencyMs: 1, version: '1.0.0' };
const server = { id: 's1', is_local: 0, agent_installed: 1, host: '192.0.2.5', agent_port: 7420,
                 agent_api_key_encrypted: 'x', agent_tls_fingerprint: 'a'.repeat(64) };
mock.module('../dist/utils/logger.js', { namedExports: { logger: { info() {}, warn() {}, error() {}, debug() {} } } });
mock.module('../dist/config/database.js', { namedExports: { query: async (sql) => (/^SELECT/.test(sql) ? [server] : []) } });
mock.module('../dist/services/secrets.js', { namedExports: { encrypt: (v) => v, decrypt: (v) => v } });
mock.module('../dist/services/agentClient.js', { namedExports: {
  agentGet: async () => ({}), agentPost: async () => ({}), pingAgent: async () => health,
  normalizeFingerprint: (v) => v,
} });
const { pingAgentEndpoint, agentUpdateAvailable, bundledAgentVersion } = await import('../dist/controllers/servers.js');
const shipped = JSON.parse(readFileSync(new URL('../../agent/package.json', import.meta.url), 'utf-8')).version;

async function ping() {
  const res = { status() { return this; }, json(b) { this.body = b; } };
  await pingAgentEndpoint({ params: { id: 's1' }, user: { isAdmin: true } }, res);
  return res.body;
}

test('version comparison', () => {
  assert.equal(agentUpdateAvailable('1.0.0', '1.1.0'), true);
  assert.equal(agentUpdateAvailable('1.1.0', '1.1.0'), false);
  assert.equal(agentUpdateAvailable('1.2.0', '1.1.0'), false);
  assert.equal(agentUpdateAvailable('1.10.0', '1.9.3'), false);
  assert.equal(agentUpdateAvailable(undefined, '1.1.0'), false);
  assert.equal(agentUpdateAvailable('garbage', '1.1.0'), false);
});

test('ping reports an update when the agent is older than the bundled one', async () => {
  assert.equal(bundledAgentVersion(), shipped);
  health = { ok: true, latencyMs: 1, version: '1.0.0' };
  const r = await ping();
  assert.equal(r.latestVersion, shipped);
  assert.equal(r.updateAvailable, true);
  health = { ok: true, latencyMs: 1, version: shipped };
  assert.equal((await ping()).updateAvailable, false);
  health = { ok: false, latencyMs: 1, error: 'down' };
  assert.equal((await ping()).updateAvailable, false);
});

test('SSH install passes the connecting address as the agent allowlist', async () => {
  const { agentInstallEnv } = await import('../dist/services/serverSsh.js');
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync('bash', ['-c', `${agentInstallEnv(7420)} env`],
    { env: { PATH: process.env.PATH, SSH_CLIENT: '203.0.113.9 51234 22' } }).toString();
  assert.match(out, /^STOR_AGENT_ALLOWED_IPS=203\.0\.113\.9$/m);
  assert.match(out, /^STOR_AGENT_PORT=7420$/m);
});

// ── The manual install command names St0r's address when it can be known ──
const { agentInstallCommand, serveInstallScript } = await import('../dist/controllers/servers.js');
const { isPrivateAddress, storAddressFor } = await import('../dist/utils/localAddress.js');

test('private-address check', () => {
  for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.22.251', '127.0.0.1', '169.254.1.1', '::1', 'fd00::5', 'fe80::1', '::ffff:192.168.1.2']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '192.0.2.5', '2001:db8::1', 'example.com', '']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("St0r's address is found for a host on a private network, not across the Internet", async () => {
  assert.equal(await storAddressFor('127.0.0.1', 7420), '127.0.0.1');
  assert.equal(await storAddressFor('192.0.2.5', 7420), null);
  assert.equal(await storAddressFor('no-such-host.invalid', 7420), null);
});

test('install command carries the allowlist when the address is known', () => {
  const t = 'a'.repeat(64);
  assert.equal(agentInstallCommand('https://stor.example', t, 7420, '192.168.1.5'),
    `curl -fsSL "https://stor.example/api/agent-install/${t}" | sudo AGENT_PORT=7420 STOR_AGENT_ALLOWED_IPS=192.168.1.5 bash`);
  assert.equal(agentInstallCommand('https://stor.example', t, 7420, null),
    `curl -fsSL "https://stor.example/api/agent-install/${t}" | sudo AGENT_PORT=7420 bash`);
  // Never anything but an address.
  assert.doesNotMatch(agentInstallCommand('https://stor.example', t, 7420, '1.2.3.4; rm -rf /'), /rm -rf/);
});

test('served install script hands the agent installer its allowlist', async () => {
  const saved = server.host;
  try {
    server.host = '127.0.0.1';
    server.install_token = 'b'.repeat(64);
    const res = { headers: {}, status(c) { this.code = c; return this; }, setHeader(k, v) { this.headers[k] = v; }, send(b) { this.body = b; } };
    await serveInstallScript({ params: { token: 'b'.repeat(64) } }, res);
    assert.match(res.body, /^ALLOWED_IPS="\$\{STOR_AGENT_ALLOWED_IPS:-127\.0\.0\.1\}"$/m);
    assert.match(res.body, /STOR_AGENT_ALLOWED_IPS="\$ALLOWED_IPS" bash install\.sh/);
    server.host = '192.0.2.5';
    await serveInstallScript({ params: { token: 'b'.repeat(64) } }, res);
    assert.match(res.body, /^ALLOWED_IPS="\$\{STOR_AGENT_ALLOWED_IPS:-\}"$/m);
  } finally {
    server.host = saved;
  }
});
