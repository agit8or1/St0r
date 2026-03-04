-- Migration 003: Full Standby Replication
-- Apply with: mysql -u urbackup urbackup_gui < database/migrations/003_replication.sql

CREATE TABLE IF NOT EXISTS replication_settings (
  id INT NOT NULL DEFAULT 1,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  concurrency INT NOT NULL DEFAULT 1,
  trigger_mode ENUM('hook_and_schedule','hook_only','schedule_only') NOT NULL DEFAULT 'hook_and_schedule',
  schedule_type ENUM('interval','cron') NOT NULL DEFAULT 'interval',
  interval_seconds INT NOT NULL DEFAULT 3600,
  cron_expression VARCHAR(100) NOT NULL DEFAULT '0 * * * *',
  debounce_seconds INT NOT NULL DEFAULT 60,
  max_staleness_minutes INT NOT NULL DEFAULT 120,
  retry_max_attempts INT NOT NULL DEFAULT 3,
  retry_base_seconds INT NOT NULL DEFAULT 30,
  retry_max_seconds INT NOT NULL DEFAULT 300,
  default_bandwidth_limit_mbps INT NOT NULL DEFAULT 0,
  default_verify_after_sync TINYINT(1) NOT NULL DEFAULT 0,
  default_checksum_verify TINYINT(1) NOT NULL DEFAULT 0,
  pause_during_active_backup TINYINT(1) NOT NULL DEFAULT 1,
  state_set_json TEXT NOT NULL DEFAULT '{"include_paths":["/etc/urbackup","/var/lib/urbackup"],"exclude_patterns":["*.tmp","*.lock","cache/"],"db":{"type":"sqlite","sqlite_path":"/var/urbackup/backup_server.db"},"repo_paths":["/home/administrator/urbackup-storage"]}',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT single_row CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insert default row if not present
INSERT IGNORE INTO replication_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS replication_targets (
  id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  mode ENUM('push_ssh_rsync') NOT NULL DEFAULT 'push_ssh_rsync',
  host VARCHAR(255) NOT NULL,
  port INT NOT NULL DEFAULT 22,
  ssh_user VARCHAR(100) NOT NULL DEFAULT 'root',
  auth_type ENUM('ssh_key','password') NOT NULL DEFAULT 'ssh_key',
  ssh_private_key_encrypted TEXT,
  ssh_password_encrypted TEXT,
  ssh_known_host_fingerprint TEXT,
  target_root_path VARCHAR(1024) NOT NULL DEFAULT '/opt/urbackup-replica',
  target_repo_paths_map JSON,
  target_db_type ENUM('sqlite','mysql') NOT NULL DEFAULT 'sqlite',
  target_db_dsn_encrypted TEXT,
  verify_after_sync TINYINT(1) NOT NULL DEFAULT 0,
  checksum_verify TINYINT(1) NOT NULL DEFAULT 0,
  bandwidth_limit_mbps INT NOT NULL DEFAULT 0,
  exclude_patterns JSON,
  standby_service_mode ENUM('running_readonly','stopped') NOT NULL DEFAULT 'stopped',
  service_stop_cmd VARCHAR(512) DEFAULT 'systemctl stop urbackupsrv',
  service_start_cmd VARCHAR(512) DEFAULT 'systemctl start urbackupsrv',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS replication_runs (
  id CHAR(36) NOT NULL,
  target_id CHAR(36) NOT NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL,
  status ENUM('queued','running','success','failed','canceled') NOT NULL DEFAULT 'queued',
  trigger_type ENUM('hook','schedule','manual') NOT NULL DEFAULT 'manual',
  step VARCHAR(255),
  progress FLOAT NOT NULL DEFAULT 0,
  bytes_sent BIGINT NOT NULL DEFAULT 0,
  files_sent INT NOT NULL DEFAULT 0,
  snapshot_timestamp TIMESTAMP NULL,
  lag_seconds INT,
  error_message TEXT,
  details_json JSON,
  PRIMARY KEY (id),
  INDEX idx_target_id (target_id),
  INDEX idx_started_at (started_at),
  INDEX idx_status (status),
  FOREIGN KEY (target_id) REFERENCES replication_targets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS replication_events (
  id CHAR(36) NOT NULL,
  target_id CHAR(36) NULL,
  type ENUM('stale','failed','recovered','config_changed','run_started','run_finished') NOT NULL,
  severity ENUM('info','warn','critical') NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_target_id (target_id),
  INDEX idx_created_at (created_at),
  INDEX idx_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS replication_alert_channels (
  id CHAR(36) NOT NULL,
  type ENUM('email','webhook') NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  config_json JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
