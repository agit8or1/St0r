import { query } from '../config/database.js';
import { getUrBackupDb } from '../config/urbackupDb.js';
import { logger } from '../utils/logger.js';
import { runHelper } from '../utils/privileged.js';
import { UrBackupService } from './urbackup.js';

/**
 * Removing an endpoint and its backup data.
 *
 * UrBackup's own removal only flags the client (clients.delete_pending = 1).
 * Its cleanup then deletes every image and file backup, the database rows and
 * the client's folders (ServerCleanupThread::removeClient, server_cleanup.cpp).
 * That cleanup finds the backups by joining them to the client row, so the row
 * must stay until cleanup has run. St0r used to delete the row itself, which
 * left the backup files on disk for good.
 *
 * Cleanup runs in UrBackup's nightly window. "Delete now" starts the same work
 * immediately with `urbackupsrv cleanup -a 0%`: removes flagged clients first,
 * then applies the normal retention rules (amount 0 frees nothing extra). That
 * command runs as a separate process and cannot see which clients are
 * connected, so St0r only starts it when no flagged client is online and no
 * backup is running; otherwise the data goes at the next nightly cleanup.
 */

export type PurgeOutcome =
  | { status: 'started' }
  | { status: 'deferred'; reason: string }
  | { status: 'running' };

const urbackup = new UrBackupService();
let purgeRunning = false;

export function isPurgeRunning(): boolean {
  return purgeRunning;
}

/** St0r's own per-endpoint records. Drill history is kept; its drills are disabled. */
export async function removeStorRecords(clientId: number, clientName: string): Promise<void> {
  const steps: [string, any[]][] = [
    ['DELETE FROM customer_clients WHERE client_name = ? OR client_id = ?', [clientName, clientId]],
    ['DELETE FROM client_storage_limits WHERE client_name = ?', [clientName]],
    ['DELETE FROM client_managed_mode WHERE client_id = ?', [String(clientId)]],
    ['DELETE FROM client_status_cache WHERE client_name = ? OR client_id = ?', [clientName, clientId]],
    ['DELETE FROM alert_state WHERE alert_key LIKE ?', [`%:${clientName.replace(/[\\%_]/g, '\\$&')}`]],
    ['UPDATE recovery_drills SET enabled = 0 WHERE client_name = ?', [clientName]],
    ['DELETE FROM endpoint_disabled WHERE client_id = ?', [clientId]],
  ];
  for (const [sql, params] of steps) {
    try {
      await query(sql, params);
    } catch (err: any) {
      // A table from an optional migration may be missing on older installs.
      if (err?.code !== 'ER_NO_SUCH_TABLE') throw err;
    }
  }
}

async function pendingClients(): Promise<{ id: number; name: string }[]> {
  const db = await getUrBackupDb();
  return db.all('SELECT id, name FROM clients WHERE delete_pending = 1');
}

/**
 * Flag a client for removal through UrBackup's API and confirm the flag took.
 * Returns the client's name.
 */
export async function markForRemoval(clientId: number): Promise<string> {
  const db = await getUrBackupDb();
  const row = await db.get<{ name: string }>('SELECT name FROM clients WHERE id = ?', clientId);
  if (!row) throw Object.assign(new Error('Client not found'), { status: 404 });

  await urbackup.markClientForRemoval(clientId);

  const after = await db.get<{ delete_pending: number }>('SELECT delete_pending FROM clients WHERE id = ?', clientId);
  if (Number(after?.delete_pending) !== 1) {
    throw new Error('UrBackup did not accept the removal (delete_pending was not set)');
  }
  await removeStorRecords(clientId, row.name);
  logger.info(`[ClientRemoval] Client ${clientId} (${row.name}) flagged for removal`);
  return row.name;
}

/** Decide whether an immediate purge is safe. Exported for the tests. */
export function purgeBlocker(
  pending: { id: number; name: string }[],
  liveClients: { id: number; name: string; online?: boolean }[],
  activities: any[],
): string | null {
  if (pending.length === 0) return 'no client is waiting for removal';
  const live = new Map(liveClients.map(c => [Number(c.id), c]));
  const online = pending.filter(p => live.get(Number(p.id))?.online);
  if (online.length) {
    return `${online.map(p => p.name).join(', ')} still connected — uninstall the UrBackup client there, ` +
      'or the data is removed at the next nightly cleanup once it is offline';
  }
  if (activities.length) return 'a backup is running; the data is removed at the next nightly cleanup';
  return null;
}

/** Start deleting flagged clients' data now, when that is safe. Returns immediately. */
export async function purgeNow(): Promise<PurgeOutcome> {
  if (purgeRunning) return { status: 'running' };
  const [pending, live, activities] = await Promise.all([
    pendingClients(),
    urbackup.getLiveStatus().catch(() => null),
    urbackup.getCurrentActivities().catch(() => [] as any[]),
  ]);
  if (live === null) return { status: 'deferred', reason: 'UrBackup status is unavailable; the data is removed at the next nightly cleanup' };
  const blocker = purgeBlocker(pending, live, Array.isArray(activities) ? activities : []);
  if (blocker) return { status: 'deferred', reason: blocker };

  purgeRunning = true;
  const names = pending.map(p => p.name).join(', ');
  logger.info(`[ClientRemoval] Deleting backup data of ${names} now`);
  runHelper('urbackup-cleanup', ['0%'], { timeout: 12 * 3600 * 1000 })
    .then(async () => {
      const left = await pendingClients().catch(() => []);
      if (left.length) logger.warn(`[ClientRemoval] Still pending after cleanup: ${left.map(p => p.name).join(', ')}`);
      else logger.info(`[ClientRemoval] Removed ${names} and their backup data`);
    })
    .catch(err => logger.error('[ClientRemoval] Cleanup failed:', err))
    .finally(() => { purgeRunning = false; });
  return { status: 'started' };
}
