-- Client storage limits with warning thresholds
CREATE TABLE IF NOT EXISTS client_storage_limits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_name VARCHAR(255) NOT NULL UNIQUE,
  limit_bytes BIGINT NOT NULL,
  warn_threshold_pct TINYINT NOT NULL DEFAULT 80,
  critical_threshold_pct TINYINT NOT NULL DEFAULT 95,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_client_name (client_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
