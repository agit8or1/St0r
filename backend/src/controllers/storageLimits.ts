import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { query } from '../config/database.js';
import { logger } from '../utils/logger.js';

export interface StorageLimitRow {
  client_name: string;
  limit_bytes: number;
  warn_threshold_pct: number;
  critical_threshold_pct: number;
}

function computeStatus(usedBytes: number, limitBytes: number, warnPct: number, criticalPct: number) {
  const pct = (usedBytes / limitBytes) * 100;
  let status: 'ok' | 'warning' | 'critical' | 'exceeded';
  if (pct >= 100) status = 'exceeded';
  else if (pct >= criticalPct) status = 'critical';
  else if (pct >= warnPct) status = 'warning';
  else status = 'ok';
  return { pct: Math.min(pct, 100), status };
}

/** GET /api/storage-limits  — returns all limits (no usage data; client provides that) */
export async function getStorageLimits(req: AuthRequest, res: Response): Promise<void> {
  try {
    const rows = await query<StorageLimitRow[]>(
      'SELECT client_name, limit_bytes, warn_threshold_pct, critical_threshold_pct FROM client_storage_limits ORDER BY client_name'
    );
    res.json(rows);
  } catch (err) {
    logger.error('Failed to get storage limits:', err);
    res.status(500).json({ error: 'Failed to get storage limits' });
  }
}

/** PUT /api/storage-limits/:clientName  — upsert a limit */
export async function upsertStorageLimit(req: AuthRequest, res: Response): Promise<void> {
  const { clientName } = req.params;
  const { limit_bytes, warn_threshold_pct = 80, critical_threshold_pct = 95 } = req.body;

  if (!limit_bytes || isNaN(Number(limit_bytes)) || Number(limit_bytes) <= 0) {
    res.status(400).json({ error: 'limit_bytes must be a positive number' });
    return;
  }
  if (warn_threshold_pct < 1 || warn_threshold_pct >= critical_threshold_pct || critical_threshold_pct > 100) {
    res.status(400).json({ error: 'Invalid threshold percentages' });
    return;
  }

  try {
    await query(
      `INSERT INTO client_storage_limits (client_name, limit_bytes, warn_threshold_pct, critical_threshold_pct)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE limit_bytes = VALUES(limit_bytes),
         warn_threshold_pct = VALUES(warn_threshold_pct),
         critical_threshold_pct = VALUES(critical_threshold_pct),
         updated_at = CURRENT_TIMESTAMP`,
      [clientName, Number(limit_bytes), Number(warn_threshold_pct), Number(critical_threshold_pct)]
    );
    res.json({ ok: true, client_name: clientName, limit_bytes: Number(limit_bytes), warn_threshold_pct: Number(warn_threshold_pct), critical_threshold_pct: Number(critical_threshold_pct) });
  } catch (err) {
    logger.error('Failed to upsert storage limit:', err);
    res.status(500).json({ error: 'Failed to save storage limit' });
  }
}

/** DELETE /api/storage-limits/:clientName  — remove a limit */
export async function deleteStorageLimit(req: AuthRequest, res: Response): Promise<void> {
  const { clientName } = req.params;
  try {
    await query('DELETE FROM client_storage_limits WHERE client_name = ?', [clientName]);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Failed to delete storage limit:', err);
    res.status(500).json({ error: 'Failed to delete storage limit' });
  }
}

/** POST /api/storage-limits/status  — compute status for multiple clients given their usage */
export async function getStorageLimitStatuses(req: AuthRequest, res: Response): Promise<void> {
  // Body: { clients: [{ name, bytes_used }] }
  const { clients } = req.body as { clients: { name: string; bytes_used: number }[] };
  if (!Array.isArray(clients)) {
    res.status(400).json({ error: 'clients array required' });
    return;
  }
  try {
    const rows = await query<StorageLimitRow[]>(
      'SELECT client_name, limit_bytes, warn_threshold_pct, critical_threshold_pct FROM client_storage_limits'
    );
    const limitMap = new Map(rows.map(r => [r.client_name, r]));
    const result = clients.map(c => {
      const limit = limitMap.get(c.name);
      if (!limit) return { name: c.name, has_limit: false };
      const { pct, status } = computeStatus(c.bytes_used, limit.limit_bytes, limit.warn_threshold_pct, limit.critical_threshold_pct);
      return {
        name: c.name,
        has_limit: true,
        limit_bytes: limit.limit_bytes,
        used_bytes: c.bytes_used,
        pct,
        status,
        warn_threshold_pct: limit.warn_threshold_pct,
        critical_threshold_pct: limit.critical_threshold_pct,
      };
    });
    res.json(result);
  } catch (err) {
    logger.error('Failed to compute storage limit statuses:', err);
    res.status(500).json({ error: 'Failed to compute storage limit statuses' });
  }
}
