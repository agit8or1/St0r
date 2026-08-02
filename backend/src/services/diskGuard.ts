import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';
import { query } from '../config/database.js';
import { openUrBackupSettingsDbReadWrite } from '../config/urbackupDb.js';
import { UrBackupService } from './urbackup.js';

const execFileAsync = promisify(execFile);

export type GuardLevel = 'ok' | 'warning' | 'critical' | 'emergency';

export interface DiskGuardThresholds {
  /** Log + record an event; no corrective action yet. */
  warnPct: number;
  /** Alert loudly; optionally reclaim space if auto-reclaim is enabled. */
  criticalPct: number;
  /** Pause new backups so the filesystem cannot be driven to 100%. */
  emergencyPct: number;
  /** Usage must fall back below this before a guard-initiated pause is lifted. */
  resumePct: number;
}

export interface DiskUsage {
  path: string;
  total: number;
  used: number;
  free: number;
  usedPct: number;
}

export interface DiskGuardStatus {
  enabled: boolean;
  level: GuardLevel;
  usage: DiskUsage | null;
  thresholds: DiskGuardThresholds;
  backupsPaused: boolean;
  autoReclaim: boolean;
  lastCheck: string | null;
  intervalMs: number;
}

/** Settings the guard flips to stop new backups. Both must be '1' to fully halt growth. */
const PAUSE_KEYS = ['no_file_backups', 'no_images'] as const;

const STATE_PAUSED_PREV = 'paused_prev_settings';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

/**
 * Watches free space on the UrBackup storage filesystem and intervenes before it
 * fills. The tiers escalate: warn (record), critical (alert, optional reclaim),
 * emergency (pause new backups). UrBackup's own nightly cleanup window then frees
 * space, and the guard lifts its pause once usage drops back under `resumePct`,
 * so the protection is self-healing rather than a one-way trip.
 */
export class DiskGuard {
  private timer: NodeJS.Timeout | null = null;
  private lastLevel: GuardLevel = 'ok';
  private lastUsage: DiskUsage | null = null;
  private lastCheck: Date | null = null;
  private checking = false;

  readonly enabled = envBool('ST0R_DISK_GUARD_ENABLED', true);
  readonly autoReclaim = envBool('ST0R_DISK_AUTO_RECLAIM', false);
  readonly intervalMs = envInt('ST0R_DISK_GUARD_INTERVAL_MIN', 10) * 60 * 1000;

  readonly thresholds: DiskGuardThresholds = {
    warnPct: envInt('ST0R_DISK_WARN_PCT', 75),
    criticalPct: envInt('ST0R_DISK_CRITICAL_PCT', 85),
    emergencyPct: envInt('ST0R_DISK_EMERGENCY_PCT', 93),
    resumePct: envInt('ST0R_DISK_RESUME_PCT', 70),
  };

  /** Resolve the filesystem that actually holds backups, not just `/`. */
  async getStoragePath(): Promise<string> {
    if (process.env.URBACKUP_BACKUP_PATH) return process.env.URBACKUP_BACKUP_PATH;
    try {
      const db = await openUrBackupSettingsDbReadWrite();
      try {
        const row = await db.get<{ value: string }>(
          "SELECT value FROM settings WHERE clientid = 0 AND key = 'backupfolder' LIMIT 1"
        );
        if (row?.value) return row.value;
      } finally {
        await db.close();
      }
    } catch (err) {
      logger.debug('[DiskGuard] Could not read backupfolder from settings DB:', err);
    }
    return '/';
  }

  /**
   * Read usage with `df` on the storage path. Never walks the tree — the backup
   * store is millions of hardlinks and `du` there hangs for many minutes.
   */
  async getUsage(): Promise<DiskUsage> {
    const path = await this.getStoragePath();
    const { stdout } = await execFileAsync('df', ['-B1', '-P', path]);
    const lines = stdout.trim().split('\n');
    const parts = lines[lines.length - 1].split(/\s+/);

    const total = parseInt(parts[1], 10);
    const used = parseInt(parts[2], 10);
    const free = parseInt(parts[3], 10);
    const usedPct = total > 0 ? (used / total) * 100 : 0;

    return { path, total, used, free, usedPct: Math.round(usedPct * 100) / 100 };
  }

  private levelFor(usedPct: number): GuardLevel {
    const { warnPct, criticalPct, emergencyPct } = this.thresholds;
    if (usedPct >= emergencyPct) return 'emergency';
    if (usedPct >= criticalPct) return 'critical';
    if (usedPct >= warnPct) return 'warning';
    return 'ok';
  }

