# Threat model: St0r

## What this project does

St0r is a self-hosted web management interface for an [UrBackup](https://www.urbackup.org/) backup server. One
St0r instance sits beside one UrBackup server and is used by an administrator (often an MSP managing many
customers) to watch backups, change client and server settings, browse and download backed-up files, build client
installers, replicate backup storage to other hosts, and manage remote servers through a small agent.

Because it fronts a backup server, a St0r instance has read access to **every file of every machine it backs up**,
plus credentials for replication targets and managed servers. Treat it as a high-value target.

## Components

| Component | Path | Runs as | Notes |
|---|---|---|---|
| Backend API | `backend/src/` (Express + TypeScript) | the user who ran `install.sh` (`setup/urbackup-gui.service`) | The backend calls `sudo` (for `systemctl`, `sqlite3 -u urbackup`, update units), so that user needs sudo rights and in practice often has `NOPASSWD: ALL`. Treat **command execution in the backend as root** on the backup server. |
| Frontend | `frontend/src/` (React + Vite) | browser | Served as static files by the backend / nginx. |
| stor-agent | `agent/src/index.ts` | **root** (`agent/setup/stor-agent.service`) | Listens on `0.0.0.0:7420` on managed remote servers; authenticated by a shared API key; can run OS updates, St0r/UrBackup updates and reboots. |
| MariaDB `urbackup_gui` | `database/` | — | St0r users, customers, replication targets (secrets AES-256-GCM encrypted with `APP_SECRET_KEY`). |
| UrBackup SQLite DBs | `/var/urbackup/backup_server*.db` | — | Read directly; per-client settings are also written directly. |
| UrBackup HTTP API | `http://localhost:55414/x` | — | Used for status, settings and backup control; it has no admin password in typical installs and must stay loopback-only. |
| Installer / updater | `install.sh`, `setup/auto-update.sh` | root | Out of scope unless reachable from the web UI (see below). |

`scripts/demo/` (screenshot tooling and a mock UrBackup API) and `docs/` are out of scope as targets, but
`scripts/demo/mock-urbackup-api.mjs` is useful for exercising the backend.

## Trust boundaries and where untrusted input enters

1. **Unauthenticated network clients → backend.** Anyone who can reach the web port. Entry points:
   `POST /api/auth/login` (plus TOTP step), `/health`, `GET /api/agent-install/:token`,
   `GET /api/agent-package/:token`, `POST /api/agent-register` (all token-protected, no session), the static
   frontend, and any route whose `authenticate` middleware is missing or bypassable.
2. **Read-only (non-admin) users → backend.** Non-admin accounts are meant to be strictly read-only
   (`requireWriteAccess` in `backend/src/middleware/auth.ts`) **and** limited to the UrBackup clients of the
   customers they are assigned to (`backend/src/middleware/scope.ts`). Any read or write of another customer's
   clients, backups, files, logs or settings is a tenant-isolation break.
3. **Admin users → host.** Admins are trusted to configure St0r, but **not** to get arbitrary shell on the host
   or read files outside the UrBackup storage tree. Admin-supplied values that reach `execFile`/`spawn`/`ssh`/
   `bash -c`, SQL, file paths or `.env` (client names, FQDNs, paths, SSH hosts/users, replication targets, cron
   strings, installer parameters) are untrusted input.
4. **Backup clients → St0r.** UrBackup clients are remote, often on the Internet, and control their **client
   name, reported settings, OS info and the file names/paths inside their backups**. All of this is rendered in
   the UI and used to build file-system paths, so a malicious endpoint is a realistic attacker (stored XSS,
   path traversal, header injection on downloads, log injection).
5. **Managed servers / replication targets → St0r.** Output of remote `ssh`, the agent's JSON responses and
   remote `rsync`/`btrfs` output are untrusted.
6. **Network → stor-agent.** Anyone who can reach port 7420 on a managed server.

## Assets, in priority order

1. Backed-up file contents of all clients (`URBACKUP_BACKUP_PATH`), via browse/download/restore.
2. Root (or service-user) code execution on the backup server or on managed servers.
3. Secrets: `JWT_SECRET`, `APP_SECRET_KEY`, DB password (`backend/.env`), replication SSH keys/passwords,
   agent API keys, UrBackup client auth keys (`internet_authkey`), install tokens, TOTP secrets.
4. Integrity of backup configuration (deleting clients, disabling backups, changing retention, pointing
   backup paths elsewhere) — this silently destroys the user's ability to recover.
5. Availability of the backup server (disk filling, killing `urbackupsrv`).

## Areas that matter most

- `backend/src/controllers/browse.ts` — backup browsing, single-file and folder (tar/zip) download, restore.
  Path traversal, symlink escape (backups contain client-controlled symlinks), customer scoping, and
  `Content-Disposition` handling with client-controlled file names.
- `backend/src/middleware/auth.ts`, `scope.ts`, `controllers/auth.ts`, `twofa.ts`, `utils/auth.ts` — JWT in
  cookie / Bearer / `?token=` (download paths only), 2FA bypass, rate-limit bypass, account deactivation and
  role-change handling, the non-admin write allowlist.
- Everything that shells out: `controllers/system.ts`, `servers.ts`, `settings.ts`, `clientInstaller.ts`,
  `logs.ts`, `storage.ts`, `urbackup.ts`; `services/replicationEngine.ts`, `serverSsh.ts` (note `bash -c`),
  `databaseBackup.ts`, `diskGuard.ts`, `systemMonitor.ts`, `urbackupDb.ts`. Argument injection into `ssh`,
  `rsync`, `scp`, `btrfs`, `sqlite3`, `tar` (e.g. a value starting with `-`) counts as command injection.
- `controllers/settings.ts` and `serverSettings.ts` — rewriting `backend/.env` (newline injection into env
  keys such as `CORS_LOCK`, `JWT_SECRET`, `URBACKUP_API_URL`).
- `controllers/servers.ts` — unauthenticated install-token endpoints (token entropy, expiry, replay, the generated
  `curl | sudo bash` script and what it interpolates), and SSRF via admin-supplied host/port for agent calls.
- `agent/src/index.ts` — API key comparison (timing, empty key), `allowed_ips`, everything reachable before auth.
- `services/secrets.ts` — AES-GCM usage (nonce reuse, key derivation, error leakage).
- Direct SQL against MariaDB (`models/`, controllers) and against the UrBackup SQLite DBs.
- Frontend rendering of UrBackup-sourced strings (client names, file names, log lines) — React escapes by default,
  so look for `dangerouslySetInnerHTML`, `href`/`src` built from data, and HTML injected into downloads.
- CSRF: auth is an HttpOnly cookie and CORS allows all origins (with credentials) unless `CORS_LOCK=true`.
  State-changing requests that a cross-site page can trigger are in scope.

## Lower priority / out of scope

- `scripts/demo/`, `docs/`, `CHANGELOG.md`, screenshots.
- `install.sh` and `setup/auto-update.sh` run as root by the operator; report them only if web input reaches them.
- Vulnerabilities in UrBackup itself, or in its passwordless HTTP API on `55414` (it is documented as
  loopback-only), unless St0r exposes or proxies it.
- Missing hardening that the operator is told to configure (HTTPS, firewall, `CORS_LOCK`), unless the
  default is unsafe in a way the docs do not warn about.
- Pure dependency-version CVEs with no reachable path in St0r's code.
- Rate-limit thresholds, verbose logging of non-secret data, and missing security headers on their own.

## How to exercise it

The scanner image (`.oss-scanner/Dockerfile`) builds the backend, frontend and agent, loads the schema into a
local MariaDB, and writes a throwaway `backend/.env`. Then:

```sh
st0r-start                             # MariaDB + mock UrBackup API (:9714) + backend (:3000)
cat /src/initial-admin-password.txt    # first-run admin password (forced change on first login)
curl -c jar -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"<from file>"}' http://127.0.0.1:3000/api/auth/login
```

Create a non-admin user and a customer through the API to test tenant isolation. There is no UrBackup server and
no `/var/urbackup/*.db` in the image, so endpoints that read those return errors; create a small SQLite DB at
`URBACKUP_DB_PATH` or use the mock API to reach deeper code. There is no automated test suite. `npm run build` in
`backend/`, `frontend/` and `agent/` typechecks.

## How we rate severity

- **Critical**: unauthenticated or read-only-user → command execution on the backup server or a managed server;
  unauthenticated read of backed-up files; authentication bypass to admin; stor-agent pre-auth command
  execution; leak of `JWT_SECRET` / `APP_SECRET_KEY` / replication keys to an unauthenticated user.
- **High**: read-only user → admin, or read/write of another customer's clients, backups or files (tenant
  isolation break); admin → arbitrary command execution on the host (injection, not an intended feature);
  path traversal or symlink escape outside the backup storage tree; stored XSS from a **backup client** (client
  name, file name, log line) that runs in an admin session; CSRF that changes settings, users or backup config;
  2FA bypass.
- **Medium**: stored XSS that requires an admin to plant it; SSRF limited to admin users; read-only user able to
  perform a write action within their own scope; secrets written to logs; DoS that stops backups or fills the disk
  from an unauthenticated position.
- **Low**: open redirects, information disclosure of versions/paths, DoS needing authentication, user enumeration.

A finding without a demonstrated path from an untrusted input is capped at Medium. Command injection reachable only
by an admin is High, not Critical, because admins are trusted with the host's configuration but not with a shell.

## Reports and patches

Please include the exact HTTP request(s) (curl is ideal), the role needed (none / read-only user / admin / backup
client / network peer of the agent), and a patch in the existing TypeScript style: `execFile` with argument arrays,
never a shell string; parameterised SQL; `realpath` + prefix checks for file paths.
