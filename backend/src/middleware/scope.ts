import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { query } from '../config/database.js';
import { getUrBackupDb } from '../config/urbackupDb.js';
import { logger } from '../utils/logger.js';

/**
 * Customer scoping for non-admin ("read-only") users.
 *
 * Administrators (`is_admin = 1`) are unrestricted. Every other account is
 * read-only AND limited to the endpoints belonging to the customers it is
 * assigned to via the `customer_users` table. A non-admin with no customer
 * assignment sees nothing — scoping fails closed on purpose, so a freshly
 * created account can never start out with server-wide visibility.
 */
export interface UserScope {
  isAdmin: boolean;
  customerIds: number[];
  /** null = unrestricted (administrators); otherwise the exact set of visible client names (lower-cased). */
  clientNames: Set<string> | null;
}

export const ADMIN_SCOPE: UserScope = { isAdmin: true, customerIds: [], clientNames: null };

const SCOPE_TTL_MS = 15_000;
const scopeCache = new Map<number, { ts: number; scope: UserScope }>();

/** Drop cached scopes — call after changing a user's customer assignments. */
export function invalidateScopeCache(userId?: number): void {
  if (userId === undefined) scopeCache.clear();
  else scopeCache.delete(userId);
}

export async function getUserScope(
  user?: { userId: number; username?: string; isAdmin: boolean }
): Promise<UserScope> {
  if (!user) return { isAdmin: false, customerIds: [], clientNames: new Set<string>() };
  if (user.isAdmin) return ADMIN_SCOPE;

  const cached = scopeCache.get(user.userId);
  if (cached && Date.now() - cached.ts < SCOPE_TTL_MS) return cached.scope;

  let rows: any[];
  try {
    rows = await query<any[]>(
      `SELECT cu.customer_id, cc.client_name
         FROM customer_users cu
         JOIN customers c ON c.id = cu.customer_id AND c.is_active = 1
         LEFT JOIN customer_clients cc ON cc.customer_id = cu.customer_id
        WHERE cu.user_id = ?`,
      [user.userId]
    );
  } catch (error) {
    // An install whose customer tables are missing (migration 002 never ran)
    // must not fall back to server-wide visibility. Fail closed and say why.
    logger.error(
      `Cannot resolve customer scope for ${user.username ?? `user ${user.userId}`} — denying all access. Run the database migrations:`,
      error
    );
    return { isAdmin: false, customerIds: [], clientNames: new Set<string>() };
  }

  const customerIds = new Set<number>();
  const clientNames = new Set<string>();
  for (const row of rows) {
    customerIds.add(Number(row.customer_id));
    if (row.client_name) clientNames.add(String(row.client_name).toLowerCase());
  }

  const scope: UserScope = {
    isAdmin: false,
    customerIds: [...customerIds],
    clientNames,
  };
  scopeCache.set(user.userId, { ts: Date.now(), scope });
  return scope;
}

/** Attaches `req.scope`. Mounted globally after `authenticate`. */
export async function attachScope(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    req.scope = await getUserScope(req.user);
    next();
  } catch (error) {
    logger.error('Failed to resolve user scope:', error);
    res.status(500).json({ error: 'Failed to resolve access scope' });
  }
}

export async function scopeOf(req: AuthRequest): Promise<UserScope> {
  if (!req.scope) req.scope = await getUserScope(req.user);
  return req.scope;
}

export function isClientVisible(scope: UserScope, clientName?: string | null): boolean {
  if (scope.clientNames === null) return true;
  if (!clientName) return false;
  return scope.clientNames.has(String(clientName).toLowerCase());
}

/** Filter a list of rows down to the clients the caller may see. */
export function filterByClientName<T extends Record<string, any>>(
  scope: UserScope,
  rows: T[] | null | undefined,
  ...keys: string[]
): T[] {
  const list = Array.isArray(rows) ? rows : [];
  if (scope.clientNames === null) return list;
  const nameKeys = keys.length > 0 ? keys : ['client_name', 'clientname', 'name'];
  return list.filter((row) => {
    const key = nameKeys.find((k) => row?.[k] !== undefined && row?.[k] !== null);
    return key ? isClientVisible(scope, row[key]) : false;
  });
}

const nameCache = new Map<string, { ts: number; name: string | null }>();
const NAME_TTL_MS = 30_000;

/** Resolve a UrBackup client id to its name (for endpoints that only carry an id). */
export async function resolveClientName(clientId: string | number): Promise<string | null> {
  const id = parseInt(String(clientId), 10);
  if (!Number.isFinite(id)) return null;
  const key = String(id);
  const cached = nameCache.get(key);
  if (cached && Date.now() - cached.ts < NAME_TTL_MS) return cached.name;
  try {
    const db = await getUrBackupDb();
    const row = await db.get('SELECT name FROM clients WHERE id = ?', id);
    const name = row?.name ?? null;
    nameCache.set(key, { ts: Date.now(), name });
    return name;
  } catch (error) {
    logger.error(`Failed to resolve client name for id ${id}:`, error);
    return null;
  }
}

/**
 * Guard for single-client endpoints. Responds 403 and returns false when the
 * caller may not touch this client.
 */
export async function assertClientAccess(
  req: AuthRequest,
  res: Response,
  client: { id?: string | number | null; name?: string | null }
): Promise<boolean> {
  const scope = await scopeOf(req);
  if (scope.clientNames === null) return true;

  let name = client.name ?? null;
  if (!name && client.id !== undefined && client.id !== null) {
    name = await resolveClientName(client.id);
  }

  if (isClientVisible(scope, name)) return true;

  logger.warn(
    `[${req.user?.username || 'unknown'}] denied access to client ${name ?? client.id ?? '?'} (outside assigned customers)`
  );
  res.status(403).json({ error: 'This endpoint is not assigned to your customer' });
  return false;
}
