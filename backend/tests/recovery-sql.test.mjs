// npm run build && node --experimental-test-module-mocks --test tests/recovery-sql.test.mjs
// Recovery verification against a throwaway MariaDB (its own datadir, port and
// socket; removed afterwards): migration 009 applies cleanly and twice, the
// SQL run store round-trips, and the API keeps backup / replication / verified
// recovery apart, keeps simulations out of recovery evidence, scopes customer
// users to their own clients, and never returns secrets.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';

const repo = join(import.meta.dirname, '..', '..');
const have = (p) => existsSync(p);
const skip = !have('/usr/sbin/mariadbd') || !have('/usr/bin/mariadb-install-db') || !have('/usr/bin/mariadb') ? 'MariaDB server not installed' : false;

const dir = mkdtempSync(join(tmpdir(), 'stor-sql-'));
let mariadbd; let port;
const freePort = () => new Promise((resolve) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const sql = (stmt, db = 'urbackup_gui') => execFileSync('mariadb', ['--no-defaults', '-h127.0.0.1', `-P${port}`, '-utest', '-ptest', db, '-e', stmt], { encoding: 'utf-8' });
const sqlFile = (file) => execFileSync('mariadb', ['--no-defaults', '-h127.0.0.1', `-P${port}`, '-utest', '-ptest', 'urbackup_gui'], { input: readFileSync(file) });

let mod = {};
before(async () => {
  if (skip) return;
  execFileSync('mariadb-install-db', ['--no-defaults', `--datadir=${join(dir, 'data')}`, '--auth-root-authentication-method=normal', '--skip-test-db'], { stdio: 'ignore' });
  port = await freePort();
  mariadbd = spawn('mariadbd', ['--no-defaults', `--datadir=${join(dir, 'data')}`, `--socket=${join(dir, 'sock')}`, '--bind-address=127.0.0.1',
    `--port=${port}`, '--skip-grant-tables', `--pid-file=${join(dir, 'pid')}`, '--skip-log-bin'], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { execFileSync('mariadb', ['--no-defaults', '-h127.0.0.1', `-P${port}`, '-e', 'SELECT 1'], { stdio: 'ignore' }); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  sql('CREATE DATABASE urbackup_gui', 'mysql');
  sqlFile(join(repo, 'database/init/01_schema.sql'));
  for (const f of readdirSync(join(repo, 'database/migrations')).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) sqlFile(join(repo, 'database/migrations', f));
  // Users: 1 admin; 10 a customer user for the customer that owns clientA.
  sql(`INSERT INTO app_users (id, username, email, password_hash, is_admin) VALUES (1,'admin','a@x','x',1),(10,'cust','c@x','x',0);
       INSERT INTO urbackup_servers (id, name, host, username, password) VALUES (1,'local','localhost','admin','');
       INSERT INTO customers (id, name, is_active) VALUES (5,'Acme',1);
       INSERT INTO customer_clients (customer_id, server_id, client_name) VALUES (5,1,'clientA');
       INSERT INTO customer_users (customer_id, user_id) VALUES (5,10);`);

  Object.assign(process.env, { DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_USER: 'test', DB_PASSWORD: 'test', DB_NAME: 'urbackup_gui', APP_SECRET_KEY: 'ef'.repeat(32) });
  mock.module('../dist/utils/logger.js', { namedExports: { logger: { info() {}, warn() {}, error() {}, debug() {} } } });
  mock.module('../dist/config/urbackupDb.js', { namedExports: { getUrBackupDb: async () => ({ get: async () => null, all: async () => [] }), openUrBackupSettingsDbReadOnly: async () => { throw new Error('none'); } } });
  mock.module('../dist/services/urbackup.js', { namedExports: { UrBackupService: class {
    async getClients() {
      return [
        { id: 1, name: 'clientA', lastbackup: Date.now() - 3600_000, lastbackup_image: null, file_ok: true, image_ok: false },
        { id: 2, name: 'clientB', lastbackup: Date.now() - 90 * 3600_000, lastbackup_image: null, file_ok: false, image_ok: false },
      ];
    }
  } } });
  mod.store = await import('../dist/services/drills/store.js');
  mod.ctrl = await import('../dist/controllers/recovery.js');
  mod.db = await import('../dist/config/database.js');
});
after(async () => {
  await mod.db?.pool.end().catch(() => {});
  mariadbd?.kill();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(dir, { recursive: true, force: true });
});

function call(handler, user, { query = {}, params = {}, body = {} } = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ code: this.statusCode, body: b }); return this; },
    };
    Promise.resolve(handler({ user, query, params, body, headers: {} }, res)).catch(reject);
  });
}
const admin = { userId: 1, username: 'admin', isAdmin: true };
const customer = { userId: 10, username: 'cust', isAdmin: false };

