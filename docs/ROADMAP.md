# St0r — Roadmap

Planned work only. Nothing in this file is implemented unless it is marked as shipped. Added 2026-11-20 from a
read-only review of St0r v3.2.140 (`9e1a0a39`) made while planning Clientst0r's backup integration.

## Planned — Integration API for Clientst0r and other service clients (P1)

**Why.** Clientst0r (a PSA) will show St0r/UrBackup backup status in its customer and device views, raise
deduplicated alerts and tickets, and later request permissioned actions. St0r today has no API a service can
use safely: the API is unversioned and undocumented, and the only sign-in is a username and password that
returns a 24-hour session cookie. Clientst0r will not store a St0r password, scrape cookies, read St0r's MariaDB
or read UrBackup's databases or files.

St0r stays the UrBackup management interface and UrBackup stays the backup engine. Nothing below changes backup
behaviour.

### 1. Integration tokens

- Stored hashed, shown once, with a visible prefix and a name.
- Scopes: `backup:read`, `replication:read`, `recovery:read`, `server:read`. Action scopes such as
  `actions:start_backup` and `actions:restore_request` come later.
- Optional customer allowlist and source-address allowlist.
- Expiry, and rotation with an overlap window.
- Revocation.
- Per-token rate limit.
- `last_used_at` and a log entry for every call.
- Administrators create, rotate and revoke tokens in the UI.
- Accepted as `Authorization: Bearer st0r_…`.

### 2. Versioned read-only API `/api/v1/` with an OpenAPI description

- `GET /api/v1/health`: UrBackup reachable, database readable, collector age, St0r version, disk guard state.
  Minimal liveness is available without authentication.
- `GET /api/v1/customers` and `GET /api/v1/endpoints?customer=&updated_since=`: stable identifiers, customer
  mapping, online, disabled, OS, client version, last seen.
- Backup status per endpoint:
  - explicit last file and image success and failure times
  - a single state field
  - a paged bulk form
- `GET /api/v1/jobs?endpoint=&status=&since=` and `GET /api/v1/jobs/running`. Each job has a stable id, the
  type (file or image), the mode (full or incremental), times, result, bytes and an error summary.
- Effective schedule and retention per endpoint, read-only and without secrets.
- Storage per endpoint, per customer and for the server volume.
- Replication: targets, status, lag, last success.
- Restore-verification results, flagging simulated against real drills.
- `GET /api/v1/events?since=<cursor>` for polling: backup failed, client offline, replication failed, drill
  failed, disk guard.
- Signed webhooks (HMAC with timestamp) with retry and a delivery log.
- No secrets, auth keys or host paths in any response; ETag or `Last-Modified` support.

### 3. Actions, after the read-only API is in use

- `POST /api/v1/endpoints/{id}/backups` with `{type: file|image, mode: full|incremental}`:
  - requires an `Idempotency-Key`
  - answers 202 with a request id, and `GET /api/v1/requests/{id}` gives its state
  - answers 409 when the client is disabled or a backup is already running
  - scope `actions:start_backup`, customer allowlist, server-side rate cap
- Restore as an approval-gated request resource:
  - create, view, approve, deny, cancel
  - an immutable audit record naming the requester (for example a Clientst0r user and ticket)
  - no direct download tokens by default
- `GET /api/v1/audit`: start-backup is not audited today.

### 4. Hardening found during the review (independent of the API)

- Stop logging UrBackup session ids, salts and password-derived hashes (`services/urbackup.ts`).
- Restrict administrator data to administrators: `/api/alerts/rules`, `/api/settings` and
  `/api/system-update/metrics` are readable by any signed-in user.
- Enforce HTTPS for the integration API, or document mutual TLS behind the reverse proxy.
- Lock CORS by default.
- Check that the restore path uses an authenticated UrBackup session.
- Align `SECURITY.md` with the bcrypt cost actually used (10, not 12).

### Not planned

- Several UrBackup servers per St0r installation. Clientst0r supports several St0r installations instead.

### Acceptance

- A read-only token reads every `/api/v1` resource for its customers and nothing else.
- A revoked token is refused.
- Every v1 response is free of secrets, which a test checks.
- Repeating a start-backup request with the same idempotency key starts one backup.
- A restore request cannot run without an approval.
