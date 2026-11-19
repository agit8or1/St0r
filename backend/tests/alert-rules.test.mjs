// npm run build && node --experimental-test-module-mocks tests/alert-rules.test.mjs
// Issue #27: Alerts page rules were kept in React state only and never saved.
// Checks that rules round-trip through the (mocked) database, that validation
// rejects bad input, and that the evaluator fires on the right clients.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Tiny in-memory stand-in for the two tables the service uses.
const rules = new Map();
const state = new Map();
async function query(sql, params = []) {
  const s = sql.replace(/\s+/g, ' ').trim();
  if (s.startsWith('CREATE TABLE')) return [];
  if (s.startsWith('INSERT IGNORE INTO alert_rules')) {
    const [type, name, enabled, threshold, ne, np, to] = params;
    if (!rules.has(type)) rules.set(type, { type, name, enabled, threshold, notify_email: ne, notify_pushover: np, email_to: to });
    return [];
  }
  if (s.startsWith('INSERT INTO alert_rules')) {
    const [type, name, enabled, threshold, ne, np, to] = params;
    rules.set(type, { type, name, enabled, threshold, notify_email: ne, notify_pushover: np, email_to: to });
    return [];
  }
  if (s === 'SELECT * FROM alert_rules') return [...rules.values()];
  if (s.startsWith('DELETE FROM alert_state WHERE rule_type')) {
    for (const [k, v] of state) if (v === params[0]) state.delete(k);
    return [];
  }
  throw new Error(`unexpected SQL: ${s}`);
}
mock.module('../dist/config/database.js', { namedExports: { query, pool: {} } });
mock.module('../dist/utils/logger.js', { namedExports: { logger: { info() {}, warn() {}, debug() {}, error() {} } } });
mock.module('../dist/services/urbackup.js', { namedExports: { UrBackupService: class {} } });
mock.module('../dist/services/diskGuard.js', { namedExports: { diskGuard: {} } });

const svc = await import('../dist/services/alertRules.js');

test('edited rules persist and are returned on reload', async () => {
  await svc.ensureAlertTables();
  assert.equal((await svc.getAlertRules()).length, 4);

  await svc.updateAlertRule('client_offline', { threshold: 48, notifyPushover: true, emailTo: 'ops@example.invalid' });
  await svc.updateAlertRule('storage_low', { enabled: true });
  // Restart: defaults are inserted with INSERT IGNORE and must not clobber edits.
  await svc.ensureAlertTables();

  const reloaded = await svc.getAlertRules();
  const offline = reloaded.find(r => r.type === 'client_offline');
  assert.equal(offline.threshold, 48);
  assert.equal(offline.notifyPushover, true);
  assert.equal(offline.emailTo, 'ops@example.invalid');
  assert.equal(reloaded.find(r => r.type === 'storage_low').enabled, true);
});

test('validation rejects bad updates', () => {
  assert.equal(svc.validateRuleUpdate('client_offline', { threshold: 12 }), null);
  assert.match(svc.validateRuleUpdate('nope', {}), /Unknown/);
  assert.match(svc.validateRuleUpdate('storage_low', { threshold: 150 }), /between/);
  assert.match(svc.validateRuleUpdate('backup_old', { threshold: 1.5 }), /whole number/);
  assert.match(svc.validateRuleUpdate('backup_failure', { threshold: 5 }), /no threshold/);
  assert.match(svc.validateRuleUpdate('backup_old', { enabled: 'yes' }), /true or false/);
  assert.match(svc.validateRuleUpdate('backup_old', { emailTo: 'a@b\r\nBcc: x@y' }), /Invalid/);
  assert.match(svc.validateRuleUpdate('backup_old', { name: '' }), /name/);
});

test('evaluator fires on the right clients', () => {
  const now = Date.UTC(2026, 10, 19);
  const H = 3600e3, D = 24 * H;
  const r = (type, threshold, enabled = true) =>
    ({ type, name: type, enabled, threshold, notifyEmail: false, notifyPushover: false, emailTo: '' });
  const clients = [
    { name: 'ok', online: true, file_ok: true, image_ok: true, lastseen: now, lastbackup: now - D, lastbackup_image: now - D },
    { name: 'failing', online: true, file_ok: false, image_ok: false, lastseen: now, lastbackup: now - 10 * D, lastbackup_image: null },
    // image backups disabled → only file status counts (issue #14)
    { name: 'fileonly', online: false, file_ok: true, image_ok: false, image_backups_disabled: true, lastseen: now - 30 * H, lastbackup: now - 2 * D },
    { name: 'briefly-offline', online: false, file_ok: true, image_ok: true, lastseen: now - 2 * H, lastbackup: now - D },
  ];
  const alerts = svc.evaluateRules(
    [r('backup_failure', null), r('client_offline', 24), r('storage_low', 90), r('backup_old', 7)],
    clients, 91.5, now);
  assert.deepEqual(alerts.map(a => a.key).sort(), [
    'backup_failure:failing', 'backup_old:failing', 'client_offline:fileonly', 'storage_low:server',
  ]);

  // Disabled rules and storage under threshold produce nothing.
  assert.deepEqual(svc.evaluateRules([r('backup_failure', null, false), r('storage_low', 95)], clients, 91.5, now), []);
});
