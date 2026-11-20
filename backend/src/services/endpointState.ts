import { query } from '../config/database.js';
import { getUrBackupDb } from '../config/urbackupDb.js';
import { logger } from '../utils/logger.js';
import { UrBackupService } from './urbackup.js';
import { DisableReason, getDisabledEndpoint } from './endpointDisabledStore.js';

/**
 * Disabling an endpoint pauses its backups without touching the ones it has.
 *
 * UrBackup has no per-client "disabled" switch. It skips scheduled backups of
 * a type when that type's interval is negative (ClientMain::isUpdateFull /
 * isUpdateIncr and the image equivalents), which is also how its own web UI
 * shows an interval as disabled. The tray's "start backup" permissions are
 * turned off as well, and St0r refuses to start backups of a disabled
 * endpoint. The previous values (and whether each was the endpoint's own or
 * inherited) are saved so enabling puts back exactly what was there.
 */

export const INTERVAL_KEYS = ['update_freq_incr', 'update_freq_full', 'update_freq_image_incr', 'update_freq_image_full'] as const;
export const TRAY_START_KEYS = [
  'allow_starting_full_file_backups',
  'allow_starting_incr_file_backups',
  'allow_starting_full_image_backups',
  'allow_starting_incr_image_backups',
] as const;
const SAVED_KEYS = [...INTERVAL_KEYS, ...TRAY_START_KEYS];

export type SavedSettings = Record<string, { value: unknown; use: number }>;

/** A negative interval disables the schedule; keep the size so UrBackup's UI still shows it. */
export function disabledInterval(value: unknown): string {
  const n = parseInt(String(value ?? ''), 10);
  return `-${Number.isFinite(n) && n > 0 ? n : 86400}`;
}

/** The settings to write when disabling, from the endpoint's current ones. */
export function disableChanges(current: SavedSettings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of INTERVAL_KEYS) out[k] = disabledInterval(current[k]?.value);
  for (const k of TRAY_START_KEYS) out[k] = '0';
  return out;
}

/**
 * The settings to write back when enabling. Managed mode locks the tray's
 * start buttons on its own, so while it is on they stay off.
 */
export function restoreChanges(saved: SavedSettings, managed: boolean): { values: Record<string, string>; uses: Record<string, string> } {
  const values: Record<string, string> = {};
  const uses: Record<string, string> = {};
  for (const k of SAVED_KEYS) {
    const s = saved[k];
    if (!s) continue;
    if (managed && (TRAY_START_KEYS as readonly string[]).includes(k)) {
      values[k] = '0';
      uses[k] = '2';
      continue;
    }
    const v = s.value;
    values[k] = v === true ? '1' : v === false ? '0' : String(v ?? '');
    uses[k] = String(s.use);
  }
  return { values, uses };
}

const urbackup = new UrBackupService();

async function clientName(clientId: number): Promise<string> {
  const db = await getUrBackupDb();
  const row = await db.get<{ name: string }>('SELECT name FROM clients WHERE id = ?', [clientId]);
  if (!row) throw Object.assign(new Error(`Client ${clientId} not found`), { status: 404 });
  return row.name;
}

async function currentSettings(clientId: number): Promise<SavedSettings> {
  const raw = (await urbackup.getClientSettings(String(clientId)))?.settings || {};
  const out: SavedSettings = {};
  for (const k of SAVED_KEYS) {
    const s = raw[k];
    if (!s || typeof s !== 'object') continue;
    // An endpoint that only inherits a setting has no `value`, just `value_group`.
    if ('value' in s) out[k] = { value: s.value, use: Number(s.use) || 1 };
    else if ('value_group' in s) out[k] = { value: s.value_group, use: Number(s.use) || 1 };
  }
  if (!INTERVAL_KEYS.every(k => out[k])) throw new Error('UrBackup did not return the backup intervals for this client');
  return out;
}

export interface DisableOptions { reason?: DisableReason; customerId?: number | null; by?: string }

