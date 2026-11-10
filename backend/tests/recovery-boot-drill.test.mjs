// npm run build && node --experimental-test-module-mocks --test tests/recovery-boot-drill.test.mjs
// The isolated boot drill against disposable infrastructure: UrBackup-style
// images (ESP + C: full and incremental) of a GPT disk made by sgdisk, St0r's
// real artifact route, and a fake Proxmox API over pinned TLS that downloads
// the disk, checks its checksum and records every VM and volume. Covers a pass,
// boot failure, service failure, isolation and quota refusals, cleanup that
// fails and is retried, a run interrupted by a restart, and a VM id that is
// no longer the drill's.
process.env.APP_SECRET_KEY = 'cd'.repeat(32);
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, realpathSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { writeVhd, pattern, encodeMbrData, buildGptDisk, IMAGE_SKIP } from './fixtures/drill-images.mjs';
import { FakePve, makeCert } from './fixtures/fake-pve.mjs';
import { MemoryStore, MemoryConfig, drill as makeDrill, quietLog } from './fixtures/drill-store.mjs';

mock.module('../dist/utils/logger.js', { namedExports: { logger: { info() {}, warn() {}, error() {}, debug() {} } } });
mock.module('../dist/config/database.js', { namedExports: { query: async () => { throw new Error('no database in this test'); } } });
mock.module('../dist/config/urbackupDb.js', { namedExports: { getUrBackupDb: async () => { throw new Error('no UrBackup db'); }, openUrBackupSettingsDbReadOnly: async () => { throw new Error('no UrBackup db'); } } });

const express = (await import('express')).default;
const { DrillRunner } = await import('../dist/services/drills/runner.js');
const { bootDrillAttempt, qemuImgConverter } = await import('../dist/services/drills/bootDrill.js');
const { ProxmoxHypervisor, SimulatorHypervisor, VmRemover, VolumeRemover, runTag } = await import('../dist/services/drills/hypervisor.js');
const { PveClient } = await import('../dist/services/drills/proxmox.js');
const { ScratchRemover } = await import('../dist/services/drills/scratch.js');
const { serveArtifact, artifactCount } = await import('../dist/services/drills/artifacts.js');

const have = (cmd, arg = '--version') => { try { execFileSync(cmd, [arg], { stdio: 'ignore' }); return true; } catch { return false; } };
const skip = !have('sgdisk') || !have('openssl', 'version') ? 'sgdisk/openssl not installed' : false;

const root = realpathSync(mkdtempSync(join(tmpdir(), 'stor-bootdrill-')));
const scratch = join(root, 'scratch');
const storage = join(root, 'storage', 'clientW');
const TOKEN = 'drill@pve!st0r';
const SECRET = randomUUID();
let pve; let pin; let artifactBase; let artifactServer; let disk; let images; let convert;

const hours = (h) => new Date(Date.now() - h * 3600_000);
const sha = (b) => createHash('sha256').update(b).digest('hex');

