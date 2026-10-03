// npm run build && node --experimental-test-module-mocks tests/agent-transport.test.mjs
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
mock.module('../dist/utils/logger.js', { namedExports: { logger: { warn() {} } } });
const { agentGet, agentPost } = await import('../dist/services/agentClient.js');
let seen;
globalThis.fetch = async (url, options) => { seen = { url, options }; return { ok: true, json: async () => ({ ok: true }) }; };
const server = (host) => ({ id: 'test', host, agent_port: 7420, decryptedKey: 'synthetic-key' });
test('remote agents default to TLS and cannot redirect the API key', async () => {
  delete process.env.STOR_AGENT_ALLOW_INSECURE_HTTP;
  await agentGet(server('agent.example.invalid'), '/health');
  assert.equal(seen.url, 'https://agent.example.invalid:7420/health');
  assert.equal(seen.options.redirect, 'error');
  await agentPost(server('agent.example.invalid'), '/test', {});
  assert.equal(seen.options.redirect, 'error');
});
test('IPv6 URL is bracketed and loopback tunnels remain supported', async () => {
  await agentGet(server('2001:db8::1'), '/health');
  assert.equal(seen.url, 'https://[2001:db8::1]:7420/health');
  await agentGet(server('::1'), '/health');
  assert.equal(seen.url, 'http://[::1]:7420/health');
});
