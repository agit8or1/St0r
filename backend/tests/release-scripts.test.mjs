// npm run build && node --experimental-test-module-mocks tests/release-scripts.test.mjs
// The installer and updater shell scripts: signature checks on fresh installs,
// what runs as root, the root-owned updater files, and nginx/TLS handling.
// Runs only throwaway keys and temp directories; needs bash, ssh-keygen, tar.
import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

mock.module('../dist/utils/logger.js', { namedExports: { logger: { info() {}, warn() {}, error() {} } } });

const repo = new URL('../../', import.meta.url).pathname;
const installSh = join(repo, 'install.sh');
const updater = readFileSync(join(repo, 'setup/auto-update.sh'), 'utf-8');
const work = mkdtempSync(join(tmpdir(), 'stor-release-test-'));
after(() => rmSync(work, { recursive: true, force: true }));

/** Run bash with install.sh's functions loaded (it stops before doing anything). */
function lib(script, env = {}) {
  return spawnSync('bash', ['-c', `ST0R_INSTALLER_LIB=1; source "$INSTALL_SH"; ${script}`],
    { env: { ...process.env, INSTALL_SH: installSh, ...env }, encoding: 'utf-8' });
}

// A throwaway signing key and a release built the way scripts/sign-release.sh does.
const key = join(work, 'k');
execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'test', '-f', key]);
const testSigners = join(work, 'signers');
writeFileSync(testSigners, `st0r-release namespaces="st0r-release" ${readFileSync(key + '.pub', 'utf-8').split(' ').slice(0, 2).join(' ')}\n`);
function makeRelease(dir, version, innerVersion = version) {
  const tree = join(dir, `St0r-${version}`);
  mkdirSync(join(tree, 'backend'), { recursive: true });
  writeFileSync(join(tree, 'VERSION'), innerVersion + '\n');
  writeFileSync(join(tree, 'backend', 'marker'), 'release-content');
  const tarball = join(dir, `st0r-v${version}.tar.gz`);
  execFileSync('tar', ['czf', tarball, '-C', dir, `St0r-${version}`]);
  execFileSync('ssh-keygen', ['-Y', 'sign', '-q', '-f', key, '-n', 'st0r-release', tarball]);
  return tarball;
}

// ── 3. Fresh installs are signature-checked against the key inside install.sh ──
test('install.sh carries the same release key as setup/release-signers', () => {
  const r = lib('printf "%s\\n" "$RELEASE_SIGNERS"');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), readFileSync(join(repo, 'setup/release-signers'), 'utf-8').trim());
});

test('verify_release: only the bundled key is accepted', () => {
  const dir = mkdtempSync(join(work, 'v-'));
  const tarball = makeRelease(dir, '9.9.9');
  // Signed by some other key: refused against the bundled anchor.
  assert.notEqual(lib(`verify_release "${tarball}" "${tarball}.sig"`).status, 0);
  // Sanity: the same files verify against their own key...
  assert.equal(lib(`verify_release "${tarball}" "${tarball}.sig" "${testSigners}"`).status, 0);
  // ...but not once the tarball is changed.
  writeFileSync(tarball, Buffer.concat([readFileSync(tarball), Buffer.from('x')]));
  assert.notEqual(lib(`verify_release "${tarball}" "${tarball}.sig" "${testSigners}"`).status, 0);
  // A real signed release, when one is at hand locally.
  const real = join(repo, 'dist-release/st0r-v3.2.130.tar.gz');
  if (existsSync(real) && existsSync(real + '.sig')) {
    assert.equal(lib(`verify_release "${real}" "${real}.sig"`).status, 0);
  }
});

/** A fake curl that serves files from `served` by URL basename and logs every URL. */
function fakeCurl(served) {
  const bin = mkdtempSync(join(work, 'bin-'));
  const log = join(bin, 'urls');
  writeFileSync(join(bin, 'curl'), `#!/bin/bash
out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac; done
echo "$url" >> "${log}"
src="${served}/$(basename "$url")"
[ -f "$src" ] || exit 22
cp "$src" "$out"
`);
  chmodSync(join(bin, 'curl'), 0o755);
  return { env: { PATH: `${bin}:${process.env.PATH}` }, urls: () => readFileSync(log, 'utf-8').trim().split('\n') };
}

test('fresh install downloads the signed release asset and refuses a bad signature', () => {
  const served = mkdtempSync(join(work, 'served-'));
  makeRelease(served, '9.9.9');
  const curl = fakeCurl(served);
  const dest = join(work, 'dest-bad');
  const r = lib(`fetch_verified_release 9.9.9 "${dest}"`, curl.env);
  assert.notEqual(r.status, 0, 'a release signed by an unknown key must be refused');
  assert.match(r.stdout, /signature check FAILED/);
  assert.equal(existsSync(join(dest, 'backend')), false, 'nothing may be extracted');
  assert.deepEqual(curl.urls(), [
    'https://github.com/agit8or1/St0r/releases/download/v9.9.9/st0r-v9.9.9.tar.gz',
    'https://github.com/agit8or1/St0r/releases/download/v9.9.9/st0r-v9.9.9.tar.gz.sig',
  ]);
  for (const u of curl.urls()) assert.doesNotMatch(u, /archive\/refs/);
});