before(async () => {
  if (skip) return;
  mkdirSync(storage, { recursive: true });
  // The client's disk and UrBackup's images of it.
  disk = buildGptDisk(mkdtempSync(join(root, 'disk-')));
  const vol = (p) => Buffer.from(disk.buf.subarray(p.offset, p.offset + p.length));
  const mbr = (n) => encodeMbrData({ partitionNumber: n, mbr: disk.mbr.subarray(0, 512), gpt: disk.gpt });
  const espPath = join(storage, '261109-2000_Image_ESP', 'Image_ESP_261109-2000.vhd');
  const cFull = join(storage, '261102-2000_Image_C', 'Image_C_261102-2000.vhd');
  const cInc = join(storage, '261109-2000_Image_C', 'Image_C_261109-2000.vhd');
  for (const p of [espPath, cFull, cInc]) mkdirSync(join(p, '..'), { recursive: true });
  const older = vol(disk.c); pattern(1024 * 1024, 'stale').copy(older, 0);
  writeVhd(espPath, { size: IMAGE_SKIP + disk.esp.length, extents: [{ offset: IMAGE_SKIP, data: vol(disk.esp) }] });
  writeVhd(cFull, { size: IMAGE_SKIP + disk.c.length, extents: [{ offset: IMAGE_SKIP, data: older }] });
  writeVhd(cInc, { size: IMAGE_SKIP + disk.c.length, type: 4, extents: [{ offset: IMAGE_SKIP, data: vol(disk.c).subarray(0, 1024 * 1024) }] });
  writeFileSync(`${espPath}.mbr`, mbr(1));
  writeFileSync(`${cFull}.mbr`, mbr(2));
  writeFileSync(`${cInc}.mbr`, mbr(2));
  images = [
    { id: 52, backup_time: hours(20), letter: 'C:', path: cInc, version: 1, incremental: 1, incremental_ref: 40, size_bytes: 2 * 1024 * 1024 },
    { id: 51, backup_time: new Date(hours(20).getTime() - 30_000), letter: 'ESP', path: espPath, version: 1, incremental: 0, incremental_ref: 0, size_bytes: 9 * 1024 * 1024 },
    { id: 40, backup_time: hours(188), letter: 'C:', path: cFull, version: 1, incremental: 0, incremental_ref: 0, size_bytes: 40 * 1024 * 1024 },
  ];

  // St0r's artifact route, on its own port.
  const app = express();
  app.get('/api/recovery/artifacts/:token/:filename', serveArtifact);
  artifactServer = createServer(app);
  await new Promise((r) => artifactServer.listen(0, '127.0.0.1', r));
  artifactBase = `http://127.0.0.1:${artifactServer.address().port}`;

  const certDir = mkdtempSync(join(root, 'pve-'));
  const c = makeCert(certDir);
  pin = c.fingerprint;
  pve = new FakePve({ key: c.key, cert: c.cert, token: `${TOKEN}=${SECRET}`, dir: certDir });
  await pve.listen();
  convert = await qemuImgConverter();
});
after(() => { pve?.close(); artifactServer?.close(); rmSync(root, { recursive: true, force: true }); });

function hvDef(over = {}) {
  return {
    id: 'hv-1', name: 'lab', type: 'proxmox', api_url: pve.url, token_id: TOKEN, token_secret_encrypted: 'x', tls_fingerprint: pin,
    node: 'pve', disk_storage: 'local-lvm', import_storage: 'local', isolated_bridge: null, artifact_base_url: artifactBase,
    max_disk_gb: 1, scratch_quota_gb: 1, ...over,
  };
}

