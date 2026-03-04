# Security Policy

## Supported Versions

Only the latest release receives security fixes.

| Version | Supported |
|---------|-----------|
| 3.2.x (latest) | ✅ |
| < 3.2 | ❌ |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report security issues by emailing the maintainer directly or opening a [GitHub Security Advisory](https://github.com/agit8or1/St0r/security/advisories/new) (private disclosure).

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
- Configurable JWT expiry (default: 7 days)
- Rate limiting on `/api/auth/login` (5 attempts / 15 min)
- Optional **TOTP 2FA** per user (RFC 6238, Google Authenticator compatible)

### Transport
- All API traffic proxied through **Nginx**
- HTTPS strongly recommended for production (see README for Certbot setup)
- HTTP → HTTPS redirect configurable in Nginx

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
- UrBackup-level operations proxied through the authenticated backend — never exposed directly

## Hardening Checklist

After installation:

- [ ] Change the default `admin` password (`admin123`) immediately
- [ ] Set a strong, random `JWT_SECRET` in `.env` (the installer generates one automatically)
- [ ] Set `APP_SECRET_KEY` to a 32-byte random hex string (`openssl rand -hex 32`)
- [ ] Enable HTTPS with a valid certificate (Certbot / Let's Encrypt)
- [ ] Restrict access to port 3000 (backend) — only Nginx should connect to it locally
- [ ] Firewall: expose only ports 80, 443 (and 55415 for UrBackup internet clients) to the internet
- [ ] Enable 2FA for the admin account (Profile → Enable 2FA)
- [ ] Regularly update dependencies (`npm audit` in `backend/` and `frontend/`)
