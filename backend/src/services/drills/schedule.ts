import { DrillDef } from './sources.js';

/** One cron field ("*", "5", "1,15", "*\/10", "8-17"). */
function fieldMatches(expr: string, value: number, min: number, max: number): boolean {
  return expr.split(',').some((part) => {
    const [range, stepStr] = part.split('/');
    const step = stepStr === undefined ? 1 : Number(stepStr);
    if (!Number.isInteger(step) || step < 1) return false;
    let lo: number; let hi: number;
    if (range === '*') { lo = min; hi = max; }
    else if (/^\d+-\d+$/.test(range)) { [lo, hi] = range.split('-').map(Number); }
    else if (/^\d+$/.test(range)) { lo = Number(range); hi = stepStr === undefined ? lo : max; }
    else return false;
    return value >= lo && value <= hi && (value - lo) % step === 0;
  });
}

/** Five-field cron (minute hour day-of-month month day-of-week), local time. */
export function cronMatches(expr: string, at: Date): boolean {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return false;
  return fieldMatches(f[0], at.getMinutes(), 0, 59) && fieldMatches(f[1], at.getHours(), 0, 23)
    && fieldMatches(f[2], at.getDate(), 1, 31) && fieldMatches(f[3], at.getMonth() + 1, 1, 12)
    && (fieldMatches(f[4], at.getDay(), 0, 7) || (at.getDay() === 0 && fieldMatches(f[4], 7, 0, 7)));
}

export function validCron(expr: unknown): boolean {
  if (typeof expr !== 'string') return false;
  const f = expr.trim().split(/\s+/);
  const ranges: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  return f.length === 5 && f.every((x, i) => x.split(',').every((p) => {
    const [r, s] = p.split('/');
    if (s !== undefined && !/^\d+$/.test(s)) return false;
    if (r === '*') return true;
    const nums = r.split('-');
    if (nums.length > 2 || !nums.every((n) => /^\d+$/.test(n))) return false;
    return nums.every((n) => Number(n) >= ranges[i][0] && Number(n) <= ranges[i][1]);
  }));
}

/** Whether a drill is due at `now` (checked once a minute). */
export function isDue(d: DrillDef, now: Date): boolean {
  if (!d.enabled) return false;
  if (d.schedule_type === 'interval') {
    if (!d.last_run_at) return true;
    return now.getTime() - d.last_run_at.getTime() >= Math.max(1, d.interval_hours) * 3600_000;
  }
  if (d.schedule_type === 'cron') {
    if (!cronMatches(d.cron_expression, now)) return false;
    // Once per matching minute, even if the check runs twice in it.
    return !d.last_run_at || now.getTime() - d.last_run_at.getTime() >= 60_000;
  }
  return false;
}
