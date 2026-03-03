-- Migration 002: Add TOTP columns and customer tables
-- Safe to run on existing installs (uses IF NOT EXISTS / IF EXISTS guards)

-- Add TOTP fields to app_users (idempotent)
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS totp_enabled TINYINT(1) NOT NULL DEFAULT 0;

-- Customer management tables (MSP multi-tenant)
CREATE TABLE IF NOT EXISTS customers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NULL,
    phone VARCHAR(100) NULL,
    company VARCHAR(255) NULL,
    address TEXT NULL,
    notes TEXT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_name (name),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_clients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    server_id INT NOT NULL,
    client_name VARCHAR(255) NOT NULL,
    client_id VARCHAR(255) NULL,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    UNIQUE KEY unique_server_client (server_id, client_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    user_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_customer_user (customer_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
