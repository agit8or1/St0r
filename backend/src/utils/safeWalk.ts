import { lstat, readdir, realpath, stat } from 'fs/promises';
import { join } from 'path';
import { isWithin } from './safePath.js';

export interface WalkSkip {
  path: string;
  reason: 'outside-root' | 'loop' | 'broken-link' | 'special-file' | 'unreadable';
}

export interface WalkEntry {
  /** Path relative to the starting directory, '/'-separated: the name in the archive. */
  rel: string;
  /**
   * Absolute path to open (for a symlinked file, its real target). Open it with
   * openFileWithin — the walk is lazy and the tree may change.
   */
  path: string;
}

/**
 * Yield every regular file under `dir` (relative and absolute path), following
 * symlinks only while their real target stays inside `root`.
 *
 * UrBackup keeps client symlinks/junctions as real symlinks in the backup tree
 * (and, with incremental symlinks on, unchanged directories as links into the
 * client's .directory_pool). Following them blindly — as `zip -r` does — lets a
 * client-controlled link point the archive at another customer's backup or at
 * the server's own files, and a junction loop (`Application Data -> ..`) makes
 * it recurse forever. `root` should be the client's own storage folder.
 *
 * The walk is lazy, so what it checked can change before a file is read:
 * consumers must open each entry with openFileWithin(entry.path, realRoot),
 * which re-checks the file that was actually opened.
 */
export async function* walkFilesWithin(
  dir: string,
  root: string,
  onSkip: (skip: WalkSkip) => void = () => {},
): AsyncGenerator<WalkEntry> {
  const realRoot = await realpath(root);
  const startReal = await realpath(dir);
  if (!isWithin(realRoot, startReal)) {
    onSkip({ path: '.', reason: 'outside-root' });
    return;
  }

  // Ancestors by real path: a link back up the current branch is a loop.
  async function* walk(abs: string, rel: string, ancestors: Set<string>): AsyncGenerator<WalkEntry> {
    const entries = await readdir(abs);
    entries.sort();
    for (const name of entries) {
      const childAbs = join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;

      const l = await lstat(childAbs);
      let real = childAbs;
      let isDir = l.isDirectory();
      let isFile = l.isFile();
      if (l.isSymbolicLink()) {
        try {
          real = await realpath(childAbs);
          const s = await stat(real);
          isDir = s.isDirectory();
          isFile = s.isFile();
        } catch {
          onSkip({ path: childRel, reason: 'broken-link' });
          continue;
        }
        if (!isWithin(realRoot, real)) {
          onSkip({ path: childRel, reason: 'outside-root' });
          continue;
        }
      }

      if (isDir) {
        if (l.isSymbolicLink() && ancestors.has(real)) {
          onSkip({ path: childRel, reason: 'loop' });
          continue;
        }
        const next = new Set(ancestors);
        next.add(l.isSymbolicLink() ? real : await realpath(childAbs));
        yield* walk(childAbs, childRel, next);
      } else if (isFile) {
        // A symlinked file is opened by its (checked) target: openFileWithin
        // refuses a symlink as the last component.
        yield { rel: childRel, path: l.isSymbolicLink() ? real : childAbs };
      } else {
        onSkip({ path: childRel, reason: 'special-file' });
      }
    }
  }

  yield* walk(startReal, '', new Set([startReal]));
}
