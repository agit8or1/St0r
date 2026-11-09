import { isAbsolute, relative, sep } from 'path';

/**
 * True when `candidate` is `base` itself or lies beneath it. Both must already
 * be resolved (realpath) — this compares strings, it does not touch the disk.
 *
 * Uses path.relative rather than startsWith so that `/data/client` does not
 * accept `/data/client-other`, and a base of `/` still works.
 */
export function isWithin(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  if (rel === '') return true;
  if (isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith('..' + sep);
}
