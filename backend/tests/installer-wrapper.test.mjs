// npm run build && node tests/installer-wrapper.test.mjs
// UrBackup's installers keep an existing client's settings (old name and key),
// so St0r's downloads remove them first. Nothing here touches the real system:
// the Linux header runs against a temp dir, with `id` and `systemctl` stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linuxWrapperHeader, windowsWrapperScript, nsisString, buildWindowsWrapper, readInstaller } from '../dist/services/installerWrapper.js';

test('the Linux header removes the old client settings and runs the installer that follows it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'st0r-wrap-'));
  try {
    const p = join(dir, 'var', 'urbackup');
    mkdirSync(join(p, 'data'), { recursive: true });
    writeFileSync(join(p, 'data', 'settings.cfg'), 'computername=[object Object]\n');
    writeFileSync(join(p, 'server_idents.txt'), 'old\n');
    writeFileSync(join(p, 'urbackup_ecdsa409k1.pub'), 'keep\n');
    // A stand-in for UrBackup's installer, with binary bytes after a marker line
    // the way makeself appends its archive.
    const out = join(dir, 'ran');
    const payload = Buffer.concat([
      Buffer.from(`#!/bin/sh\necho "$@" > "${out}"\nexit 0\n#BIN\n`),
      Buffer.from([0, 255, 10, 13, 0, 1, 2, 10]),
    ]);
    const header = linuxWrapperHeader("Jen's PC").replaceAll('/usr/local/var/urbackup', p);
    const script = join(dir, 'install.sh');
    writeFileSync(script, Buffer.concat([Buffer.from(header), payload]));

    // Not root: refuses and changes nothing.
    const asUser = spawnSync('sh', [script], { encoding: 'utf8' });
    assert.notEqual(asUser.status, 0);
    assert.ok(existsSync(join(p, 'data', 'settings.cfg')));

    // Pretend to be root, and record instead of stopping a real service.
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'id'), '#!/bin/sh\necho 0\n', { mode: 0o755 });
    writeFileSync(join(bin, 'systemctl'), `#!/bin/sh\necho "$@" >> "${dir}/systemctl"\n`, { mode: 0o755 });
    execFileSync('sh', [script, '--force', 'x y'], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(readFileSync(join(dir, 'systemctl'), 'utf8'), 'stop urbackupclientbackend.service\n');
    assert.equal(readFileSync(out, 'utf8'), '--force x y\n');
    assert.ok(!existsSync(join(p, 'data')), 'old settings removed');
    assert.ok(!existsSync(join(p, 'server_idents.txt')), 'old server identity removed');
    assert.ok(existsSync(join(p, 'urbackup_ecdsa409k1.pub')), 'other files kept');

    // The payload is extracted byte for byte.
    const skip = Number(/tail -n \+(\d+)/.exec(header)[1]);
    const extracted = execFileSync('sh', ['-c', `tail -n +${skip} "$0"`, script]);
    assert.deepEqual(extracted, payload);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('NSIS strings cannot break out or expand variables', () => {
  assert.equal(nsisString('a"b`c\nd'), 'a b c d');
  assert.equal(nsisString('$PROGRAMFILES'), '$$PROGRAMFILES');
  const nsi = windowsWrapperScript('Jen $R0 "x"', '/tmp/in.exe', '/tmp/out.exe');
  assert.match(nsi, /Name "UrBackup Client \(Jen \$\$R0 {2}x \)"/);
  assert.match(nsi, /Uninstall\.exe" \/S _\?=\$OLD/);
  assert.match(nsi, /StrCpy \$R1 \$R0 "" -9/);
  assert.match(nsi, /\$R1 != "\\UrBackup"/);
});

const hasMakensis = spawnSync('makensis', ['-VERSION']).status === 0;

test('the Windows wrapper builds and carries the original installer unchanged', { skip: !hasMakensis && 'makensis not installed' }, async () => {
  const inner = Buffer.concat([Buffer.from('MZ fake installer '), Buffer.alloc(4096, 7), Buffer.from('computername=jens house')]);
  const built = await buildWindowsWrapper(inner, 'jens house');
  try {
    const exe = readFileSync(built.path);
    assert.equal(exe.subarray(0, 2).toString(), 'MZ');
    assert.ok(exe.includes(inner), 'inner installer stored uncompressed and unchanged');
  } finally {
    await built.cleanup();
  }
  assert.ok(!existsSync(built.path), 'temp files removed');
});

test('a short installer download is an error, not a broken installer', async () => {
  const body = Buffer.alloc(1000, 1);
  const ok = new Response(body, { headers: { 'content-length': '1000' } });
  assert.equal((await readInstaller(ok)).length, 1000);
  const short = new Response(body.subarray(0, 900), { headers: { 'content-length': '1000' } });
  await assert.rejects(readInstaller(short), /900 of 1000 bytes/);
});
