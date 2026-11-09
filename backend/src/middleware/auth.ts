import { Request, Response, NextFunction } from 'express';
import { verifyToken, JWTPayload, matchesCredentialVersion } from '../utils/auth.js';
import { logger } from '../utils/logger.js';
import { findUserById } from '../models/user.js';
import type { UserScope } from './scope.js';

export interface AuthRequest extends Request {
  user?: JWTPayload;
  scope?: UserScope;
}

/**
 * The JWT is stateless and lives for 24h, so its claims cannot be trusted on
 * their own: a deleted, deactivated or demoted account would keep its access
 * until the token expired. Every request re-checks the account against the
 * database, cached briefly so this costs one query per user per few seconds
 * rather than one per request.
 */
const USER_TTL_MS = 10_000;
type Account = { isAdmin: boolean; passwordHash: string; mustChangePassword: boolean };
const userCache = new Map<number, ({ ts: number } & Account) | { ts: number; revoked: true }>();

/** Drop cached account state — call after changing or removing a user. */
export function invalidateUserCache(userId?: number): void {
  if (userId === undefined) userCache.clear();
  else userCache.delete(userId);
}

/**
 * Returns the account's current admin flag, or null when the account no longer
 * exists or has been deactivated (findUserById filters on is_active).
 */
async function currentUser(userId: number): Promise<Account | null> {
  const cached = userCache.get(userId);
  if (cached && Date.now() - cached.ts < USER_TTL_MS) {
    if ('revoked' in cached) return null;
    const { ts: _ts, ...account } = cached;
    return account;
  }

  const user = await findUserById(userId);
  if (!user) {
    userCache.set(userId, { ts: Date.now(), revoked: true });
    return null;
  }

  const account: Account = {
    isAdmin: !!user.is_admin,
    passwordHash: user.password_hash,
    mustChangePassword: !!user.must_change_password,
  };
  userCache.set(userId, { ts: Date.now(), ...account });
  return account;
}

/**
 * What an account that must change its password may still reach: the change
 * itself, and signing out. Everything else is refused until the password is
 * changed — the login page's modal was the only thing enforcing this before.
 */
const PASSWORD_CHANGE_ALLOWLIST: RegExp[] = [
  /^\/api\/profile\/change-password$/,
  /^\/api\/auth\/logout$/,
];

export const PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED';

function getTokenFromRequest(req: AuthRequest): string | undefined {
  const authHeader = req.headers.authorization;

  // Check HttpOnly cookie first (preferred, XSS-safe)
  if (req.cookies?.auth_token) {
    return req.cookies.auth_token;
  }
  // Fall back to Authorization header (for API clients)
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  // Never from the query string: a token in the URL ends up in proxy and
  // access logs, browser history and Referer headers. Downloads use the cookie.
  return undefined;
}

export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  let decoded: JWTPayload;
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    decoded = verifyToken(token);
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  try {
    const account = await currentUser(decoded.userId);
    if (!account) {
      logger.warn(`[${decoded.username}] rejected — account deleted or deactivated`);
      res.clearCookie('auth_token');
      res.status(401).json({ error: 'Account is no longer active' });
      return;
    }

    // Issued before the password last changed (or before sessions carried a
    // credential version at all): revoked, not a deleted account, and logged
    // as such so the two are not confused when reading the logs.
    if (!matchesCredentialVersion(decoded.credentialVersion, account.passwordHash)) {
      logger.info(`[${decoded.username}] session revoked — password changed since sign-in`);
      res.clearCookie('auth_token');
      res.status(401).json({ error: 'Session expired — please sign in again' });
      return;
    }

    if (account.mustChangePassword) {
      const path = req.originalUrl.split('?')[0];
      if (!PASSWORD_CHANGE_ALLOWLIST.some((re) => re.test(path))) {
        logger.warn(`[${decoded.username}] blocked ${req.method} ${path} — password change required`);
        res.status(403).json({ error: 'You must change your password before continuing', code: PASSWORD_CHANGE_REQUIRED });
        return;
      }
    }

    // Trust the database over the token: a role change must take effect at once,
    // not whenever the holder next logs in.
    req.user = { ...decoded, isAdmin: account.isAdmin };
    next();
  } catch (error) {
    // A database outage must not silently downgrade this to "token looks fine".
    logger.error('Failed to verify account status:', error);
    res.status(503).json({ error: 'Cannot verify account status' });
  }
}

export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

/**
 * Paths a non-admin (read-only) account may still write to: its own session,
 * its own password/2FA, bug reports, and read-only endpoints that happen to
 * use POST because they take a request body.
 */
const NON_ADMIN_WRITE_ALLOWLIST: RegExp[] = [
  /^\/api\/auth\/(logout|me|refresh)$/,
  /^\/api\/profile\/change-password$/,
  /^\/api\/2fa\//,
  /^\/api\/storage-limits\/status$/,
];

/**
 * Global safety net: non-admin accounts are read-only. Individual routes still
 * carry `requireAdmin`, but this blocks any mutating endpoint that is added
 * later without one.
 */
export async function requireWriteAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  if (req.user?.isAdmin) {
    next();
    return;
  }
  // This runs ahead of each route's own `authenticate`, so decode here too.
  if (!req.user) {
    const token = getTokenFromRequest(req);
    if (!token) {
      next();
      return;
    }
    try {
      req.user = verifyToken(token);
    } catch {
      // Invalid/expired — let the route's `authenticate` produce the 401.
      next();
      return;
    }

    // Resolve the live role, so a freshly promoted admin is not held to the
    // read-only rule by a token that still says otherwise.
    try {
      const account = await currentUser(req.user.userId);
      if (!account) {
        // Revoked — let the route's `authenticate` produce the 401.
        next();
        return;
      }
      req.user = { ...req.user, isAdmin: account.isAdmin };
    } catch {
      // Cannot verify — fall through to the read-only rule below, which is the
      // safe direction, and let `authenticate` surface the real error.
    }

    if (req.user.isAdmin) {
      next();
      return;
    }
  }
  const path = req.originalUrl.split('?')[0];
  if (NON_ADMIN_WRITE_ALLOWLIST.some((re) => re.test(path))) {
    next();
    return;
  }
  logger.warn(`[${req.user.username}] blocked write ${req.method} ${path} (read-only account)`);
  res.status(403).json({ error: 'Your account is read-only' });
}
