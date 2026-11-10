// npm run build && node --experimental-test-module-mocks --test tests/recovery-file-drill.test.mjs
// The file-restore drill end to end, against disposable infrastructure: a
// throwaway sshd on 127.0.0.1 plays the offsite standby (the second UrBackup
// server a replication target writes to), holding a disposable copy of the
// backup tree. The drill restores a canary from it over real SSH, with the
// target's pinned host key and encrypted private key, exactly as configured
// for replication. Runs here are actual restores of disposable data.
process.env.APP_SECRET_KEY = 'ab'.repeat(32);
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, readdirSync, realpathSync, chmodSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { MemoryStore, MemoryConfig, drill as makeDrill, quietLog } from './fixtures/drill-store.mjs';

// St0r's databases are not used here: the drill gets its config and restore points from fixtures.
mock.module('../dist/utils/logger.js', { namedExports: { logger: { info() {}, warn() {}, error() {}, debug() {} } } });
mock.module('../dist/config/database.js', { namedExports: { query: async () => { throw new Error('no database in this test'); } } });
mock.module('../dist/config/urbackupDb.js', { namedExports: { getUrBackupDb: async () => { throw new Error('no UrBackup db'); }, openUrBackupSettingsDbReadOnly: async () => { throw new Error('no UrBackup db'); } } });

const { encrypt } = await import('../dist/services/secrets.js');
const { DrillRunner } = await import('../dist/services/drills/runner.js');
const { fileDrillAttempt } = await import('../dist/services/drills/fileDrill.js');
const { SshStandby } = await import('../dist/services/drills/standby.js');
const { ScratchRemover } = await import('../dist/services/drills/scratch.js');
const { knownHostsLine } = await import('../dist/services/sshTarget.js');

const have = (p) => existsSync(p);
const skip = !have('/usr/sbin/sshd') || !have('/usr/bin/ssh-keygen') ? 'sshd/ssh-keygen not installed' : false;

const root = realpathSync(mkdtempSync(join(tmpdir(), 'stor-filedrill-')));
const scratch = join(root, 'scratch');
const standbyRepl = join(root, 'standby', 'repl');       // the target's copy of the storage folder
const LOCAL_STORAGE = '/srv/urbackup-storage';          // the primary's storage folder (never read)
const clientDir = join(standbyRepl, 'clientA');
const CANARY_PATH = 'C/Users/Public/Documents/st0r-canary.bin';
const canaryContent = Buffer.concat([Buffer.from('St0r recovery canary test\n'), randomBytes(65536)]);
const canarySha = createHash('sha256').update(canaryContent).digest('hex');
let sshd; let port; let target; let hostPub;

const hours = (h) => new Date(Date.now() - h * 3600_000);
const backups = [
  { id: 30, backup_time: hours(1), path: '261110-1200', incremental: true },   // not replicated yet
  { id: 20, backup_time: hours(25), path: '261109-1100', incremental: true },  // on the standby
  { id: 10, backup_time: hours(49), path: '261108-1000', incremental: false }, // on the standby
];

function putCanary(backup, content = canaryContent) {
  const p = join(clientDir, backup, CANARY_PATH);
  mkdirSync(join(p, '..'), { recursive: true });
  rmSync(p, { force: true });
  writeFileSync(p, content);
  return p;
}

