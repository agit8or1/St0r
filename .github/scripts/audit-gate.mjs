// npm audit gate for one project directory: node .github/scripts/audit-gate.mjs backend
//
// Every advisory in the lockfile must either be fixed or be listed in
// .github/audit-exceptions.json with a reason and an expiry date. An exception marked
// devOnly stops applying the moment the vulnerable package reaches the production tree.
// A scanner that fails, returns something unexpected, or scans nothing is an error,
// never a clean result.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export class ScannerError extends Error {}

const GHSA = /GHSA(-[23456789cfghjmpqrvwx]{4}){3}/;

// Throws ScannerError unless `report` is a complete npm audit v2 report.
export function checkReport(report, lock) {
  if (!report || typeof report !== 'object') throw new ScannerError('npm audit produced no JSON report');
  if (report.error) {
    const { summary, detail, code } = report.error;
    throw new ScannerError(`npm audit failed: ${summary || detail || code || 'no detail given (registry unreachable?)'}`);
  }
  if (report.auditReportVersion !== 2 || typeof report.vulnerabilities !== 'object' || !report.metadata?.dependencies) {
    throw new ScannerError('npm audit report is not in the expected v2 format');
  }
  const locked = Object.keys(lock.packages || {}).filter(path => path !== '').length;
  if (locked > 0 && !(report.metadata.dependencies.total > 0)) {
    throw new ScannerError(`npm audit scanned 0 dependencies but the lockfile lists ${locked}`);
  }
}

// One finding per (package, advisory), with the lockfile paths it occurs at.
export function findings(report, lock) {
  const out = [];
  for (const [name, vuln] of Object.entries(report.vulnerabilities)) {
    for (const via of vuln.via) {
      if (typeof via !== 'object') continue; // propagated from a dependency; reported there
      const id = (String(via.url || '').match(GHSA) || [String(via.source)])[0];
      const nodes = vuln.nodes || [];
      const prod = nodes.filter(node => !lock.packages?.[node]?.dev);
      out.push({ name, id, severity: via.severity, range: via.range, title: via.title, nodes, prod });
    }
  }
  return out;
}

export function evaluate(report, lock, exceptions, project, today = new Date().toISOString().slice(0, 10)) {
  checkReport(report, lock);
  const rules = exceptions.filter(e => e.project === project);
  const problems = [];
  for (const rule of rules) {
    for (const key of ['package', 'advisory', 'reason', 'expires']) {
      if (!rule[key]) problems.push(`exception ${JSON.stringify(rule)} is missing "${key}"`);
    }
    if (rule.expires && !/^\d{4}-\d{2}-\d{2}$/.test(rule.expires)) problems.push(`exception ${rule.advisory}: expires must be YYYY-MM-DD`);
  }
  const used = new Set();
  const results = findings(report, lock).map(f => {
    const rule = rules.find(r => r.package === f.name && r.advisory === f.id);
    let status = 'blocking', note = '';
    if (rule) {
      used.add(rule);
      if (rule.expires < today) note = `exception expired ${rule.expires}`;
      else if (rule.devOnly && f.prod.length) note = `exception is devOnly but reaches production via ${f.prod.join(', ')}`;
      else { status = 'accepted'; note = rule.reason; }
    }
    return { ...f, status, note, exposure: f.prod.length ? 'production' : 'dev/build only' };
  });
  const stale = rules.filter(rule => !used.has(rule));
  return { results, problems, stale };
}

function main(project) {
  const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const dir = join(root, project);
  const lockPath = join(dir, 'package-lock.json');
  if (!existsSync(lockPath)) throw new ScannerError('no package-lock.json to audit');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const exceptions = JSON.parse(readFileSync(join(root, '.github/audit-exceptions.json'), 'utf8')).exceptions;

  let raw;
  try {
    raw = execFileSync('npm', ['audit', '--json', '--package-lock-only'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    raw = err.stdout; // npm audit exits non-zero when it finds anything; the report decides
    if (!raw) throw new ScannerError(`npm audit did not run: ${err.stderr || err.message}`);
  }
  let report;
  try { report = JSON.parse(raw); } catch { throw new ScannerError(`npm audit output is not JSON: ${raw.slice(0, 200)}`); }

  const { results, problems, stale } = evaluate(report, lock, exceptions, project);
  const lines = [`### npm audit: \`${project}\` (${report.metadata.dependencies.total} dependencies scanned)`, ''];
  if (results.length) {
    lines.push('| Status | Severity | Package | Advisory | Exposure | Note |', '| --- | --- | --- | --- | --- | --- |');
    for (const r of results) lines.push(`| ${r.status} | ${r.severity} | ${r.name} ${r.range} | ${r.id} | ${r.exposure} | ${r.note.replace(/\|/g, '\\|')} |`);
  } else {
    lines.push('No known advisories.');
  }
  for (const rule of stale) lines.push('', `Stale exception (no longer matches anything, remove it): ${rule.package} ${rule.advisory}`);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n\n');
  for (const rule of stale) console.log(`::warning::${project}: stale audit exception ${rule.package} ${rule.advisory}`);

  const blocking = results.filter(r => r.status === 'blocking');
  for (const p of problems) console.log(`::error::${project}: ${p}`);
  for (const r of blocking) console.log(`::error::${project}: ${r.severity} ${r.name} ${r.id} (${r.exposure})${r.note ? ' - ' + r.note : ''}: ${r.title}`);
  return blocking.length || problems.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv[2] || '.');
  } catch (err) {
    console.log(`::error::${process.argv[2]}: ${err.message}`);
    process.exitCode = 2;
  }
}