function setup({ hv = {}, drillOver = {}, bootConfig = {}, imageRows, decompress, extraRemovers = {} } = {}) {
  const store = new MemoryStore();
  const alerts = [];
  const def = hvDef(hv);
  const d = makeDrill({
    id: 'boot-1', name: 'Boot drill', kind: 'boot', client_name: 'clientW', canary_id: null, replication_target_id: null,
    hypervisor_id: 'hv-1', timeout_seconds: 60, retry_max_attempts: 1,
    boot_config: { profile: 'windows-uefi', service: 'MSSQLSERVER', memory_mb: 2048, cores: 2, boot_timeout_seconds: 5, service_timeout_seconds: 5, ...bootConfig },
    ...drillOver,
  });
  const config = new MemoryConfig({ drills: [d], hypervisors: [def], channels: [{ id: 'c', type: 'webhook', enabled: true, config_json: {} }] });
  const rows = imageRows ?? images;
  const points = {
    storageFolder: async () => join(root, 'storage'), fileBackups: async () => [],
    imageBackups: async () => rows, associatedImages: async () => [],
  };
  const hypervisor = (h) => (h.type === 'simulator' ? new SimulatorHypervisor(d.boot_config.simulate)
    : new ProxmoxHypervisor(new PveClient({ api_url: h.api_url, token_id: h.token_id, token_secret: SECRET, tls_fingerprint: h.tls_fingerprint }, { retries: 0 }), h, 20));
  const hvFor = () => hypervisor(def);
  const removers = async (r) => {
    if (extraRemovers[r.kind]) return extraRemovers[r.kind];
    if (r.kind === 'scratch_dir') return new ScratchRemover(scratch);
    if (r.kind === 'pve_vm') return new VmRemover(hvFor(), 5000);
    if (r.kind === 'pve_volume') return new VolumeRemover(hvFor(), 5000);
    return { remove: async () => 'gone' };
  };
  const runner = new DrillRunner({
    store, config, removers, log: quietLog, retryDelayMs: 10, sendAlert: async (e) => { alerts.push(e); },
    evidenceFor: async () => (def.type === 'simulator' ? 'simulated' : 'actual'),
    attempt: {
      file: async () => { throw new Error('not used'); },
      boot: (ctx, dr) => bootDrillAttempt(ctx, dr, {
        config, points, scratchRoot: scratch, convert, pollMs: 50, hypervisor,
        decompress: decompress ?? (async () => { throw new Error('no .vhdz here'); }),
      }),
    },
  });
  return { store, alerts, runner, drill: d, removers };
}

const scratchEmpty = () => !existsSync(scratch) || readdirSync(scratch).length === 0;
function resetPve() {
  pve.vms.clear(); pve.volumes.clear(); pve.calls.length = 0;
  pve.behaviour = { boot: 'ok', service: 'ok', failDelete: false, failStart: false };
  pve.networks = { vmbr9: { type: 'bridge', bridge_ports: '', active: 1 } };
  pve.storage = { local: 1e12, 'local-lvm': 1e12 };
}

test('boots a disposable clone of the newest image, checks the service, removes it (actual evidence)', { skip }, async () => {
  resetPve();
  const { runner, drill, store, alerts } = setup();
  const run = await runner.runToCompletion(drill);
  assert.equal(run.status, 'passed', `${run.failure_stage}: ${run.failure_reason}`);
  assert.equal(run.evidence, 'actual');
  // Exactly which images: C: 52 on top of full 40, with ESP 51 from the same run.
  const rp = run.restore_point_json;
  assert.deepEqual(rp.images.map((i) => [i.letter, i.image_id, i.chain]), [['ESP', 51, [51]], ['C:', 52, [40, 52]]]);
  assert.ok(Math.abs(run.recovery_point_age_seconds - 20 * 3600) < 120);
  assert.equal(run.services_json[0].name, 'MSSQLSERVER');
  assert.equal(run.services_json[0].passed, true);
  assert.ok(run.boot_ms >= 0 && run.rto_ms >= run.boot_ms);
  assert.equal(run.copy_json.network, 'no network device');

  // What Proxmox got: the original disk (qcow2 → raw when qemu-img is there), and a VM with no NIC.
  const created = pve.calls.filter((c) => c === 'POST /nodes/pve/qemu');
  assert.equal(created.length, 1);
  const files = readdirSync(pve.dir).filter((f) => f.startsWith('st0r-drill-'));
  assert.equal(files.length, 1);
  const got = join(pve.dir, files[0]);
  let gotRaw = readFileSync(got);
  if (files[0].endsWith('.qcow2')) {
    execFileSync('qemu-img', ['convert', '-f', 'qcow2', '-O', 'raw', got, `${got}.raw`]);
    gotRaw = readFileSync(`${got}.raw`);
  }
  assert.equal(sha(gotRaw), sha(disk.buf), 'the clone booted from exactly the client\'s disk');

  // Everything it created is gone: VM, imported volume, scratch, the download URL.
  assert.equal(pve.vms.size, 0);
  assert.equal(pve.volumes.size, 0);
  assert.ok(scratchEmpty());
  assert.equal(artifactCount(), 0);
  const res = await store.resourcesForRun(run.id);
  assert.deepEqual(res.map((r) => [r.kind, r.state]).sort(), [['pve_vm', 'deleted'], ['pve_volume', 'deleted'], ['scratch_dir', 'deleted']]);
  assert.equal(run.cleanup_status, 'done');
  assert.equal(alerts.length, 0);
});

