# Security review — 2026-10-02

## Changes

- Bind signed sessions to an HMAC fingerprint of the current password hash. Password changes/admin resets invalidate existing tokens. Existing account-cache invalidation remains in place; other processes converge within the existing 10-second cache TTL.
- Clear the session cookie and return the profile UI to login after a password change. Old tokens without the new claim must sign in again.
- Remote agent requests default to HTTPS and refuse redirects that could forward the API key. (Added when this was split: agents get a self-signed certificate whose SHA-256 fingerprint St0r pins, checked before the key is sent; an agent with a certificate of its own is verified through Node's normal trust store.)
- Plain HTTP agent listeners bind only to loopback. Optional TLS uses STOR_AGENT_TLS_CERT and STOR_AGENT_TLS_KEY; configured allowed_ips are enforced against the actual socket peer, never request headers. API keys are no longer printed by startup/install logs.
- The agent installer installs build dependencies before compiling and prunes them afterwards. Add a lockfile for reproducibility.
- Update axios, multer, mysql2, nodemailer and affected transitive dependencies. Nodemailer changes major version; sending real mail was not tested. (When this was split, axios, multer, mysql2 and the in-range fixes went ahead separately; nodemailer moved to ^10.1.1 here, because the advisory covers 10.0.8 and earlier, including the originally proposed ^10.0.6.)

## Validation

Backend, frontend and agent TypeScript/production builds passed. On Node 24 after the builds:

```sh
cd backend
node --experimental-test-module-mocks tests/session-revocation.test.mjs
node --experimental-test-module-mocks tests/agent-transport.test.mjs
cd ../agent
node tests/security.test.mjs
```

Thirteen tests pass: session revocation (3); agent transport (7): fingerprint formats, transport choice, a pinned certificate accepted, a different one refused before anything is sent, an unpinned self-signed agent refused, redirects not followed, loopback HTTP; and the agent (3): allowlist and key checks on a real loopback agent and refusal of a non-loopback cleartext listener. No backup, reboot, update, or production agent calls were made.

## Required coordinated rollout

Existing remote HTTP agents stop connecting once the backend is upgraded. Upgrade the backend, then install each remote agent again: "Install agent" over SSH, or generate a new install command and run it on the agent. The installer keeps the agent's API key, generates `/etc/stor-agent/tls/agent.crt` and `agent.key` (EC P-256, ten years), writes `/etc/stor-agent/tls.env` and restarts the agent on HTTPS. The SSH install and the install command report the certificate's SHA-256 fingerprint, and St0r stores it in `managed_servers.agent_tls_fingerprint`. For an agent installed by hand, the installer prints the fingerprint; enter it with the API key under "Enter API key".

How St0r connects, in order:

1. A pinned fingerprint: TLS, accepting only that certificate. St0r completes the handshake and compares the fingerprint before sending the request, so a wrong certificate never sees the API key. No CA or hostname check applies.
2. A loopback host (127.0.0.1, ::1, localhost), or `STOR_AGENT_ALLOW_INSECURE_HTTP=true` on the backend: plain HTTP. The switch is for the rollout window only; it sends keys in cleartext.
3. Otherwise: TLS verified against CAs and the host name. For a private CA, set `NODE_EXTRA_CA_CERTS` on the backend service; do not disable verification.

To use a certificate of your own, create `/etc/stor-agent/tls.env` before installing (the installer never replaces an existing one):

```ini
STOR_AGENT_TLS_CERT=/etc/stor-agent/tls/fullchain.pem
STOR_AGENT_TLS_KEY=/etc/stor-agent/tls/privkey.pem
```

No fingerprint is pinned then, and the agent reads the certificate only at start, so restart it after each renewal. To keep an agent on loopback behind a TLS reverse proxy, create an empty `tls.env`; `allowed_ips` then sees 127.0.0.1, so it must include it or be empty, and the proxy should enforce the source allowlist. A self-signed certificate that is replaced (for example by deleting `tls.env` and re-installing) needs registering again: re-run "Install agent" or the install command, or enter the new fingerprint.

For an agent service installed before this change and not re-installed, the unit has no `EnvironmentFile`; re-installing rewrites it. `allowed_ips` takes exact IP addresses, not CIDRs.

Deploy backend/frontend together. All users will need to sign in again. The session change covers password resets; ordinary logout still clears the cookie without adding a server-side token denylist.

## Remaining dependency advisory

braces 3.0.3 remains in development tooling and matches GHSA-vfj7-8cjw-p6xm, which has no patched release listed in OSV. This patch does not claim that advisory is resolved. Avoid untrusted build/glob patterns.
