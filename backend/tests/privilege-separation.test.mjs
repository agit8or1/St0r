// npm run build && node --experimental-test-module-mocks tests/privilege-separation.test.mjs
// St0r runs as its own unprivileged account; its only root access is the update
// launcher and the root-owned helper, which validates every request itself.
// Also: the sqlite3 native binary is checked against a pinned SHA-256.
// No root needed: the shell code is sourced with stand-ins for the commands
// that would need it.
import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

mock.module('../dist/utils/logger.js', { namedExports: { logger: { info() {}, warn() {}, error() {}, debug() {} } } });

const repo = new URL('../../', import.meta.url).pathname;
const helper = join(repo, 'setup/st0r-helper.sh');
const serviceLib = join(repo, 'setup/service-user.sh');
const work = realpathSync(mkdtempSync(join(tmpdir(), 'stor-priv-test-')));
after(() => rmSync(work, { recursive: true, force: true }));
const bash = (script, env = {}) => spawnSync('bash', ['-c', script], { env: { ...process.env, ...env }, encoding: 'utf-8' });

// ── The backend has no general sudo ─────────────────────────────────────────
test('the backend runs sudo only for the launcher, the helper, and the one-time legacy update', () => {
  const files = execFileSync('grep', ['-rlE', "'sudo'|\"sudo\"", join(repo, 'backend/src')]).toString().trim().split('\n')
    .map((f) => f.slice(repo.length)).sort();
  assert.deepEqual(files, ['backend/src/controllers/system.ts', 'backend/src/utils/privileged.ts']);
  const system = readFileSync(join(repo, 'backend/src/controllers/system.ts'), 'utf-8');
  // In system.ts: the launcher, and the legacy bootstrap for installs without it.
  const uses = system.split('\n').filter((l) => /'sudo'/.test(l));
  assert.equal(uses.length, 3, uses.join('\n'));
  for (const l of uses) assert.match(l, /UPDATE_LAUNCHER|\['sudo', \[$|reset-failed', 'urbackup-gui-update\.service'/, l);
});

test('helper calls go through sudo -n to the root-owned helper, and fail clearly without it', async () => {
  const { helperCommand, runHelper, HELPER, HelperMissingError } = await import('../dist/utils/privileged.js');
  assert.equal(HELPER, '/usr/local/lib/st0r/st0r-helper');
  assert.deepEqual(helperCommand('delete-backup', ['/x/y/z']), ['sudo', ['-n', HELPER, 'delete-backup', '/x/y/z']]);
  if (!existsSync(HELPER)) await assert.rejects(runHelper('reboot'), HelperMissingError);
});

// ── The helper validates everything itself ──────────────────────────────────
// Source it (main does not run), pretend to be root, and point the storage
// folder at a temp tree. Only refusals are exercised: those exit before any
// real command runs.
const storage = join(work, 'storage');
mkdirSync(join(storage, 'clientA', '261107-2000_Image_C'), { recursive: true });
mkdirSync(join(storage, 'clientA', '261107-2000'), { recursive: true });
writeFileSync(join(storage, 'clientA', '261107-2000_Image_C', 'Image_C.vhdz'), 'img');
mkdirSync(join(work, 'elsewhere', 'x'), { recursive: true });
symlinkSync(join(work, 'elsewhere', 'x'), join(storage, 'clientA', 'escape'));
function helperRun(...args) {
  const quoted = args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
  return bash(`source "${helper}"; id() { echo 0; }; backup_folder() { printf '%s\\n' "${storage}"; }; main ${quoted}`);
}

test('helper: delete-backup accepts only a backup inside the storage folder', () => {
  const ok = bash(`source "${helper}"; backup_folder() { printf '%s\\n' "${storage}"; }; inside_storage "${storage}/clientA/261107-2000"`);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout.trim(), `${storage}/clientA/261107-2000`);
  for (const bad of [
    storage,                                   // the storage folder itself
    `${storage}/clientA`,                      // a whole client
    `${storage}/clientA/../clientA`,           // still a whole client
    `${storage}/clientA/261107-2000/../..`,    // climbs out
    `${storage}/clientA/escape`,               // a link out of the storage folder
    join(work, 'elsewhere', 'x'),              // somewhere else entirely
    'clientA/261107-2000',                     // relative
    '/etc',
  ]) {
    const r = helperRun('delete-backup', bad);
    assert.equal(r.status, 2, `${bad}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /^st0r-helper: /m, bad);
  }
});

test('helper: argument checks', () => {
  const refused = [
    ['bogus'],
    ['reboot', 'now'],                         // takes no arguments
    ['os-update', '--extra'],
    ['urbackup-cleanup'],
    ['urbackup-cleanup', '5%; reboot'],
    ['urbackup-cleanup', '-a'],
    ['urbackup-cleanup', '99999G'],
    ['journal', '0'],
    ['journal', '1001'],
    ['journal', '5 -u ssh'],
    ['vhd-cleanup', '/tmp'],
    ['vhd-cleanup', '/tmp/st0r-vhd-ABCDEFGHIJ/../../etc'],
    ['vhd-cleanup', '/etc/st0r-vhd-ABCDEFGHIJ'],
    ['vhd-decompress', `${storage}/clientA/261107-2000`],           // not a .vhdz
    ['vhd-decompress', join(work, 'elsewhere', 'x')],
    ['delete-backup', `${storage}/clientA/261107-2000\nx`],          // control characters
  ];
  for (const args of refused) {
    const r = helperRun(...args);
    assert.equal(r.status, 2, `${JSON.stringify(args)}: ${r.stdout}${r.stderr}`);
  }
  // A real decompress request still needs the caller's group from sudo.
  const r = helperRun('vhd-decompress', `${storage}/clientA/261107-2000_Image_C/Image_C.vhdz`);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /through sudo/);
});

test('helper refuses to run as anyone but root', () => {
  const r = spawnSync('bash', [helper, 'journal', '5'], { encoding: 'utf-8' });
  if (process.getuid() !== 0) {
    assert.equal(r.status, 2);
    assert.match(r.stderr, /must be run as root/);
  }
});

// ── The service account ────────────────────────────────────────────────────
test('install.sh runs St0r as the st0r account, not as the user who ran sudo', () => {
  const src = readFileSync(join(repo, 'install.sh'), 'utf-8');
  assert.doesNotMatch(src, /sudo -u "\$ACTUAL_USER"/);
  assert.doesNotMatch(src, /(chown|usermod|install-root-files\.sh).*\$ACTUAL_USER/);
  assert.match(src, /SERVICE_USER="\$ST0R_USER"/);
  assert.match(src, /\. "\$SRC_DIR\/setup\/service-user\.sh"/);
  assert.match(readFileSync(join(repo, 'setup/urbackup-gui.service'), 'utf-8'), /^User=st0r$/m);
  assert.match(readFileSync(serviceLib, 'utf-8'), /^ST0R_USER=st0r$/m);
});

test('st0r_migrate hands the install, its backups and the unit to the new account', () => {
  const t = mkdtempSync(join(work, 'mig-'));
  mkdirSync(join(t, 'opt', 'urbackup-gui', 'backend'), { recursive: true });
  writeFileSync(join(t, 'opt', 'urbackup-gui', 'backend', '.env'), 'X=1\n');
  mkdirSync(join(t, 'opt', 'urbackup-gui-backup-20261110-133357'));
  writeFileSync(join(t, 'unit'), '[Service]\nUser=administrator\nGroup=administrator\nExecStart=/usr/bin/node x\n');
  // find -exec runs chown from PATH, so the stand-in is an executable.
  mkdirSync(join(t, 'bin'));
  writeFileSync(join(t, 'bin', 'chown'), `#!/bin/sh\necho "chown $*" >> "${t}/calls"\n`, { mode: 0o755 });
  const r = bash(`
    source "${serviceLib}"
    ST0R_INSTALL_DIR="${t}/opt/urbackup-gui"; ST0R_BACKUP_PREFIX="${t}/opt/urbackup-gui-backup-"
    ST0R_UNIT_FILE="${t}/unit"; ST0R_ROOT_LOGS=()
    id() { echo st0r; }
    systemctl() { echo "systemctl $*" >> "${t}/calls"; }
    st0r_migrate administrator st0r`, { PATH: `${join(t, 'bin')}:${process.env.PATH}` });
  assert.equal(r.status, 0, r.stderr);
  const calls = readFileSync(join(t, 'calls'), 'utf-8');
  for (const p of ['opt/urbackup-gui', 'opt/urbackup-gui/backend/.env', 'opt/urbackup-gui-backup-20261110-133357']) {
    assert.match(calls, new RegExp(`chown -h st0r:st0r .*${t}/${p}( |$)`, 'm'), p);
  }
  assert.match(calls, /systemctl daemon-reload/);
  const unit = readFileSync(join(t, 'unit'), 'utf-8');
  assert.match(unit, /^User=st0r$/m);
  assert.doesNotMatch(unit, /^Group=/m);
  assert.match(r.stdout, /Service user changed from administrator to st0r/);
});

test('st0r_preflight refuses a Node.js the service account could modify', () => {
  const r = bash(`
    source "${serviceLib}"
    st0r_backup_folder() { :; }
    runuser() { shift 3; if [ "$1" = test ] && [ "$2" = -w ]; then [ "$3" = /opt/node/bin/node ]; return; fi; return 0; }
    st0r_preflight st0r /opt/node/bin/node`);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /could modify \/opt\/node\/bin\/node/);
  const ok = bash(`
    source "${serviceLib}"
    st0r_backup_folder() { :; }
    runuser() { shift 3; if [ "$1" = test ] && [ "$2" = -w ]; then return 1; fi; return 0; }
    st0r_preflight st0r /usr/bin/node`);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});

test('updater moves the install to the st0r account after stopping it, and back on failure', () => {
  const u = readFileSync(join(repo, 'setup/auto-update.sh'), 'utf-8');
  const at = (re) => { const m = re.exec(u); assert.ok(m, String(re)); return m.index; };
  const stop = at(/^systemctl stop urbackup-gui/m);
  const migrate = at(/^\s+st0r_migrate "\$SERVICE_USER" "\$ST0R_USER"$/m);
  const copy = at(/^as_service rsync -a --exclude='\.env'/m);
  assert.ok(stop < migrate && migrate < copy, 'stop → migrate → copy');
  assert.match(u, /\. "\$SRC\/setup\/service-user\.sh"/);                  // from the verified release
  assert.match(u, /if why=\$\(st0r_preflight "\$ST0R_USER" "\$NODE_BIN"\)/);
  // rollback() reverts the account before restoring files
  const rb = u.slice(u.indexOf('rollback() {'), u.indexOf('trap rollback ERR'));
  assert.ok(rb.indexOf('st0r_migrate "$SERVICE_USER" "$MIGRATED_FROM"') < rb.indexOf('rsync -a --delete'), rb);
  // ...and so does an unhealthy start
  assert.match(u, /if st0r_service_healthy; then[\s\S]*?st0r_migrate "\$SERVICE_USER" "\$MIGRATED_FROM"/);
});

// ── The sqlite3 binary is the pinned one ───────────────────────────────────
const lock = JSON.parse(readFileSync(join(repo, 'backend/package-lock.json'), 'utf-8'));
const sqliteVersion = lock.packages['node_modules/sqlite3'].version;
const sums = readFileSync(join(repo, 'setup/sqlite3-prebuilt.sha256'), 'utf-8');

test('a pinned sqlite3 binary exists for the locked sqlite3 version', () => {
  for (const plat of ['linux-x64', 'linux-arm64', 'linuxmusl-x64', 'linuxmusl-arm64']) {
    assert.match(sums, new RegExp(`^[0-9a-f]{64}  sqlite3-v${sqliteVersion.replace(/\./g, '\\.')}-napi-v6-${plat}\\.tar\\.gz$`, 'm'), plat);
  }
});

test('installs never fetch the sqlite3 binary unchecked', () => {
  for (const f of ['install.sh', 'setup/auto-update.sh', 'docs/installation.md']) {
    const src = readFileSync(join(repo, f), 'utf-8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    assert.doesNotMatch(src, /npm rebuild sqlite3(?! --build-from-source)/, f);
    assert.match(src, /install-sqlite3\.sh/, f);
  }
});

function fakeSqliteTree(binary) {
  const t = mkdtempSync(join(work, 'sq-'));
  const backend = join(t, 'backend');
  mkdirSync(join(backend, 'node_modules', 'sqlite3'), { recursive: true });
  writeFileSync(join(backend, 'node_modules', 'sqlite3', 'package.json'), JSON.stringify({ name: 'sqlite3', version: '6.0.1' }, null, 2));
  // The "release asset": build/Release/node_sqlite3.node in a tarball.
  mkdirSync(join(t, 'asset', 'build', 'Release'), { recursive: true });
  writeFileSync(join(t, 'asset', 'build', 'Release', 'node_sqlite3.node'), binary);
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const libc = /musl/i.test(spawnSync('ldd', ['--version'], { encoding: 'utf-8' }).stderr + spawnSync('ldd', ['--version'], { encoding: 'utf-8' }).stdout) ? 'linuxmusl' : 'linux';
  const name = `sqlite3-v6.0.1-napi-v6-${libc}-${arch}.tar.gz`;
  mkdirSync(join(t, 'srv', 'v6.0.1'), { recursive: true });
  execFileSync('tar', ['czf', join(t, 'srv', 'v6.0.1', name), '-C', join(t, 'asset'), 'build']);
  // curl stand-in: "downloads" from the local srv directory.
  mkdirSync(join(t, 'bin'));
  writeFileSync(join(t, 'bin', 'curl'), `#!/bin/bash\nout=""; url=""\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; --proto|--max-time) shift 2;; -*) shift;; *) url="$1"; shift;; esac; done\necho "$url" >> "${t}/urls"\ncp "${t}/srv/\${url#file://srv/}" "$out"\n`, { mode: 0o755 });
  return { t, backend, name, digest: createHash('sha256').update(readFileSync(join(t, 'srv', 'v6.0.1', name))).digest('hex') };
}
function installSqlite(f, sum) {
  writeFileSync(join(f.t, 'sums'), `# test\n${sum}  ${f.name}\n`);
  return spawnSync('bash', [join(repo, 'setup/install-sqlite3.sh'), f.backend], {
    env: { ...process.env, PATH: `${join(f.t, 'bin')}:${process.env.PATH}`, ST0R_SQLITE3_SUMS: join(f.t, 'sums'), ST0R_SQLITE3_BASE_URL: 'file://srv' },
    encoding: 'utf-8',
  });
}

test('install-sqlite3.sh installs the binary only when its SHA-256 matches the pin', () => {
  const good = fakeSqliteTree('GOOD-BINARY');
  const r = installSqlite(good, good.digest);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(good.backend, 'node_modules/sqlite3/build/Release/node_sqlite3.node'), 'utf-8'), 'GOOD-BINARY');
  assert.equal(readFileSync(join(good.t, 'urls'), 'utf-8').trim(), `file://srv/v6.0.1/${good.name}`);

  const bad = fakeSqliteTree('TAMPERED');
  const r2 = installSqlite(bad, good.digest);
  assert.notEqual(r2.status, 0);
  assert.match(r2.stderr, /does not match its pinned SHA-256/);
  assert.equal(existsSync(join(bad.backend, 'node_modules/sqlite3/build')), false);
});

