// Recovery verification (scheduled restore drills). Mirrors backend/src/controllers/recovery.ts.

export type DrillKind = 'file' | 'boot';
export type RunStatus = 'running' | 'passed' | 'failed' | 'error' | 'interrupted';
export type Evidence = 'actual' | 'simulated';

export interface BootConfig {
  profile: 'windows-uefi';
  service: string;
  memory_mb?: number;
  cores?: number;
  boot_timeout_seconds?: number;
  service_timeout_seconds?: number;
  simulate?: { boot?: 'ok' | 'fail'; service?: 'ok' | 'fail' };
}

export interface DrillRun {
  id: string;
  drill_id: string | null;
  kind: DrillKind;
  client_name: string;
  evidence: Evidence;
  status: RunStatus;
  trigger_type: 'schedule' | 'manual';
  attempts: number;
  started_at: string;
  finished_at: string | null;
  elapsed_ms: number | null;
  copy_json: Record<string, any> | null;
  restore_point_json: Record<string, any> | null;
  recovery_point_time: string | null;
  recovery_point_age_seconds: number | null;
  restored_item: string | null;
  expected_sha256: string | null;
  actual_sha256: string | null;
  bytes_restored: number | null;
  boot_ms: number | null;
  rto_ms: number | null;
  services_json: Array<{ name: string; passed: boolean; detail: string }> | null;
  failure_stage: string | null;
  failure_reason: string | null;
  cleanup_status: 'none' | 'done' | 'pending' | 'failed';
  steps_json: Array<{ at: string; stage: string; message: string }> | null;
  resources?: Array<{ id: string; kind: string; locator: string; state: string; attempts: number; last_error: string | null }>;
}

export interface Drill {
  id: string;
  name: string;
  kind: DrillKind;
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
  last_run_at: string | null;
  running: boolean;
  last_run: DrillRun | null;
}

export interface Canary {
  id: string;
  client_name: string;
  path: string;
  sha256: string;
  size_bytes: number | null;
  source: 'generated' | 'manual';
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Hypervisor {
  id: string;
  name: string;
  type: 'proxmox' | 'simulator';
  api_url: string;
  token_id: string;
  has_token_secret: boolean;
  tls_fingerprint: string | null;
  node: string;
  disk_storage: string;
  import_storage: string;
  isolated_bridge: string | null;
  artifact_base_url: string | null;
  max_disk_gb: number;
  scratch_quota_gb: number;
}

export interface ClientRecoveryStatus {
  client_name: string;
  backup: { state: 'ok' | 'failed' | 'none' | 'unknown'; last_file_backup: number | null; last_image_backup: number | null };
  replication: { state: 'ok' | 'failed' | 'running' | 'not_configured'; targets: Array<{ id: string; name: string; last: { status: string; finished_at: string | null } | null; last_success: { finished_at: string | null } | null }> };
  recovery: { state: 'verified' | 'stale' | 'failed' | 'never_run' | 'not_configured'; drills: number; last_run: DrillRun | null; last_passed: DrillRun | null };
  simulation: { last_run: DrillRun } | null;
}

export interface ReportRun {
  id: string; drill: string; kind: DrillKind; status: RunStatus;
  started_at: string; finished_at: string | null; elapsed_ms: number | null; attempts: number;
  copy: { kind: string; target_name: string | null; hypervisor: string | null; network: string | null } | null;
  restore_point: Record<string, any> | null; recovery_point_time: string | null; recovery_point_age_seconds: number | null;
  restored_item: string | null; expected_sha256: string | null; actual_sha256: string | null; bytes_restored: number | null;
  boot_ms: number | null; rto_ms: number | null; services: Array<{ name: string; passed: boolean; detail: string }>;
  failure_stage: string | null; failure_reason: string | null; cleanup_status: string;
}

export interface RecoveryReport {
  client_name: string;
  generated_at: string;
  period_days: number;
  summary: { actual_runs: number; actual_passed: number; last_verified: string | null; newest_recovery_point: string | null };
  actual: ReportRun[];
  simulated: ReportRun[];
}

export interface GeneratedCanary { id: string; sha256: string; size_bytes: number; filename: string; content_base64: string }
