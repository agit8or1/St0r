// npm run build && node --experimental-test-module-mocks tests/endpoint-state.test.mjs
// Disabling an endpoint pauses its backups by making UrBackup's intervals
// negative; enabling must put back exactly what was there before.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// In-memory stand-ins for the endpoint_disabled / customer tables.
const rows = new Map();
let customerDisabled = 0;
const customerClients = ['pc1', 'pc2'];
let managed = 0;
const query = async (sql, params = []) => {
  if (sql.startsWith('SELECT * FROM endpoint_disabled WHERE client_id')) return rows.has(params[0]) ? [rows.get(params[0])] : [];
  if (sql.startsWith('SELECT * FROM endpoint_disabled')) return [...rows.values()];
  if (sql.startsWith('INSERT INTO endpoint_disabled')) {
    const [client_id, client_name, reason, customer_id, saved_settings, disabled_by] = params;
    rows.set(client_id, { client_id, client_name, reason, customer_id, saved_settings, disabled_by });
    return { affectedRows: 1 };
  }
  if (sql.startsWith('DELETE FROM endpoint_disabled')) { rows.delete(params[0]); return { affectedRows: 1 }; }
  if (sql.startsWith("UPDATE endpoint_disabled SET reason = 'manual'")) {
    const r = rows.get(params[0]); r.reason = 'manual'; r.customer_id = null; return { affectedRows: 1 };
  }
  if (sql.startsWith('SELECT managed FROM client_managed_mode')) return [{ managed }];
  if (sql.startsWith('UPDATE customers SET disabled = 1')) { customerDisabled = 1; return { affectedRows: 1 }; }
  if (sql.startsWith('UPDATE customers SET disabled = 0')) { customerDisabled = 0; return { affectedRows: 1 }; }
  if (sql.startsWith('SELECT client_name FROM customer_clients')) return customerClients.map(client_name => ({ client_name }));
  if (sql.startsWith("SELECT client_id, client_name FROM endpoint_disabled WHERE reason = 'customer'")) {
    return [...rows.values()].filter(r => r.reason === 'customer' && r.customer_id === params[0]);
  }
  if (sql.startsWith('SELECT disabled FROM customers')) return [{ disabled: customerDisabled }];
  throw new Error(`unexpected SQL: ${sql}`);
};

const clientsById = new Map([[1, 'pc1'], [2, 'pc2'], [3, 'pc3']]);
const fakeDb = {
  get: async (sql, params) => {
    const p = Array.isArray(params) ? params : [params];
    if (sql.startsWith('SELECT name FROM clients WHERE id')) return clientsById.has(p[0]) ? { name: clientsById.get(p[0]) } : undefined;
    const id = [...clientsById].find(([, n]) => n === p[0])?.[0];
    return id ? { id, name: p[0] } : undefined;
  },
};

// Per-client UrBackup settings as the API reports them, and every save.
const settings = new Map();
const saves = [];
const initial = () => ({
  update_freq_incr: { use: 1, value: '18000' },
  update_freq_full: { use: 2, value: '2592000' },
  update_freq_image_incr: { use: 1, value: '604800' },
  update_freq_image_full: { use: 1, value: '5184000' },
  allow_starting_full_file_backups: { use: 1, value: true },
  allow_starting_incr_file_backups: { use: 1, value: true },
  allow_starting_full_image_backups: { use: 1, value: true },
  allow_starting_incr_image_backups: { use: 4, value: false },
});
for (const id of clientsById.keys()) settings.set(String(id), initial());
// A brand-new endpoint only inherits: UrBackup reports value_group and no value.
clientsById.set(4, 'fresh');
settings.set('4', Object.fromEntries(Object.entries(initial()).map(([k, v]) => [k, { use: 1, value_group: v.value }])));

class FakeUrBackup {
  async getClientSettings(id) { return { settings: settings.get(id) }; }
  async setClientSettings(id, values, uses = {}) {
    saves.push({ id, values, uses });
    const s = settings.get(id);
    for (const [k, v] of Object.entries(values)) s[k] = { use: Number(uses[k] ?? 2), value: v };
    return { success: true };
  }
}

mock.module('../dist/utils/logger.js', { namedExports: { logger: { info() {}, warn() {}, error() {}, debug() {} } } });
mock.module('../dist/config/database.js', { namedExports: { query, pool: {} } });
mock.module('../dist/config/urbackupDb.js', { namedExports: { getUrBackupDb: async () => fakeDb } });
mock.module('../dist/services/urbackup.js', { namedExports: { UrBackupService: FakeUrBackup } });
mock.module('../dist/services/diskGuard.js', { namedExports: { diskGuard: {} } });

