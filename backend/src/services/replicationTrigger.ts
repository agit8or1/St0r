import { query } from '../config/database.js';
import { replicationScheduler } from './replicationScheduler.js';
import { logger } from '../utils/logger.js';

class ReplicationTrigger {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastKnownBackupTimes = new Map<string, number>();
  private readonly POLL_INTERVAL = 30 * 1000; // 30s

  start(): void {
    logger.info('[ReplicationTrigger] Starting backup change monitor');
    this.pollTimer = setInterval(() => this.poll(), this.POLL_INTERVAL);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      // Only trigger if hook mode is enabled
      const settingsRows = await query<any[]>(
        'SELECT enabled, trigger_mode, debounce_seconds FROM replication_settings WHERE id = 1'
      );
      if (!settingsRows.length) return;
      const s = settingsRows[0];
      if (!s.enabled) return;
      if (s.trigger_mode === 'schedule_only') return;

      // Get clients and their lastbackup times
      const { UrBackupService } = await import('./urbackup.js');
      const service = new UrBackupService();
      const clients = await service.getClients();

      let anyChanged = false;
      for (const client of clients) {
        const clientKey = String(client.id || client.name);
        const lastBackup = client.lastbackup || 0;
        const prev = this.lastKnownBackupTimes.get(clientKey) ?? lastBackup;

        if (lastBackup > prev) {
          logger.info(
            `[ReplicationTrigger] Client ${client.name} new backup detected (${lastBackup} > ${prev})`
          );
          anyChanged = true;
        }
        this.lastKnownBackupTimes.set(clientKey, lastBackup);
      }

      if (!anyChanged) return;

      // Debounce trigger for all enabled targets
      const targets = await query<any[]>(
        'SELECT id FROM replication_targets WHERE enabled = 1'
      );
      const debounceMs = (s.debounce_seconds || 60) * 1000;
      for (const t of targets) {
        replicationScheduler.debounce(t.id, 'hook', debounceMs);
      }
    } catch (err) {
      logger.error('[ReplicationTrigger] Poll error:', err);
    }
  }
}

export const replicationTrigger = new ReplicationTrigger();
