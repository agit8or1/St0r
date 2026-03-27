export interface User {
  id: number;
  username: string;
  email: string;
  isAdmin: boolean;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface UrBackupServer {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServerRequest {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  isDefault?: boolean;
}

export interface Client {
  id: string;
  name: string;
  lastbackup?: number;
  lastbackup_image?: number;
  lastseen?: number;
  online: boolean;
  status: string;
  ip?: string;
  uid?: string;
  file_ok?: boolean;
  image_ok?: boolean;
  bytes_used_files?: number;
  bytes_used_images?: number;
  client_version_string?: string | null;
  os_simple?: string | null;
}

export interface Activity {
  id: string;
  action: string;
  client: string;
  pcdone: number;
  eta_ms: number;
  done_bytes: number;
  total_bytes: number;
  errors?: number;
  success?: boolean | number | string;
}

export interface Backup {
  id: number;
  backuptime: number;
  image: boolean;
  incremental: boolean;
  size_bytes: number;
  duration: number;
}

export interface Status {
  online_clients: number;
  offline_clients: number;
  active_processes: number;
  failed_backups: number;
}

export interface Usage {
  used: number;
  total: number;
}

export interface Customer {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: string;
  notes?: string;
  is_active: boolean;
  client_count?: number;
  user_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface CustomerClient {
  id: number;
  customer_id: number;
  server_id: number;
  client_name: string;
  client_id?: string;
  notes?: string;
  server_name?: string;
  server_host?: string;
  customer_name?: string;
  customer_company?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SystemMetrics {
  cpu: {
    usage: number;
    cores: number;
    model: string;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  network: {
    iface: string;
    rxBytesPerSec: number;
    txBytesPerSec: number;
    linkSpeedMbps: number;
  };
  uptime: number;
  hostname: string;
}

export interface ServerLatency {
  serverId: number;
  host: string;
  port: number;
  latency: number;
  status: 'connected' | 'unreachable';
}

export interface StorageInfo {
  used: number;
  available: number;
  servers: Array<{
    serverId: number;
    serverName: string;
    used: number;
    available: number;
    error?: string;
  }>;
}

// Storage limits
export interface StorageLimit {
  client_name: string;
  limit_bytes: number;
  warn_threshold_pct: number;
  critical_threshold_pct: number;
}

export interface StorageLimitStatus {
  name: string;
  has_limit: boolean;
  limit_bytes?: number;
  used_bytes?: number;
  pct?: number;
  status?: 'ok' | 'warning' | 'critical' | 'exceeded';
  warn_threshold_pct?: number;
  critical_threshold_pct?: number;
}

// Replication types
export interface ReplicationSettings {
  id: number;
  enabled: boolean;
  concurrency: number;
  trigger_mode: 'hook_and_schedule' | 'hook_only' | 'schedule_only';
  schedule_type: 'interval' | 'cron';
  interval_seconds: number;
  cron_expression: string;
  debounce_seconds: number;
  max_staleness_minutes: number;
  retry_max_attempts: number;
  retry_base_seconds: number;
  retry_max_seconds: number;
  default_bandwidth_limit_mbps: number;
  default_verify_after_sync: boolean;
  default_checksum_verify: boolean;
  pause_during_active_backup: boolean;
  state_set_json: {
    include_paths: string[];
    exclude_patterns: string[];
    repo_paths: string[];
    db: { type: 'sqlite' | 'mysql'; sqlite_path?: string; mysql_dsn?: string };
  } | null;
}

export interface ReplicationTarget {
  id: string;
  name: string;
  enabled: boolean;
  mode: 'push_ssh_rsync';
  host: string;
  port: number;
  ssh_user: string;
  auth_type: 'ssh_key' | 'password';
  ssh_private_key_encrypted: string | null;
  ssh_password_encrypted: string | null;
  ssh_known_host_fingerprint: string | null;
  target_root_path: string;
  target_repo_paths_map: Record<string, string> | null;
  target_db_type: 'sqlite' | 'mysql';
  target_db_dsn_encrypted: string | null;
  verify_after_sync: boolean;
  checksum_verify: boolean;
  bandwidth_limit_mbps: number;
  exclude_patterns: string[] | null;
  standby_service_mode: 'running_readonly' | 'stopped';
  service_stop_cmd: string;
  service_start_cmd: string;
  btrfs_mode: 'auto' | 'btrfs_send' | 'rsync';
  created_at: string;
  updated_at: string;
}

export interface ReplicationRun {
  id: string;
  target_id: string;
  started_at: string;
  finished_at: string | null;
  status: 'queued' | 'running' | 'success' | 'failed' | 'canceled';
  trigger_type: 'hook' | 'schedule' | 'manual';
  step: string | null;
  progress: number;
  bytes_sent: number;
  files_sent: number;
  snapshot_timestamp: string | null;
  lag_seconds: number | null;
  error_message: string | null;
  details_json: { log?: string } | null;
}

export interface ReplicationEvent {
  id: string;
  target_id: string | null;
  type: 'stale' | 'failed' | 'recovered' | 'config_changed' | 'run_started' | 'run_finished';
  severity: 'info' | 'warn' | 'critical';
  message: string;
  created_at: string;
}

export interface ReplicationAlertChannel {
  id: string;
  type: 'email' | 'webhook';
  enabled: boolean;
  config_json: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface ReplicationTargetStatus {
  target: ReplicationTarget;
  lastRun: {
    id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    progress: number;
    lag_seconds: number | null;
    bytes_sent: number;
    error_message: string | null;
  } | null;
  isRunning: boolean;
}