const svc = await import('../dist/services/endpointState.js');
const alerts = await import('../dist/services/alertRules.js');

test('a disabled interval is negative and keeps its size', () => {
  assert.equal(svc.disabledInterval('18000'), '-18000');
  assert.equal(svc.disabledInterval(''), '-86400');
  assert.equal(svc.disabledInterval('-5'), '-86400');
});

test('disable makes every interval negative and turns off the tray start buttons', async () => {
  assert.equal(await svc.disableEndpoint(1, { by: 'admin' }), true);
  const s = settings.get('1');
  for (const k of svc.INTERVAL_KEYS) assert.ok(Number(s[k].value) < -1, `${k} = ${s[k].value}`);
  for (const k of svc.TRAY_START_KEYS) assert.equal(s[k].value, '0');
  assert.equal(rows.get(1).reason, 'manual');
  // A second disable changes nothing.
  const before = saves.length;
  assert.equal(await svc.disableEndpoint(1), false);
  assert.equal(saves.length, before);
});

test('enable restores the exact values and whether each was inherited', async () => {
  assert.equal(await svc.enableEndpoint(1), true);
  const last = saves.at(-1);
  assert.equal(last.values.update_freq_incr, '18000');
  assert.equal(last.uses.update_freq_incr, '1');       // was inherited
  assert.equal(last.uses.update_freq_full, '2');       // was the endpoint's own
  assert.equal(last.values.allow_starting_incr_image_backups, '0');
  assert.equal(last.uses.allow_starting_incr_image_backups, '4');
  assert.equal(rows.has(1), false);
  assert.equal(await svc.enableEndpoint(1), false);
});

test('managed mode keeps the tray start buttons off after enabling', () => {
  const saved = initial();
  const { values, uses } = svc.restoreChanges(saved, true);
  for (const k of svc.TRAY_START_KEYS) { assert.equal(values[k], '0'); assert.equal(uses[k], '2'); }
  assert.equal(values.update_freq_full, '2592000');
});

test('a customer re-enables only the endpoints its disabling paused', async () => {
  settings.set('1', initial()); settings.set('2', initial());
  await svc.disableEndpoint(2, { reason: 'manual' });        // disabled by hand first
  const off = await svc.disableCustomer(7, 'admin');
  assert.deepEqual(off.changed, ['pc1']);
  assert.equal(rows.get(1).reason, 'customer');
  assert.equal(rows.get(2).reason, 'manual');

  const on = await svc.enableCustomer(7);
  assert.deepEqual(on.changed, ['pc1']);
  assert.equal(rows.has(1), false);
  assert.equal(rows.has(2), true, 'the hand-disabled endpoint stays disabled');
  await svc.enableEndpoint(2);
});

test('disabling by hand while the customer is disabled survives enabling the customer', async () => {
  await svc.disableCustomer(7);
  await svc.disableEndpoint(1, { reason: 'manual' });
  assert.equal(rows.get(1).reason, 'manual');
  await svc.enableCustomer(7);
  assert.equal(rows.has(1), true);
  assert.equal(rows.has(2), false);
  await svc.enableEndpoint(1);
});

test('an endpoint assigned to a disabled customer is disabled with it', async () => {
  customerDisabled = 1;
  await svc.applyCustomerState(7, 'pc3', 'admin');
  assert.equal(rows.get(3)?.reason, 'customer');
  customerDisabled = 0;
  await svc.applyCustomerState(8, 'pc1');
  assert.equal(rows.has(1), false);
  await svc.enableEndpoint(3);
});

test('disabled endpoints raise no client alerts', () => {
  const r = (type, threshold = null) => ({ id: 1, type, enabled: true, threshold });
  const now = Date.now();
  const clients = [
    { name: 'paused', disabled: true, online: false, lastseen: now - 30 * 86400e3, file_ok: false, image_ok: false, lastbackup: now - 30 * 86400e3 },
    { name: 'broken', online: false, lastseen: now - 30 * 86400e3, file_ok: false, image_ok: false, lastbackup: now - 30 * 86400e3 },
  ];
  const out = alerts.evaluateRules([r('backup_failure'), r('client_offline', 24), r('backup_old', 7)], clients, null, now);
  assert.ok(out.length >= 3);
  assert.ok(out.every(a => a.clientName === 'broken'));
});

test('an endpoint that only inherits its settings can be disabled and enabled', async () => {
  assert.equal(await svc.disableEndpoint(4), true);
  assert.equal(settings.get('4').update_freq_incr.value, '-18000');
  await svc.enableEndpoint(4);
  const last = saves.at(-1);
  assert.equal(last.values.update_freq_incr, '18000');
  assert.equal(last.uses.update_freq_incr, '1');
});