test('the VM is created with only the verified isolated bridge, tagged as the drill\'s', { skip }, async () => {
  resetPve();
  let seen;
  const { runner, drill } = setup({ hv: { isolated_bridge: 'vmbr9' } });
  const orig = pve.handle.bind(pve);
  pve.handle = async (req, res) => {
    if (req.method === 'POST' && req.url.endsWith('/qemu')) {
      const done = orig(req, res); await done; seen = [...pve.vms.values()][0]?.params; return done;
    }
    return orig(req, res);
  };
  try {
    const run = await runner.runToCompletion(drill);
    assert.equal(run.status, 'passed', run.failure_reason);
    assert.match(run.copy_json.network, /vmbr9: no uplink ports/);
    assert.equal(seen.net0, 'e1000,bridge=vmbr9,firewall=0');
    assert.equal(seen.bios, 'ovmf');
    assert.match(seen.efidisk0, /pre-enrolled-keys=0/);
    assert.equal(seen.agent, 'enabled=1');
    assert.equal(seen.tags, `st0r-drill;${runTag(run.id)}`);
    assert.equal(seen.name, `st0r-drill-${run.id.replace(/-/g, '').slice(0, 12)}`);
  } finally { pve.handle = orig; }
});

test('a bridge with an uplink or host address is refused before anything is created', { skip }, async () => {
  resetPve();
  pve.networks.vmbr0 = { type: 'bridge', bridge_ports: 'eno1', address: '192.0.2.10', cidr: '192.0.2.10/24', gateway: '192.0.2.1' };
  const { runner, drill, store } = setup({ hv: { isolated_bridge: 'vmbr0' } });
  const run = await runner.runToCompletion(drill);
  assert.equal(run.status, 'error');
  assert.equal(run.failure_stage, 'isolation');
  assert.match(run.failure_reason, /uplink ports \(eno1\).*gateway 192\.0\.2\.1/);
  assert.equal((await store.resourcesForRun(run.id)).length, 0);
  assert.equal(pve.vms.size + pve.volumes.size, 0);
});

test('the clone does not boot: boot failure, and the VM is still removed', { skip }, async () => {
  resetPve();
  pve.behaviour.boot = 'never';
  const { runner, drill, alerts } = setup();
  const run = await runner.runToCompletion(drill);
  assert.equal(run.status, 'failed');
  assert.equal(run.failure_stage, 'boot');
  assert.match(run.failure_reason, /guest agent did not answer within 5 s/);
  assert.equal(run.boot_ms, undefined);
  assert.equal(pve.vms.size, 0);
  assert.equal(pve.volumes.size, 0);
  assert.equal(run.cleanup_status, 'done');
  assert.equal(alerts[0].type, 'drill_failed');
});

test('the VM fails to start: boot failure', { skip }, async () => {
  resetPve();
  pve.behaviour.failStart = true;
  const { runner, drill } = setup();
  const run = await runner.runToCompletion(drill);
  assert.equal(run.failure_stage, 'boot');
  assert.match(run.failure_reason, /QEMU exited with code 1/);
  assert.equal(pve.vms.size, 0);
});

test('the service is not running in the clone: service failure', { skip }, async () => {
  resetPve();
  pve.behaviour.service = 'stopped';
  const { runner, drill } = setup();
  const run = await runner.runToCompletion(drill);
  assert.equal(run.status, 'failed');
  assert.equal(run.failure_stage, 'service');
  assert.ok(run.boot_ms >= 0, 'it did boot');
  assert.deepEqual(run.services_json.map((s) => [s.name, s.passed]), [['MSSQLSERVER', false]]);
  assert.match(run.services_json[0].detail, /STOPPED/);
  assert.equal(pve.vms.size, 0);
});

