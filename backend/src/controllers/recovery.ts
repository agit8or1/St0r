import { Response } from 'express';
import { randomBytes, randomUUID, createHash } from 'crypto';
import { AuthRequest } from '../middleware/auth.js';
import { scopeOf, isClientVisible, filterByClientName } from '../middleware/scope.js';
import { query } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { encrypt } from '../services/secrets.js';
import { UrBackupService } from '../services/urbackup.js';
import { normalizeFingerprint } from '../services/agentClient.js';
import { drillRunner, drillConfig, drillStore, hypervisorFor } from '../services/drills/index.js';
import { runFromRow } from '../services/drills/store.js';
import { drillFromRow, validCanaryPath } from '../services/drills/sources.js';
import { validateBootConfig } from '../services/drills/bootDrill.js';
import { validCron } from '../services/drills/schedule.js';
import { DrillError } from '../services/drills/errors.js';

/**
 * Recovery verification. Admins configure drills, canaries and hypervisors;
 * every user sees statuses, runs and reports for the clients in their scope
 * (customer users are read-only, as everywhere else).
 */

const CLIENT_NAME = /^[A-Za-z0-9 ._@()-]{1,255}$/;

function bad(res: Response, msg: string): void { res.status(400).json({ error: msg }); }
function fail(res: Response, what: string, e: unknown): void {
  logger.error(`[Recovery] ${what}:`, e);
  res.status(500).json({ error: `Failed to ${what}` });
}

// ── Canaries ───────────────────────────────────────────────────────────────

export async function listCanaries(req: AuthRequest, res: Response): Promise<void> {
  try {
    const scope = await scopeOf(req);
    const rows = await query<any[]>('SELECT * FROM recovery_canaries ORDER BY client_name, created_at');
    res.json(filterByClientName(scope, rows, 'client_name'));
  } catch (e) { fail(res, 'list canaries', e); }
}

function canaryInput(body: any): { client_name: string; path: string; note: string | null } | string {
  const client = String(body?.client_name ?? '').trim();
  if (!CLIENT_NAME.test(client)) return 'Choose a client';
  const path = String(body?.path ?? '').trim().replace(/^\/+/, '');
  if (!validCanaryPath(path)) return 'The path must be relative to the backup root, with "/" between folders (e.g. C/Users/Public/Documents/st0r-canary.bin)';
  const note = body?.note ? String(body.note).slice(0, 255) : null;
  return { client_name: client, path, note };
}

/** Register a file already in the backups, with its checksum computed from a trusted original. */
export async function createCanary(req: AuthRequest, res: Response): Promise<void> {
  const input = canaryInput(req.body);
  if (typeof input === 'string') return bad(res, input);
  const sha = String(req.body?.sha256 ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha)) return bad(res, 'Enter the file\'s SHA-256 (64 hex characters), computed from the original');
  const size = req.body?.size_bytes === undefined || req.body?.size_bytes === null || req.body?.size_bytes === '' ? null : Number(req.body.size_bytes);
  if (size !== null && (!Number.isSafeInteger(size) || size < 0)) return bad(res, 'Size must be a whole number of bytes');
  try {
    const id = randomUUID();
    await query(
      `INSERT INTO recovery_canaries (id, client_name, path, sha256, size_bytes, source, note, created_by) VALUES (?, ?, ?, ?, ?, 'manual', ?, ?)`,
      [id, input.client_name, input.path, sha, size, input.note, req.user?.username ?? null]);
    res.status(201).json({ id });
  } catch (e) { fail(res, 'create canary', e); }
}

/**
 * Generate a canary: random content whose checksum St0r records now, before
 * the file has ever been backed up. The content is returned once, to be put
 * on the client at the given path; St0r does not keep it.
 */
export async function generateCanary(req: AuthRequest, res: Response): Promise<void> {
  const input = canaryInput(req.body);
  if (typeof input === 'string') return bad(res, input);
  const size = Number(req.body?.size_bytes ?? 65536);
  if (!Number.isInteger(size) || size < 1024 || size > 4 * 1024 * 1024) return bad(res, 'Size must be between 1 KiB and 4 MiB');
  try {
    const id = randomUUID();
    const header = Buffer.from(`St0r recovery canary ${id} for ${input.client_name}. Do not edit or delete: scheduled restore drills check this exact content.\n`);
    const content = Buffer.concat([header, randomBytes(Math.max(0, size - header.length))]).subarray(0, size);
    const sha = createHash('sha256').update(content).digest('hex');
    await query(
      `INSERT INTO recovery_canaries (id, client_name, path, sha256, size_bytes, source, note, created_by) VALUES (?, ?, ?, ?, ?, 'generated', ?, ?)`,
      [id, input.client_name, input.path, sha, content.length, input.note, req.user?.username ?? null]);
    res.status(201).json({ id, sha256: sha, size_bytes: content.length, filename: input.path.split('/').pop(), content_base64: content.toString('base64') });
  } catch (e) { fail(res, 'generate canary', e); }
}

