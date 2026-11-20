-- Disabling endpoints and customers.
--
-- A disabled endpoint keeps its backups but runs no new ones: St0r makes its
-- UrBackup backup intervals negative (UrBackup skips a negative interval) and
-- turns off the tray's start-backup buttons. The values it had before are kept
-- here so enabling restores them exactly.
--
-- customers.is_active = 0 already means "deleted", so a disabled customer is a
-- separate flag. Disabling a customer disables its endpoints (reason
-- 'customer') and hides them from its accounts; enabling it re-enables only
-- those, not endpoints disabled by hand.
-- Idempotent: safe to re-apply.

CREATE TABLE IF NOT EXISTS endpoint_disabled (
  client_id INT NOT NULL PRIMARY KEY,
  client_name VARCHAR(255) NOT NULL,
  reason VARCHAR(16) NOT NULL DEFAULT 'manual',
  customer_id INT NULL,
  saved_settings TEXT NOT NULL,
  disabled_by VARCHAR(255) NULL,
  disabled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS disabled TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMP NULL DEFAULT NULL;
