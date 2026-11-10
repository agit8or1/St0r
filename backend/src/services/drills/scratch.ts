import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { DrillError } from './errors.js';
import { ResourceLedger, RemoveOutcome } from './ledger.js';
import { ResourceRecord } from './store.js';
import { runHelper } from '../../utils/privileged.js';

/**
 * Disposable scratch storage for drills. Every run gets its own directory,
 * "run-<run id>", under the scratch root; nothing outside it is written.
 */
export function scratchRoot(): string {
  return path.resolve(process.env.STOR_DRILL_SCRATCH || path.join(os.tmpdir(), 'st0r-drills'));
}

/** Free bytes for an unprivileged writer on the filesystem holding `dir`. */
export async function freeBytes(dir: string): Promise<number> {
  const s = await fs.statfs(dir);
  return Number(s.bavail) * Number(s.bsize);
}

/** Fail with a quota error unless `needed` bytes fit, keeping `reserve` bytes (default 1 GiB) free. */
export async function assertFits(dir: string, needed: number, what: string, reserve = 1024 ** 3): Promise<void> {
  const free = await freeBytes(dir);
  if (needed + reserve > free) {
    throw new DrillError('quota',
      `${what} needs ${fmtBytes(needed)} but only ${fmtBytes(Math.max(0, free - reserve))} of scratch space is available in ${dir}`);
  }
}

export function fmtBytes(n: number): string {
  const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}

/** Create a scratch directory "run-<name>" for a run attempt (recorded in the ledger first). */
export async function createScratchDir(ledger: ResourceLedger, name: string, root = scratchRoot()): Promise<string> {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const dir = path.join(root, `run-${name}`);
  await ledger.track('scratch_dir', dir, `run-${name}`, null, () => fs.mkdir(dir, { mode: 0o700 }));
  return dir;
}

/** Removes a scratch directory, only if it is a "run-…" directory directly under the scratch root. */
export class ScratchRemover {
  constructor(private root = scratchRoot()) {}
  async remove(r: ResourceRecord): Promise<RemoveOutcome> {
    const dir = path.resolve(r.locator);
    if (path.dirname(dir) !== this.root || path.basename(dir) !== r.marker || !/^run-[0-9a-f-]{36}(-a\d{1,3})?$/.test(r.marker)) {
      return 'not_ours';
    }
    let st;
    try { st = await fs.lstat(dir); } catch (e: any) { if (e.code === 'ENOENT') return 'gone'; throw e; }
    if (!st.isDirectory() || st.isSymbolicLink()) return 'not_ours';
    await fs.rm(dir, { recursive: true, force: true });
    return 'deleted';
  }
}

/** Removes a directory made by the helper's vhd-decompress (the helper checks it too). */
export class VhdWorkdirRemover {
  async remove(r: ResourceRecord): Promise<RemoveOutcome> {
    if (!/^\/tmp\/st0r-vhd-[A-Za-z0-9]{10}$/.test(r.locator)) return 'not_ours';
    try { await fs.lstat(r.locator); } catch (e: any) { if (e.code === 'ENOENT') return 'gone'; throw e; }
    await runHelper('vhd-cleanup', [r.locator]);
    return 'deleted';
  }
}
