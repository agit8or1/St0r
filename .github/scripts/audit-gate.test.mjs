// node .github/scripts/audit-gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, ScannerError } from './audit-gate.mjs';

const lock = { packages: { '': {}, 'node_modules/express': {}, 'node_modules/body-parser': {},
                           'node_modules/minimatch': { dev: true } } };
const advisory = (name, id, severity = 'high') => ({ name, severity, range: '<9', title: `${name} issue`,
                                                    url: `https://github.com/advisories/${id}` });
function report(vulns = {}) {
  return { auditReportVersion: 2, vulnerabilities: vulns,
           metadata: { vulnerabilities: {}, dependencies: { total: 3 } } };
}
const bodyParser = { 'body-parser': { via: [advisory('body-parser', 'GHSA-27r3-jxmh-p828')], nodes: ['node_modules/body-parser'] },
                     express: { via: ['body-parser'], nodes: ['node_modules/express'] } };
const minimatch = { minimatch: { via: [advisory('minimatch', 'GHSA-g3hv-75wg-m249', 'moderate')], nodes: ['node_modules/minimatch'] } };
const rule = (extra) => ({ project: 'backend', package: 'minimatch', advisory: 'GHSA-g3hv-75wg-m249',
                           reason: 'lint only', expires: '2027-01-01', devOnly: true, ...extra });

test('scanner failures are errors, never clean', () => {
  assert.throws(() => evaluate({ error: { code: 'ENOTFOUND', summary: 'registry unreachable' } }, lock, [], 'backend'), ScannerError);
  assert.throws(() => evaluate({ message: 'unexpected' }, lock, [], 'backend'), ScannerError);
  assert.throws(() => evaluate(null, lock, [], 'backend'), ScannerError);
  const empty = report();
  empty.metadata.dependencies.total = 0;
  assert.throws(() => evaluate(empty, lock, [], 'backend'), /scanned 0 dependencies/);
});

test('a clean report passes', () => {
  assert.deepEqual(evaluate(report(), lock, [], 'backend').results, []);
});

test('unlisted advisories block; propagated parents are not double counted', () => {
  const { results } = evaluate(report(bodyParser), lock, [], 'backend');
  assert.equal(results.length, 1);
  assert.deepEqual([results[0].name, results[0].id, results[0].status, results[0].exposure],
                   ['body-parser', 'GHSA-27r3-jxmh-p828', 'blocking', 'production']);
});

test('a matching, current, dev-only exception is accepted', () => {
  const { results, problems } = evaluate(report(minimatch), lock, [rule()], 'backend', '2026-11-06');
  assert.deepEqual(problems, []);
  assert.equal(results[0].status, 'accepted');
});

test('exceptions do not apply once expired, to other projects, or when the package reaches production', () => {
  assert.equal(evaluate(report(minimatch), lock, [rule()], 'backend', '2027-01-02').results[0].status, 'blocking');
  assert.equal(evaluate(report(minimatch), lock, [rule()], 'frontend', '2026-11-06').results[0].status, 'blocking');
  const prodLock = { packages: { ...lock.packages, 'node_modules/minimatch': {} } };
  const { results } = evaluate(report(minimatch), prodLock, [rule()], 'backend', '2026-11-06');
  assert.equal(results[0].status, 'blocking');
  assert.match(results[0].note, /reaches production/);
});

test('incomplete and stale exceptions are reported', () => {
  const { problems, stale } = evaluate(report(), lock, [rule({ reason: '' })], 'backend', '2026-11-06');
  assert.equal(problems.length, 1);
  assert.equal(stale.length, 1);
});
