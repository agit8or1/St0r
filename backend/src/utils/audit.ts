import { logger } from './logger.js';
import type { AuthRequest } from '../middleware/auth.js';

/**
 * Record a successful access to backup data (download, restore, export).
 *
 * Denials and failures were already logged; successful reads were not, so there
 * was no record of who took which customer's data. One line per event, prefixed
 * `[audit]` so it can be grepped out of the journal:
 *   journalctl -u urbackup-gui | grep '\[audit\]'
 */
export function audit(req: AuthRequest, action: string, details: Record<string, unknown>): void {
  const who = req.user ? `${req.user.username} (id ${req.user.userId})` : 'unknown';
  const fields = Object.entries(details)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');
  logger.info(`[audit] ${action} by ${who} from ${req.ip ?? '?'} ${fields}`.trimEnd());
}
