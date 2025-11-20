-- Migration: Add installations table
-- Run this if upgrading from version < 3.2.2

CREATE TABLE IF NOT EXISTS installations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    install_id VARCHAR(255) NOT NULL UNIQUE,
    version VARCHAR(50),
    check_count INT DEFAULT 1,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_install_id (install_id),
    INDEX idx_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migration completed successfully' AS status;
