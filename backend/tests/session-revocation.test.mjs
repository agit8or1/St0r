// npm run build && node --experimental-test-module-mocks --test tests/session-revocation.test.mjs
// Mock only the database and logger. Exercise the actual JWT and middleware.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
process.env.JWT_SECRET = 'offline-regression-key-not-for-production';
let account = { id: 1, username: 'test', is_admin: false, password_hash: 'old-hash' };
mock.module('../dist/models/user.js', { namedExports: { findUserById: async () => account } });
mock.module('../dist/utils/logger.js', { namedExports: { logger: { warn() {}, error() {} } } });
const { credentialVersion, generateToken } = await import('../dist/utils/auth.js');
const { authenticate, invalidateUserCache } = await import('../dist/middleware/auth.js');
const issue = (hash) => generateToken({ userId: 1, username: 'test', isAdmin: false,
                                     credentialVersion: credentialVersion(hash) });
async function request(token) {
  const req = { headers: { authorization: `Bearer ${token}` }, cookies: {}, query: {}, path: '/api/me' };
  const result = { passed: false, code: 200, clearCookie() {},
    status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await authenticate(req, result, () => { result.passed = true; });
  return result;
}
test('password reset invalidates old signed tokens and new login succeeds', async () => {
  const oldToken = issue('old-hash');
  assert.equal((await request(oldToken)).passed, true);
  account.password_hash = 'new-hash';
  invalidateUserCache(1);
  assert.equal((await request(oldToken)).code, 401);
  assert.equal((await request(issue('new-hash'))).passed, true);
});
test('legacy sessions without a credential version require sign-in', async () => {
  const token = generateToken({ userId: 1, username: 'test', isAdmin: false });
  assert.equal((await request(token)).code, 401);
});
test('disabled or deleted account stays rejected', async () => {
  const token = issue('new-hash');
  account = null;
  invalidateUserCache(1);
  assert.equal((await request(token)).code, 401);
});
