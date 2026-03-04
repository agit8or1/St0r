import { query } from '../config/database.js';
import { replicationEngine } from './replicationEngine.js';
import { logger } from '../utils/logger.js';

interface SchedulerSettings {
  enabled: boolean;
  trigger_mode: 'hook_and_schedule' | 'hook_only' | 'schedule_only';
  schedule_type: 'interval' | 'cron';
  interval_seconds: number;
  cron_expression: string;
  debounce_seconds: number;
}

class ReplicationScheduler {
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private cronTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private settings: SchedulerSettings | null = null;

  async start(): Promise<void> {
    logger.info('[ReplicationScheduler] Starting');
    await this.reload();
  }

  async reload(): Promise<void> {
    this.stop();
    try {
      const rows = await query<any[]>('SELECT * FROM replication_settings WHERE id = 1');
      if (!rows.length) return;

      const s = rows[0];
      this.settings = {
        enabled: !!s.enabled,
        trigger_mode: s.trigger_mode,
        schedule_type: s.schedule_type,
        interval_seconds: s.interval_seconds || 3600,
        cron_expression: s.cron_expression || '0 * * * *',
        debounce_seconds: s.debounce_seconds || 60,
      };

      if (!this.settings.enabled) {
        logger.info('[ReplicationScheduler] Disabled — not scheduling');
        return;
      }

      if (this.settings.trigger_mode === 'hook_only') {
        logger.info('[ReplicationScheduler] Hook-only mode, no timer scheduled');
        return;
      }

      if (this.settings.schedule_type === 'interval') {
        const ms = this.settings.interval_seconds * 1000;
        logger.info(`[ReplicationScheduler] Interval mode: every ${this.settings.interval_seconds}s`);
        this.intervalTimer = setInterval(() => this.runAllEnabled('schedule'), ms);
      } else {
        // Basic cron: check every minute
        logger.info(`[ReplicationScheduler] Cron mode: ${this.settings.cron_expression}`);
        this.cronTimer = setInterval(() => {
          if (this.matchCron(this.settings!.cron_expression)) {
            this.runAllEnabled('schedule');
          }
        }, 60 * 1000);
      }
    } catch (err) {
      logger.error('[ReplicationScheduler] Failed to load settings:', err);
    }
  }

  stop(): void {
    if (this.intervalTimer) { clearInterval(this.intervalTimer); this.intervalTimer = null; }
    if (this.cronTimer) { clearInterval(this.cronTimer); this.cronTimer = null; }
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
  }

  debounce(targetId: string, trigger: 'hook' | 'schedule' | 'manual', debounceMs: number): void {
    const existing = this.debounceTimers.get(targetId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(targetId);
      this.runTarget(targetId, trigger);
    }, debounceMs);

    this.debounceTimers.set(targetId, timer);
    logger.info(`[ReplicationScheduler] Debounced ${targetId} for ${debounceMs}ms`);
  }

  async runNow(targetId: string): Promise<string> {
    return replicationEngine.runTarget(targetId, 'manual');
  }

  private async runTarget(targetId: string, trigger: 'hook' | 'schedule' | 'manual'): Promise<void> {
    try {
      await replicationEngine.runTarget(targetId, trigger);
    } catch (err) {
      logger.error(`[ReplicationScheduler] Failed to run target ${targetId}:`, err);
    }
  }

  private async runAllEnabled(trigger: 'hook' | 'schedule' | 'manual'): Promise<void> {
    try {
      const targets = await query<any[]>(
        'SELECT id FROM replication_targets WHERE enabled = 1'
      );
      for (const t of targets) {
        this.runTarget(t.id, trigger);
      }
    } catch (err) {
      logger.error('[ReplicationScheduler] runAllEnabled failed:', err);
    }
  }

  /**
   * Very simple cron matcher: supports "minute hour * * *" format.
   * Only checks minute and hour fields.
   */
  private matchCron(expr: string): boolean {
    const parts = expr.trim().split(/\s+/);
    if (parts.length < 5) return false;

    const now = new Date();
    const [minExpr, hourExpr] = parts;

    const matchField = (expr: string, value: number): boolean => {
      if (expr === '*') return true;
      return parseInt(expr, 10) === value;
    };

    return matchField(minExpr, now.getMinutes()) && matchField(hourExpr, now.getHours());
  }
}

export const replicationScheduler = new ReplicationScheduler();
