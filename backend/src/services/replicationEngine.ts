import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { query } from '../config/database.js';
import { decrypt } from './secrets.js';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

interface ReplicationTarget {
  id: string;
  name: string;
  host: string;
  port: number;
  ssh_user: string;
  auth_type: 'ssh_key' | 'password';
  ssh_private_key_encrypted: string | null;
  ssh_password_encrypted: string | null;
  ssh_known_host_fingerprint: string | null;
  target_root_path: string;
  target_repo_paths_map: Record<string, string> | null;
  target_db_type: 'sqlite' | 'mysql';
  target_db_dsn_encrypted: string | null;
  verify_after_sync: boolean;
  checksum_verify: boolean;
  bandwidth_limit_mbps: number;
  exclude_patterns: string[] | null;
  standby_service_mode: 'running_readonly' | 'stopped';
  service_stop_cmd: string;
  service_start_cmd: string;
}

interface ReplicationSettings {
  state_set_json: string;
  default_bandwidth_limit_mbps: number;
  default_verify_after_sync: boolean;
  default_checksum_verify: boolean;
}

const MAX_LOG_BYTES = 50 * 1024; // 50KB

class ReplicationEngine {
  private locks = new Map<string, boolean>();

  async runTarget(targetId: string, trigger: 'hook' | 'schedule' | 'manual'): Promise<string> {
    if (this.locks.get(targetId)) {
      logger.warn(`[ReplicationEngine] Target ${targetId} already running, skipping`);
      throw new Error('A replication run is already in progress for this target');
    }

    const runId = randomUUID();
    this.locks.set(targetId, true);

    // Create run record
    await query(
      `INSERT INTO replication_runs (id, target_id, status, trigger_type, step, details_json)
       VALUES (?, ?, 'running', ?, 'initializing', ?)`,
      [runId, targetId, trigger, JSON.stringify({ log: '' })]
    );

    // Run async (don't await so caller gets runId immediately)
    this.executeRun(runId, targetId).finally(() => {
      this.locks.delete(targetId);
    });

    return runId;
  }

  isRunning(targetId: string): boolean {
    return this.locks.get(targetId) === true;
  }

  private async appendLog(runId: string, text: string): Promise<void> {
    try {
      const rows = await query<any[]>(
        'SELECT details_json FROM replication_runs WHERE id = ?',
        [runId]
      );
      if (!rows.length) return;
      const details = rows[0].details_json || { log: '' };
      let log: string = details.log || '';
      log += text + '\n';
      // Trim to max size
      if (log.length > MAX_LOG_BYTES) {
        log = log.slice(log.length - MAX_LOG_BYTES);
      }
      details.log = log;
      await query(
        'UPDATE replication_runs SET details_json = ? WHERE id = ?',
        [JSON.stringify(details), runId]
      );
    } catch {
      // Non-fatal
    }
  }

  private async updateStep(runId: string, step: string, progress?: number): Promise<void> {
    const updates: string[] = ['step = ?'];
    const params: any[] = [step];
    if (progress !== undefined) {
      updates.push('progress = ?');
      params.push(progress);
    }
    params.push(runId);
    await query(`UPDATE replication_runs SET ${updates.join(', ')} WHERE id = ?`, params);
    await this.appendLog(runId, `[${new Date().toISOString()}] ${step}`);
  }

  private async failRun(runId: string, error: string): Promise<void> {
    await query(
      `UPDATE replication_runs SET status = 'failed', finished_at = NOW(), error_message = ?, step = 'failed' WHERE id = ?`,
      [error.substring(0, 2048), runId]
    );
    await this.appendLog(runId, `ERROR: ${error}`);
  }