test('not enough Proxmox storage: quota refusal before anything is created', { skip }, async () => {
  resetPve();
  pve.storage.local = 1024;
  const { runner, drill, store } = setup();
  const run = await runner.runToCompletion(drill);
  assert.equal(run.status, 'error');
  assert.equal(run.failure_stage, 'quota');
  assert.equal((await store.resourcesForRun(run.id)).length, 0);
});

test('a disk over the drill size limit is refused', { skip }, async () => {
  resetPve();
  const { runner, drill } = setup({ hv: { max_disk_gb: 0.01 } });
  const run = await runner.runToCompletion(drill);
  assert.equal(run.failure_stage, 'quota');
  assert.match(run.failure_reason, /over this hypervisor's/);
});

test('an image whose data file is missing is not a restore point', { skip }, async () => {
  resetPve();
  const rows = images.map((i) => (i.id === 40 ? { ...i, path: join(storage, 'gone', 'Image_C.vhd') } : i));
  const { runner, drill } = setup({ imageRows: rows });
  const run = await runner.runToCompletion(drill);
  assert.equal(run.status, 'failed');
  assert.equal(run.failure_stage, 'restore-point');
  assert.match(run.failure_reason, /missing its data file/);
});

test('a certificate other than the pinned one is refused', { skip }, async () => {
  resetPve();
  const { runner, drill } = setup({ hv: { tls_fingerprint: 'AA:'.repeat(31) + 'AA' } });
  const run = await runner.runToCompletion(drill);
  assert.equal(run.failure_stage, 'connect');
  assert.match(run.failure_reason, /does not match the pinned fingerprint/);
});

test('cleanup that fails is recorded, alerted, and finished by the sweeper', { skip }, async () => {
  resetPve();
  pve.behaviour.failDelete = true;
  const { runner, drill, store, alerts } = setup();
  const run = await runner.runToCompletion(drill);
  assert.equal(run.status, 'passed', 'the drill itself passed');
  assert.equal(run.cleanup_status, 'pending');
  const vm = (await store.resourcesForRun(run.id)).find((r) => r.kind === 'pve_vm');
  assert.equal(vm.state, 'delete_failed');
  assert.match(vm.last_error, /storage is busy/);
  assert.equal(pve.vms.size, 1, 'the VM is still there');
  assert.ok(alerts.some((a) => a.type === 'drill_cleanup'));
  // Later the hypervisor recovers and the sweeper finishes the job.
  pve.behaviour.failDelete = false;
  await runner.sweep();
  assert.equal(pve.vms.size, 0);
  assert.equal(pve.volumes.size, 0);
  assert.equal((await store.getRun(run.id)).cleanup_status, 'done');
  assert.ok((await store.resourcesForRun(run.id)).every((r) => r.state === 'deleted'));
});

test('a run interrupted by a restart is marked and everything it created is removed', { skip }, async () => {
  resetPve();
  const { store, runner } = setup();
  // What a run had made when St0r stopped: a VM, its import volume, a scratch dir.
  const runId = randomUUID(); const short = runId.replace(/-/g, '').slice(0, 12);
  await store.createRun({ id: runId, drill_id: 'boot-1', kind: 'boot', client_name: 'clientW', evidence: 'actual', status: 'running', trigger_type: 'schedule', attempts: 1, started_at: hours(1), cleanup_status: 'none' });
  const name = `st0r-drill-${short}`; const tag = runTag(runId);
  pve.vms.set(150, { name, tags: `st0r-drill;${tag}`, running: true, params: {} });
  const vol = `local:import/st0r-drill-${short}-a1.qcow2`;
  pve.volumes.set(vol, Buffer.from('x'));
  const dir = join(scratch, `run-${runId}-a1`); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'disk.raw'), 'partial');
  await store.addResource({ id: 'r1', run_id: runId, kind: 'scratch_dir', hypervisor_id: null, locator: dir, marker: `run-${runId}-a1` });
  await store.updateResource('r1', { state: 'created' });
  await store.addResource({ id: 'r2', run_id: runId, kind: 'pve_volume', hypervisor_id: 'hv-1', locator: vol, marker: `st0r-drill-${short}-a1.qcow2` });
  await store.updateResource('r2', { state: 'created' });
  // Recorded but not yet confirmed: the VM may or may not exist. It does.
  await store.addResource({ id: 'r3', run_id: runId, kind: 'pve_vm', hypervisor_id: 'hv-1', locator: 'pve/150', marker: `${name}|${tag}` });

  const n = await runner.recoverInterrupted();
  assert.equal(n, 1);
  const run = await store.getRun(runId);
  assert.equal(run.status, 'interrupted');
  assert.equal(run.cleanup_status, 'done');
  assert.equal(pve.vms.size, 0);
  assert.equal(pve.volumes.size, 0);
  assert.ok(!existsSync(dir));
  // VM first, then the volume it was imported from, then local scratch.
  const order = pve.calls.filter((c) => c.startsWith('DELETE'));
  assert.deepEqual(order, ['DELETE /nodes/pve/qemu/150', `DELETE /nodes/pve/storage/local/content/${encodeURIComponent(vol)}`]);
});

