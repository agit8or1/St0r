import { lstat, readdir, realpath, stat } from 'fs/promises';
import { join } from 'path';
import { isWithin } from './safePath.js';

export interface WalkSkip {
  path: string;
  reason: 'outside-root' | 'loop' | 'broken-link' | 'unlistable-name' | 'special-file';
}

/**
 * Yield every regular file under `dir`, as a path relative to `dir`, following
 * symlinks only while their real target stays inside `root`.
 *
 * UrBackup keeps client symlinks/junctions as real symlinks in the backup tree
 * (and, with incremental symlinks on, unchanged directories as links into the
 * client's .directory_pool). Following them blindly — as `zip -r` does — lets a
 * client-controlled link point the archive at another customer's backup or at
 * the server's own files, and a junction loop (`Application Data -> ..`) makes
 * it recurse forever. `root` should be the client's own storage folder.
 *
 * Names containing a newline are skipped: the list is fed to `zip -@`, which
 * reads one name per line.
 */
export async function* walkFilesWithin(
  dir: string,
  root: string,
  onSkip: (skip: WalkSkip) => void = () => {},
): AsyncGenerator<string> {
  const realRoot = await realpath(root);
  const startReal = await realpath(dir);
  if (!isWithin(realRoot, startReal)) {
    onSkip({ path: '.', reason: 'outside-root' });
    return;
  }

  // Ancestors by real path: a link back up the current branch is a loop.
  async function* walk(abs: string, rel: string, ancestors: Set<string>): AsyncGenerator<string> {
    const entries = await readdir(abs);
    entries.sort();
    for (const name of entries) {
      const childAbs = join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      if (childRel.includes('\n') || childRel.includes('\r')) {
        onSkip({ path: childRel, reason: 'unlistable-name' });
        continue;
      }

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
        yield childRel;
      } else {
        onSkip({ path: childRel, reason: 'special-file' });
      }
    }
  }

  yield* walk(startReal, '', new Set([startReal]));
}