test('fresh install extracts a correctly signed release, and refuses a missing .sig or wrong VERSION', () => {
  const trusted = `RELEASE_SIGNERS="$(cat "${testSigners}")"`;
  const served = mkdtempSync(join(work, 'served-'));
  makeRelease(served, '9.9.9');
  const ok = join(work, 'dest-ok');
  const r = lib(`${trusted}; fetch_verified_release 9.9.9 "${ok}"`, fakeCurl(served).env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(join(ok, 'backend', 'marker'), 'utf-8'), 'release-content');

  rmSync(join(served, 'st0r-v9.9.9.tar.gz.sig'));
  assert.notEqual(lib(`${trusted}; fetch_verified_release 9.9.9 "${join(work, 'dest-nosig')}"`, fakeCurl(served).env).status, 0);

  const replay = mkdtempSync(join(work, 'served-'));
  makeRelease(replay, '9.9.9', '9.9.8'); // validly signed, but an older release inside
  const d = join(work, 'dest-replay');
  assert.notEqual(lib(`${trusted}; fetch_verified_release 9.9.9 "${d}"`, fakeCurl(replay).env).status, 0);
  assert.equal(existsSync(join(d, 'backend')), false);
});

test('install.sh no longer downloads GitHub source archives', () => {
  assert.doesNotMatch(readFileSync(installSh, 'utf-8'), /archive\/refs\/tags/);
});

// ── 4. TLS ──────────────────────────────────────────────────────────────────
test('re-running the installer keeps an existing nginx site (Certbot edits survive)', () => {
  const site = join(work, 'site');
  const certbotEdited = 'server {\n    listen 443 ssl; # managed by Certbot\n    ssl_certificate /etc/letsencrypt/live/x/fullchain.pem;\n}\n';
  writeFileSync(site, certbotEdited);
  const r = lib(`install_nginx_site "${join(repo, 'setup/nginx-site.conf')}" "${site}"`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(site, 'utf-8'), certbotEdited);
  const fresh = join(work, 'fresh-site');
  assert.equal(lib(`install_nginx_site "${join(repo, 'setup/nginx-site.conf')}" "${fresh}"`).status, 0);
  assert.equal(readFileSync(fresh, 'utf-8'), readFileSync(join(repo, 'setup/nginx-site.conf'), 'utf-8'));
});

test('--domain / --email are parsed and validated', () => {
  const p = (args) => lib(`parse_args ${args} && echo "D=$ST0R_DOMAIN E=$ST0R_EMAIL"`);
  assert.match(p('--domain backup.example.com --email ops@example.com').stdout, /D=backup\.example\.com E=ops@example\.com/);
  assert.match(p('--domain=backup.example.com').stdout, /D=backup\.example\.com E=$/m);
  for (const bad of ['--domain "x;id"', '--domain', '--domain "-d evil.example"', '--email ops@example.com', '--bogus']) {
    assert.notEqual(p(bad).status, 0, bad);
  }
});

test('installer points plain-HTTP installs at the HTTPS next step', () => {
  const src = readFileSync(installSh, 'utf-8');
  assert.match(src, /enable_https "\$ST0R_DOMAIN"/);
  assert.match(src, /Next step — enable HTTPS/);
  assert.match(src, /certbot --nginx -d "\$domain" --non-interactive --agree-tos --redirect/);
});

