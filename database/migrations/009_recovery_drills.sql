-- Recovery verification: scheduled restore drills.
--
-- A drill restores something real from a backup copy into disposable storage
-- and checks it: a canary file from the offsite (replicated) copy against a
-- checksum St0r keeps itself, or — optionally — an image backup booted as a
-- throwaway VM on an isolated Proxmox network. Every run records exactly which
-- copy and restore point it used, whether it was actual or simulated, how long
-- it took and why it failed. Everything a run creates is written to
-- recovery_drill_resources BEFORE it is created, so cleanup can be resumed
-- after an interruption and never touches anything the run did not create.
-- Idempotent: safe to re-apply.

-- Known files whose checksum St0r holds independently of any backup.
CREATE TABLE IF NOT EXISTS recovery_canaries (
  id CHAR(36) NOT NULL,
  client_name VARCHAR(255) NOT NULL,
  -- Path inside a file backup, relative to the backup's root, '/'-separated
  -- (e.g. "C/Users/Public/Documents/st0r-canary.bin").
  path VARCHAR(1024) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  size_bytes BIGINT NULL,
  source ENUM('generated','manual') NOT NULL DEFAULT 'manual',
  note VARCHAR(255) NULL,
  created_by VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_canary_client (client_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Disposable hypervisors for boot drills (Proxmox VE, e.g. one managed with Depl0y).
CREATE TABLE IF NOT EXISTS recovery_hypervisors (
  id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  type ENUM('proxmox','simulator') NOT NULL DEFAULT 'proxmox',
  api_url VARCHAR(512) NOT NULL,
  token_id VARCHAR(255) NOT NULL,
  token_secret_encrypted TEXT NULL,
  tls_fingerprint CHAR(64) NULL,
  node VARCHAR(255) NOT NULL,
  disk_storage VARCHAR(255) NOT NULL,
  import_storage VARCHAR(255) NOT NULL,
  -- NULL: the drill VM gets no network device at all.
  isolated_bridge VARCHAR(64) NULL,
  -- Where the hypervisor downloads the assembled disk from (St0r's address as it sees it).
  artifact_base_url VARCHAR(512) NULL,
  max_disk_gb INT NOT NULL DEFAULT 512,
  scratch_quota_gb INT NOT NULL DEFAULT 600,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS recovery_drills (
  id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  kind ENUM('file','boot') NOT NULL,
  client_name VARCHAR(255) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  -- file drills: the canary and the offsite copy (a replication target) it is restored from
  canary_id CHAR(36) NULL,
  replication_target_id CHAR(36) NULL,
  -- boot drills
  hypervisor_id CHAR(36) NULL,
  boot_config_json JSON NULL,
  -- schedule (same shape as replication_settings)
  schedule_type ENUM('manual','interval','cron') NOT NULL DEFAULT 'manual',
  interval_hours INT NOT NULL DEFAULT 24,
  cron_expression VARCHAR(100) NOT NULL DEFAULT '0 3 * * *',
  -- alert when the newest restorable point is older than this
  max_recovery_point_age_hours INT NOT NULL DEFAULT 48,
  timeout_seconds INT NOT NULL DEFAULT 900,
  retry_max_attempts INT NOT NULL DEFAULT 2,
  last_run_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_drill_client (client_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS recovery_drill_runs (
  id CHAR(36) NOT NULL,
  drill_id CHAR(36) NULL,
  kind ENUM('file','boot') NOT NULL,
  client_name VARCHAR(255) NOT NULL,
  -- actual: real backup data restored onto real infrastructure.
  -- simulated: any part (copy, hypervisor) was a simulator — never shown as recovery evidence.
  evidence ENUM('actual','simulated') NOT NULL DEFAULT 'actual',
  status ENUM('running','passed','failed','error','interrupted') NOT NULL DEFAULT 'running',
  trigger_type ENUM('schedule','manual') NOT NULL DEFAULT 'manual',
  attempts INT NOT NULL DEFAULT 1,
  started_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
  finished_at TIMESTAMP(3) NULL,
  elapsed_ms BIGINT NULL,
  -- The exact copy used: {kind:'offsite', target_id, target_name, host, path} or {kind:'primary', path}
  copy_json JSON NULL,
  -- The exact restore point: {backup_id, backup_time, backup_path, image_ids...}
  restore_point_json JSON NULL,
  recovery_point_time TIMESTAMP NULL,
  recovery_point_age_seconds BIGINT NULL,
  restored_item VARCHAR(1024) NULL,
  expected_sha256 CHAR(64) NULL,
  actual_sha256 CHAR(64) NULL,
  bytes_restored BIGINT NULL,
  boot_ms BIGINT NULL,
  rto_ms BIGINT NULL,
  services_json JSON NULL,
  failure_stage VARCHAR(64) NULL,
  failure_reason TEXT NULL,
  cleanup_status ENUM('none','done','pending','failed') NOT NULL DEFAULT 'none',
  steps_json JSON NULL,
  PRIMARY KEY (id),
  INDEX idx_run_drill (drill_id),
  INDEX idx_run_client (client_name),
  INDEX idx_run_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Everything a run creates, recorded before it is created.
CREATE TABLE IF NOT EXISTS recovery_drill_resources (
  id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  kind ENUM('scratch_dir','vhd_workdir','pve_volume','pve_vm') NOT NULL,
  hypervisor_id CHAR(36) NULL,
  -- path, Proxmox volume id, or "<node>/<vmid>"
  locator VARCHAR(1024) NOT NULL,
  -- what the resource must carry to be ours (VM name/tag, file name); checked before deleting
  marker VARCHAR(255) NOT NULL,
  state ENUM('creating','created','deleted','delete_failed','not_ours') NOT NULL DEFAULT 'creating',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_res_run (run_id),
  INDEX idx_res_state (state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