  private async recordEvent(
    level: GuardLevel,
    usage: DiskUsage,
    action: string,
    detail?: string
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO disk_guard_events (level, used_pct, free_bytes, total_bytes, action, detail)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [level, usage.usedPct, usage.free, usage.total, action, detail ?? null]
      );
    } catch (err) {
      logger.error('[DiskGuard] Failed to record event:', err);
    }
  }

  private async getState(key: string): Promise<string | null> {
    try {
      const rows = await query<{ v: string }[]>('SELECT v FROM disk_guard_state WHERE k = ?', [key]);
      return rows[0]?.v ?? null;
    } catch {
      return null;
    }
  }

  private async setState(key: string, value: string | null): Promise<void> {
    try {
      if (value === null) {
        await query('DELETE FROM disk_guard_state WHERE k = ?', [key]);
      } else {
        await query(
          'INSERT INTO disk_guard_state (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
          [key, value]
        );
      }
    } catch (err) {
      logger.error('[DiskGuard] Failed to persist state:', err);
    }
  }

  /** True when the guard (not the admin) currently has backups paused. */
  async isPausedByGuard(): Promise<boolean> {
    return (await this.getState(STATE_PAUSED_PREV)) !== null;
  }

  /**
   * Halt new backups. Remembers the prior values so a later resume restores
   * exactly what the admin had, rather than assuming both were enabled.
   */
  async pauseBackups(reason: string): Promise<void> {
    if (await this.isPausedByGuard()) return;

    const service = new UrBackupService();
    const current = await service.getSettings();
    const prev: Record<string, string> = {};
    for (const key of PAUSE_KEYS) {
      prev[key] = String(current[key] ?? '0');
    }

    await service.setSettings({ no_file_backups: '1', no_images: '1' });
    await this.setState(STATE_PAUSED_PREV, JSON.stringify(prev));
    logger.warn(`[DiskGuard] Paused new file and image backups: ${reason}`);
  }

  /** Restore whatever no_file_backups/no_images were before the guard paused them. */
  async resumeBackups(reason: string): Promise<void> {
    const saved = await this.getState(STATE_PAUSED_PREV);
    if (saved === null) return;

    let prev: Record<string, string>;
    try {
      prev = JSON.parse(saved);
    } catch {
      prev = { no_file_backups: '0', no_images: '0' };
    }

    const service = new UrBackupService();
    await service.setSettings({
      no_file_backups: prev.no_file_backups ?? '0',
      no_images: prev.no_images ?? '0',
    });
    await this.setState(STATE_PAUSED_PREV, null);
    logger.info(`[DiskGuard] Resumed backups: ${reason}`);
  }

  /**
   * Ask UrBackup to delete oldest backups until `amount` is freed. Destructive, so
   * it only runs automatically when ST0R_DISK_AUTO_RECLAIM is set; otherwise it is
   * an explicit admin action. Retention floors (min_*) still apply.
   */
  async reclaim(amount: string): Promise<{ ok: boolean; output: string }> {
    if (!/^\d{1,4}(%|M|G|T)$/.test(amount)) {
      throw new Error("amount must look like '5%', '500M', '20G' or '1T'");
    }
    logger.warn(`[DiskGuard] Running urbackupsrv cleanup -a ${amount}`);
    try {
      const { stdout, stderr } = await execFileAsync(
        'sudo',
        ['-n', 'urbackupsrv', 'cleanup', '-u', 'urbackup', '-a', amount],
        { timeout: 30 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 }
      );
      return { ok: true, output: `${stdout}\n${stderr}`.trim() };
    } catch (err: any) {
      const output = `${err?.stdout ?? ''}\n${err?.stderr ?? ''}`.trim() || String(err?.message ?? err);
      logger.error(`[DiskGuard] Cleanup failed: ${output}`);
      return { ok: false, output };
    }
  }

  /**
   * Remove files in the backup store that the UrBackup database no longer
   * references — orphans left behind by interrupted backups and deletions, which
   * are duplicates of data already retained elsewhere. Requires the server to be
   * stopped, so this is admin-triggered only and never part of the timer.
   */
  async removeUnknown(): Promise<{ ok: boolean; output: string }> {
    logger.warn('[DiskGuard] Running urbackupsrv remove-unknown');
    try {
      const { stdout, stderr } = await execFileAsync(
        'sudo',
        ['-n', 'urbackupsrv', 'remove-unknown', '-u', 'urbackup'],
        { timeout: 60 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 }
      );
      return { ok: true, output: `${stdout}\n${stderr}`.trim() };
    } catch (err: any) {
      const output = `${err?.stdout ?? ''}\n${err?.stderr ?? ''}`.trim() || String(err?.message ?? err);
      logger.error(`[DiskGuard] remove-unknown failed: ${output}`);
      return { ok: false, output };
    }
  }

  /** One monitoring pass. Safe to call concurrently; overlapping runs are skipped. */
  async check(): Promise<DiskGuardStatus> {
    if (this.checking) return this.getStatus();
    this.checking = true;

    try {
      const usage = await this.getUsage();
      const level = this.levelFor(usage.usedPct);
      const previous = this.lastLevel;

      this.lastUsage = usage;
      this.lastCheck = new Date();

      const summary = `${usage.usedPct}% used, ${(usage.free / 1024 ** 3).toFixed(1)} GiB free on ${usage.path}`;

      if (level === 'emergency') {
        if (previous !== 'emergency') {
          logger.error(`[DiskGuard] EMERGENCY: ${summary}`);
          await this.recordEvent(level, usage, 'pause_backups', summary);
        }
        try {
          await this.pauseBackups(summary);
        } catch (err) {
          logger.error('[DiskGuard] Failed to pause backups:', err);
          await this.recordEvent(level, usage, 'pause_failed', String(err));
        }
      } else if (level === 'critical') {
        if (previous !== 'critical') {
          logger.error(`[DiskGuard] CRITICAL: ${summary}`);
          await this.recordEvent(level, usage, 'alert', summary);
        }
        if (this.autoReclaim) {
          const target = Math.max(1, Math.ceil(usage.usedPct - this.thresholds.warnPct));
          const result = await this.reclaim(`${target}%`);
          await this.recordEvent(level, usage, result.ok ? 'reclaimed' : 'reclaim_failed', result.output.slice(0, 4000));
        }
      } else if (level === 'warning') {
        if (previous !== 'warning') {
          logger.warn(`[DiskGuard] WARNING: ${summary}`);
          await this.recordEvent(level, usage, 'alert', summary);
        }
      }

      // Hysteresis: only lift a guard-initiated pause once usage is comfortably
      // back down, so we don't flap around the emergency threshold. Requiring
      // level 'ok' as well means a misconfigured resumePct above emergencyPct
      // can't make a single pass both pause and resume.
      if (level === 'ok' && usage.usedPct < this.thresholds.resumePct && (await this.isPausedByGuard())) {
        try {
          await this.resumeBackups(summary);
          await this.recordEvent('ok', usage, 'resume_backups', summary);
        } catch (err) {
          logger.error('[DiskGuard] Failed to resume backups:', err);
        }
      }

      if (level === 'ok' && previous !== 'ok') {
        logger.info(`[DiskGuard] Recovered: ${summary}`);
        await this.recordEvent(level, usage, 'recovered', summary);
      }

      this.lastLevel = level;
      return this.getStatus();
    } catch (err) {
      logger.error('[DiskGuard] Check failed:', err);
      return this.getStatus();
    } finally {
      this.checking = false;
    }
  }

  getStatus(): DiskGuardStatus {
    return {
      enabled: this.enabled,
      level: this.lastLevel,
      usage: this.lastUsage,
      thresholds: this.thresholds,
      backupsPaused: false, // filled in by the route, which can await the DB
      autoReclaim: this.autoReclaim,
      lastCheck: this.lastCheck ? this.lastCheck.toISOString() : null,
      intervalMs: this.intervalMs,
    };
  }

  async getEvents(limit = 50): Promise<any[]> {
    try {
      const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 500);
      return await query<any[]>(
        `SELECT id, level, used_pct, free_bytes, total_bytes, action, detail, created_at
         FROM disk_guard_events ORDER BY id DESC LIMIT ${safeLimit}`
      );
    } catch (err) {
      logger.error('[DiskGuard] Failed to read events:', err);
      return [];
    }
  }

  start(): void {
    if (!this.enabled) {
      logger.info('[DiskGuard] Disabled via ST0R_DISK_GUARD_ENABLED');
      return;
    }
    if (this.timer) return;

    const { warnPct, criticalPct, emergencyPct, resumePct } = this.thresholds;
    logger.info(
      `[DiskGuard] Started — warn ${warnPct}%, critical ${criticalPct}%, emergency ${emergencyPct}% ` +
      `(resume below ${resumePct}%), every ${this.intervalMs / 60000} min, auto-reclaim ${this.autoReclaim ? 'on' : 'off'}`
    );

    // First pass shortly after boot so a disk already in trouble is caught now.
    setTimeout(() => { void this.check(); }, 30 * 1000);
    this.timer = setInterval(() => { void this.check(); }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const diskGuard = new DiskGuard();
