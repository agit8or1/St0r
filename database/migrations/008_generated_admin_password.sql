-- Migration 008: Replace the shared default password with a generated one
--
-- First run used to create admin/admin123, and the login page advertised those
-- credentials to any unauthenticated visitor while they were still in use.
-- The backend now generates a random password on first run instead, and this
-- flag drives the forced password change — so the "must change" state is read
-- from an authenticated session rather than a public endpoint.
--
-- Existing installations: the backend sets this flag on startup for any account
-- still using the old default, so they keep being prompted.

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS must_change_password TINYINT(1) NOT NULL DEFAULT 0;