test('migration 009 is idempotent', { skip }, () => {
  sqlFile(join(repo, 'database/migrations/009_recovery_drills.sql'));
  const tables = sql("SHOW TABLES LIKE 'recovery_%'");
  for (const t of ['recovery_canaries', 'recovery_hypervisors', 'recovery_drills', 'recovery_drill_runs', 'recovery_drill_resources']) assert.match(tables, new RegExp(t));
});

test('the SQL run store round-trips runs and the resource ledger', { skip }, async () => {
  const s = new mod.store.SqlDrillStore();
  const id = randomUUID();
  const started = new Date(Date.now() - 5000);
  await s.createRun({ id, drill_id: 'd-sql', kind: 'file', client_name: 'clientA', evidence: 'actual', status: 'running', trigger_type: 'manual', attempts: 0, started_at: started, cleanup_status: 'none', steps_json: [] });
  await s.updateRun(id, { status: 'passed', attempts: 1, finished_at: new Date(), elapsed_ms: 4321, copy_json: { kind: 'offsite', target_name: 't' }, recovery_point_time: new Date('2026-11-09T11:00:00Z'), recovery_point_age_seconds: 99, services_json: [{ name: 's', passed: true, detail: 'ok' }], bogus: 'ignored' });
  const r = await s.getRun(id);
  assert.equal(r.status, 'passed');
  assert.equal(r.elapsed_ms, 4321);
  assert.deepEqual(r.copy_json, { kind: 'offsite', target_name: 't' });
  assert.equal(r.services_json[0].name, 's');
  assert.equal(Math.abs(new Date(r.started_at).getTime() - started.getTime()) < 5, true, 'millisecond timestamps');
  assert.equal((await s.lastRun('d-sql')).id, id);
  assert.equal(await s.lastRun('d-sql', id), null);
  await s.addResource({ id: 'res-1', run_id: id, kind: 'scratch_dir', hypervisor_id: null, locator: '/x/run-1', marker: 'run-1' });
  assert.equal((await s.liveResources()).length, 1);
  await s.updateResource('res-1', { state: 'deleted', attempts: 1 });
  assert.equal((await s.liveResources()).length, 0);
  assert.equal((await s.resourcesForRun(id))[0].state, 'deleted');
});

async function seedRuns() {
  sql(`DELETE FROM recovery_drill_runs; DELETE FROM recovery_drills;`);
  sql(`INSERT INTO recovery_drills (id, name, kind, client_name, canary_id, replication_target_id) VALUES
       ('da','A file drill','file','clientA',NULL,NULL), ('db','B file drill','file','clientB',NULL,NULL), ('dbs','B boot (sim)','boot','clientB',NULL,NULL)`);
  const s = new mod.store.SqlDrillStore();
  const mk = async (over) => s.createRun({ id: randomUUID(), kind: 'file', evidence: 'actual', trigger_type: 'schedule', attempts: 1, cleanup_status: 'done', ...over });
  await mk({ drill_id: 'da', client_name: 'clientA', status: 'passed', started_at: new Date(Date.now() - 7200_000), finished_at: new Date(Date.now() - 7100_000), elapsed_ms: 1800,
    restored_item: 'C/canary.bin', expected_sha256: 'a'.repeat(64), actual_sha256: 'a'.repeat(64), recovery_point_time: new Date(Date.now() - 26 * 3600_000), recovery_point_age_seconds: 26 * 3600,
    restore_point_json: { backup_id: 20, rpo_exceeded: false }, copy_json: { kind: 'offsite', target_name: 'standby-1', host: '10.0.0.9', path: '/secret/remote/path' } });
  // clientB: its last actual run failed; a simulated boot drill "passed" afterwards.
  await mk({ drill_id: 'db', client_name: 'clientB', status: 'failed', failure_stage: 'verify', failure_reason: 'checksum mismatch', started_at: new Date(Date.now() - 3600_000) });
  await mk({ drill_id: 'dbs', client_name: 'clientB', kind: 'boot', evidence: 'simulated', status: 'passed', started_at: new Date(Date.now() - 600_000), rto_ms: 1000,
    services_json: [{ name: 'svc', passed: true, detail: 'simulated' }] });
}

