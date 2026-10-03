# Security review — 2026-10-02

## Changes

- Bind signed sessions to an HMAC fingerprint of the current password hash. Password changes/admin resets invalidate existing tokens. Existing account-cache invalidation remains in place; other processes converge within the existing 10-second cache TTL.
- Clear the session cookie and return the profile UI to login after a password change. Old tokens without the new claim must sign in again.
- Remote agent requests default to HTTPS, verify the server certificate through Node's normal trust store, and refuse redirects that could forward the API key.
- Plain HTTP agent listeners bind only to loopback. Optional TLS uses STOR_AGENT_TLS_CERT and STOR_AGENT_TLS_KEY; configured allowed_ips are enforced against the actual socket peer, never request headers. API keys are no longer printed by startup/install logs.
- The agent installer installs build dependencies before compiling and prunes them afterwards. Add a lockfile for reproducibility.
- Update axios, multer, mysql2, nodemailer and affected transitive dependencies. Nodemailer changes major version; sending real mail was not tested.

## Validation

Backend, frontend and agent TypeScript/production builds passed. On Node 24 after the builds:

```sh
cd backend
node --experimental-test-module-mocks tests/session-revocation.test.mjs
node --experimental-test-module-mocks tests/agent-transport.test.mjs
cd ../agent
node tests/security.test.mjs
```

Eight tests passed: session revocation, legacy/deleted sessions, TLS URL selection, redirect refusal, actual loopback agent allowlist/key checks and rejection of non-loopback cleartext listeners. No backup, reboot, update, or production agent calls were made.

## Required coordinated rollout

Existing remote HTTP agents will stop connecting with the secure defaults. Configure and test agent TLS before deploying the backend change. For each remote agent, use a certificate valid for its configured DNS name/IP and a matching private key. Store them in a root-readable directory. On new installs the service reads /etc/stor-agent/tls.env; for an existing service add a systemd override containing:

```ini
[Service]
EnvironmentFile=/etc/stor-agent/tls.env
```

Example /etc/stor-agent/tls.env (root-owned, mode 600):

```ini
STOR_AGENT_TLS_CERT=/etc/stor-agent/tls/fullchain.pem
STOR_AGENT_TLS_KEY=/etc/stor-agent/tls/privkey.pem
STOR_AGENT_BIND_HOST=0.0.0.0
```

Then systemctl daemon-reload && systemctl restart stor-agent. Set config.json allowed_ips to the St0r server's actual source IP(s). These are exact IP addresses, not CIDRs. When using a TLS reverse proxy, bind the agent on loopback and enforce the remote source allowlist at that proxy as well. For a private CA, configure NODE_EXTRA_CA_CERTS on the backend service; do not disable TLS verification.

Loopback tunnels still use HTTP. STOR_AGENT_ALLOW_INSECURE_HTTP=true is an explicit backend compatibility switch for a temporary legacy rollout; it sends keys in cleartext and should not be used as the permanent setup. The agent itself never binds cleartext HTTP to a non-loopback interface.

Deploy backend/frontend together. All users will need to sign in again. The session change covers password resets; ordinary logout still clears the cookie without adding a server-side token denylist.

## Remaining dependency advisory

braces 3.0.3 remains in development tooling and matches GHSA-vfj7-8cjw-p6xm, which has no patched release listed in OSV. This patch does not claim that advisory is resolved. Avoid untrusted build/glob patterns.
