import { readFile } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { query } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { runHelper } from '../utils/privileged.js';
import { UrBackupService } from './urbackup.js';

const execFileAsync = promisify(execFile);

/**
 * Daily automatic update of the local UrBackup server package.
 *
 * Once a day, inside a window that starts at the configured hour, St0r runs the
 * root helper's `urbackup-server-update` (apt-get update + install
 * --only-upgrade urbackup-server). The helper restarts UrBackup only when the
 * package actually changed. A running backup postpones the update to a later
 * check in the window, so an upgrade never interrupts one; if backups run for
 * the whole window, the update is skipped until the next day.
 */

export const UPDATE_LOG = '/var/log/urbackup-server-update.log';
const WINDOW_HOURS = 3;
const TICK_MS = 10 * 60 * 1000;

export interface AutoUpdateConfig {
  enabled: boolean;
  /** Local hour (0-23) the daily window starts. */
  hour: number;
}

export interface AutoUpdateState {
  /** Local date (YYYY-MM-DD) of the last completed or skipped attempt. */
  lastDate: string | null;
  lastRunAt: string | null;
  lastResult: string | null;
}

const DEFAULT_CONFIG: AutoUpdateConfig = { enabled: true, hour: 4 };
const KEY = {
  enabled: 'urbackup_auto_update_enabled',
  hour: 'urbackup_auto_update_hour',
  lastDate: 'urbackup_auto_update_last_date',
  lastRunAt: 'urbackup_auto_update_last_run_at',
  lastResult: 'urbackup_auto_update_last_result',
};

export async function ensureSettingsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS st0r_settings (
      k VARCHAR(64) NOT NULL PRIMARY KEY,
      v TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function getValues(): Promise<Map<string, string>> {
  const rows = await query<any[]>(
    `SELECT k, v FROM st0r_settings WHERE k IN (${Object.values(KEY).map(() => '?').join(',')})`,
    Object.values(KEY),
  );
  return new Map(rows.map(r => [r.k, r.v]));
}

async function setValues(values: Record<string, string>): Promise<void> {
  for (const [k, v] of Object.entries(values)) {
    await query('INSERT INTO st0r_settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [k, v]);
  }
}

export async function getConfig(): Promise<AutoUpdateConfig> {
  const m = await getValues();
  const hour = parseInt(m.get(KEY.hour) ?? '', 10);
  return {
    enabled: m.has(KEY.enabled) ? m.get(KEY.enabled) === '1' : DEFAULT_CONFIG.enabled,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_CONFIG.hour,
  };
}

export async function getState(): Promise<AutoUpdateState> {
  const m = await getValues();
  return { lastDate: m.get(KEY.lastDate) ?? null, lastRunAt: m.get(KEY.lastRunAt) ?? null, lastResult: m.get(KEY.lastResult) ?? null };
}

export function validateConfig(body: any): string | null {
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return 'enabled must be true or false';
  if (body.hour !== undefined && (!Number.isInteger(body.hour) || body.hour < 0 || body.hour > 23)) {
    return 'hour must be a whole number from 0 to 23';
  }
  return null;
}

export async function setConfig(body: Partial<AutoUpdateConfig>): Promise<AutoUpdateConfig> {
  const values: Record<string, string> = {};
  if (body.enabled !== undefined) values[KEY.enabled] = body.enabled ? '1' : '0';
  if (body.hour !== undefined) values[KEY.hour] = String(body.hour);
  await setValues(values);
  return getConfig();
}

function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The local date the most recent update window started on: the key for "done for this window". */
export function windowKey(now: Date, config: AutoUpdateConfig): string {
  const sinceStart = (now.getHours() - config.hour + 24) % 24;
  const start = new Date(now);
  start.setHours(now.getHours() - sinceStart, 0, 0, 0);
  return localDate(start);
}

/**
 * What a tick should do. Pure, for the tests.
 *  - 'run'   inside the window, not yet done for it, no backup running
 *  - 'wait'  inside the window but a backup is running (try again next tick)
 *  - 'skip'  the window has just closed without an update: record it
 *  - 'idle'  nothing to do
 */
export function decide(
  now: Date, config: AutoUpdateConfig, state: AutoUpdateState, backupRunning: boolean,
): 'run' | 'wait' | 'skip' | 'idle' {
  if (!config.enabled) return 'idle';
  if (state.lastDate === windowKey(now, config)) return 'idle';
  const sinceStart = (now.getHours() - config.hour + 24) % 24;
  if (sinceStart < WINDOW_HOURS) return backupRunning ? 'wait' : 'run';
  if (sinceStart === WINDOW_HOURS) return 'skip';
  return 'idle';
}

export async function installedVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('dpkg-query', ['-W', '-f=${Version}', 'urbackup-server']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Wait for the helper's background unit to log its SUCCESS/FAILED line. */
async function waitForResult(timeoutMs = 30 * 60 * 1000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 15_000));
    const log = await readFile(UPDATE_LOG, 'utf-8').catch(() => '');
    const line = log.split('\n').reverse().find(l => /^(SUCCESS|FAILED):/.test(l));
    if (line) return line;
  }
  return 'FAILED: no result within 30 minutes (see /var/log/urbackup-server-update.log)';
}

class UrBackupAutoUpdater {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private urbackup = new UrBackupService();

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
    setTimeout(() => this.tick(), 2 * 60 * 1000).unref();
    logger.info('[UrBackupAutoUpdate] Scheduler started');
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const [config, state] = await Promise.all([getConfig(), getState()]);
      let running = false;
      const now = new Date();
      if (config.enabled && state.lastDate !== windowKey(now, config)) {
        const activities = await this.urbackup.getCurrentActivities().catch(() => null);
        // If UrBackup can't be asked, treat it as busy rather than update blind.
        running = activities === null || (Array.isArray(activities) && activities.length > 0);
      }
      const action = decide(now, config, state, running);
      const key = windowKey(now, config);
      if (action === 'wait') logger.info('[UrBackupAutoUpdate] Backup running — postponing the update');
      if (action === 'skip') {
        await this.record('SKIPPED: backups were running for the whole update window', key);
      }
      if (action === 'run') await this.runNow(key);
    } catch (err) {
      logger.error('[UrBackupAutoUpdate] Tick failed:', err);
    } finally {
      this.busy = false;
    }
  }

  private async record(result: string, key: string | null): Promise<void> {
    await setValues({
      ...(key ? { [KEY.lastDate]: key } : {}),
      [KEY.lastRunAt]: new Date().toISOString(),
      [KEY.lastResult]: result,
    });
    logger.info(`[UrBackupAutoUpdate] ${result}`);
  }

  /** Run an update now. `key` marks the scheduled window done; a manual run passes null. */
  async runNow(key: string | null = null): Promise<string> {
    logger.info('[UrBackupAutoUpdate] Checking for a UrBackup server update');
    try {
      const { stdout } = await runHelper('urbackup-server-update');
      if (/already running/.test(stdout)) logger.info('[UrBackupAutoUpdate] An update is already running');
      const result = await waitForResult();
      await this.record(result, key);
      return result;
    } catch (err: any) {
      const result = `FAILED: ${err?.message || err}`;
      await this.record(result, key);
      return result;
    }
  }
}

export const urbackupAutoUpdater = new UrBackupAutoUpdater();