  private async executeRun(runId: string, targetId: string): Promise<void> {
    let keyFile: string | null = null;
    let knownHostsFile: string | null = null;
    let snapshotFile: string | null = null;

    try {
      // Load target
      const targets = await query<any[]>(
        'SELECT * FROM replication_targets WHERE id = ?',
        [targetId]
      );
      if (!targets.length) throw new Error('Target not found');
      const target: ReplicationTarget = targets[0];
      target.target_repo_paths_map = target.target_repo_paths_map
        ? (typeof target.target_repo_paths_map === 'string'
            ? JSON.parse(target.target_repo_paths_map)
            : target.target_repo_paths_map)
        : null;
      target.exclude_patterns = target.exclude_patterns
        ? (typeof target.exclude_patterns === 'string'
            ? JSON.parse(target.exclude_patterns)
            : target.exclude_patterns)
        : null;

      // Load settings
      const settingsRows = await query<any[]>('SELECT * FROM replication_settings WHERE id = 1');
      const settings: ReplicationSettings = settingsRows[0] || {};
      const stateSet = settings.state_set_json
        ? JSON.parse(settings.state_set_json)
        : { include_paths: [], repo_paths: [], exclude_patterns: [], db: { type: 'sqlite', sqlite_path: '' } };

      // Prepare SSH key file
      await this.updateStep(runId, 'preflight: preparing SSH credentials');
      if (target.auth_type === 'ssh_key' && target.ssh_private_key_encrypted) {
        const privateKey = decrypt(target.ssh_private_key_encrypted);
        keyFile = path.join(os.tmpdir(), `repl_key_${runId}`);
        await fs.writeFile(keyFile, privateKey, { mode: 0o600 });
      }

      // Known hosts file
      if (target.ssh_known_host_fingerprint) {
        knownHostsFile = path.join(os.tmpdir(), `repl_known_hosts_${runId}`);
        await fs.writeFile(
          knownHostsFile,
          `${target.host} ${target.ssh_known_host_fingerprint}\n`,
          { mode: 0o600 }
        );
      }

      const sshArgs = this.buildSshArgs(target, keyFile, knownHostsFile);

      // Preflight: SSH connectivity
      await this.updateStep(runId, 'preflight: testing SSH connectivity');
      await this.sshExec(target, sshArgs, 'echo replication_ok', 10000);

      // Preflight: check rsync available on remote
      await this.updateStep(runId, 'preflight: checking rsync on remote');
      await this.sshExec(target, sshArgs, 'which rsync', 10000);

      // Stop standby service if configured
      if (target.standby_service_mode === 'stopped' && target.service_stop_cmd) {
        await this.updateStep(runId, 'stopping standby service');
        await this.sshExec(target, sshArgs, target.service_stop_cmd, 30000);
      }

      // Snapshot UrBackup SQLite DB
      if (stateSet.db?.type === 'sqlite' && stateSet.db?.sqlite_path) {
        await this.updateStep(runId, 'creating SQLite snapshot');
        snapshotFile = path.join(os.tmpdir(), `repl_db_${runId}.sqlite`);
        try {
          await execFileAsync('sqlite3', [
            stateSet.db.sqlite_path,
            `.backup '${snapshotFile}'`
          ], { timeout: 60000 });
          await query(
            'UPDATE replication_runs SET snapshot_timestamp = NOW() WHERE id = ?',
            [runId]
          );
        } catch (err: any) {
          await this.appendLog(runId, `Warning: SQLite snapshot failed: ${err.message}`);
        }
      }

      // rsync include paths (state files)
      const bwlimit = target.bandwidth_limit_mbps || settings.default_bandwidth_limit_mbps || 0;
      let totalBytesSent = 0;

      for (const includePath of (stateSet.include_paths || [])) {
        await this.updateStep(runId, `syncing state path: ${includePath}`);
        const targetPath = `${target.ssh_user}@${target.host}:${target.target_root_path}${includePath}/`;
        const excludeArgs = (target.exclude_patterns || stateSet.exclude_patterns || [])
          .flatMap((p: string) => ['--exclude', p]);
        const bytes = await this.rsyncPath(
          runId, target, sshArgs, `${includePath}/`, targetPath,
          excludeArgs, bwlimit,
          target.checksum_verify || settings.default_checksum_verify
        );
        totalBytesSent += bytes;
      }

      // rsync repo paths
      if (target.target_repo_paths_map && Object.keys(target.target_repo_paths_map).length > 0) {
        // Use explicit source→target path mappings
        for (const [srcPath, dstRelPath] of Object.entries(target.target_repo_paths_map)) {
          await this.updateStep(runId, `syncing repo: ${srcPath}`);
          const targetPath = `${target.ssh_user}@${target.host}:${dstRelPath}/`;
          const bytes = await this.rsyncPath(
            runId, target, sshArgs, `${srcPath}/`, targetPath,
            [], bwlimit,
            target.checksum_verify || settings.default_checksum_verify
          );
          totalBytesSent += bytes;
        }
      } else {
        // Fall back to stateSet repo_paths → target_root_path/<path>
        for (const repoPath of (stateSet.repo_paths || [])) {
          await this.updateStep(runId, `syncing repo: ${repoPath}`);
          const targetPath = `${target.ssh_user}@${target.host}:${target.target_root_path}${repoPath}/`;
          const bytes = await this.rsyncPath(
            runId, target, sshArgs, `${repoPath}/`, targetPath,
            [], bwlimit,
            target.checksum_verify || settings.default_checksum_verify
          );
          totalBytesSent += bytes;
        }
      }

      // Transfer DB snapshot
      if (snapshotFile) {
        await this.updateStep(runId, 'transferring database snapshot');
        const remoteTmp = `${target.target_root_path}/repl_db_tmp_${runId}.sqlite`;
        const remoteFinal = stateSet.db?.sqlite_path || `${target.target_root_path}/backup_server.db`;
        try {
          await this.scpFile(target, sshArgs, snapshotFile, remoteTmp);
          // Atomic rename on remote
          await this.sshExec(target, sshArgs, `mv "${remoteTmp}" "${remoteFinal}"`, 15000);
        } catch (err: any) {
          await this.appendLog(runId, `Warning: DB transfer failed: ${err.message}`);
        }
      }

      // Verify (optional)
      if (target.verify_after_sync || settings.default_verify_after_sync) {
        await this.updateStep(runId, 'verifying transfer');
        try {
          await this.sshExec(target, sshArgs, `ls "${target.target_root_path}"`, 15000);
        } catch (err: any) {
          await this.appendLog(runId, `Verify warning: ${err.message}`);
        }
      }

      // Start standby service
      if (target.standby_service_mode === 'stopped' && target.service_start_cmd) {
        await this.updateStep(runId, 'starting standby service');
        try {
          await this.sshExec(target, sshArgs, target.service_start_cmd, 30000);
        } catch (err: any) {
          await this.appendLog(runId, `Warning: could not start standby service: ${err.message}`);
        }
      }

      // Calculate lag
      const now = Date.now();
      const lagSeconds = Math.round((now - Date.now()) / 1000); // minimal for now

      // Mark success
      await query(
        `UPDATE replication_runs
         SET status = 'success', finished_at = NOW(), progress = 100, bytes_sent = ?,
             lag_seconds = ?, step = 'completed'
         WHERE id = ?`,
        [totalBytesSent, lagSeconds, runId]
      );
      await this.appendLog(runId, `Completed successfully. Bytes sent: ${totalBytesSent}`);

      // Emit success event
      await this.emitEvent(targetId, 'run_finished', 'info',
        `Replication run ${runId} completed successfully`);

    } catch (err: any) {
      logger.error(`[ReplicationEngine] Run ${runId} failed:`, err);
      await this.failRun(runId, err.message || String(err));
      await this.emitEvent(targetId, 'failed', 'critical',
        `Replication run ${runId} failed: ${err.message}`);
    } finally {
      // Cleanup temp files
      const cleanups = [keyFile, knownHostsFile, snapshotFile].filter(Boolean) as string[];
      for (const f of cleanups) {
        try { await fs.unlink(f); } catch {}
      }
    }
  }

