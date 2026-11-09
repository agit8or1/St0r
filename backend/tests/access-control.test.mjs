// npm run build && node --experimental-test-module-mocks --test tests/access-control.test.mjs
// Customer scoping and path-traversal checks on the backup browse/download
// endpoints. Only the databases and logger are mocked; scope.js, browse.js and
// the filesystem checks are the real code, run against a temp storage tree.
import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

// ── Storage tree ────────────────────────────────────────────────────────────
//   root/storage/clientA/b1/inside.txt
//   root/storage/clientA/b1/escape   -> root/secret.txt   (symlink out of the backup)
//   root/storage/clientA/b1x/sibling.txt                 (shares the "b1" prefix)
//   root/storage/clientB/b1/other-customer.txt
//   root/secret.txt
const root = realpathSync(mkdtempSync(join(tmpdir(), 'stor-access-')));
const storage = join(root, 'storage');
mkdirSync(join(storage, 'clientA', 'b1', 'sub'), { recursive: true });
mkdirSync(join(storage, 'clientA', 'b1x'), { recursive: true });
mkdirSync(join(storage, 'clientB', 'b1'), { recursive: true });
writeFileSync(join(storage, 'clientA', 'b1', 'inside.txt'), 'A-data');
writeFileSync(join(storage, 'clientA', 'b1x', 'sibling.txt'), 'sibling');
writeFileSync(join(storage, 'clientB', 'b1', 'other-customer.txt'), 'B-data');
writeFileSync(join(root, 'secret.txt'), 'SECRET');
symlinkSync(join(root, 'secret.txt'), join(storage, 'clientA', 'b1', 'escape'));
after(() => rmSync(root, { recursive: true, force: true }));

// ── Mocks ───────────────────────────────────────────────────────────────────
const clients = [{ id: 1, name: 'clientA' }, { id: 2, name: 'clientB' }];
// user 10: assigned to the customer that owns clientA. user 11: no assignment.
const assignments = { 10: [{ customer_id: 5, client_name: 'clientA' }], 11: [] };

mock.module('../dist/utils/logger.js', { namedExports: { logger: { info() {}, warn() {}, error() {}, debug() {} } } });
mock.module('../dist/config/database.js', { namedExports: {
  query: async (_sql, params) => assignments[params[0]] ?? [],
} });
mock.module('../dist/config/urbackupDb.js', { namedExports: {
  getUrBackupDb: async () => ({ get: async (_sql, id) => clients.find((c) => c.id === Number(id)) ?? null }),
  openUrBackupSettingsDbReadOnly: async () => ({ get: async () => ({ value: storage }), close: async () => {} }),
} });
mock.module('../dist/services/urbackupDb.js', { namedExports: {
  UrBackupDbService: class {
    async getClients() { return clients; }
    async getFileBackups() { return [{ id: 7, path: 'b1' }]; }
  },
} });

const { downloadFile, downloadFolder } = await import('../dist/controllers/browse.js');
const { isWithin } = await import('../dist/utils/safePath.js');

const admin = { userId: 1, username: 'admin', isAdmin: true };
const scoped = { userId: 10, username: 'tech-a', isAdmin: false };
const unassigned = { userId: 11, username: 'nobody', isAdmin: false };

/** Run a handler; resolves with { code, body } once it has answered or finished streaming. */
function call(handler, user, query) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const res = new Writable({ write(chunk, _enc, cb) { chunks.push(chunk); cb(); } });
    res.code = 200;
    res.headersSent = false;
    res.setHeader = () => {};
    res.status = (c) => { res.code = c; return res; };
    res.json = (body) => { res.headersSent = true; resolve({ code: res.code, body }); return res; };
    res.on('finish', () => resolve({ code: res.code, body: Buffer.concat(chunks).toString() }));
    const req = { user, query, ip: '127.0.0.1', headers: {}, cookies: {} };
    handler(req, res).catch(reject);
  });
}

// ── isWithin ────────────────────────────────────────────────────────────────
test('isWithin accepts the base and its children only', () => {
  assert.equal(isWithin('/data/c/b1', '/data/c/b1'), true);
  assert.equal(isWithin('/data/c/b1', '/data/c/b1/x/y'), true);
  assert.equal(isWithin('/data/c/b1', '/data/c/b1/..hidden'), true);
  assert.equal(isWithin('/data/c/b1', '/data/c/b1x/secret'), false);
  assert.equal(isWithin('/data/c/b1', '/data/c'), false);
  assert.equal(isWithin('/data/c/b1', '/etc/passwd'), false);
  assert.equal(isWithin('/', '/etc/passwd'), true);
});

// ── Customer scoping ────────────────────────────────────────────────────────
test('scoped user can download from an assigned client', async () => {
  const r = await call(downloadFile, scoped, { clientId: '1', backupId: '7', path: 'inside.txt' });
  assert.equal(r.code, 200);
  assert.equal(r.body, 'A-data');
});

test('scoped user is refused another customer\'s client', async () => {
  const r = await call(downloadFile, scoped, { clientId: '2', backupId: '7', path: 'other-customer.txt' });
  assert.equal(r.code, 403);
  assert.match(r.body.error, /not assigned/);
  const f = await call(downloadFolder, scoped, { clientId: '2', backupId: '7', path: '/' });
  assert.equal(f.code, 403);
});

test('non-admin with no customer assignment sees nothing', async () => {
  const r = await call(downloadFile, unassigned, { clientId: '1', backupId: '7', path: 'inside.txt' });
  assert.equal(r.code, 403);
});

test('admin is not scoped', async () => {
  const r = await call(downloadFile, admin, { clientId: '2', backupId: '7', path: 'other-customer.txt' });
  assert.equal(r.code, 200);
  assert.equal(r.body, 'B-data');
});

test('unknown client id is refused for a scoped user, not leaked as 404', async () => {
  const r = await call(downloadFile, scoped, { clientId: '99', backupId: '7', path: 'inside.txt' });
  assert.equal(r.code, 403);
});

// ── Path traversal ──────────────────────────────────────────────────────────
for (const [label, path] of [
  ['dot-dot out of the storage tree', '../../../secret.txt'],
  ['dot-dot into another customer', '../../clientB/b1/other-customer.txt'],
  ['dot-dot into a sibling sharing the prefix', '../b1x/sibling.txt'],
  ['symlink pointing out of the backup', 'escape'],
]) {
  test(`download refuses ${label}`, async () => {
    const r = await call(downloadFile, admin, { clientId: '1', backupId: '7', path });
    assert.equal(r.code, 403, `expected 403 for ${path}, got ${r.code}: ${JSON.stringify(r.body)}`);
    assert.doesNotMatch(String(r.body), /SECRET|B-data|sibling/);
  });
}

test('folder download refuses dot-dot out of the backup', async () => {
  const r = await call(downloadFolder, admin, { clientId: '1', backupId: '7', path: '../../clientB/b1' });
  assert.equal(r.code, 403);
});

test('a nested path inside the backup still works', async () => {
  writeFileSync(join(storage, 'clientA', 'b1', 'sub', 'deep.txt'), 'deep');
  const r = await call(downloadFile, admin, { clientId: '1', backupId: '7', path: 'sub/../sub/deep.txt' });
  assert.equal(r.code, 200);
  assert.equal(r.body, 'deep');
});