// ── 1. The update path installs only the signed lockfile, without scripts ──
test('updater: npm runs only as the service user, from the lockfile, without install scripts', () => {
  const code = updater.split('\n').filter((l) => !/^\s*#/.test(l));
  const npmLines = code.filter((l) => /\bnpm\b/.test(l) && !/npm_config_|npm not found|Using npm|NODE_DIR\/npm|npm is run/.test(l));
  assert.ok(npmLines.length >= 4, npmLines.join('\n'));
  for (const l of npmLines) {
    assert.match(l, /^\s*(as_service|echo)/, `npm outside as_service: ${l}`);
    assert.doesNotMatch(l, /npm (install|i|update)\b/, l);
    assert.doesNotMatch(l, /audit fix/, l);
    if (/^\s*as_service/.test(l)) for (const cmd of l.matchAll(/npm (ci|prune)[^&']*/g)) assert.match(cmd[0], /--ignore-scripts/, l);
  }
  assert.doesNotMatch(code.join("\n"), /audit fix/);
  // Root's PATH never gains a user-writable (nvm) directory.
  for (const l of code.filter((x) => /export PATH=/.test(x))) assert.doesNotMatch(l, /home|nvm|NODE_DIR|\$PATH/, l);
});

test('updater: root trusts nothing from the install directory', () => {
  assert.match(updater, /^SIGNERS_FILE="\/etc\/st0r\/release-signers"$/m);
  assert.match(updater, /for mig in "\$SRC\/database\/migrations"\/\*\.sql/);
  assert.doesNotMatch(updater, /for mig in "\$INSTALL_DIR/);
  // File copies into /opt run as the service user. (The only root copy is the
  // self-copy of this root-owned script into a fresh mktemp file.)
  for (const l of updater.split('\n').filter((x) => /^\s*(rsync|cp) /.test(x) && !/"\$_self"$/.test(x))) assert.fail(`root copy: ${l}`);
  assert.match(updater, /bash "\$SRC\/setup\/install-root-files\.sh" "\$SRC" "\$SERVICE_USER"/);
});

// ── 2. Root-owned updater files and the no-argument launcher ────────────────
test('install-root-files.sh installs the updater, launcher, key and a no-argument sudo rule', () => {
  const dest = mkdtempSync(join(work, 'root-'));
  const r = spawnSync('bash', [join(repo, 'setup/install-root-files.sh'), repo, 'stor-svc'],
    { env: { ...process.env, ST0R_DESTDIR: dest }, encoding: 'utf-8' });
  assert.equal(r.status, 0, r.stderr);
  const mode = (p) => (statSync(join(dest, p)).mode & 0o7777).toString(8);
  assert.equal(mode('usr/local/lib/st0r/auto-update.sh'), '755');
  assert.equal(mode('usr/local/lib/st0r/start-update'), '755');
  assert.equal(mode('etc/st0r/release-signers'), '644');
  assert.equal(mode('etc/sudoers.d/st0r-update'), '440');
  assert.equal(readFileSync(join(dest, 'etc/st0r/release-signers'), 'utf-8'), readFileSync(join(repo, 'setup/release-signers'), 'utf-8'));
  const rule = readFileSync(join(dest, 'etc/sudoers.d/st0r-update'), 'utf-8').split('\n').filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(rule, ['stor-svc ALL=(root) NOPASSWD: /usr/local/lib/st0r/start-update ""']);
  for (const bad of ['root ALL', 'a;b', '../x', '']) {
    const b = spawnSync('bash', [join(repo, 'setup/install-root-files.sh'), repo, bad], { env: { ...process.env, ST0R_DESTDIR: dest } });
    assert.notEqual(b.status, 0, bad);
  }
});

test('the launcher takes no arguments', () => {
  const r = spawnSync('bash', [join(repo, 'setup/start-update.sh'), '/tmp/evil.sh'], { encoding: 'utf-8' });
  assert.equal(r.status, 2);
  const src = readFileSync(join(repo, 'setup/start-update.sh'), 'utf-8');
  assert.match(src, /^UPDATER=\/usr\/local\/lib\/st0r\/auto-update\.sh$/m);
  assert.doesNotMatch(src, /\/opt\//);
});

test('the panel starts updates only through the launcher, with no arguments', async () => {
  const { updateLaunchCommand, UPDATE_LAUNCHER } = await import('../dist/controllers/system.js');
  assert.equal(UPDATE_LAUNCHER, '/usr/local/lib/st0r/start-update');
  assert.deepEqual(updateLaunchCommand(true), ['sudo', ['-n', '/usr/local/lib/st0r/start-update']]);
  assert.deepEqual(updateLaunchCommand(true, false), ['sudo', ['-n', '/usr/local/lib/st0r/start-update']]);
  // Installs from before the launcher: the updater copy runs once and installs it.
  const legacy = updateLaunchCommand(false, true);
  assert.equal(legacy[1].at(-1), '/opt/urbackup-gui/setup/auto-update.sh');
  assert.equal(updateLaunchCommand(false, false), null);
});

test('install.sh: root reads the unit, nginx template, schema and updater from the staged source', () => {
  const src = readFileSync(installSh, 'utf-8');
  assert.match(src, /"\$SRC_DIR\/setup\/urbackup-gui\.service" > \/etc\/systemd\/system\/urbackup-gui\.service/);
  assert.match(src, /install_nginx_site "\$SRC_DIR\/setup\/nginx-site\.conf"/);
  assert.match(src, /bash "\$SRC_DIR\/setup\/install-root-files\.sh" "\$SRC_DIR" "\$ACTUAL_USER"/);
  assert.doesNotMatch(src, /chown -R/);
  assert.doesNotMatch(src, /\$INSTALL_DIR\/(database|setup)\//);
  assert.doesNotMatch(src, /npm install|audit fix/);
});
