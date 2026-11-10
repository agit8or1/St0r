import { query } from '../../config/database.js';
import { getUrBackupDb, openUrBackupSettingsDbReadOnly } from '../../config/urbackupDb.js';
import { AlertChannel } from '../replicationAlerts.js';
import { StandbyTarget } from './standby.js';
import { DrillError } from './errors.js';

/**
 * Everything a drill reads: its own configuration from St0r's database, and
 * restore points from UrBackup's. Behind interfaces so the runners can be
 * tested against fixtures.
 */
export interface DrillDef {
  id: string;
  name: string;
  kind: 'file' | 'boot';
  client_name: string;
  enabled: boolean;
  canary_id: string | null;
  replication_target_id: string | null;
  hypervisor_id: string | null;
  boot_config: BootConfig | null;
  schedule_type: 'manual' | 'interval' | 'cron';
  interval_hours: number;
  cron_expression: string;
  max_recovery_point_age_hours: number;
  timeout_seconds: number;
  retry_max_attempts: number;
  last_run_at: Date | null;
}

export interface BootConfig {
  /** Only "windows-uefi" is supported: see docs/recovery-verification.md. */
  profile: 'windows-uefi';
  /** The service that must be running in the clone (Windows service name). */
  service: string;
  memory_mb: number;
  cores: number;
  /** How long the guest agent may take to answer after the VM starts. */
  boot_timeout_seconds: number;
  /** How long the service may take to reach RUNNING once the agent answers. */
  service_timeout_seconds: number;
  /** Simulator hypervisors only: make the drill fail at a stage, for testing alerts and reports. */
  simulate?: { boot?: 'ok' | 'fail'; service?: 'ok' | 'fail' };
}

export interface Canary {
  id: string;
  client_name: string;
  path: string;
  sha256: string;
  size_bytes: number | null;
  source: 'generated' | 'manual';
  note: string | null;
}

export interface HypervisorDef {
  id: string;
  name: string;
  type: 'proxmox' | 'simulator';
  api_url: string;
  token_id: string;
  token_secret_encrypted: string | null;
  tls_fingerprint: string | null;
  node: string;
  disk_storage: string;
  import_storage: string;
  isolated_bridge: string | null;
  artifact_base_url: string | null;
  max_disk_gb: number;
  scratch_quota_gb: number;
}

export interface ReplicaTarget extends StandbyTarget {
  enabled: boolean;
  target_root_path: string;
  target_repo_paths_map: Record<string, string> | null;
}

export interface LastReplication { run_id: string; status: string; finished_at: Date | null }

export interface DrillConfigSource {
  getDrill(id: string): Promise<DrillDef | null>;
  listDrills(): Promise<DrillDef[]>;
  getCanary(id: string): Promise<Canary | null>;
  getTarget(id: string): Promise<ReplicaTarget | null>;
  /** repo_paths from the replication state set: what gets replicated when no explicit map is set. */
  replicatedRepoPaths(): Promise<string[]>;
  lastReplication(targetId: string): Promise<{ lastSuccess: LastReplication | null; last: LastReplication | null }>;
  getHypervisor(id: string): Promise<HypervisorDef | null>;
  alertChannels(): Promise<AlertChannel[]>;
  markRun(drillId: string, at: Date): Promise<void>;
}

export interface FileRestorePoint {
  id: number;
  backup_time: Date;
  path: string;
  incremental: boolean;
}

export interface ImageRestorePoint {
  id: number;
  backup_time: Date;
  letter: string;
  path: string;
  version: number;
  incremental: number;
  incremental_ref: number;
  size_bytes: number;
}

export interface RestorePointSource {
  storageFolder(): Promise<string>;
  /** Complete, not-being-deleted file backups, newest first. */
  fileBackups(clientName: string, limit: number): Promise<FileRestorePoint[]>;
  /** Complete, not-being-deleted image backups, newest first. */
  imageBackups(clientName: string): Promise<ImageRestorePoint[]>;
  /** Images UrBackup associated with an image (the ESP / system volume taken with C:). */
  associatedImages(imageId: number): Promise<number[]>;
}

