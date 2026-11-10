import { query } from '../../config/database.js';

export type RunStatus = 'running' | 'passed' | 'failed' | 'error' | 'interrupted';
export type Evidence = 'actual' | 'simulated';
export type ResourceKind = 'scratch_dir' | 'vhd_workdir' | 'pve_volume' | 'pve_vm';
export type ResourceState = 'creating' | 'created' | 'deleted' | 'delete_failed' | 'not_ours';

export interface RunRecord {
  id: string;
  drill_id: string | null;
  kind: 'file' | 'boot';
  client_name: string;
  evidence: Evidence;
  status: RunStatus;
  trigger_type: 'schedule' | 'manual';
  attempts: number;
  started_at: Date;
  finished_at?: Date | null;
  elapsed_ms?: number | null;
  copy_json?: Record<string, unknown> | null;
  restore_point_json?: Record<string, unknown> | null;
  recovery_point_time?: Date | null;
  recovery_point_age_seconds?: number | null;
  restored_item?: string | null;
  expected_sha256?: string | null;
  actual_sha256?: string | null;
  bytes_restored?: number | null;
  boot_ms?: number | null;
  rto_ms?: number | null;
  services_json?: Array<{ name: string; passed: boolean; detail: string }> | null;
  failure_stage?: string | null;
  failure_reason?: string | null;
  cleanup_status: 'none' | 'done' | 'pending' | 'failed';
  steps_json?: Array<{ at: string; stage: string; message: string }> | null;
}

export interface ResourceRecord {
  id: string;
  run_id: string;
  kind: ResourceKind;
  hypervisor_id: string | null;
  locator: string;
  marker: string;
  state: ResourceState;
  attempts: number;
  last_error: string | null;
  created_at?: Date;
}

/** Persistence for drill runs and the resources they create. */
export interface DrillStore {
  createRun(run: RunRecord): Promise<void>;
  updateRun(id: string, patch: Partial<RunRecord>): Promise<void>;
  getRun(id: string): Promise<RunRecord | null>;
  /** Runs still marked running (e.g. when St0r was stopped mid-drill). */
  runningRuns(): Promise<RunRecord[]>;
  /** The newest finished run of a drill, other than `excludeRunId`. */
  lastRun(drillId: string, excludeRunId?: string): Promise<RunRecord | null>;
  addResource(r: Omit<ResourceRecord, 'state' | 'attempts' | 'last_error'>): Promise<void>;
  updateResource(id: string, patch: Partial<Pick<ResourceRecord, 'state' | 'attempts' | 'last_error' | 'locator'>>): Promise<void>;
  resourcesForRun(runId: string): Promise<ResourceRecord[]>;
  /** Resources that still exist or may exist: creating, created, delete_failed. */
  liveResources(): Promise<ResourceRecord[]>;
}

const RUN_JSON = ['copy_json', 'restore_point_json', 'services_json', 'steps_json'] as const;
const RUN_COLUMNS = [
  'drill_id', 'kind', 'client_name', 'evidence', 'status', 'trigger_type', 'attempts', 'started_at', 'finished_at',
  'elapsed_ms', 'copy_json', 'restore_point_json', 'recovery_point_time', 'recovery_point_age_seconds',
  'restored_item', 'expected_sha256', 'actual_sha256', 'bytes_restored', 'boot_ms', 'rto_ms', 'services_json',
  'failure_stage', 'failure_reason', 'cleanup_status', 'steps_json',
] as const;

function toDb(key: string, v: unknown): unknown {
  if ((RUN_JSON as readonly string[]).includes(key)) return v === null || v === undefined ? null : JSON.stringify(v);
  return v === undefined ? null : v;
}

function parseJson(v: unknown): any {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  if (Buffer.isBuffer(v)) { try { return JSON.parse(v.toString('utf8')); } catch { return null; } }
  return v;
}

export function runFromRow(row: any): RunRecord {
  const r: any = { ...row };
  for (const k of RUN_JSON) r[k] = parseJson(row[k]);
  for (const k of ['attempts', 'elapsed_ms', 'recovery_point_age_seconds', 'bytes_restored', 'boot_ms', 'rto_ms']) {
    if (r[k] !== null && r[k] !== undefined) r[k] = Number(r[k]);
  }
  return r as RunRecord;
}

export class SqlDrillStore implements DrillStore {
  async createRun(run: RunRecord): Promise<void> {
    const cols = ['id', ...RUN_COLUMNS];
    await query(
      `INSERT INTO recovery_drill_runs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => toDb(c, (run as any)[c])),
    );
  }

  async updateRun(id: string, patch: Partial<RunRecord>): Promise<void> {
    const keys = Object.keys(patch).filter((k) => (RUN_COLUMNS as readonly string[]).includes(k));
    if (!keys.length) return;
    await query(
      `UPDATE recovery_drill_runs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
      [...keys.map((k) => toDb(k, (patch as any)[k])), id],
    );
  }

  async getRun(id: string): Promise<RunRecord | null> {
    const rows = await query<any[]>('SELECT * FROM recovery_drill_runs WHERE id = ?', [id]);
    return rows[0] ? runFromRow(rows[0]) : null;
  }

  async runningRuns(): Promise<RunRecord[]> {
    const rows = await query<any[]>("SELECT * FROM recovery_drill_runs WHERE status = 'running'");
    return rows.map(runFromRow);
  }

  async lastRun(drillId: string, excludeRunId = ''): Promise<RunRecord | null> {
    const rows = await query<any[]>(
      "SELECT * FROM recovery_drill_runs WHERE drill_id = ? AND id <> ? AND status <> 'running' ORDER BY started_at DESC LIMIT 1", [drillId, excludeRunId]);
    return rows[0] ? runFromRow(rows[0]) : null;
  }

  async addResource(r: Omit<ResourceRecord, 'state' | 'attempts' | 'last_error'>): Promise<void> {
    await query(
      `INSERT INTO recovery_drill_resources (id, run_id, kind, hypervisor_id, locator, marker, state, attempts)
       VALUES (?, ?, ?, ?, ?, ?, 'creating', 0)`,
      [r.id, r.run_id, r.kind, r.hypervisor_id, r.locator, r.marker],
    );
  }

  async updateResource(id: string, patch: Partial<Pick<ResourceRecord, 'state' | 'attempts' | 'last_error' | 'locator'>>): Promise<void> {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    await query(
      `UPDATE recovery_drill_resources SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
      [...keys.map((k) => (patch as any)[k] ?? null), id],
    );
  }

  async resourcesForRun(runId: string): Promise<ResourceRecord[]> {
    return query<any[]>('SELECT * FROM recovery_drill_resources WHERE run_id = ? ORDER BY created_at', [runId]);
  }

  async liveResources(): Promise<ResourceRecord[]> {
    return query<any[]>(
      "SELECT * FROM recovery_drill_resources WHERE state IN ('creating','created','delete_failed') ORDER BY created_at");
  }
}