test('cleanup never removes a VM that is no longer the drill\'s', { skip }, async () => {
  resetPve();
  const { store, runner } = setup();
  const runId = randomUUID(); const short = runId.replace(/-/g, '').slice(0, 12);
  await store.createRun({ id: runId, drill_id: 'boot-1', kind: 'boot', client_name: 'clientW', evidence: 'actual', status: 'failed', trigger_type: 'manual', attempts: 1, started_at: hours(1), cleanup_status: 'pending' });
  // The drill recorded VM 160 before creating it, the create failed, and someone else's VM now has that id.
  pve.vms.set(160, { name: 'payroll-db', tags: 'prod', running: true, params: {} });
  await store.addResource({ id: 'v1', run_id: runId, kind: 'pve_vm', hypervisor_id: 'hv-1', locator: 'pve/160', marker: `st0r-drill-${short}|${runTag(runId)}` });
  // And a volume locator that does not carry the drill's name.
  await store.addResource({ id: 'v2', run_id: runId, kind: 'pve_volume', hypervisor_id: 'hv-1', locator: 'local:import/payroll.qcow2', marker: 'payroll.qcow2' });
  pve.volumes.set('local:import/payroll.qcow2', Buffer.from('keep'));
  await runner.sweep();
  assert.ok(pve.vms.has(160), 'the other VM is untouched');
  assert.ok(pve.volumes.has('local:import/payroll.qcow2'), 'the other volume is untouched');
  const res = await store.resourcesForRun(runId);
  assert.deepEqual(res.map((r) => r.state), ['not_ours', 'not_ours']);
  assert.ok(!pve.calls.some((c) => c.startsWith('DELETE')));
});

test('a VM whose create finished after the drill gave up is still found and removed', { skip }, async () => {
  resetPve();
  const { store, runner } = setup();
  const runId = randomUUID(); const short = runId.replace(/-/g, '').slice(0, 12);
  await store.createRun({ id: runId, drill_id: 'boot-1', kind: 'boot', client_name: 'clientW', evidence: 'actual', status: 'failed', trigger_type: 'manual', attempts: 1, started_at: hours(1), cleanup_status: 'pending' });
  const name = `st0r-drill-${short}`; const tag = runTag(runId);
  // Recorded, never confirmed (the drill timed out waiting for the create task).
  await store.addResource({ id: 'late', run_id: runId, kind: 'pve_vm', hypervisor_id: 'hv-1', locator: 'pve/170', marker: `${name}|${tag}` });
  await runner.sweep();
  let r = (await store.resourcesForRun(runId))[0];
  assert.equal(r.state, 'creating', 'not written off on the first look');
  assert.equal((await store.getRun(runId)).cleanup_status, 'pending');
  // Proxmox finishes the create task late.
  pve.vms.set(170, { name, tags: `st0r-drill;${tag}`, running: false, params: {} });
  await runner.sweep();
  r = (await store.resourcesForRun(runId))[0];
  assert.equal(r.state, 'deleted');
  assert.equal(pve.vms.size, 0);
  assert.equal((await store.getRun(runId)).cleanup_status, 'done');
});

