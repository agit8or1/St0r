-- Migration 006: Managed Servers
-- Apply with: mysql -u urbackup -p urbackup_gui < database/migrations/006_managed_servers.sql

CREATE TABLE IF NOT EXISTS managed_servers (
  id            CHAR(36)      NOT NULL,
  name          VARCHAR(255)  NOT NULL,
  is_local      TINYINT(1)    NOT NULL DEFAULT 0,

  -- Agent connection (NULL for local)
  host                   VARCHAR(255) NULL,
  agent_port             INT          NOT NULL DEFAULT 7420,
  agent_api_key_encrypted TEXT         NULL,

  -- SSH credentials for agent installation (cleared after install if desired)
  ssh_port               INT          NOT NULL DEFAULT 22,
  ssh_user               VARCHAR(100) NULL,
  auth_type              ENUM('ssh_key','password') NULL,
  ssh_private_key_encrypted TEXT       NULL,
  ssh_password_encrypted TEXT          NULL,
  ssh_known_host_fingerprint TEXT      NULL,

  -- Agent status
  agent_installed        TINYINT(1)   NOT NULL DEFAULT 0,
  last_seen              BIGINT       NULL,

  notes                  TEXT         NULL,
  enabled                TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order             INT          NOT NULL DEFAULT 0,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
