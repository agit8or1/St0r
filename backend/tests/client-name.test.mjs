// npm run build && node tests/client-name.test.mjs
// UrBackup's add_client stores "Jen's" as "Jen''s", so the installed client's
// name never matches. Names with such characters are refused up front.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateClientName } from '../dist/utils/clientName.js';

test('ordinary names pass and are tidied', () => {
  assert.deepEqual(validateClientName('  Jen-PC  '), { name: 'Jen-PC' });
  assert.deepEqual(validateClientName('Office   laptop_2 (old)'), { name: 'Office laptop_2 (old)' });
});

test('apostrophes, quotes and folder-breaking characters are refused', () => {
  for (const n of ["PC at Jen's", 'a"b', 'a`b', 'a\\b', 'a/b', 'a:b', 'a*b', 'a?b', 'a<b', 'a>b', 'a|b']) {
    const r = validateClientName(n);
    assert.ok('error' in r, n);
  }
  assert.match(validateClientName("PC at Jen's").error, /cannot contain '/);
});

test('empty, too long, control characters and a trailing dot are refused', () => {
  for (const n of ['', '   ', undefined, 42, 'x'.repeat(65), 'a\u0001b', 'a\u007fb', 'pc.']) {
    assert.ok('error' in validateClientName(n), JSON.stringify(n));
  }
  assert.deepEqual(validateClientName('x'.repeat(64)), { name: 'x'.repeat(64) });
  assert.deepEqual(validateClientName('a\tb'), { name: 'a b' });
});
