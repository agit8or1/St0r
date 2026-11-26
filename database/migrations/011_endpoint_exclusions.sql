-- Server exclusions always apply to every endpoint.
--
-- UrBackup gives an endpoint exactly one exclusion list: the group's, its own,
-- or the one the client reported. Windows clients report theirs, which hid the
-- server's list entirely. St0r keeps each endpoint's own patterns here and
-- pushes "server exclusions + own patterns" to UrBackup as the endpoint's list.
-- Idempotent: safe to re-apply (the backend also creates it at startup).

CREATE TABLE IF NOT EXISTS endpoint_exclusions (
  client_id INT NOT NULL PRIMARY KEY,
  patterns TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
