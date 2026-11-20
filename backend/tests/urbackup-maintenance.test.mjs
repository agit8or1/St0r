// npm run build && node --experimental-test-module-mocks tests/urbackup-maintenance.test.mjs
// Endpoint removal and the daily UrBackup server update: when a purge may start,
// and when the scheduled update runs, waits or is skipped. Mocks DB/logger/helper.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

mock.module('../dist/utils/logger.js', { namedExports: { logger: { info() {}, warn() {}, error() {}, debug() {} } } });
mock.module('../dist/config/database.js', { namedExports: { query: async () => [], pool: {} } });
mock.module('../dist/config/urbackupDb.js', { namedExports: { getUrBackupDb: async () => ({}) } });
mock.module('../dist/utils/privileged.js', { namedExports: { runHelper: async () => ({ stdout: '', stderr: '' }) } });
mock.module('../dist/services/urbackup.js', { namedExports: { UrBackupService: class {} } });

const { purgeBlocker } = await import('../dist/services/clientRemoval.js');
const { decide, windowKey, validateConfig } = await import('../dist/services/urbackupAutoUpdate.js');

test('purge only starts when no flagged client is connected and nothing is backing up', () => {
  const pending = [{ id: 2, name: 'Jen' }];
  assert.equal(purgeBlocker(pending, [{ id: 1, name: 'Home', online: true }, { id: 2, name: 'Jen', online: false }], []), null);
  assert.match(purgeBlocker(pending, [{ id: 2, name: 'Jen', online: true }], []), /Jen still connected/);
  assert.match(purgeBlocker(pending, [{ id: 2, name: 'Jen', online: false }], [{ id: 'x' }]), /backup is running/);
  assert.match(purgeBlocker([], [], []), /no client is waiting/);
});

test('removal never deletes the client row itself', () => {
  // UrBackup's cleanup finds the backups to delete through the client row.
  const src = readFileSync(new URL('../src/services/urbackupDb.ts', import.meta.url), 'utf-8')
    + readFileSync(new URL('../src/services/urbackup.ts', import.meta.url), 'utf-8')
    + readFileSync(new URL('../src/services/clientRemoval.ts', import.meta.url), 'utf-8');
  assert.doesNotMatch(src, /DELETE\s+FROM\s+clients\b/i);
});

const at = (h, m = 0, day = 19) => new Date(2026, 10, day, h, m);
const cfg = { enabled: true, hour: 4 };
const fresh = { lastDate: null, lastRunAt: null, lastResult: null };

test('scheduled update runs inside its window, waits for backups, then skips', () => {
  assert.equal(decide(at(3, 50), cfg, fresh, false), 'idle');
  assert.equal(decide(at(4, 0), cfg, fresh, false), 'run');
  assert.equal(decide(at(6, 59), cfg, fresh, false), 'run');
  assert.equal(decide(at(5, 0), cfg, fresh, true), 'wait');
  assert.equal(decide(at(7, 10), cfg, fresh, true), 'skip');
  assert.equal(decide(at(8, 10), cfg, fresh, false), 'idle');
  assert.equal(decide(at(5, 0), { ...cfg, enabled: false }, fresh, false), 'idle');
  // Done for today's window: nothing more until tomorrow's.
  const done = { ...fresh, lastDate: windowKey(at(4, 10), cfg) };
  assert.equal(decide(at(5, 0), cfg, done, false), 'idle');
  assert.equal(decide(at(4, 0, 20), cfg, done, false), 'run');
});

test('a window that crosses midnight belongs to the day it started', () => {
  const late = { enabled: true, hour: 23 };
  assert.equal(windowKey(at(23, 30), late), windowKey(at(1, 30, 20), late));
  assert.equal(decide(at(1, 30, 20), late, fresh, false), 'run');
  const skipped = { ...fresh, lastDate: windowKey(at(2, 10, 20), late) };
  // The skip recorded at 02:10 on the 20th must not suppress that evening's window.
  assert.equal(decide(at(23, 0, 20), late, skipped, false), 'run');
});

test('settings validation', () => {
  assert.equal(validateConfig({ enabled: false, hour: 0 }), null);
  assert.match(validateConfig({ hour: 24 }), /0 to 23/);
  assert.match(validateConfig({ hour: 1.5 }), /0 to 23/);
  assert.match(validateConfig({ enabled: 'yes' }), /true or false/);
});
