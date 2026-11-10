import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { createWriteStream } from 'fs';
import { SshTarget, withTargetSsh, shQuote } from '../sshTarget.js';
import { DrillError } from './errors.js';

/**
 * The offsite copy of the backups: the storage St0r replicates to a second
 * UrBackup server (a replication target). Read over SSH as that target, the
 * same way replication writes it.
 */
export interface StandbyCopy {
  /** Fails with stage 'connect' when the standby cannot be reached. */
  connect(): Promise<void>;
  /** The resolved path of `path` on the standby, or null when there is no regular file there. */
  resolveFile(path: string): Promise<{ realPath: string; size: number } | null>;
  /** The resolved path of a directory, or null. */
  resolveDir(path: string): Promise<string | null>;
  /** Copy a file to `dest`, hashing it on the way. Refuses more than maxBytes. */
  fetch(path: string, dest: string, maxBytes: number): Promise<{ sha256: string; bytes: number }>;
}

export interface StandbyTarget extends SshTarget {
  id: string;
  name: string;
}

/** ssh exits 255 for its own failures (connection, authentication, host key). */
const SSH_FAILED = 255;

export class SshStandby implements StandbyCopy {
  constructor(private target: StandbyTarget, private timeoutMs = 30_000) {}

  private run(cmd: string, timeoutMs = this.timeoutMs): Promise<{ code: number; stdout: string; stderr: string }> {
    return withTargetSsh(this.target, (sshArgs) => new Promise((resolve, reject) => {
      const p = spawn('ssh', [...sshArgs, '-o', `ConnectTimeout=${Math.ceil(Math.min(timeoutMs, 30_000) / 1000)}`,
        `${this.target.ssh_user}@${this.target.host}`, cmd]);
      let stdout = ''; let stderr = '';
      const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new DrillError('timeout', `Standby ${this.target.name} did not answer within ${timeoutMs} ms`, true)); }, timeoutMs);
      p.stdout.on('data', (d) => { stdout += d; if (stdout.length > 1_000_000) p.kill(); });
      p.stderr.on('data', (d) => { stderr += d; });
      p.on('error', (e) => { clearTimeout(timer); reject(new DrillError('connect', `Cannot run ssh: ${e.message}`, false)); });
      p.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
    }));
  }

  private unreachable(stderr: string): DrillError {
    return new DrillError('connect',
      `Standby ${this.target.name} (${this.target.host}) is unreachable: ${stderr.trim().split('\n').pop() || 'ssh failed'}`, true);
  }

  async connect(): Promise<void> {
    const r = await this.run('echo st0r-drill-ok');
    if (r.code !== 0 || r.stdout.trim() !== 'st0r-drill-ok') throw this.unreachable(r.stderr);
  }

  async resolveFile(path: string): Promise<{ realPath: string; size: number } | null> {
    const r = await this.run(`p=$(realpath -e -- ${shQuote(path)}) && [ -f "$p" ] && printf '%s\\n' "$p" && stat -c %s -- "$p"`);
    if (r.code === SSH_FAILED) throw this.unreachable(r.stderr);
    if (r.code !== 0) return null;
    const [realPath, size] = r.stdout.split('\n');
    if (!realPath || !/^\d+$/.test(size ?? '')) return null;
    return { realPath, size: Number(size) };
  }

  async resolveDir(path: string): Promise<string | null> {
    const r = await this.run(`p=$(realpath -e -- ${shQuote(path)}) && [ -d "$p" ] && printf '%s\\n' "$p"`);
    if (r.code === SSH_FAILED) throw this.unreachable(r.stderr);
    if (r.code !== 0) return null;
    return r.stdout.split('\n')[0] || null;
  }

  fetch(path: string, dest: string, maxBytes: number): Promise<{ sha256: string; bytes: number }> {
    return withTargetSsh(this.target, (sshArgs) => new Promise((resolve, reject) => {
      const p = spawn('ssh', [...sshArgs, `${this.target.ssh_user}@${this.target.host}`, `cat -- ${shQuote(path)}`]);
      const hash = createHash('sha256');
      const out = createWriteStream(dest, { flags: 'wx', mode: 0o600 });
      let bytes = 0; let stderr = ''; let failed: DrillError | null = null;
      const timer = setTimeout(() => { failed = new DrillError('timeout', `Copying from ${this.target.name} took longer than ${this.timeoutMs * 4} ms`, true); p.kill('SIGKILL'); }, this.timeoutMs * 4);
      p.stdout.on('data', (d: Buffer) => {
        bytes += d.length;
        if (bytes > maxBytes) { failed = new DrillError('quota', `The file on the standby is larger than the ${maxBytes}-byte limit`, false); p.kill(); return; }
        hash.update(d);
        out.write(d);
      });
      p.stderr.on('data', (d) => { stderr += d; });
      p.on('error', (e) => { failed = new DrillError('connect', e.message, true); });
      p.on('close', (code) => {
        clearTimeout(timer);
        out.end(() => {
          if (failed) return reject(failed);
          if (code === SSH_FAILED) return reject(this.unreachable(stderr));
          if (code !== 0) return reject(new DrillError('restore', `Reading ${path} on ${this.target.name} failed: ${stderr.trim() || `exit ${code}`}`, true));
          resolve({ sha256: hash.digest('hex'), bytes });
        });
      });
    }));
  }
}