/** Returns false when the endpoint was already disabled. */
export async function disableEndpoint(clientId: number, opts: DisableOptions = {}): Promise<boolean> {
  const reason = opts.reason ?? 'manual';
  const name = await clientName(clientId);
  const existing = await getDisabledEndpoint(clientId);
  if (existing) {
    // Disabling by hand while the customer is disabled keeps it disabled
    // when the customer is enabled again.
    if (reason === 'manual' && existing.reason !== 'manual') {
      await query("UPDATE endpoint_disabled SET reason = 'manual', customer_id = NULL WHERE client_id = ?", [clientId]);
    }
    return false;
  }

  const saved = await currentSettings(clientId);
  // Record first: if the settings write fails half way, enabling can still
  // put back what was there.
  await query(
    'INSERT INTO endpoint_disabled (client_id, client_name, reason, customer_id, saved_settings, disabled_by) VALUES (?, ?, ?, ?, ?, ?)',
    [clientId, name, reason, opts.customerId ?? null, JSON.stringify(saved), opts.by ?? null]
  );
  try {
    const result = await urbackup.setClientSettings(String(clientId), disableChanges(saved));
    if (!result?.success) throw new Error('UrBackup did not save the settings');
  } catch (err) {
    await query('DELETE FROM endpoint_disabled WHERE client_id = ?', [clientId]).catch(() => {});
    throw err;
  }
  logger.info(`[Endpoints] Disabled ${name} (${reason})`);
  return true;
}

/** Returns false when the endpoint was not disabled. */
export async function enableEndpoint(clientId: number): Promise<boolean> {
  const row = await getDisabledEndpoint(clientId);
  if (!row) return false;
  const saved: SavedSettings = JSON.parse(row.saved_settings);
  const managedRows = await query<any[]>('SELECT managed FROM client_managed_mode WHERE client_id = ?', [String(clientId)]).catch(() => []);
  const managed = !!managedRows[0]?.managed;
  const { values, uses } = restoreChanges(saved, managed);
  const result = await urbackup.setClientSettings(String(clientId), values, uses);
  if (!result?.success) throw new Error('UrBackup did not save the settings');
  await query('DELETE FROM endpoint_disabled WHERE client_id = ?', [clientId]);
  logger.info(`[Endpoints] Enabled ${row.client_name}`);
  return true;
}

async function customerEndpoints(customerId: number): Promise<{ id: number; name: string }[]> {
  const rows = await query<{ client_name: string }[]>('SELECT client_name FROM customer_clients WHERE customer_id = ?', [customerId]);
  if (!rows.length) return [];
  const db = await getUrBackupDb();
  const out: { id: number; name: string }[] = [];
  for (const r of rows) {
    const c = await db.get<{ id: number; name: string }>(
      'SELECT id, name FROM clients WHERE name = ? AND (delete_pending IS NULL OR delete_pending = 0)', [r.client_name]
    );
    if (c) out.push(c);
  }
  return out;
}

export interface BulkResult { changed: string[]; failed: { name: string; error: string }[] }

export async function disableCustomer(customerId: number, by?: string): Promise<BulkResult> {
  const res = await query<any>('UPDATE customers SET disabled = 1, disabled_at = NOW() WHERE id = ? AND is_active = 1', [customerId]);
  if (!res.affectedRows) throw Object.assign(new Error('Customer not found'), { status: 404 });
  const out: BulkResult = { changed: [], failed: [] };
  for (const c of await customerEndpoints(customerId)) {
    try {
      if (await disableEndpoint(c.id, { reason: 'customer', customerId, by })) out.changed.push(c.name);
    } catch (err: any) {
      logger.error(`[Endpoints] Could not disable ${c.name}:`, err);
      out.failed.push({ name: c.name, error: err?.message || String(err) });
    }
  }
  return out;
}

/** Enables only the endpoints the customer's disabling turned off. */
export async function enableCustomer(customerId: number): Promise<BulkResult> {
  const res = await query<any>('UPDATE customers SET disabled = 0, disabled_at = NULL WHERE id = ? AND is_active = 1', [customerId]);
  if (!res.affectedRows) throw Object.assign(new Error('Customer not found'), { status: 404 });
  const rows = await query<{ client_id: number; client_name: string }[]>(
    "SELECT client_id, client_name FROM endpoint_disabled WHERE reason = 'customer' AND customer_id = ?", [customerId]
  );
  const out: BulkResult = { changed: [], failed: [] };
  for (const r of rows) {
    try {
      if (await enableEndpoint(Number(r.client_id))) out.changed.push(r.client_name);
    } catch (err: any) {
      logger.error(`[Endpoints] Could not enable ${r.client_name}:`, err);
      out.failed.push({ name: r.client_name, error: err?.message || String(err) });
    }
  }
  return out;
}

/** An endpoint assigned to a disabled customer is disabled with it. */
export async function applyCustomerState(customerId: number, clientName: string, by?: string): Promise<void> {
  const rows = await query<any[]>('SELECT disabled FROM customers WHERE id = ?', [customerId]);
  if (!rows[0]?.disabled) return;
  const db = await getUrBackupDb();
  const c = await db.get<{ id: number }>('SELECT id FROM clients WHERE name = ?', [clientName]);
  if (c) await disableEndpoint(c.id, { reason: 'customer', customerId, by });
}
