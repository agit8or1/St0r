-- Migration 007: Customer-scoped user access (issue #21)
--
-- Non-admin accounts are read-only and may only see the endpoints belonging to
-- the customers they are assigned to. The assignment lives in `customer_users`
-- (created in migration 002); this migration only makes sure it exists on older
-- installs and adds the index the scope lookup needs.

CREATE TABLE IF NOT EXISTS customer_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    user_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_customer_user (customer_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Scope resolution looks up every customer for one user on each request.
CREATE INDEX IF NOT EXISTS idx_customer_users_user ON customer_users (user_id);

-- customer_clients is joined by customer_id when building a user's visible set.
CREATE INDEX IF NOT EXISTS idx_customer_clients_customer ON customer_clients (customer_id);