function freePort() {
  return new Promise((resolve) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

async function startSshd() {
  const d = join(root, 'sshd');
  mkdirSync(d, { recursive: true });
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(d, 'host'), '-C', '']);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(d, 'client'), '-C', '']);
  writeFileSync(join(d, 'authorized_keys'), readFileSync(join(d, 'client.pub')));
  chmodSync(join(d, 'authorized_keys'), 0o600);
  port = await freePort();
  writeFileSync(join(d, 'sshd_config'), [
    `Port ${port}`, 'ListenAddress 127.0.0.1', `HostKey ${join(d, 'host')}`, `AuthorizedKeysFile ${join(d, 'authorized_keys')}`,
    'PasswordAuthentication no', 'KbdInteractiveAuthentication no', 'UsePAM no', 'StrictModes no', `PidFile ${join(d, 'pid')}`,
    'LogLevel ERROR', '',
  ].join('\n'));
  sshd = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', join(d, 'sshd_config')], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; sshd.stderr.on('data', (x) => { err += x; });
  // Wait for the port.
  for (let i = 0; i < 100; i++) {
    const up = await new Promise((resolve) => { const s = createServer(); s.once('error', () => resolve(true)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(false))); });
    if (up) break;
    if (sshd.exitCode !== null) throw new Error(`sshd exited: ${err}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  hostPub = readFileSync(join(d, 'host.pub'), 'utf-8').trim().split(' ').slice(0, 2).join(' ');
  return { privateKey: readFileSync(join(d, 'client'), 'utf-8') };
}

before(async () => {
  if (skip) return;
  const { privateKey } = await startSshd();
  target = {
    id: 'target-1', name: 'standby-1', host: '127.0.0.1', port, ssh_user: userInfo().username, auth_type: 'ssh_key',
    ssh_private_key_encrypted: encrypt(privateKey), ssh_known_host_fingerprint: hostPub, enabled: true,
    target_root_path: '/unused', target_repo_paths_map: { [LOCAL_STORAGE]: standbyRepl },
  };
});
after(() => { sshd?.kill(); rmSync(root, { recursive: true, force: true }); });

function setup({ drillOver = {}, targetOver = {}, maxCanaryBytes = 1024 * 1024, standby } = {}) {
  const store = new MemoryStore();
  const alerts = [];
  const d = makeDrill(drillOver);
  const config = new MemoryConfig({
    drills: [d],
    canaries: [{ id: 'canary-1', client_name: 'clientA', path: CANARY_PATH, sha256: canarySha, size_bytes: canaryContent.length, source: 'generated', note: null }],
    targets: [{ ...target, ...targetOver }],
    channels: [{ id: 'ch', type: 'webhook', enabled: true, config_json: {} }],
    replication: { 'target-1': { lastSuccess: { run_id: 'repl-9', status: 'success', finished_at: hours(2) }, last: null } },
  });
  const points = { storageFolder: async () => LOCAL_STORAGE, fileBackups: async () => backups, imageBackups: async () => [], associatedImages: async () => [] };
  const runner = new DrillRunner({
    store, config, sendAlert: async (e) => { alerts.push(e); }, log: quietLog, retryDelayMs: 10,
    removers: async (r) => (r.kind === 'scratch_dir' ? new ScratchRemover(scratch) : { remove: async () => 'gone' }),
    attempt: {
      file: (ctx, dr) => fileDrillAttempt(ctx, dr, {
        config, points, scratchRoot: scratch, maxCanaryBytes,
        standby: standby ?? ((t, ms) => new SshStandby(t, ms)),
      }),
      boot: async () => { throw new Error('not used'); },
    },
  });
  return { store, alerts, runner, drill: d };
}

const scratchEmpty = () => !existsSync(scratch) || readdirSync(scratch).length === 0;

test('restores the canary from the offsite copy and verifies it (actual evidence)', { skip }, async () => {
  rmSync(clientDir, { recursive: true, force: true });
  putCanary('261109-1100');
  putCanary('261108-1000');
  const { runner, drill, store, alerts } = setup();
  const run = await runner.runToCompletion(drill);
  assert.equal(run.status, 'passed', run.failure_reason);
  assert.equal(run.evidence, 'actual');
  // The newest backup had not reached the standby; the newest one that had was used.
  assert.equal(run.restore_point_json.backup_id, 20);
  assert.equal(run.restore_point_json.backup_path, '261109-1100');
  assert.ok(run.recovery_point_age_seconds >= 25 * 3600 - 5 && run.recovery_point_age_seconds <= 25 * 3600 + 60);
  assert.equal(run.restore_point_json.rpo_exceeded, false);
  // The exact copy: which target, which file on it, and the replication it came from.
  assert.equal(run.copy_json.kind, 'offsite');
  assert.equal(run.copy_json.target_id, 'target-1');
  assert.equal(run.copy_json.path, join(clientDir, '261109-1100', CANARY_PATH));
  assert.equal(run.copy_json.last_successful_replication.run_id, 'repl-9');
  assert.equal(run.expected_sha256, canarySha);
  assert.equal(run.actual_sha256, canarySha);
  assert.equal(run.bytes_restored, canaryContent.length);
  assert.ok(run.elapsed_ms >= 0 && run.finished_at);
  assert.equal(run.attempts, 1);
  assert.ok(run.steps_json.some((s) => /261110-1200.*not on the standby/.test(s.message)));
  // Scratch storage was used and removed.
  const res = await store.resourcesForRun(run.id);
  assert.equal(res.length, 1);
  assert.equal(res[0].kind, 'scratch_dir');
  assert.equal(res[0].state, 'deleted');
  assert.equal(run.cleanup_status, 'done');
  assert.ok(scratchEmpty());
  assert.equal(alerts.length, 0);
});

test('a corrupt offsite copy fails verification, is not retried and alerts', { skip }, async () => {
  const bad = Buffer.from(canaryContent); bad[4000] ^= 0xff;
  putCanary('261109-1100', bad);
  const { runner, drill, alerts } = setup();
  const run = await runner.runToCompletion(drill);
  assert.equal(run.status, 'failed');
  assert.equal(run.failure_stage, 'verify');
  assert.match(run.failure_reason, /does not match its expected checksum/);
  assert.match(run.failure_reason, /261109-1100 on standby-1/);
  assert.equal(run.attempts, 1, 'a checksum mismatch is not retried');
  assert.equal(run.restore_point_json.backup_id, 20, 'it does not fall back to an older backup');
  assert.notEqual(run.actual_sha256, canarySha);
  assert.equal(run.actual_sha256, createHash('sha256').update(bad).digest('hex'));
  assert.equal(run.cleanup_status, 'done');
  assert.ok(scratchEmpty());
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'drill_failed');
  assert.equal(alerts[0].severity, 'critical');
  assert.equal(alerts[0].target_id, 'drill-1');
  putCanary('261109-1100');
});

test('the canary passes again: a recovery alert follows a failure', { skip }, async () => {
  const { runner, drill, store, alerts } = setup();
  await store.createRun({ id: 'old', drill_id: drill.id, kind: 'file', client_name: 'clientA', evidence: 'actual', status: 'failed', started_at: hours(3), attempts: 1, cleanup_status: 'done' });
  const run = await runner.runToCompletion(drill);
  assert.equal(run.status, 'passed');
  assert.deepEqual(alerts.map((a) => a.type), ['drill_recovered']);
});

test('a missing standby is retried, then fails at connect with nothing created', { skip }, async () => {
  const closed = await freePort();
  const { runner, drill, store } = setup({ targetOver: { port: closed, name: 'standby-gone' } });
  const run = await runner.runToCompletion(drill);
  assert.equal(run.status, 'failed');
  assert.equal(run.failure_stage, 'connect');
  assert.match(run.failure_reason, /standby-gone .* is unreachable/);
  assert.equal(run.attempts, 2, 'retried once (retry_max_attempts = 2)');
  assert.equal((await store.resourcesForRun(run.id)).length, 0);
  assert.equal(run.cleanup_status, 'none');
});

test('a canary that resolves outside its backup on the standby is ignored', { skip }, async () => {
  const outside = join(root, 'outside.bin');
  writeFileSync(outside, canaryContent);
  const p = join(clientDir, '261109-1100', CANARY_PATH);
  rmSync(p); symlinkSync(outside, p);
  const { runner, drill } = setup();
  const run = await runner.runToCompletion(drill);
  assert.equal(run.status, 'passed');
  assert.equal(run.restore_point_json.backup_id, 10, 'the escaping link is skipped; the older genuine copy is used');
  assert.ok(run.steps_json.some((s) => /resolves outside the backup/.test(s.message)));
  putCanary('261109-1100');
});

test('no backup on the standby holds the canary: restore-point failure', { skip }, async () => {
  const { runner, drill } = setup({ drillOver: { retry_max_attempts: 1 } });
  const saved = backups.splice(0);
  backups.push({ id: 99, backup_time: hours(1), path: '261110-0900', incremental: true });
  try {
    const run = await runner.runToCompletion(drill);
    assert.equal(run.status, 'failed');
    assert.equal(run.failure_stage, 'restore-point');
    assert.match(run.failure_reason, /None of the 1 newest backups/);
  } finally { backups.splice(0, backups.length, ...saved); }
});

test('the recovery point is older than allowed: passes, flagged, alerted', { skip }, async () => {
  const { runner, drill, alerts } = setup({ drillOver: { max_recovery_point_age_hours: 12 } });
  const run = await runner.runToCompletion(drill);
  assert.equal(run.status, 'passed');
  assert.equal(run.restore_point_json.rpo_exceeded, true);
  assert.deepEqual(alerts.map((a) => a.type), ['drill_rpo']);
});

test('a canary over the size limit is refused before anything is written', { skip }, async () => {
  const { runner, drill, store } = setup({ maxCanaryBytes: 1024 });
  const run = await runner.runToCompletion(drill);
  assert.equal(run.status, 'error');
  assert.equal(run.failure_stage, 'quota');
  assert.equal((await store.resourcesForRun(run.id)).length, 0);
});

test('storage the target does not replicate is a configuration error', { skip }, async () => {
  const { runner, drill } = setup({ targetOver: { target_repo_paths_map: { '/somewhere/else': standbyRepl } } });
  const run = await runner.runToCompletion(drill);
  assert.equal(run.status, 'error');
  assert.equal(run.failure_stage, 'config');
  assert.match(run.failure_reason, /does not replicate the backup storage folder/);
});

test('a standby that stops answering mid-copy hits the drill timeout and is cleaned up', { skip }, async () => {
  // Wrap the real standby; its copy never finishes.
  const standby = (t, ms) => {
    const real = new SshStandby(t, ms);
    return { connect: () => real.connect(), resolveDir: (p) => real.resolveDir(p), resolveFile: (p) => real.resolveFile(p), fetch: () => new Promise(() => {}) };
  };
  const { runner, drill, store } = setup({ drillOver: { timeout_seconds: 3, retry_max_attempts: 1 }, standby });
  const run = await runner.runToCompletion(drill);
  assert.equal(run.status, 'failed');
  assert.equal(run.failure_stage, 'timeout');
  assert.match(run.failure_reason, /did not finish within its 3-second limit/);
  // The scratch directory created before the copy is gone.
  const res = await store.resourcesForRun(run.id);
  assert.equal(res.length, 1);
  assert.equal(res[0].state, 'deleted');
  assert.ok(scratchEmpty());
});

test('a pinned host key on a non-standard SSH port is written as [host]:port (replication and drills)', () => {
  assert.equal(knownHostsLine({ host: 'standby.lan', port: 2222 }, 'ssh-ed25519 AAAA'), '[standby.lan]:2222 ssh-ed25519 AAAA\n');
  assert.equal(knownHostsLine({ host: 'standby.lan', port: 22 }, 'ssh-ed25519 AAAA'), 'standby.lan ssh-ed25519 AAAA\n');
  // Replication uses the same line (it used to write a bare host, which ssh never matches for port 2222).
  const engine = readFileSync(new URL('../src/services/replicationEngine.ts', import.meta.url), 'utf-8');
  assert.match(engine, /knownHostsLine\(target, target\.ssh_known_host_fingerprint\)/);
  assert.doesNotMatch(engine, /`\$\{target\.host\} \$\{target\.ssh_known_host_fingerprint\}/);
});