function parseJson(v: unknown): any {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  if (Buffer.isBuffer(v)) { try { return JSON.parse(v.toString('utf8')); } catch { return null; } }
  return v;
}

export function drillFromRow(r: any): DrillDef {
  return {
    id: r.id, name: r.name, kind: r.kind, client_name: r.client_name, enabled: !!r.enabled,
    canary_id: r.canary_id ?? null, replication_target_id: r.replication_target_id ?? null,
    hypervisor_id: r.hypervisor_id ?? null, boot_config: parseJson(r.boot_config_json),
    schedule_type: r.schedule_type, interval_hours: Number(r.interval_hours), cron_expression: r.cron_expression,
    max_recovery_point_age_hours: Number(r.max_recovery_point_age_hours), timeout_seconds: Number(r.timeout_seconds),
    retry_max_attempts: Number(r.retry_max_attempts), last_run_at: r.last_run_at ? new Date(r.last_run_at) : null,
  };
}

export class SqlDrillConfig implements DrillConfigSource {
  async getDrill(id: string) {
    const rows = await query<any[]>('SELECT * FROM recovery_drills WHERE id = ?', [id]);
    return rows[0] ? drillFromRow(rows[0]) : null;
  }
  async listDrills() {
    return (await query<any[]>('SELECT * FROM recovery_drills ORDER BY name')).map(drillFromRow);
  }
  async getCanary(id: string) {
    const rows = await query<any[]>('SELECT * FROM recovery_canaries WHERE id = ?', [id]);
    const r = rows[0];
    return r ? { ...r, size_bytes: r.size_bytes === null ? null : Number(r.size_bytes) } : null;
  }
  async getTarget(id: string) {
    const rows = await query<any[]>('SELECT * FROM replication_targets WHERE id = ?', [id]);
    const r = rows[0];
    if (!r) return null;
    return { ...r, enabled: !!r.enabled, port: Number(r.port) || 22, target_repo_paths_map: parseJson(r.target_repo_paths_map) };
  }
  async replicatedRepoPaths() {
    const rows = await query<any[]>('SELECT state_set_json FROM replication_settings WHERE id = 1');
    const s = parseJson(rows[0]?.state_set_json);
    return Array.isArray(s?.repo_paths) ? s.repo_paths.filter((p: unknown) => typeof p === 'string') : [];
  }
  async lastReplication(targetId: string) {
    const pick = (r: any): LastReplication | null => r ? { run_id: r.id, status: r.status, finished_at: r.finished_at ? new Date(r.finished_at) : null } : null;
    const ok = await query<any[]>("SELECT id, status, finished_at FROM replication_runs WHERE target_id = ? AND status = 'success' ORDER BY started_at DESC LIMIT 1", [targetId]);
    const any = await query<any[]>('SELECT id, status, finished_at FROM replication_runs WHERE target_id = ? ORDER BY started_at DESC LIMIT 1', [targetId]);
    return { lastSuccess: pick(ok[0]), last: pick(any[0]) };
  }
  async getHypervisor(id: string) {
    const rows = await query<any[]>('SELECT * FROM recovery_hypervisors WHERE id = ?', [id]);
    const r = rows[0];
    return r ? { ...r, max_disk_gb: Number(r.max_disk_gb), scratch_quota_gb: Number(r.scratch_quota_gb) } : null;
  }
  async alertChannels() {
    const rows = await query<any[]>('SELECT * FROM replication_alert_channels WHERE enabled = 1');
    return rows.map((r) => ({ ...r, enabled: !!r.enabled, config_json: parseJson(r.config_json) || {} }));
  }
  async markRun(drillId: string, at: Date) {
    await query('UPDATE recovery_drills SET last_run_at = ? WHERE id = ?', [at, drillId]);
  }
}

