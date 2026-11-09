// npm run build && node --experimental-test-module-mocks --test tests/auth-hardening.test.mjs
// Server-side enforcement of the forced password change, and no session token
// from the URL. Mocks only the database and logger.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
process.env.JWT_SECRET = 'offline-regression-key-not-for-production';
const account = { id: 3, username: 'firstrun', is_admin: true, password_hash: 'h', must_change_password: true };
mock.module('../dist/models/user.js', { namedExports: { findUserById: async () => account } });
mock.module('../dist/utils/logger.js', { namedExports: { logger: { info() {}, warn() {}, error() {} } } });
const { credentialVersion, generateToken } = await import('../dist/utils/auth.js');
const { authenticate, invalidateUserCache } = await import('../dist/middleware/auth.js');
const { cookieSecure } = await import('../dist/utils/auth.js');

const token = () => generateToken({ userId: 3, username: 'firstrun', isAdmin: true,
                                    credentialVersion: credentialVersion(account.password_hash) });
async function request(url, { cookie, query = {} } = {}) {
  const req = { headers: {}, cookies: cookie ? { auth_token: cookie } : {}, query,
                originalUrl: url, path: url.replace(/^\/api\/[^/]+/, ''), method: 'GET' };
  const res = { passed: false, code: 200, clearCookie() {},
    status(c) { this.code = c; return this; }, json(b) { this.body = b; } };
  await authenticate(req, res, () => { res.passed = true; });
  return res;
}

test('must-change account is refused everywhere but the password change', async () => {
  invalidateUserCache();
  for (const url of ['/api/urbackup/clients', '/api/users', '/api/browse/download?clientId=1', '/api/auth/validate']) {
    const r = await request(url, { cookie: token() });
    assert.equal(r.code, 403, url);
    assert.equal(r.body.code, 'PASSWORD_CHANGE_REQUIRED', url);
  }
  assert.equal((await request('/api/profile/change-password', { cookie: token() })).passed, true);
});

test('once the flag is cleared the same session works', async () => {
  account.must_change_password = false;
  invalidateUserCache(3);
  assert.equal((await request('/api/urbackup/clients', { cookie: token() })).passed, true);
});

test('session token in the query string is ignored, even on /download', async () => {
  invalidateUserCache();
  for (const url of ['/api/browse/download', '/api/documentation/download/x.pdf']) {
    const r = await request(url, { query: { token: token() } });
    assert.equal(r.code, 401, url);
    assert.equal(r.passed, false, url);
  }
});

test('COOKIE_SECURE auto follows the request scheme; true/false force it', () => {
  delete process.env.COOKIE_SECURE;
  assert.equal(cookieSecure({ secure: true }), true);
  assert.equal(cookieSecure({ secure: false }), false);
  process.env.COOKIE_SECURE = 'auto';
  assert.equal(cookieSecure({ secure: true }), true);
  process.env.COOKIE_SECURE = 'false';
  assert.equal(cookieSecure({ secure: true }), false);
  process.env.COOKIE_SECURE = 'true';
  assert.equal(cookieSecure({ secure: false }), true);
});