test('status keeps backup, replication and verified recovery separate; simulations never verify', { skip }, async () => {
  await seedRuns();
  const { code, body } = await call(mod.ctrl.getStatus, admin);
  assert.equal(code, 200);
  const a = body.find((x) => x.client_name === 'clientA');
  const b = body.find((x) => x.client_name === 'clientB');
  assert.deepEqual([a.backup.state, a.recovery.state], ['ok', 'verified']);
  assert.equal(a.replication.state, 'not_configured');
  // clientB's backups failed AND its last real drill failed — even though a simulation passed later.
  assert.equal(b.backup.state, 'failed');
  assert.equal(b.recovery.state, 'failed');
  assert.equal(b.recovery.last_run.evidence, 'actual');
  assert.equal(b.simulation.last_run.evidence, 'simulated');
});

test('the customer report separates actual restores from simulations and hides internals', { skip }, async () => {
  await seedRuns();
  const { body } = await call(mod.ctrl.getReport, admin, { query: { client: 'clientB', days: 30 } });
  assert.equal(body.actual.length, 1);
  assert.equal(body.simulated.length, 1);
  assert.equal(body.summary.actual_passed, 0, 'a simulated pass is not a verified recovery');
  assert.equal(body.summary.last_verified, null);
  const ra = (await call(mod.ctrl.getReport, admin, { query: { client: 'clientA' } })).body;
  assert.equal(ra.summary.actual_passed, 1);
  assert.equal(ra.actual[0].restored_item, 'C/canary.bin');
  assert.equal(ra.actual[0].recovery_point_age_seconds, 26 * 3600);
  assert.equal(ra.actual[0].elapsed_ms, 1800);
  assert.equal(ra.actual[0].copy.target_name, 'standby-1');
  assert.equal(ra.actual[0].copy.path, undefined, 'standby paths and hosts stay out of the customer report');
  assert.equal(ra.actual[0].copy.host, undefined);
  assert.equal(ra.actual[0].restore_point.backup_id, 20);
  // Image restore points name the images, not St0r's storage paths.
  sql(`UPDATE recovery_drill_runs SET restore_point_json = '{"kind":"image","images":[{"letter":"C:","image_id":52,"chain":[40,52],"path":"/srv/storage/c/Image_C.vhdz"}]}' WHERE drill_id = 'da'`);
  const ri = (await call(mod.ctrl.getReport, admin, { query: { client: 'clientA' } })).body;
  assert.deepEqual(ri.actual[0].restore_point.images, [{ letter: 'C:', image_id: 52, chain: [40, 52], backup_time: undefined }]);
  assert.doesNotMatch(JSON.stringify(ri), /\/srv\/storage/);
});

test('customer users see only their own clients', { skip }, async () => {
  await seedRuns();
  assert.equal((await call(mod.ctrl.getReport, customer, { query: { client: 'clientB' } })).code, 404);
  assert.equal((await call(mod.ctrl.getReport, customer, { query: { client: 'clientA' } })).code, 200);
  const st = (await call(mod.ctrl.getStatus, customer)).body;
  assert.deepEqual(st.map((x) => x.client_name), ['clientA']);
  const runs = (await call(mod.ctrl.listRuns, customer)).body;
  assert.ok(runs.length >= 1 && runs.every((r) => r.client_name === 'clientA'));
  const drills = (await call(mod.ctrl.listDrills, customer)).body;
  assert.deepEqual(drills.map((d) => d.client_name), ['clientA']);
  // Customers get what was restored, not St0r's infrastructure.
  const mine = runs.find((r) => r.copy_json);
  assert.deepEqual(Object.keys(mine.copy_json).sort(), ['hypervisor', 'kind', 'network', 'target_name']);
  assert.doesNotMatch(JSON.stringify([runs, st]), /10\.0\.0\.9|\/secret\/remote\/path/);
  assert.match(JSON.stringify((await call(mod.ctrl.listRuns, admin)).body), /\/secret\/remote\/path/, 'admins see the full record');
  const one = (await call(mod.ctrl.getRun, customer, { params: { id: mine.id } })).body;
  assert.equal(one.resources, undefined);
  assert.equal(one.steps_json, null);
  const other = (await call(mod.ctrl.listRuns, admin, { query: { client: 'clientB' } })).body[0];
  assert.equal((await call(mod.ctrl.getRun, customer, { params: { id: other.id } })).code, 404);
});

