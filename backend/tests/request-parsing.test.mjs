// npm run build && node --experimental-test-module-mocks tests/request-parsing.test.mjs
// Runs the real server in a disposable child process (see fixtures/isolated-server.mjs)
// on 127.0.0.1 and sends it malformed bodies and uploads. Nothing else is contacted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import { gzipSync, deflateSync } from 'node:zlib';

process.env.JWT_SECRET = 'offline-regression-key-not-for-production';
const { generateToken, credentialVersion } = await import('../dist/utils/auth.js');
const token = generateToken({ userId: 1, username: 'test', isAdmin: true, credentialVersion: credentialVersion('test-hash') });
const fixture = new URL('./fixtures/isolated-server.mjs', import.meta.url).pathname;

async function startServer(t) {
  const dir = await mkdtemp(join(tmpdir(), 'stor-backend-test-'));
  const allocator = createServer();
  allocator.listen(0, '127.0.0.1');
  await once(allocator, 'listening');
  const port = allocator.address().port;
  await new Promise(resolve => allocator.close(resolve));
  // cwd is the empty temp dir so dotenv finds no .env; multer's dest is tmpdir(), so
  // TMPDIR makes every upload temp file land where the test can see it.
  const env = { ...process.env, PORT: String(port), TMPDIR: dir };
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'URBACKUP_SERVER_URL']) delete env[key];
  const child = spawn(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', fixture],
                      { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit'); }
    await rm(dir, { recursive: true, force: true });
  });
  await Promise.race([
    new Promise((resolve, reject) => {
      child.stdout.on('data', () => { if (output.includes('Server running')) resolve(); });
      child.on('exit', code => reject(new Error(`Server exited ${code}: ${output}`)));
    }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error(`Server start timed out: ${output}`)), 15000); timer.unref(); }),
  ]);
  const url = `http://127.0.0.1:${port}`;
  return {
    url, port, dir,
    // The process must still be up and serving; output is included so a crash shows its stack.
    async assertAlive() {
      await new Promise(resolve => setTimeout(resolve, 250));
      assert.equal(child.exitCode, null, `server exited: ${output}`);
      assert.equal((await fetch(url + '/health')).status, 200, output);
    },
  };
}

const post = (url, body, headers) => fetch(url, { method: 'POST', body, headers });
async function assertControlledError(res, status) {
  assert.equal(res.status, status);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  const body = await res.json();
  assert.equal(typeof body.error, 'string');
  assert.equal(JSON.stringify(body).includes('node_modules'), false, 'stack trace leaked');
}

// GHSA-27r3-jxmh-p828: body-parser left the decoder piped after it finished a valid
// frame. The response went out normally, then the trailing bytes reached the finished
// decoder and its unhandled error terminated the process.
test('compressed body with trailing bytes does not crash the server', async t => {
  const server = await startServer(t);
  const trailer = Buffer.alloc(100 * 1024, 0x58);
  const cases = [
    ['gzip', 'application/json', gzipSync('{"username":"nobody","password":"x"}')],
    ['deflate', 'application/json', deflateSync('{"username":"nobody","password":"x"}')],
    ['gzip', 'application/x-www-form-urlencoded', gzipSync('username=nobody&password=x')],
  ];
  for (const [encoding, type, frame] of cases) {
    // Unauthenticated login: parsing runs before any credential check.
    const res = await post(server.url + '/api/auth/login', Buffer.concat([frame, Buffer.from([0]), trailer]),
                           { 'Content-Type': type, 'Content-Encoding': encoding })
      .catch(async err => { await server.assertAlive(); throw err; });
    assert.ok(res.status >= 400 && res.status < 500, `${encoding} ${type}: ${res.status}`);
    await res.arrayBuffer();
    await server.assertAlive();
  }
});

