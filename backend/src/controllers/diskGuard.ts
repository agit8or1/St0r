import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { diskGuard } from '../services/diskGuard.js';
import { logger } from '../utils/logger.js';

/** GET /api/disk-guard — current usage, level, thresholds and pause state */
export async function getDiskGuardStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    // Refresh usage on demand so the UI never shows a stale figure between ticks.
    await diskGuard.check();
    const status = diskGuard.getStatus();
    status.backupsPaused = await diskGuard.isPausedByGuard();
    res.json(status);
  } catch (err) {
    logger.error('Failed to get disk guard status:', err);
    res.status(500).json({ error: 'Failed to get disk guard status' });
  }
}

/** GET /api/disk-guard/events — recent guard actions */
export async function getDiskGuardEvents(req: AuthRequest, res: Response): Promise<void> {
  try {
    const limit = parseInt(String(req.query.limit ?? '50'), 10);
    const events = await diskGuard.getEvents(isNaN(limit) ? 50 : limit);
    res.json(events);
  } catch (err) {
    logger.error('Failed to get disk guard events:', err);
    res.status(500).json({ error: 'Failed to get disk guard events' });
  }
}

/** POST /api/disk-guard/reclaim — delete oldest backups to free space (admin) */
export async function reclaimSpace(req: AuthRequest, res: Response): Promise<void> {
  const { amount } = req.body as { amount?: string };
  if (!amount) {
    res.status(400).json({ error: "amount is required, e.g. '5%' or '100G'" });
    return;
  }
  try {
    const result = await diskGuard.reclaim(amount);
    if (!result.ok) {
      res.status(500).json({ error: 'Cleanup failed', output: result.output });
      return;
    }
    logger.info(`Space reclamation of ${amount} triggered by ${req.user?.username ?? 'unknown'}`);
    res.json({ ok: true, output: result.output });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'Invalid request' });
  }
}

/**
 * POST /api/disk-guard/prune-orphans — remove backup-store files the UrBackup
 * database no longer references. Requires the server to be stopped first, so the
 * caller must pass confirm:true to acknowledge the downtime.
 */
export async function pruneOrphans(req: AuthRequest, res: Response): Promise<void> {
  const { confirm } = req.body as { confirm?: boolean };
  if (confirm !== true) {
    res.status(400).json({
      error: 'Pruning orphaned files requires the UrBackup server to be stopped. Pass confirm:true to proceed.',
    });
    return;
  }
  try {
    const result = await diskGuard.removeUnknown();
    if (!result.ok) {
      res.status(500).json({ error: 'Orphan prune failed', output: result.output });
      return;
    }
    logger.info(`Orphan prune triggered by ${req.user?.username ?? 'unknown'}`);
    res.json({ ok: true, output: result.output });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Orphan prune failed' });
  }
}

/** POST /api/disk-guard/resume — manually lift a guard-initiated backup pause */
export async function resumeBackups(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await diskGuard.isPausedByGuard())) {
      res.status(400).json({ error: 'Backups are not currently paused by the disk guard' });
      return;
    }
    await diskGuard.resumeBackups(`manual resume by ${req.user?.username ?? 'unknown'}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Failed to resume backups:', err);
    res.status(500).json({ error: 'Failed to resume backups' });
  }
}