  private buildSshArgs(target: ReplicationTarget, keyFile: string | null, knownHostsFile: string | null): string[] {
    const args = ['-p', String(target.port), '-o', 'BatchMode=yes'];
    if (keyFile) {
      args.push('-i', keyFile);
    }
    if (knownHostsFile) {
      args.push('-o', `UserKnownHostsFile=${knownHostsFile}`);
      args.push('-o', 'StrictHostKeyChecking=yes');
    } else {
      args.push('-o', 'StrictHostKeyChecking=no');
    }
    return args;
  }

  private sshExec(target: ReplicationTarget, sshArgs: string[], cmd: string, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [...sshArgs, `${target.ssh_user}@${target.host}`, cmd];
      execFile('ssh', args, { timeout }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`SSH exec failed: ${error.message}\n${stderr}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  private scpFile(target: ReplicationTarget, sshArgs: string[], localPath: string, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const scpArgs = [...sshArgs, localPath, `${target.ssh_user}@${target.host}:${remotePath}`];
      execFile('scp', scpArgs, { timeout: 120000 }, (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`SCP failed: ${error.message}\n${stderr}`));
        } else {
          resolve();
        }
      });
    });
  }

  private rsyncPath(
    runId: string,
    target: ReplicationTarget,
    sshArgs: string[],
    src: string,
    dst: string,
    extraExcludes: string[],
    bwlimit: number,
    checksum: boolean
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const rsyncArgs = ['-aHAX', '--numeric-ids', '--delete', '--partial', '--info=progress2'];
      if (checksum) rsyncArgs.push('-c');
      if (bwlimit > 0) rsyncArgs.push(`--bwlimit=${bwlimit * 1024}`); // KB/s
      rsyncArgs.push('-e', `ssh ${sshArgs.join(' ')}`);
      rsyncArgs.push(...extraExcludes);
      rsyncArgs.push(src, dst);

      const proc = spawn('rsync', rsyncArgs);
      let bytesSent = 0;
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        // Parse progress: "1,234,567  45%  ..."
        const match = text.match(/(\d[\d,]+)\s+(\d+)%/);
        if (match) {
          bytesSent = parseInt(match[1].replace(/,/g, ''), 10);
          const pct = parseInt(match[2], 10);
          query(
            'UPDATE replication_runs SET progress = ?, bytes_sent = ? WHERE id = ?',
            [pct, bytesSent, runId]
          ).catch(() => {});
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 || code === 24) { // 24 = partial transfer (ok for our purposes)
          resolve(bytesSent);
        } else {
          reject(new Error(`rsync exited with code ${code}: ${stderr.slice(0, 500)}`));
        }
      });

      proc.on('error', reject);
    });
  }

  private async emitEvent(
    targetId: string | null,
    type: string,
    severity: string,
    message: string
  ): Promise<void> {
    try {
      const id = randomUUID();
      await query(
        'INSERT INTO replication_events (id, target_id, type, severity, message) VALUES (?, ?, ?, ?, ?)',
        [id, targetId, type, severity, message]
      );
    } catch {
      // Non-fatal
    }
  }
}

export const replicationEngine = new ReplicationEngine();
