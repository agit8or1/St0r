import { constants, Stats } from 'fs';
import { open, readlink, FileHandle } from 'fs/promises';
import { isWithin } from './safePath.js';

/** The file that was opened is not inside the folder it was meant to come from. */
export class OutsideRootError extends Error {
  constructor(readonly path: string) {
    super(`Refusing to read ${path}: it is not inside the expected folder`);
    this.name = 'OutsideRootError';
  }
}

/**
 * Open `path` read-only and confirm, from the open descriptor itself, that the
 * file it refers to lies inside `root` (which must already be a realpath).
 *
 * Checking a path with realpath() and opening it afterwards leaves a gap: any
 * directory along the way can be swapped for a symlink in between, and
 * O_NOFOLLOW only covers the last component. Here the check runs on what was
 * actually opened — the kernel's own path for the descriptor
 * (/proc/self/fd/N) — so a swap at any depth is caught. O_NONBLOCK keeps a
 * FIFO swapped in from blocking the open; callers still check the type.
 *
 * Returns the handle and its fstat; the caller owns the handle and must close it.
 */
export async function openFileWithin(path: string, root: string): Promise<{ handle: FileHandle; stats: Stats }> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    // Linux-only, like the rest of St0r. If /proc is unavailable this throws
    // and the file is not served.
    const opened = await readlink(`/proc/self/fd/${handle.fd}`);
    if (!opened.startsWith('/') || !isWithin(root, opened.replace(/ \(deleted\)$/, ''))) {
      throw new OutsideRootError(path);
    }
    const stats = await handle.stat();
    return { handle, stats };
  } catch (err) {
    await handle.close().catch(() => undefined);
    throw err;
  }
}
