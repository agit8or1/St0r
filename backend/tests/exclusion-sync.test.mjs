// npm run build && node --experimental-test-module-mocks tests/exclusion-sync.test.mjs
// Server exclusions must reach every endpoint. UrBackup gives an endpoint one
// exclusion list (group, own value or client-reported); a Windows client
// reports its own (use=4), which hid the server's list completely.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const own = new Map();
const query = async (sql, params = []) => {
  if (sql.startsWith('SELECT patterns FROM endpoint_exclusions')) return own.has(params[0]) ? [{ patterns: own.get(params[0]) }] : [];
  if (sql.startsWith('INSERT INTO endpoint_exclusions')) { own.set(params[0], params[1]); return { affectedRows: 1 }; }
  throw new Error(`unexpected SQL: ${sql}`);
};
mock.module('../dist/utils/logger.js', { namedExports: { logger: { info() {}, warn() {}, error() {}, debug() {} } } });
mock.module('../dist/config/database.js', { namedExports: { query, pool: {} } });

const sync = await import('../dist/services/exclusionSync.js');

/** Stand-in for UrBackup: saving exclude_files makes it the endpoint's own value (use=2). */
function fakeService(settings) {
  const saves = [];
  return {
    saves,
    settings,
    async getClientSettings(id) { return { settings: { exclude_files: settings[id] } }; },
    async setClientSettings(id, s) {
      saves.push([id, s.exclude_files]);
      settings[id] = { ...settings[id], use: 2, value: s.exclude_files };
      return { success: true };
    },
    async getGroups() { return { members: Object.keys(settings).map(id => ({ id: Number(id) })) }; },
  };
}

const SERVER = ':\\Users\\*\\AppData\\Local\\Temp;*.tmp';

test('client-reported list (use=4): server exclusions are added, client ones kept', async () => {
  own.clear();
  const svc = fakeService({ 1: { use: 4, value: 'C:\\Windows;*.TMP', value_client: 'C:\\Windows;*.TMP', value_group: SERVER } });
  assert.equal(await sync.syncEndpointExclusions(svc, 1), true);
  assert.deepEqual(svc.saves, [['1', ':\\Users\\*\\AppData\\Local\\Temp;*.tmp;C:\\Windows']]);
  assert.equal(own.get(1), 'C:\\Windows');
  // Already in sync: nothing more is written.
  assert.equal(await sync.syncEndpointExclusions(svc, 1), false);
});

test('inheriting the group list (use=1) is left alone', async () => {
  own.clear();
  const svc = fakeService({ 2: { use: 1, value_group: SERVER } });
  assert.equal(await sync.syncEndpointExclusions(svc, 2), false);
  assert.equal(svc.saves.length, 0);
});

test('server exclusions added or removed later reach the endpoint', async () => {
  own.clear();
  const svc = fakeService({ 3: { use: 4, value_client: 'D:\\Games', value_group: '*.tmp;:\\Users\\User\\Nextcloud4' } });
  await sync.syncEndpointExclusions(svc, 3);
  svc.settings[3].value_group = '*.tmp;:\\Users\\User\\Nextcloud3';
  assert.equal(await sync.syncAllExclusions(svc), 1);
  assert.equal(svc.settings[3].value, '*.tmp;:\\Users\\User\\Nextcloud3;D:\\Games');
});

test('editing an endpoint keeps server exclusions even if removed from the form', async () => {
  own.clear();
  const svc = fakeService({ 4: { use: 2, value: SERVER, value_group: SERVER } });
  const saved = await sync.setEndpointExclusions(svc, 4, '*.tmp;E:\\Scratch');
  assert.equal(saved, ':\\Users\\*\\AppData\\Local\\Temp;*.tmp;E:\\Scratch');
  assert.equal(own.get(4), 'E:\\Scratch');
});

test('a client that switched back to its own list is corrected', async () => {
  own.clear();
  own.set(5, 'E:\\Scratch');
  const svc = fakeService({ 5: { use: 4, value: 'x', value_client: 'C:\\Windows', value_group: '*.tmp' } });
  assert.equal(await sync.syncEndpointExclusions(svc, 5), true);
  assert.equal(svc.settings[5].value, '*.tmp;E:\\Scratch');
});