test('malformed compressed bodies get a controlled 4xx', async t => {
  const server = await startServer(t);
  const headers = { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' };
  await assertControlledError(await post(server.url + '/api/no-such-route', Buffer.from('not gzip at all'), headers), 400);
  await assertControlledError(await post(server.url + '/api/no-such-route', gzipSync('{"a":1}').subarray(0, 12), headers), 400);
  await assertControlledError(await post(server.url + '/api/no-such-route', Buffer.from('{}'),
    { 'Content-Type': 'application/json', 'Content-Encoding': 'br' }), 415);
  await server.assertAlive();
});

test('malformed, oversized and over-nested bodies are rejected', async t => {
  const server = await startServer(t);
  const json = { 'Content-Type': 'application/json' };
  await assertControlledError(await post(server.url + '/api/no-such-route', '{"a":', json), 400);
  // express.json() default limit is 100kb, also applied to the inflated size.
  await assertControlledError(await post(server.url + '/api/no-such-route', JSON.stringify({ a: 'x'.repeat(200 * 1024) }), json), 413);
  await assertControlledError(await post(server.url + '/api/no-such-route', gzipSync(JSON.stringify({ a: 'x'.repeat(200 * 1024) })),
    { ...json, 'Content-Encoding': 'gzip' }), 413);
  // urlencoded({ extended: true }) parses with qs; depth is capped at 32.
  await assertControlledError(await post(server.url + '/api/no-such-route', 'a' + '[b]'.repeat(40) + '=1',
    { 'Content-Type': 'application/x-www-form-urlencoded' }), 400);
  // Well-formed bodies still reach routing.
  const ok = await post(server.url + '/api/no-such-route', 'a[b][c]=1&a[d]=2', { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(ok.status, 404);
  await server.assertAlive();
});

function multipart(field, filename, content) {
  const boundary = '----stor-test-boundary';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
               'Content-Type: application/octet-stream\r\n\r\n';
  return { body: Buffer.concat([Buffer.from(head), content, Buffer.from(`\r\n--${boundary}--\r\n`)]),
           type: `multipart/form-data; boundary=${boundary}` };
}
const upload = (server, form, auth = true) => post(server.url + '/api/database-backup/upload-restore', form.body,
  { 'Content-Type': form.type, ...(auth ? { Authorization: `Bearer ${token}` } : {}) });
async function tempFiles(server) { return (await readdir(server.dir)).filter(name => !name.startsWith('.')); }

test('upload: authenticated admin upload is accepted and its temp file handled', async t => {
  const server = await startServer(t);
  const res = await upload(server, multipart('backup', 'dump.sql.gz', Buffer.from('-- small dump\n')));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { field: 'backup', name: 'dump.sql.gz', size: 14 });
  assert.deepEqual(await tempFiles(server), []);
});

test('upload: unauthenticated requests are refused before multer writes anything', async t => {
  const server = await startServer(t);
  const res = await upload(server, multipart('backup', 'dump.sql', Buffer.alloc(1024)), false);
  assert.equal(res.status, 401);
  assert.deepEqual(await tempFiles(server), []);
  await server.assertAlive();
});

test('upload: the 100 MB limit is enforced and the partial file removed', async t => {
  const server = await startServer(t);
  const res = await upload(server, multipart('backup', 'big.sql', Buffer.alloc(100 * 1024 * 1024 + 1)));
  await assertControlledError(res, 413);
  assert.deepEqual(await tempFiles(server), []);
  await server.assertAlive();
});

test('upload: an unexpected field name is rejected without leaving a file', async t => {
  const server = await startServer(t);
  await assertControlledError(await upload(server, multipart('other', 'dump.sql', Buffer.from('x'))), 400);
  assert.deepEqual(await tempFiles(server), []);
  await server.assertAlive();
});

test('upload: a malformed multipart body is a 400', async t => {
  const server = await startServer(t);
  const form = multipart('backup', 'dump.sql', Buffer.from('x'));
  // Cut before the closing boundary.
  await assertControlledError(await upload(server, { ...form, body: form.body.subarray(0, form.body.length - 30) }), 400);
  await assertControlledError(await upload(server, { body: Buffer.from('no boundary here'), type: 'multipart/form-data' }), 400);
  assert.deepEqual(await tempFiles(server), []);
  await server.assertAlive();
});

test('upload: a client that disconnects mid-upload does not crash the server or leak a file', async t => {
  const server = await startServer(t);
  const form = multipart('backup', 'dump.sql', Buffer.alloc(4 * 1024 * 1024));
  const socket = connect(server.port, '127.0.0.1');
  await once(socket, 'connect');
  socket.write(`POST /api/database-backup/upload-restore HTTP/1.1\r\nHost: 127.0.0.1\r\n` +
               `Authorization: Bearer ${token}\r\nContent-Type: ${form.type}\r\nContent-Length: ${form.body.length}\r\n\r\n`);
  socket.write(form.body.subarray(0, form.body.length / 2));
  await new Promise(resolve => setTimeout(resolve, 300));
  socket.destroy();
  for (let i = 0; i < 40 && (await tempFiles(server)).length; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(await tempFiles(server), []);
  await server.assertAlive();
});
