import { Request, Response, NextFunction } from 'express';
import { verifyToken, JWTPayload } from '../utils/auth.js';
import { logger } from '../utils/logger.js';
import type { UserScope } from './scope.js';

export interface AuthRequest extends Request {
  user?: JWTPayload;
  scope?: UserScope;
}

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
  // Fall back to query parameter — only permitted for file download endpoints
  if (
    req.query.token &&
    typeof req.query.token === 'string' &&
    req.path.startsWith('/download')
  ) {
    return req.query.token;
  }
  return undefined;
}

export function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const decoded = verifyToken(token);

    req.user = decoded;
    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
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
  /^\/api\/bug-report$/,
  /^\/api\/storage-limits\/status$/,
];

/**
 * Global safety net: non-admin accounts are read-only. Individual routes still
 * carry `requireAdmin`, but this blocks any mutating endpoint that is added
 * later without one.
 */
export function requireWriteAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
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
