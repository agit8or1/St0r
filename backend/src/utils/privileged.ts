import { execFile } from 'child_process';
import { existsSync } from 'fs';

/**
 * The panel's only way to do anything as root.
 *
 * St0r runs as an unprivileged service user. /etc/sudoers.d/st0r-update lets
 * it run exactly two root-owned commands: the update launcher (no arguments)
 * and this helper, whose actions are fixed operations that validate their own
 * arguments (setup/st0r-helper.sh). There is no general `sudo <command>`.
 */
export const HELPER = '/usr/local/lib/st0r/st0r-helper';

export type HelperAction =
  | 'urbackup-server-update'
  | 'os-update'
  | 'reboot'
  | 'urbackup-cleanup'
  | 'urbackup-remove-unknown'
  | 'delete-backup'
  | 'vhd-decompress'
  | 'vhd-cleanup'
  | 'journal';

export class HelperMissingError extends Error {
  constructor() {
    super('This action needs the St0r helper, which is installed by the updater. ' +
      'Run Update Now once more (or re-run install.sh) to finish installing it.');
    this.name = 'HelperMissingError';
  }
}

/** The argv that runs a helper action. Exported for the tests. */
export function helperCommand(action: HelperAction, args: string[] = []): [string, string[]] {
  return ['sudo', ['-n', HELPER, action, ...args]];
}

export function helperInstalled(): boolean {
  return existsSync(HELPER);
}

export interface HelperResult { stdout: string; stderr: string }

/** Run a helper action to completion. Rejects (with its stderr) on a non-zero exit. */
export function runHelper(
  action: HelperAction,
  args: string[] = [],
  opts: { timeout?: number; maxBuffer?: number } = {},
): Promise<HelperResult> {
  if (!helperInstalled()) return Promise.reject(new HelperMissingError());
  const [cmd, argv] = helperCommand(action, args);
  return new Promise((resolve, reject) => {
    execFile(cmd, argv, { timeout: opts.timeout ?? 60_000, maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as Error & { stdout?: string; stderr?: string };
          e.stdout = String(stdout ?? '');
          e.stderr = String(stderr ?? '');
          if (e.stderr.trim()) e.message = `${action}: ${e.stderr.trim()}`;
          reject(e);
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      });
  });
}
