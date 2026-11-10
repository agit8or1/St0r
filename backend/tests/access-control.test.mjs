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
import { execFileSync } from 'node:child_process';

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
    res.on('finish', () => { const raw = Buffer.concat(chunks); resolve({ code: res.code, body: raw.toString(), raw }); });
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

// ── Folder download: which symlinks zip may follow ─────────────────────────
test('folder zip follows links inside the client folder, skips links out and loops', async () => {
  const b1 = join(storage, 'clientA', 'b1');
  mkdirSync(join(storage, 'clientA', '.directory_pool', 'p1'), { recursive: true });
  writeFileSync(join(storage, 'clientA', '.directory_pool', 'p1', 'pooled.txt'), 'pooled');
  symlinkSync('../.directory_pool/p1', join(b1, 'unchanged-dir'));          // allowed: own pool
  symlinkSync('../../clientB/b1', join(b1, 'other-customer-dir'));         // refused: other customer
  symlinkSync(root, join(b1, 'server-root'));                              // refused: outside storage
  symlinkSync('..', join(b1, 'sub', 'loop'));                              // refused: loop
  const r = await call(downloadFolder, admin, { clientId: '1', backupId: '7', path: '/' });
  assert.equal(r.code, 200);
  const zipPath = join(root, 'out.zip');
  writeFileSync(zipPath, r.raw);
  const names = execFileSync('unzip', ['-Z1', zipPath]).toString().trim().split('\n').sort();
  assert.ok(names.includes('inside.txt'), names.join(','));
  assert.ok(names.includes('unchanged-dir/pooled.txt'), names.join(','));
  assert.ok(names.includes('sub/deep.txt'), names.join(','));
  for (const n of names) assert.doesNotMatch(n, /other-customer|server-root|secret|escape|loop/, n);
});

// ── Download TOCTOU: the file actually opened must still be inside the folder ──
// A directory on the vetted path is swapped for a symlink after the realpath
// check. O_NOFOLLOW alone only covers the last component, so it opens the file.
const { openFileWithin, OutsideRootError } = await import('../dist/utils/safeOpen.js');
const { zipVettedFiles } = await import('../dist/controllers/browse.js');
const { ZipWriter } = await import('../dist/utils/zipStream.js');
const { open: openFile } = await import('node:fs/promises');
const { constants: fsc } = await import('node:fs');

function swappedTree() {
  const t = realpathSync(mkdtempSync(join(tmpdir(), 'stor-toctou-')));
  mkdirSync(join(t, 'client', 'real'), { recursive: true });
  mkdirSync(join(t, 'outside'));
  writeFileSync(join(t, 'client', 'real', 'ok.txt'), 'ok-data');
  writeFileSync(join(t, 'outside', 'ok.txt'), 'OUTSIDE');
  // "dir" passed the check as a real directory; it is now a link out.
  symlinkSync(join(t, 'outside'), join(t, 'client', 'dir'));
  symlinkSync(join(t, 'outside', 'ok.txt'), join(t, 'client', 'leaf'));
  after(() => rmSync(t, { recursive: true, force: true }));
  return { t, client: join(t, 'client') };
}

test('openFileWithin refuses a path whose directory was swapped for a link out', async () => {
  const { client } = swappedTree();
  const swapped = join(client, 'dir', 'ok.txt');
  // The protection this replaces: O_NOFOLLOW on the last component lets it through.
  const h = await openFile(swapped, fsc.O_RDONLY | fsc.O_NOFOLLOW);
  assert.equal((await h.readFile()).toString(), 'OUTSIDE');
  await h.close();
  await assert.rejects(openFileWithin(swapped, client), OutsideRootError);
  await assert.rejects(openFileWithin(join(client, 'leaf'), client), /ELOOP|symbolic/);
  const ok = await openFileWithin(join(client, 'real', 'ok.txt'), client);
  assert.equal((await ok.handle.readFile()).toString(), 'ok-data');
  await ok.handle.close();
});

/** Collect what a writer receives into a Buffer. */
function sinkToBuffer() {
  const chunks = [];
  const w = new Writable({ write(c, _e, cb) { chunks.push(c); cb(); } });
  const done = new Promise((resolve) => w.on('finish', () => resolve(Buffer.concat(chunks))));
  return { w, done };
}

test('folder zip skips an entry that left the client folder after the walk', async () => {
  const { t, client } = swappedTree();
  async function* entries() {
    yield { rel: 'real/ok.txt', path: join(client, 'real', 'ok.txt') };
    yield { rel: 'dir/ok.txt', path: join(client, 'dir', 'ok.txt') }; // vetted, then swapped
  }
  const { w, done } = sinkToBuffer();
  const skipped = [];
  await zipVettedFiles(entries(), client, w, (s) => skipped.push(s));
  const zipPath = join(t, 'out.zip');
  writeFileSync(zipPath, await done);
  assert.deepEqual(execFileSync('unzip', ['-Z1', zipPath]).toString().trim().split('\n'), ['real/ok.txt']);
  assert.equal(execFileSync('unzip', ['-p', zipPath, 'real/ok.txt']).toString(), 'ok-data');
  assert.doesNotMatch((await done).toString('latin1'), /OUTSIDE/);
  assert.deepEqual(skipped, [{ path: 'dir/ok.txt', reason: 'outside-root' }]);
});

test('folder zip is built in-process, without the zip command', async () => {
  const savedPath = process.env.PATH;
  process.env.PATH = '/nonexistent';
  let r;
  try {
    r = await call(downloadFolder, admin, { clientId: '1', backupId: '7', path: 'sub' });
  } finally {
    process.env.PATH = savedPath;
  }
  assert.equal(r.code, 200);
  const zipPath = join(root, 'sub.zip');
  writeFileSync(zipPath, r.raw);
  execFileSync('unzip', ['-tq', zipPath]);
  assert.equal(execFileSync('unzip', ['-p', zipPath, 'deep.txt']).toString(), 'deep');
});

for (const zip64 of [false, true]) {
  test(`zip writer output is a valid archive${zip64 ? ' (ZIP64 entries)' : ''}`, async () => {
    const t = realpathSync(mkdtempSync(join(tmpdir(), 'stor-zip-')));
    after(() => rmSync(t, { recursive: true, force: true }));
    const files = { 'empty.txt': Buffer.alloc(0), 'ünïcode/naïve.txt': Buffer.from('héllo'),
                    'random.bin': (await import('node:crypto')).randomBytes(300_000) };
    const { w, done } = sinkToBuffer();
    const zip = new ZipWriter(w, zip64 ? 0 : undefined);
    for (const [name, data] of Object.entries(files)) {
      const p = join(t, name.replace(/\//g, '_'));
      writeFileSync(p, data);
      const h = await openFile(p);
      await zip.addFile(name, h, await h.stat());
      await h.close();
    }
    await zip.finish();
    const zipPath = join(t, 'out.zip');
    writeFileSync(zipPath, await done);
    execFileSync('unzip', ['-tq', zipPath]);
    const py = `import sys, zipfile, json\nz = zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(json.dumps({i.filename: z.read(i).hex() for i in z.infolist()}))`;
    const got = JSON.parse(execFileSync('python3', ['-I', '-c', py, zipPath]).toString());
    assert.deepEqual(Object.keys(got).sort(), Object.keys(files).sort());
    for (const [name, data] of Object.entries(files)) assert.equal(got[name], data.toString('hex'), name);
  });
}
