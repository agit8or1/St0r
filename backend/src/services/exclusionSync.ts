import { query } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { mergePatterns, samePatterns, splitPatterns, subtractPatterns } from '../utils/urbackupSettings.js';

/**
 * Server exclusions must always reach the endpoint.
 *
 * UrBackup picks exactly ONE source for an endpoint's exclude_files
 * (urbackupserver/ClientMain.cpp sendSettings): use=1 the group's list,
 * use=2 the endpoint's own value, use=4 what the client reported. Mixed
 * bitmasks are not merged for the client — it gets `value` alone. A Windows
 * client reports its built-in list and ends up on use=4, so anything set on
 * the server (Default group or a named group) is silently ignored for it.
 *
 * St0r therefore keeps each endpoint's own patterns here and pushes
 * group list + own patterns as the endpoint's value with use=2. The group
 * part is recomputed on every sync, so adding or removing a server
 * exclusion reaches every endpoint.
 */

interface ExcludeSetting { use?: number | string; value?: string; value_group?: string; value_client?: string }

interface SettingsService {
  getClientSettings(clientId: string): Promise<any>;
  setClientSettings(clientId: string, settings: any): Promise<{ success: boolean }>;
  getGroups(): Promise<{ members: { id: number }[] }>;
}

export async function ensureExclusionTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS endpoint_exclusions (
      client_id INT NOT NULL PRIMARY KEY,
      patterns TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function getOwnPatterns(clientId: number): Promise<string[] | null> {
  const rows = await query<any[]>('SELECT patterns FROM endpoint_exclusions WHERE client_id = ?', [clientId]);
  return rows.length ? splitPatterns(rows[0].patterns) : null;
}

async function saveOwnPatterns(clientId: number, patterns: string[]): Promise<void> {
  await query(
    'INSERT INTO endpoint_exclusions (client_id, patterns) VALUES (?, ?) ON DUPLICATE KEY UPDATE patterns = VALUES(patterns)',
    [clientId, patterns.join(';')]
  );
}

async function readExcludeSetting(service: SettingsService, clientId: number): Promise<ExcludeSetting | null> {
  const raw = (await service.getClientSettings(String(clientId)))?.settings?.exclude_files;
  return raw && typeof raw === 'object' ? raw : null;
}

/** The server's (group's) exclusions in effect for an endpoint. */
export async function getServerExclusions(service: SettingsService, clientId: number): Promise<string[]> {
  return splitPatterns((await readExcludeSetting(service, clientId))?.value_group);
}

/**
 * An endpoint's exclusions were edited in St0r. Server exclusions can't be
 * removed per endpoint, so only the rest is the endpoint's own; returns the
 * full list to save (server exclusions first).
 */
export async function setEndpointExclusions(service: SettingsService, clientId: number, submitted: unknown): Promise<string> {
  const server = await getServerExclusions(service, clientId);
  const own = subtractPatterns(splitPatterns(submitted), server);
  await saveOwnPatterns(clientId, own);
  return mergePatterns(server, own).join(';');
}

/** Pushes server + own exclusions to one endpoint. Returns true if it changed anything. */
export async function syncEndpointExclusions(service: SettingsService, clientId: number): Promise<boolean> {
  const setting = await readExcludeSetting(service, clientId);
  if (!setting) return false;
  const use = Number(setting.use);
  const server = splitPatterns(setting.value_group);
  let own = await getOwnPatterns(clientId);

  if (own === null) {
    // Plain inheritance already applies the server list as-is.
    if (use === 1) return false;
    // First sync: keep what the endpoint had — a St0r override, or the
    // client's own built-in list — as its own patterns.
    own = subtractPatterns(splitPatterns(use & 2 ? setting.value : setting.value_client), server);
    await saveOwnPatterns(clientId, own);
  }

  if (use === 1 && own.length === 0) return false;
  const wanted = mergePatterns(server, own);
  if (use === 2 && samePatterns(splitPatterns(setting.value), wanted)) return false;

  const result = await service.setClientSettings(String(clientId), { exclude_files: wanted.join(';') });
  if (!result.success) throw new Error(`UrBackup did not save exclusions for endpoint ${clientId}`);
  logger.info(`[ExclusionSync] Endpoint ${clientId}: applied ${server.length} server + ${own.length} endpoint exclusions (was use=${use})`);
  return true;
}

/** Syncs every endpoint; one failing endpoint doesn't stop the rest. */
export async function syncAllExclusions(service: SettingsService): Promise<number> {
  const { members } = await service.getGroups();
  let changed = 0;
  for (const m of members) {
    try {
      if (await syncEndpointExclusions(service, m.id)) changed++;
    } catch (err) {
      logger.warn(`[ExclusionSync] Endpoint ${m.id} failed:`, err);
    }
  }
  return changed;
}

/** Runs in the background after a save; errors are logged, not thrown. */
export function syncAllExclusionsSoon(service: SettingsService): void {
  syncAllExclusions(service).catch(err => logger.warn('[ExclusionSync] Sync failed:', err));
}

const SYNC_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Periodic sync catches new endpoints (a newly installed client reports its
 * own list, use=4) and endpoints whose source was switched elsewhere.
 */
export function startExclusionSync(service: SettingsService): void {
  const run = () => syncAllExclusions(service)
    .then(n => { if (n > 0) logger.info(`[ExclusionSync] Updated ${n} endpoint(s)`); })
    .catch(err => logger.warn('[ExclusionSync] Sync failed:', err));
  setTimeout(run, 60 * 1000);
  setInterval(run, SYNC_INTERVAL_MS);
}
