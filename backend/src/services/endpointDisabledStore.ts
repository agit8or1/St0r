import { query } from '../config/database.js';

/**
 * Which endpoints St0r has disabled, and the UrBackup settings they had before.
 * Kept apart from endpointState.ts so UrBackupService.getClients() can read it
 * without an import cycle.
 */

export type DisableReason = 'manual' | 'customer';

export interface DisabledEndpoint {
  client_id: number;
  client_name: string;
  reason: DisableReason;
  customer_id: number | null;
  saved_settings: string;
  disabled_by: string | null;
  disabled_at: Date | string;
}

export async function ensureEndpointStateTables(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS endpoint_disabled (
      client_id INT NOT NULL PRIMARY KEY,
      client_name VARCHAR(255) NOT NULL,
      reason VARCHAR(16) NOT NULL DEFAULT 'manual',
      customer_id INT NULL,
      saved_settings TEXT NOT NULL,
      disabled_by VARCHAR(255) NULL,
      disabled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_customer (customer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // `is_active = 0` already means "deleted" for customers, so disabling is a
  // separate flag: a disabled customer stays listed and can be enabled again.
  try {
    await query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS disabled TINYINT(1) NOT NULL DEFAULT 0');
    await query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMP NULL DEFAULT NULL');
  } catch (err: any) {
    // Installs that never ran the customers migration have no table to extend.
    if (err?.code !== 'ER_NO_SUCH_TABLE') throw err;
  }
}

export async function getDisabledEndpoints(): Promise<Map<number, DisabledEndpoint>> {
  const rows = await query<DisabledEndpoint[]>('SELECT * FROM endpoint_disabled');
  return new Map(rows.map(r => [Number(r.client_id), r]));
}

export async function getDisabledEndpoint(clientId: number): Promise<DisabledEndpoint | null> {
  const rows = await query<DisabledEndpoint[]>('SELECT * FROM endpoint_disabled WHERE client_id = ?', [clientId]);
  return rows[0] ?? null;
}
