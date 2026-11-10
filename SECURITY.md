# Security Policy

## Supported Versions

Only the latest release receives security fixes.

| Version | Supported |
|---------|-----------|
| 3.2.x (latest) | ✅ |
| < 3.2 | ❌ |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report security issues by emailing **agit8or@agit8or.net** or by opening a [GitHub Security Advisory](https://github.com/agit8or1/St0r/security/advisories/new) (private disclosure).

Include:
- Description of the vulnerability and potential impact
- Steps to reproduce
- Affected versions
- Any suggested fix (optional)

You will receive a response within 5 business days. If confirmed, a fix will be released as soon as practical and you will be credited in the changelog unless you prefer to remain anonymous.

## Security Features

### Authentication
- Password hashing with **bcrypt** (cost factor 12)
- JWT tokens stored in **HttpOnly cookies** — not accessible to JavaScript
- Sessions expire after 24 hours, and are revoked at once when the password changes or the account is disabled
- Rate limiting on `/api/auth/login`: 10 failed attempts per IP per 15 minutes (successful sign-ins are not counted)
- Session token accepted only from the HttpOnly cookie or an `Authorization: Bearer` header — never from the URL
- A forced first-login password change is enforced by the server: until it is done, every API call except the password change is refused
- Optional **TOTP 2FA** per user (RFC 6238, Google Authenticator compatible)

### Transport
- All API traffic proxied through **Nginx**
- HTTPS strongly recommended for production: `install.sh --domain backup.example.com` gets a Let's Encrypt certificate with Certbot and redirects HTTP to HTTPS. Without it the installer serves plain HTTP and says so at the end
- Re-running the installer never overwrites an existing nginx site, so Certbot's HTTPS configuration is kept
- Session cookie `Secure` flag: `COOKIE_SECURE=auto` (the default) sets it whenever the request arrived over HTTPS, so it turns on by itself once Certbot is set up; `true`/`false` force it

### Input Validation
- FQDN/hostname inputs validated with strict regex before any SQL or shell use
- SQL queries use parameterized statements (mysql2 prepared statements, sqlite `.all()`/`.get()` with `?` placeholders)
- Field allowlist enforced on user-update SQL queries

### Secrets
- SSH private keys and passwords for replication targets stored **AES-256-GCM encrypted** in MariaDB
- Encryption key is derived from `APP_SECRET_KEY` in the backend `.env` (never stored in the DB)
- `.env` is excluded from version control via `.gitignore`

### HTTP Security Headers (helmet.js)
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy` (configured per environment)

### Access Control
- Role-based: `admin` (full access) and standard users (read-only by default)
- Admin-only endpoints checked server-side on every request
- Non-admin users are limited to the endpoints of the customers they are assigned to; with no assignment they see nothing

### Audit Logging
- File and folder downloads, image exports, file restores and database backup downloads/restores are logged with the user, source IP and what was accessed
- Lines are prefixed `[audit]`: `journalctl -u urbackup-gui | grep '\[audit\]'`
- UrBackup-level operations proxied through the authenticated backend — never exposed directly

### Installs and updates
- Releases are signed with the St0r release key (an SSH signature on `st0r-<tag>.tar.gz`); the private key is not stored on GitHub
- `install.sh` downloads only the signed release asset and verifies it against the public key **inside install.sh itself**, never one that came with the download; it refuses an unsigned or badly signed release, or one whose `VERSION` does not match
- Updates (About → Update) are verified against `/etc/st0r/release-signers`, owned by root
- St0r runs as its own system account, `st0r`: no login shell, member of the `urbackup` group for read access to the backups, and no sudo beyond the two commands below. Installs that ran as the user who installed them are moved to it by the next update or by re-running `install.sh`
- The updater (`/usr/local/lib/st0r/auto-update.sh`), its launcher (`/usr/local/lib/st0r/start-update`) and the helper (`/usr/local/lib/st0r/st0r-helper`) are root-owned and not writable by `st0r`. The sudo rule the installer adds (`/etc/sudoers.d/st0r-update`) allows only the launcher, with no arguments, and the helper
- The helper is the panel's only other root access: a fixed set of actions (UrBackup and OS package updates, reboot, UrBackup cleanup, deleting one backup, decompressing an image backup for export, reading St0r's own journal), each of which validates its arguments itself. Backup deletion accepts only a directory at least two levels inside UrBackup's storage folder and runs as the `urbackup` user
- `/opt/urbackup-gui` belongs to the service user, so the root-run updater executes nothing from it: database migrations come from the verified tarball, and copying files and every `npm` command run as the service user
- Dependencies are installed with `npm ci` from the release's signed `package-lock.json`, with install scripts disabled (`--ignore-scripts`). The one native binary, `sqlite3`, is the official prebuilt checked against the SHA-256 pinned in the release (`setup/sqlite3-prebuilt.sha256`); without a pinned build for the platform it is compiled from its lockfile-pinned source. Updates never run `npm audit fix`: dependency changes ship in a signed release

Note: code execution as `st0r` still means control of St0r and read access to every backup (and write access to UrBackup's databases), but not root. An install that still runs as an administrator account (the move to `st0r` was skipped; the update log says why) keeps that account's sudo rights.

### Remote agents
- Authenticated by API key over TLS with a pinned certificate; the source address allowlist and the key are checked before the request body is read
- The SSH installer sets `allowed_ips` to the address St0r connects from, and the install command does the same when St0r and the agent's host are on the same private network. Otherwise (St0r's address as the agent sees it cannot be known, e.g. behind NAT) an agent with an empty list pins the first source that presents the valid key (St0r, which polls straight after registration); `"*"` allows any source explicitly
- `/health` reports the agent version, and the Servers page shows when an agent is older than the one St0r ships. Agents do not update themselves: use **Update agent via SSH** or run the install command again (the API key, certificate and settings are kept)

### Backup file downloads
- File downloads and folder ZIPs check, from the open file descriptor, that the file actually opened is still inside the client's backup folder, so a directory swapped for a symlink after the path check is refused. Folder ZIPs are built in-process from those descriptors; a symlinked file is included when its target is inside the client's folder

## Hardening Checklist

After installation:

- [ ] Change the generated first-run `admin` password, and delete `initial-admin-password.txt`
- [ ] Set a strong, random `JWT_SECRET` in `.env` (the installer generates one automatically)
- [ ] Set `APP_SECRET_KEY` to a 32-byte random hex string (`openssl rand -hex 32`)
- [ ] Enable HTTPS with a valid certificate (`sudo ./install.sh --domain your.domain`, or Certbot by hand)
- [ ] Restrict access to port 3000 (backend) — only Nginx should connect to it locally
- [ ] Firewall: expose only ports 80, 443 (and 55415 for UrBackup internet clients) to the internet
- [ ] Enable 2FA for the admin account (Profile → Enable 2FA)
- [ ] Keep St0r updated (About → Check for Updates); dependency updates arrive in signed releases
- [ ] Check that St0r runs as `st0r` (`systemctl show urbackup-gui -p User`) and that `st0r` has no sudo rights beyond `/etc/sudoers.d/st0r-update` (`sudo -l -U st0r`)