/** UrBackup stores times as UTC "YYYY-MM-DD HH:MM:SS". */
function utc(s: string): Date {
  return new Date(`${String(s).replace(' ', 'T')}Z`);
}

export class UrBackupRestorePoints implements RestorePointSource {
  async storageFolder(): Promise<string> {
    const db = await openUrBackupSettingsDbReadOnly();
    try {
      const row = await db.get<{ value?: string }>("SELECT value FROM settings WHERE key = 'backupfolder' AND clientid = 0 LIMIT 1");
      const folder = row?.value?.trim();
      if (!folder) throw new DrillError('config', 'UrBackup has no storage folder configured');
      return folder.replace(/\/+$/, '');
    } finally {
      await db.close().catch(() => undefined);
    }
  }

  private async clientId(name: string): Promise<number> {
    const db = await getUrBackupDb();
    const row = await db.get<{ id: number }>('SELECT id FROM clients WHERE name = ?', name);
    if (!row) throw new DrillError('restore-point', `UrBackup has no client named ${name}`);
    return row.id;
  }

  async fileBackups(clientName: string, limit: number) {
    const id = await this.clientId(clientName);
    const db = await getUrBackupDb();
    const rows = await db.all<any[]>(
      `SELECT id, backuptime, path, incremental FROM backups
       WHERE clientid = ? AND complete = 1 AND (delete_pending = 0 OR delete_pending IS NULL)
       ORDER BY backuptime DESC LIMIT ?`, id, limit);
    return rows.map((r) => ({ id: r.id, backup_time: utc(r.backuptime), path: r.path, incremental: r.incremental !== 0 }));
  }

  async imageBackups(clientName: string) {
    const id = await this.clientId(clientName);
    const db = await getUrBackupDb();
    const rows = await db.all<any[]>(
      `SELECT id, backuptime, letter, path, version, incremental, incremental_ref, size_bytes FROM backup_images
       WHERE clientid = ? AND complete = 1 AND (delete_pending = 0 OR delete_pending IS NULL)
       ORDER BY backuptime DESC`, id);
    return rows.map((r) => ({
      id: r.id, backup_time: utc(r.backuptime), letter: r.letter, path: r.path, version: Number(r.version) || 0,
      incremental: Number(r.incremental) || 0, incremental_ref: Number(r.incremental_ref) || 0, size_bytes: Number(r.size_bytes) || 0,
    }));
  }

  async associatedImages(imageId: number) {
    const db = await getUrBackupDb();
    const rows = await db.all<any[]>('SELECT assoc_id FROM assoc_images WHERE img_id = ?', imageId);
    return rows.map((r) => Number(r.assoc_id));
  }
}

/**
 * Where a local storage path lives on a replication target: through the
 * target's explicit path map (longest matching source wins), or else under its
 * root path when the path is one of the replicated repositories. Null when the
 * target does not replicate it.
 */
export function remotePathFor(
  target: Pick<ReplicaTarget, 'target_root_path' | 'target_repo_paths_map'>,
  repoPaths: string[],
  localPath: string,
): string | null {
  const norm = (p: string) => p.replace(/\/+$/, '') || '/';
  const local = norm(localPath);
  const within = (base: string) => local === base || local.startsWith(`${base}/`);
  const map = target.target_repo_paths_map;
  if (map && Object.keys(map).length) {
    const src = Object.keys(map).map(norm).filter(within).sort((a, b) => b.length - a.length)[0];
    if (!src) return null;
    const dst = norm(Object.entries(map).find(([k]) => norm(k) === src)![1]);
    return dst + local.slice(src.length);
  }
  if (!repoPaths.map(norm).some(within)) return null;
  return `${norm(target.target_root_path)}${local}`;
}

/** A canary path: relative, '/'-separated, no empty, "." or ".." parts, no control characters. */
export function validCanaryPath(p: unknown): p is string {
  if (typeof p !== 'string' || !p || p.length > 1024) return false;
  if (p.startsWith('/') || p.includes('\\') || [...p].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return false;
  return p.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}