test('a generated canary records the checksum of exactly the content handed out', { skip }, async () => {
  const { code, body } = await call(mod.ctrl.generateCanary, admin, { body: { client_name: 'clientA', path: 'C/Users/Public/st0r-canary.bin', size_bytes: 4096 } });
  assert.equal(code, 201);
  const content = Buffer.from(body.content_base64, 'base64');
  assert.equal(content.length, 4096);
  assert.equal(createHash('sha256').update(content).digest('hex'), body.sha256);
  assert.match(sql(`SELECT sha256 FROM recovery_canaries WHERE id='${body.id}'`), new RegExp(body.sha256));
  assert.doesNotMatch(sql(`SELECT * FROM recovery_canaries WHERE id='${body.id}'`), /content/i);
  // A leading "/" is dropped (paths are relative to the backup root); escapes are refused.
  const norm = await call(mod.ctrl.createCanary, admin, { body: { client_name: 'clientA', path: '/C/x.bin', sha256: 'b'.repeat(64) } });
  assert.equal(norm.code, 201);
  assert.match(sql(`SELECT path FROM recovery_canaries WHERE id='${norm.body.id}'`), /^path\nC\/x\.bin$/m);
  for (const path of ['../etc/passwd', 'C/../../x', 'C\\Windows\\x', 'a//b', 'C/./x']) {
    assert.equal((await call(mod.ctrl.createCanary, admin, { body: { client_name: 'clientA', path, sha256: 'a'.repeat(64) } })).code, 400, path);
  }
});

test('hypervisor secrets are stored encrypted and never returned', { skip }, async () => {
  const { code, body } = await call(mod.ctrl.createHypervisor, admin, { body: {
    name: 'lab', api_url: 'https://pve.lab:8006', token_id: 'drill@pve!st0r', token_secret: 'super-secret-value',
    node: 'pve', disk_storage: 'local-lvm', import_storage: 'local', isolated_bridge: 'vmbr9', artifact_base_url: 'https://st0r.lab',
  } });
  assert.equal(code, 201, JSON.stringify(body));
  assert.doesNotMatch(sql('SELECT * FROM recovery_hypervisors'), /super-secret-value/);
  const list = (await call(mod.ctrl.listHypervisors, admin)).body;
  assert.equal(list[0].has_token_secret, true);
  assert.equal(list[0].token_secret_encrypted, undefined);
  assert.doesNotMatch(JSON.stringify(list), /super-secret-value/);
  assert.equal((await call(mod.ctrl.createHypervisor, admin, { body: { name: 'x', api_url: 'http://pve:8006', token_id: 'a@b!c', token_secret: 's', node: 'pve', disk_storage: 'l', import_storage: 'l' } })).code, 400, 'plain http is refused');
});

test('drill input is validated: a boot drill on real hardware cannot carry simulated outcomes', { skip }, async () => {
  const hv = (await call(mod.ctrl.listHypervisors, admin)).body[0];
  const { code, body } = await call(mod.ctrl.createDrill, admin, { body: {
    kind: 'boot', name: 'boot', client_name: 'clientA', hypervisor_id: hv.id,
    boot_config: { profile: 'windows-uefi', service: 'MSSQLSERVER', simulate: { boot: 'fail' } },
  } });
  assert.equal(code, 201, JSON.stringify(body));
  assert.doesNotMatch(sql(`SELECT boot_config_json FROM recovery_drills WHERE id='${body.id}'`), /simulate/);
  assert.equal((await call(mod.ctrl.createDrill, admin, { body: { kind: 'boot', name: 'b', client_name: 'clientA', hypervisor_id: hv.id, boot_config: { profile: 'linux-bios', service: 'x' } } })).code, 400);
  assert.equal((await call(mod.ctrl.createDrill, admin, { body: { kind: 'boot', name: 'b', client_name: 'clientA', hypervisor_id: hv.id, boot_config: { profile: 'windows-uefi', service: 'a;rm -rf /' } } })).code, 400);
  assert.equal((await call(mod.ctrl.createDrill, admin, { body: { kind: 'file', name: 'f', client_name: 'clientA', schedule_type: 'cron', cron_expression: 'every day' } })).code, 400);
});
