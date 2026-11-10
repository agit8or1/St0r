import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { decrypt } from './secrets.js';

/** The SSH fields of a replication target. */
export interface SshTarget {
  host: string;
  port: number;
  ssh_user: string;
  auth_type: 'ssh_key' | 'password';
  ssh_private_key_encrypted?: string | null;
  ssh_known_host_fingerprint?: string | null;
}

/** ssh(1) options for a target: batch mode, its key, and its pinned host key when one is set. */
export function buildSshArgs(target: Pick<SshTarget, 'port'>, keyFile: string | null, knownHostsFile: string | null): string[] {
  const args = ['-p', String(target.port), '-o', 'BatchMode=yes'];
  if (keyFile) {
    args.push('-i', keyFile);
  }
  if (knownHostsFile) {
    args.push('-o', `UserKnownHostsFile=${knownHostsFile}`);
    args.push('-o', 'StrictHostKeyChecking=yes');
  } else {
    args.push('-o', 'StrictHostKeyChecking=accept-new');
  }
  return args;
}

/** The known_hosts line pinning a target's host key. ssh looks a non-standard port up as "[host]:port". */
export function knownHostsLine(target: Pick<SshTarget, 'host' | 'port'>, hostKey: string): string {
  const hostSpec = target.port && target.port !== 22 ? `[${target.host}]:${target.port}` : target.host;
  return `${hostSpec} ${hostKey}\n`;
}

/**
 * Write the target's private key and pinned host key to private temp files,
 * run `fn` with the resulting ssh options, and remove the files afterwards.
 */
export async function withTargetSsh<T>(target: SshTarget, fn: (sshArgs: string[]) => Promise<T>): Promise<T> {
  const id = randomUUID();
  let keyFile: string | null = null;
  let knownHostsFile: string | null = null;
  try {
    if (target.auth_type === 'ssh_key' && target.ssh_private_key_encrypted) {
      keyFile = path.join(os.tmpdir(), `st0r_ssh_key_${id}`);
      await fs.writeFile(keyFile, decrypt(target.ssh_private_key_encrypted), { mode: 0o600 });
    }
    if (target.ssh_known_host_fingerprint) {
      knownHostsFile = path.join(os.tmpdir(), `st0r_known_hosts_${id}`);
      await fs.writeFile(knownHostsFile, knownHostsLine(target, target.ssh_known_host_fingerprint), { mode: 0o600 });
    }
    return await fn(buildSshArgs(target, keyFile, knownHostsFile));
  } finally {
    if (keyFile) await fs.rm(keyFile, { force: true }).catch(() => undefined);
    if (knownHostsFile) await fs.rm(knownHostsFile, { force: true }).catch(() => undefined);
  }
}

/** Quote one argument for the remote shell. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