test('an unconfirmed VM that never appears is written off after the re-checks', { skip }, async () => {
  resetPve();
  const { store, runner } = setup();
  const runId = randomUUID();
  await store.createRun({ id: runId, drill_id: 'boot-1', kind: 'boot', client_name: 'clientW', evidence: 'actual', status: 'error', trigger_type: 'manual', attempts: 1, started_at: hours(1), cleanup_status: 'pending' });
  await store.addResource({ id: 'never', run_id: runId, kind: 'pve_vm', hypervisor_id: 'hv-1', locator: 'pve/171', marker: `st0r-drill-x|${runTag(runId)}` });
  for (let i = 0; i < 3; i++) await runner.sweep();
  assert.equal((await store.resourcesForRun(runId))[0].state, 'deleted');
  assert.equal((await store.getRun(runId)).cleanup_status, 'done');
});

test('compressed images are decompressed into recorded work directories, which are removed', { skip }, async () => {
  resetPve();
  // UrBackup's .vhdz: here a copy of the .vhd; the stand-in for the root helper
  // "decompresses" by copying into /tmp/st0r-vhd-<tag>, as the helper does.
  const rows = images.map((i) => {
    const z = i.path.replace(/\.vhd$/, '.vhdz');
    copyFileSync(i.path, z); copyFileSync(`${i.path}.mbr`, `${z}.mbr`);
    return { ...i, path: z };
  });
  const seen = [];
  let store;
  const decompress = async (file, tag) => {
    const dir = `/tmp/st0r-vhd-${tag}`;
    // The ledger row exists before the helper is asked to create anything.
    seen.push((await store.liveResources()).some((r) => r.kind === 'vhd_workdir' && r.locator === dir && r.state === 'creating'));
    mkdirSync(dir);
    const out = join(dir, basename(file));
    copyFileSync(file, out);
    return out;
  };
  const rm = { remove: async (r) => { rmSync(r.locator, { recursive: true, force: true }); return 'deleted'; } };
  const s = setup({ imageRows: rows, decompress, extraRemovers: { vhd_workdir: rm } });
  store = s.store;
  const run = await s.runner.runToCompletion(s.drill);
  assert.equal(run.status, 'passed', run.failure_reason);
  assert.deepEqual(seen, [true, true, true], 'ESP, C: full, C: incremental');
  const work = (await store.resourcesForRun(run.id)).filter((r) => r.kind === 'vhd_workdir');
  assert.equal(work.length, 3);
  for (const w of work) { assert.equal(w.state, 'deleted'); assert.ok(!existsSync(w.locator)); assert.match(w.locator, /^\/tmp\/st0r-vhd-[A-Za-z0-9]{10}$/); }
});

test('a simulator run is recorded as simulated, never as recovery evidence', { skip }, async () => {
  resetPve();
  const { runner, drill } = setup({ hv: { type: 'simulator' }, bootConfig: { simulate: { boot: 'ok', service: 'ok' } } });
  const run = await runner.runToCompletion(drill);
  assert.equal(run.status, 'passed', run.failure_reason);
  assert.equal(run.evidence, 'simulated');
  assert.equal(pve.calls.length, 0, 'no real hypervisor was touched');
  assert.ok(scratchEmpty());
});