export async function deleteCanary(req: AuthRequest, res: Response): Promise<void> {
  try {
    const used = await query<any[]>('SELECT name FROM recovery_drills WHERE canary_id = ?', [req.params.id]);
    if (used.length) return bad(res, `The canary is used by drill "${used[0].name}"`);
    await query('DELETE FROM recovery_canaries WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { fail(res, 'delete canary', e); }
}

// ── Hypervisors (admin) ────────────────────────────────────────────────────

function publicHypervisor(h: any) {
  const { token_secret_encrypted: _secret, ...rest } = h;
  return { ...rest, has_token_secret: !!h.token_secret_encrypted };
}

export async function listHypervisors(_req: AuthRequest, res: Response): Promise<void> {
  try {
    res.json((await query<any[]>('SELECT * FROM recovery_hypervisors ORDER BY name')).map(publicHypervisor));
  } catch (e) { fail(res, 'list hypervisors', e); }
}

const STORAGE_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const BRIDGE = /^[A-Za-z][A-Za-z0-9_.-]{0,15}$/;

function hypervisorInput(b: any, existing?: any): Record<string, unknown> | string {
  const type = b?.type === 'simulator' ? 'simulator' : 'proxmox';
  const name = String(b?.name ?? '').trim();
  if (!name || name.length > 255) return 'Name the hypervisor';
  const out: Record<string, unknown> = { name, type };
  if (type === 'simulator') {
    Object.assign(out, { api_url: 'simulator:', token_id: '-', node: 'sim', disk_storage: 'sim', import_storage: 'sim', isolated_bridge: null, tls_fingerprint: null, artifact_base_url: null });
  } else {
    let url: URL;
    try { url = new URL(String(b?.api_url ?? '')); } catch { return 'The API URL must look like https://pve.example:8006'; }
    if (url.protocol !== 'https:') return 'The API URL must use https';
    out.api_url = url.origin;
    const tokenId = String(b?.token_id ?? '').trim();
    if (!/^[^\s!@]+@[^\s!@]+![A-Za-z0-9_.-]+$/.test(tokenId)) return 'The token id must look like user@realm!tokenid';
    out.token_id = tokenId;
    if (b?.tls_fingerprint) {
      const fp = normalizeFingerprint(b.tls_fingerprint);
      if (!fp) return 'The TLS fingerprint must be a SHA-256 fingerprint';
      out.tls_fingerprint = fp;
    } else out.tls_fingerprint = null;
    const nodeName = String(b?.node ?? '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/.test(nodeName)) return 'Enter the Proxmox node name';
    out.node = nodeName;
    for (const k of ['disk_storage', 'import_storage']) {
      const v = String(b?.[k] ?? '').trim();
      if (!STORAGE_ID.test(v)) return `Enter a Proxmox storage id for ${k.replace('_', ' ')}`;
      out[k] = v;
    }
    const bridge = String(b?.isolated_bridge ?? '').trim();
    if (bridge && !BRIDGE.test(bridge)) return 'The bridge name is not valid';
    out.isolated_bridge = bridge || null;
    const base = String(b?.artifact_base_url ?? '').trim();
    if (base) {
      try { const u = new URL(base); if (!/^https?:$/.test(u.protocol)) throw new Error(); out.artifact_base_url = u.origin + u.pathname.replace(/\/+$/, ''); }
      catch { return 'The St0r address for Proxmox must be an http(s) URL'; }
    } else out.artifact_base_url = null;
    if (b?.token_secret) out.token_secret_encrypted = encrypt(String(b.token_secret));
    else if (!existing?.token_secret_encrypted) return 'Enter the API token secret';
  }
  for (const [k, lo, hi, def] of [['max_disk_gb', 1, 65536, 512], ['scratch_quota_gb', 1, 65536, 600]] as const) {
    const v = b?.[k] === undefined || b?.[k] === '' ? (existing?.[k] ?? def) : Number(b[k]);
    if (!Number.isInteger(v) || v < lo || v > hi) return `${k} must be between ${lo} and ${hi}`;
    out[k] = v;
  }
  return out;
}

export async function createHypervisor(req: AuthRequest, res: Response): Promise<void> {
  const input = hypervisorInput(req.body);
  if (typeof input === 'string') return bad(res, input);
  try {
    const id = randomUUID();
    const cols = ['id', ...Object.keys(input)];
    await query(`INSERT INTO recovery_hypervisors (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, [id, ...Object.values(input)]);
    res.status(201).json({ id });
  } catch (e) { fail(res, 'create hypervisor', e); }
}

export async function updateHypervisor(req: AuthRequest, res: Response): Promise<void> {
  try {
    const rows = await query<any[]>('SELECT * FROM recovery_hypervisors WHERE id = ?', [req.params.id]);
    if (!rows.length) { res.status(404).json({ error: 'Not found' }); return; }
    const input = hypervisorInput(req.body, rows[0]);
    if (typeof input === 'string') return bad(res, input);
    await query(`UPDATE recovery_hypervisors SET ${Object.keys(input).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...Object.values(input), req.params.id]);
    res.json({ ok: true });
  } catch (e) { fail(res, 'update hypervisor', e); }
}

export async function deleteHypervisor(req: AuthRequest, res: Response): Promise<void> {
  try {
    const used = await query<any[]>('SELECT name FROM recovery_drills WHERE hypervisor_id = ?', [req.params.id]);
    if (used.length) return bad(res, `The hypervisor is used by drill "${used[0].name}"`);
    const live = await query<any[]>("SELECT id FROM recovery_drill_resources WHERE hypervisor_id = ? AND state IN ('creating','created','delete_failed')", [req.params.id]);
    if (live.length) return bad(res, 'Drill resources on this hypervisor are still being cleaned up');
    await query('DELETE FROM recovery_hypervisors WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { fail(res, 'delete hypervisor', e); }
}

/** Check the API, the storages and the isolated bridge, without creating anything. */
export async function testHypervisor(req: AuthRequest, res: Response): Promise<void> {
  try {
    const def = await drillConfig.getHypervisor(String(req.params.id));
    if (!def) { res.status(404).json({ error: 'Not found' }); return; }
    const hv = hypervisorFor(def);
    const checks: Array<{ check: string; ok: boolean; detail: string }> = [];
    const step = async (check: string, fn: () => Promise<string>) => {
      try { checks.push({ check, ok: true, detail: await fn() }); } catch (e) { checks.push({ check, ok: false, detail: (e as Error).message }); }
    };
    await step('API', async () => { await hv.ping(); return hv.label; });
    await step('Disk storage', async () => `${Math.round((await hv.storageAvail(def.disk_storage)) / 1024 ** 3)} GiB free in ${def.disk_storage}`);
    await step('Import storage', async () => `${Math.round((await hv.storageAvail(def.import_storage)) / 1024 ** 3)} GiB free in ${def.import_storage}`);
    await step('Network isolation', async () => def.isolated_bridge ? (await hv.checkIsolation(def.isolated_bridge)).detail : 'Drill VMs get no network device');
    res.json({ ok: checks.every((c) => c.ok), evidence: hv.evidence, checks });
  } catch (e) {
    if (e instanceof DrillError) { res.json({ ok: false, checks: [{ check: 'Configuration', ok: false, detail: e.message }] }); return; }
    fail(res, 'test hypervisor', e);
  }
}

// ── Drills ─────────────────────────────────────────────────────────────────

async function drillInput(b: any): Promise<Record<string, unknown> | string> {
  const kind = b?.kind === 'boot' ? 'boot' : b?.kind === 'file' ? 'file' : null;
  if (!kind) return 'Choose a file or boot drill';
  const name = String(b?.name ?? '').trim();
  if (!name || name.length > 255) return 'Name the drill';
  const client = String(b?.client_name ?? '').trim();
  if (!CLIENT_NAME.test(client)) return 'Choose a client';
  const out: Record<string, unknown> = { name, kind, client_name: client, enabled: b?.enabled === false || b?.enabled === 0 ? 0 : 1 };
  if (kind === 'file') {
    const canary = b?.canary_id ? await drillConfig.getCanary(String(b.canary_id)) : null;
    if (!canary) return 'Choose a canary file';
    if (canary.client_name !== client) return 'The canary belongs to a different client';
    const target = b?.replication_target_id ? await drillConfig.getTarget(String(b.replication_target_id)) : null;
    if (!target) return 'Choose the offsite copy (a replication target)';
    Object.assign(out, { canary_id: canary.id, replication_target_id: target.id, hypervisor_id: null, boot_config_json: null });
  } else {
    const hv = b?.hypervisor_id ? await drillConfig.getHypervisor(String(b.hypervisor_id)) : null;
    if (!hv) return 'Choose a hypervisor';
    let cfg;
    try { cfg = validateBootConfig(b?.boot_config); } catch (e) { return (e as Error).message; }
    if (cfg.simulate && hv.type !== 'simulator') delete cfg.simulate;
    Object.assign(out, { hypervisor_id: hv.id, boot_config_json: JSON.stringify(cfg), canary_id: null, replication_target_id: null });
  }
  const schedule = ['manual', 'interval', 'cron'].includes(b?.schedule_type) ? b.schedule_type : 'manual';
  out.schedule_type = schedule;
  const ints: Array<[string, number, number, number]> = [
    ['interval_hours', 1, 24 * 90, 24], ['max_recovery_point_age_hours', 1, 24 * 365, 48],
    ['timeout_seconds', 60, 24 * 3600, kind === 'boot' ? 7200 : 900], ['retry_max_attempts', 1, 5, 2],
  ];
  for (const [k, lo, hi, def] of ints) {
    const v = b?.[k] === undefined || b?.[k] === '' ? def : Number(b[k]);
    if (!Number.isInteger(v) || v < lo || v > hi) return `${k.replace(/_/g, ' ')} must be between ${lo} and ${hi}`;
    out[k] = v;
  }
  const cron = String(b?.cron_expression ?? '0 3 * * *').trim();
  if (schedule === 'cron' && !validCron(cron)) return 'The cron expression must have five fields (minute hour day month weekday)';
  out.cron_expression = cron;
  return out;
}

function publicDrill(d: ReturnType<typeof drillFromRow>) {
  return { ...d, running: drillRunner.isRunning(d.id) };
}

export async function listDrills(req: AuthRequest, res: Response): Promise<void> {
  try {
    const scope = await scopeOf(req);
    const drills = filterByClientName(scope, await drillConfig.listDrills(), 'client_name');
    const out: any[] = [];
    for (const d of drills) out.push({ ...publicDrill(d), last_run: forViewer(await drillStore.lastRun(d.id), scope.isAdmin) });
    res.json(out);
  } catch (e) { fail(res, 'list drills', e); }
}

export async function createDrill(req: AuthRequest, res: Response): Promise<void> {
  try {
    const input = await drillInput(req.body);
    if (typeof input === 'string') return bad(res, input);
    const id = randomUUID();
    const cols = ['id', ...Object.keys(input)];
    await query(`INSERT INTO recovery_drills (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, [id, ...Object.values(input)]);
    res.status(201).json({ id });
  } catch (e) { fail(res, 'create drill', e); }
}

export async function updateDrill(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await drillConfig.getDrill(String(req.params.id)))) { res.status(404).json({ error: 'Not found' }); return; }
    const input = await drillInput(req.body);
    if (typeof input === 'string') return bad(res, input);
    await query(`UPDATE recovery_drills SET ${Object.keys(input).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...Object.values(input), req.params.id]);
    res.json({ ok: true });
  } catch (e) { fail(res, 'update drill', e); }
}

export async function deleteDrill(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (drillRunner.isRunning(String(req.params.id))) return bad(res, 'The drill is running');
    // Runs are kept as evidence; they keep their client name and lose only the link.
    await query('UPDATE recovery_drill_runs SET drill_id = NULL WHERE drill_id = ?', [req.params.id]);
    await query('DELETE FROM recovery_drills WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { fail(res, 'delete drill', e); }
}

export async function runDrill(req: AuthRequest, res: Response): Promise<void> {
  try {
    const drill = await drillConfig.getDrill(String(req.params.id));
    if (!drill) { res.status(404).json({ error: 'Not found' }); return; }
    const runId = await drillRunner.start(drill, 'manual');
    logger.info(`[Recovery] ${req.user?.username} started drill ${drill.name} (run ${runId})`);
    res.status(202).json({ run_id: runId });
  } catch (e) {
    if (e instanceof DrillError) return bad(res, e.message);
    fail(res, 'start drill', e);
  }
}

// ── Runs ───────────────────────────────────────────────────────────────────

/**
 * A run as a customer account sees it: what was restored and how it went, but
 * not St0r's infrastructure (standby hosts and paths, storage paths, VM ids,
 * resource locators). Administrators get the full record.
 */
function forViewer<T extends Record<string, any> | null>(run: T, isAdmin: boolean): T {
  if (!run || isAdmin) return run;
  const c = run.copy_json;
  return {
    ...run,
    copy_json: c ? { kind: c.kind, target_name: c.target_name ?? null, hypervisor: c.hypervisor ?? null, network: c.network ?? null } : null,
    restore_point_json: reportRestorePoint(run.restore_point_json),
    steps_json: null,
    resources: undefined,
  };
}

export async function listRuns(req: AuthRequest, res: Response): Promise<void> {
  try {
    const scope = await scopeOf(req);
    const where: string[] = []; const params: unknown[] = [];
    if (req.query.drill_id) { where.push('drill_id = ?'); params.push(String(req.query.drill_id)); }
    if (req.query.client) { where.push('client_name = ?'); params.push(String(req.query.client)); }
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const rows = await query<any[]>(
      `SELECT * FROM recovery_drill_runs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY started_at DESC LIMIT ${limit}`, params);
    res.json(filterByClientName(scope, rows.map(runFromRow), 'client_name').map((r) => forViewer(r, scope.isAdmin)));
  } catch (e) { fail(res, 'list runs', e); }
}

export async function getRun(req: AuthRequest, res: Response): Promise<void> {
  try {
    const run = await drillStore.getRun(String(req.params.id));
    const scope = await scopeOf(req);
    if (!run || !isClientVisible(scope, run.client_name)) { res.status(404).json({ error: 'Not found' }); return; }
    const resources = await drillStore.resourcesForRun(run.id);
    res.json(forViewer({ ...run, resources: resources.map(({ marker: _m, ...r }) => r) }, scope.isAdmin));
  } catch (e) { fail(res, 'get run', e); }
}

// ── Status and report ──────────────────────────────────────────────────────

/** The last finished run of each drill, split by evidence. */
async function runsByClient(clients: string[], sinceDays: number) {
  if (!clients.length) return [];
  return (await query<any[]>(
    `SELECT * FROM recovery_drill_runs WHERE status <> 'running' AND started_at >= (NOW() - INTERVAL ? DAY)
     AND client_name IN (${clients.map(() => '?').join(', ')}) ORDER BY started_at DESC`, [sinceDays, ...clients])).map(runFromRow);
}

/**
 * Three separate statuses per client — never merged into one:
 *  backup:      UrBackup's own view of the client's last backups
 *  replication: whether the offsite copies its drills use were replicated
 *  recovery:    the newest drill run that actually restored something (simulations excluded)
 */
export async function getStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const scope = await scopeOf(req);
    let clients: any[] = [];
    try { clients = await new UrBackupService().getClients(); } catch (e) { logger.warn(`[Recovery] client list unavailable: ${(e as Error).message}`); }
    clients = filterByClientName(scope, clients, 'name');
    const drills = filterByClientName(scope, await drillConfig.listDrills(), 'client_name');
    const names = [...new Set([...clients.map((c) => c.name), ...drills.map((d) => d.client_name)])];
    const runs = await runsByClient(names, 90);
    const targets = new Map<string, any>();
    for (const d of drills) {
      if (d.replication_target_id && !targets.has(d.replication_target_id)) {
        const t = await drillConfig.getTarget(d.replication_target_id);
        const r = await drillConfig.lastReplication(d.replication_target_id);
        targets.set(d.replication_target_id, t ? { id: t.id, name: t.name, enabled: t.enabled, last: r.last, last_success: r.lastSuccess } : null);
      }
    }
    const out = names.sort().map((name) => {
      const c = clients.find((x) => x.name === name);
      const cd = drills.filter((d) => d.client_name === name);
      const actual = runs.filter((r) => r.client_name === name && r.evidence === 'actual');
      const lastActual = actual[0] ?? null;
      const lastPassed = actual.find((r) => r.status === 'passed') ?? null;
      const lastSim = runs.find((r) => r.client_name === name && r.evidence === 'simulated') ?? null;
      const repl = [...new Set(cd.map((d) => d.replication_target_id).filter(Boolean))].map((id) => targets.get(id as string)).filter(Boolean);
      const backupState = !c ? 'unknown' : (c.file_ok || c.image_ok) ? 'ok' : (c.lastbackup || c.lastbackup_image) ? 'failed' : 'none';
      const replState = !repl.length ? 'not_configured'
        : repl.every((t: any) => t.last?.status === 'success') ? 'ok'
        : repl.some((t: any) => t.last?.status === 'running' || t.last?.status === 'queued') ? 'running' : 'failed';
      const recState = !cd.length ? 'not_configured' : !lastActual ? 'never_run'
        : lastActual.status === 'passed' ? ((lastActual.restore_point_json as any)?.rpo_exceeded ? 'stale' : 'verified') : 'failed';
      return {
        client_name: name,
        backup: { state: backupState, last_file_backup: c?.lastbackup ?? null, last_image_backup: c?.lastbackup_image ?? null, file_ok: !!c?.file_ok, image_ok: !!c?.image_ok },
        replication: { state: replState, targets: repl },
        recovery: { state: recState, drills: cd.length, last_run: forViewer(lastActual, scope.isAdmin), last_passed: forViewer(lastPassed, scope.isAdmin) },
        simulation: lastSim ? { last_run: forViewer(lastSim, scope.isAdmin) } : null,
      };
    });
    res.json(out);
  } catch (e) { fail(res, 'load recovery status', e); }
}

/** A restore point as a customer sees it: which backup, when — not where St0r keeps it. */
function reportRestorePoint(rp: any) {
  if (!rp) return null;
  const common = { max_age_hours: rp.max_age_hours, rpo_exceeded: rp.rpo_exceeded };
  if (rp.kind === 'image') {
    return { kind: 'image', ...common, images: (rp.images || []).map((i: any) => ({ letter: i.letter, image_id: i.image_id, backup_time: i.backup_time, chain: i.chain })) };
  }
  return { kind: 'file', ...common, backup_id: rp.backup_id, backup_time: rp.backup_time, backup_path: rp.backup_path, incremental: rp.incremental };
}

/** Customer-facing report for one client: what was actually restored, separated from simulations. */
export async function getReport(req: AuthRequest, res: Response): Promise<void> {
  try {
    const client = String(req.query.client ?? '');
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const scope = await scopeOf(req);
    if (!CLIENT_NAME.test(client) || !isClientVisible(scope, client)) { res.status(404).json({ error: 'Not found' }); return; }
    const runs = await runsByClient([client], days);
    const drills = (await drillConfig.listDrills()).filter((d) => d.client_name === client);
    const shape = (r: any) => ({
      id: r.id, drill: drills.find((d) => d.id === r.drill_id)?.name ?? '(deleted drill)', kind: r.kind, status: r.status,
      started_at: r.started_at, finished_at: r.finished_at, elapsed_ms: r.elapsed_ms, attempts: r.attempts,
      copy: r.copy_json ? { kind: r.copy_json.kind, target_name: r.copy_json.target_name ?? null, hypervisor: r.copy_json.hypervisor ?? null, network: r.copy_json.network ?? null } : null,
      restore_point: reportRestorePoint(r.restore_point_json), recovery_point_time: r.recovery_point_time, recovery_point_age_seconds: r.recovery_point_age_seconds,
      restored_item: r.restored_item, expected_sha256: r.expected_sha256, actual_sha256: r.actual_sha256, bytes_restored: r.bytes_restored,
      boot_ms: r.boot_ms, rto_ms: r.rto_ms, services: r.services_json || [],
      failure_stage: r.failure_stage, failure_reason: r.failure_reason, cleanup_status: r.cleanup_status,
    });
    const actual = runs.filter((r) => r.evidence === 'actual');
    res.json({
      client_name: client, generated_at: new Date().toISOString(), period_days: days,
      summary: {
        actual_runs: actual.length,
        actual_passed: actual.filter((r) => r.status === 'passed').length,
        last_verified: actual.find((r) => r.status === 'passed')?.finished_at ?? null,
        newest_recovery_point: actual.find((r) => r.status === 'passed')?.recovery_point_time ?? null,
      },
      actual: actual.map(shape),
      simulated: runs.filter((r) => r.evidence === 'simulated').map(shape),
    });
  } catch (e) { fail(res, 'build report', e); }
}

/** Options for the drill form (admin): replication targets as offsite copies. */
export async function getOptions(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const targets = await query<any[]>('SELECT id, name, host, enabled FROM replication_targets ORDER BY name');
    let clients: string[] = [];
    try { clients = (await new UrBackupService().getClients()).map((c: any) => c.name); } catch { /* list stays empty */ }
    res.json({ replication_targets: targets, clients });
  } catch (e) { fail(res, 'load options', e); }
}
