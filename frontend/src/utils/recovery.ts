/** Durations and ages for recovery drills. */
export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function fmtAge(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '—';
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  if (sec < 48 * 3600) return `${Math.round(sec / 3600)} h`;
  return `${Math.round(sec / 86400)} days`;
}
