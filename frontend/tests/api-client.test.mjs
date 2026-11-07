// node tests/api-client.test.mjs
// Compiles the real src/services/api.ts and runs it against a local mock API on 127.0.0.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformWithEsbuild } from 'vite';

const requests = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams),
                    type: req.headers['content-type'], body });
    const reply = (status, payload, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
    };
    if (url.pathname === '/api/auth/login') return reply(400, { error: 'Username and password are required' });
    if (url.pathname === '/api/auth/logout') { res.writeHead(204); return res.end(); }
    if (url.pathname === '/api/auth/validate') return reply(401, { error: 'No token provided' });
    if (url.pathname === '/api/servers') return reply(200, 'plain text', 'text/plain');
    reply(200, { ok: true, path: url.pathname });
  });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;

const storage = new Map([['user', '{"id":1}']]);
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
globalThis.window = { location: { origin, pathname: '/clients', href: `${origin}/clients` } };

const dir = await mkdtemp(join(tmpdir(), 'stor-frontend-test-'));
const source = await readFile(new URL('../src/services/api.ts', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'api.ts', { loader: 'ts', format: 'esm' });
await writeFile(join(dir, 'api.mjs'), code);
const { api, HttpError } = await import(join(dir, 'api.mjs'));
test.after(async () => { server.close(); await rm(dir, { recursive: true, force: true }); });

const last = () => requests[requests.length - 1];

test('GET resolves to the parsed JSON body and drops unset params', async () => {
  const data = await api.getJobLogs(undefined, 20);
  assert.deepEqual(data, { ok: true, path: '/api/urbackup/job-logs' });
  assert.deepEqual(last().query, { num: '20' });
  assert.equal(last().type, undefined);
});

test('POST, PATCH and DELETE send JSON bodies', async () => {
  await api.updateClientName(7, 'new-name');
  assert.equal(last().method, 'PATCH');
  assert.equal(last().type, 'application/json');
  assert.equal(JSON.parse(last().body).newName, 'new-name');
  assert.equal(JSON.parse(last().body).serverId, undefined); // undefined fields are dropped, as with axios
  // removeClient sends its body on a DELETE, which axios did through config.data.
  await api.removeClient(7, 3);
  assert.deepEqual([last().method, last().path, JSON.parse(last().body)], ['DELETE', '/api/urbackup/clients/7', { serverId: 3 }]);
  await api.logout();
  assert.deepEqual([last().method, last().body], ['POST', '']);
});

test('error responses keep the shape pages read: err.response.status / .data.error', async () => {
  const err = await api.login('', '').catch(e => e);
  assert.ok(err instanceof HttpError);
  assert.equal(err.message, 'Request failed with status code 400');
  assert.equal(err.response.status, 400);
  assert.equal(err.response.data.error, 'Username and password are required');
  assert.equal(storage.has('user'), true);
});

test('401 clears the session and sends the user to /login, except from /login itself', async () => {
  window.location.pathname = '/login';
  window.location.href = `${origin}/login`;
  assert.equal(await api.validateToken(), false);
  assert.equal(storage.has('user'), true);
  window.location.pathname = '/clients';
  assert.equal(await api.validateToken(), false);
  assert.equal(storage.has('user'), false);
  assert.equal(window.location.href, '/login');
});

test('non-JSON bodies come back as text, network failures as an error', async () => {
  assert.equal(await api.getServers(), 'plain text');
  const down = createServer();
  down.listen(0, '127.0.0.1');
  await once(down, 'listening');
  const port = down.address().port;
  await new Promise(resolve => down.close(resolve));
  window.location.origin = `http://127.0.0.1:${port}`;
  const err = await api.getServers().catch(e => e);
  window.location.origin = origin;
  assert.ok(err instanceof HttpError);
  assert.equal(err.message, 'Network Error');
  assert.equal(err.response, undefined);
});
