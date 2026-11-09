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
- HTTPS strongly recommended for production (see README for Certbot setup)
- HTTP → HTTPS redirect configurable in Nginx
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

## Hardening Checklist

After installation:

- [ ] Change the generated first-run `admin` password, and delete `initial-admin-password.txt`
- [ ] Set a strong, random `JWT_SECRET` in `.env` (the installer generates one automatically)
- [ ] Set `APP_SECRET_KEY` to a 32-byte random hex string (`openssl rand -hex 32`)
- [ ] Enable HTTPS with a valid certificate (Certbot / Let's Encrypt)
- [ ] Restrict access to port 3000 (backend) — only Nginx should connect to it locally
- [ ] Firewall: expose only ports 80, 443 (and 55415 for UrBackup internet clients) to the internet
- [ ] Enable 2FA for the admin account (Profile → Enable 2FA)
- [ ] Regularly update dependencies (`npm audit` in `backend/` and `frontend/`)
