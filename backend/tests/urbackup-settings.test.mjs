// npm run build && node tests/urbackup-settings.test.mjs
// Issue #57: settings an endpoint inherits from its group come back from
// UrBackup with value_group and no value. St0r showed its own defaults instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenClientSettings, validateGroupName } from '../dist/utils/urbackupSettings.js';

test('inherited settings take the group value', () => {
  const { settings, inherited, useValues } = flattenClientSettings({
    max_file_full: { use: 1, value_group: 1 },
    min_file_full: { use: 2, value: 1, value_group: 2 },
    default_dirs: { use: 3, value: 'C:\\Users|Users', value_group: 'D:\\' },
    memberof: 2,
    alert_scripts: [{ id: 1 }],
  });
  assert.equal(settings.max_file_full, 1);
  assert.equal(settings.min_file_full, 1);
  assert.equal(settings.default_dirs, 'C:\\Users|Users');
  assert.equal(settings.memberof, 2);
  assert.equal('alert_scripts' in settings, false);
  assert.deepEqual(inherited, ['max_file_full']);
  assert.equal(useValues.default_dirs, 3);
});

test('group names', () => {
  assert.deepEqual(validateGroupName('  Office   PCs '), { name: 'Office PCs' });
  assert.ok('error' in validateGroupName(''));
  assert.ok('error' in validateGroupName("Jen's"));
  assert.ok('error' in validateGroupName('x'.repeat(65)));
});
