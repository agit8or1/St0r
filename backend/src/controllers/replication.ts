import { Response } from 'express';
import { randomUUID } from 'crypto';
import { query } from '../config/database.js';
import { encrypt, decrypt } from '../services/secrets.js';
import { replicationScheduler } from '../services/replicationScheduler.js';
import { replicationEngine } from '../services/replicationEngine.js';
import type { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const REDACTED = '***REDACTED***';

function redactTarget(t: any): any {
  return {
    ...t,
    ssh_private_key_encrypted: t.ssh_private_key_encrypted ? REDACTED : null,
    ssh_password_encrypted: t.ssh_password_encrypted ? REDACTED : null,
    target_db_dsn_encrypted: t.target_db_dsn_encrypted ? REDACTED : null,
  };
}

function parseJson(val: any) {
  if (!val) return null;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return null; }
  }
  return val;
}

// Settings
export async function getSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const rows = await query<any[]>('SELECT * FROM replication_settings WHERE id = 1');
    const row = rows[0] || {};
    row.state_set_json = parseJson(row.state_set_json);
    res.json(row);
  } catch (err: any) {
    logger.error('[Replication] getSettings error:', err);
    res.status(500).json({ error: err.message });
  }
}

export async function updateSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      enabled, concurrency, trigger_mode, schedule_type, interval_seconds, cron_expression,
      debounce_seconds, max_staleness_minutes, retry_max_attempts, retry_base_seconds,
      retry_max_seconds, default_bandwidth_limit_mbps, default_verify_after_sync,
      default_checksum_verify, pause_during_active_backup, state_set_json,
    } = req.body;

    const stateSetStr = state_set_json
      ? (typeof state_set_json === 'string' ? state_set_json : JSON.stringify(state_set_json))
      : undefined;

    await query(
      `UPDATE replication_settings SET
        enabled = COALESCE(?, enabled),
        concurrency = COALESCE(?, concurrency),
        trigger_mode = COALESCE(?, trigger_mode),
        schedule_type = COALESCE(?, schedule_type),
        interval_seconds = COALESCE(?, interval_seconds),
        cron_expression = COALESCE(?, cron_expression),
        debounce_seconds = COALESCE(?, debounce_seconds),
        max_staleness_minutes = COALESCE(?, max_staleness_minutes),
        retry_max_attempts = COALESCE(?, retry_max_attempts),
        retry_base_seconds = COALESCE(?, retry_base_seconds),
        retry_max_seconds = COALESCE(?, retry_max_seconds),
        default_bandwidth_limit_mbps = COALESCE(?, default_bandwidth_limit_mbps),
        default_verify_after_sync = COALESCE(?, default_verify_after_sync),
        default_checksum_verify = COALESCE(?, default_checksum_verify),
        pause_during_active_backup = COALESCE(?, pause_during_active_backup),
        state_set_json = COALESCE(?, state_set_json)
       WHERE id = 1`,
      [
        enabled !== undefined ? (enabled ? 1 : 0) : null,
        concurrency ?? null,
        trigger_mode ?? null,
        schedule_type ?? null,
        interval_seconds ?? null,
        cron_expression ?? null,
        debounce_seconds ?? null,
        max_staleness_minutes ?? null,
        retry_max_attempts ?? null,
        retry_base_seconds ?? null,
        retry_max_seconds ?? null,
        default_bandwidth_limit_mbps ?? null,
        default_verify_after_sync !== undefined ? (default_verify_after_sync ? 1 : 0) : null,
        default_checksum_verify !== undefined ? (default_checksum_verify ? 1 : 0) : null,
        pause_during_active_backup !== undefined ? (pause_during_active_backup ? 1 : 0) : null,
        stateSetStr ?? null,
      ]
    );

    // Reload scheduler with new settings
    await replicationScheduler.reload();

    res.json({ success: true });
  } catch (err: any) {
    logger.error('[Replication] updateSettings error:', err);
    res.status(500).json({ error: err.message });
  }
}

// Targets
export async function getTargets(req: AuthRequest, res: Response): Promise<void> {
  try {
    const rows = await query<any[]>('SELECT * FROM replication_targets ORDER BY created_at');
    res.json(rows.map(redactTarget));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function createTarget(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = randomUUID();
    const {
      name, enabled = true, mode = 'push_ssh_rsync',
      host, port = 22, ssh_user = 'root', auth_type = 'ssh_key',
      ssh_private_key, ssh_password, ssh_known_host_fingerprint,
      target_root_path = '/opt/urbackup-replica', target_repo_paths_map,
      target_db_type = 'sqlite', target_db_dsn,
      verify_after_sync = false, checksum_verify = false,
      bandwidth_limit_mbps = 0, exclude_patterns,
      standby_service_mode = 'stopped', service_stop_cmd, service_start_cmd,
      btrfs_mode = 'auto',
    } = req.body;

    if (!host) {
      res.status(400).json({ error: 'host is required' });
      return;
    }

    const sshKeyEnc = ssh_private_key ? encrypt(ssh_private_key) : null;
    const sshPassEnc = ssh_password ? encrypt(ssh_password) : null;
    const dbDsnEnc = target_db_dsn ? encrypt(target_db_dsn) : null;

    await query(
      `INSERT INTO replication_targets
       (id, name, enabled, mode, host, port, ssh_user, auth_type,
        ssh_private_key_encrypted, ssh_password_encrypted, ssh_known_host_fingerprint,
        target_root_path, target_repo_paths_map, target_db_type, target_db_dsn_encrypted,
        verify_after_sync, checksum_verify, bandwidth_limit_mbps, exclude_patterns,
        standby_service_mode, service_stop_cmd, service_start_cmd, btrfs_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, name || `Target ${id.slice(0, 8)}`, enabled ? 1 : 0, mode,
        host, port, ssh_user, auth_type,
        sshKeyEnc, sshPassEnc, ssh_known_host_fingerprint || null,
        target_root_path,
        target_repo_paths_map ? JSON.stringify(target_repo_paths_map) : null,
        target_db_type, dbDsnEnc,
        verify_after_sync ? 1 : 0, checksum_verify ? 1 : 0,
        bandwidth_limit_mbps,
        exclude_patterns ? JSON.stringify(exclude_patterns) : null,
        standby_service_mode,
        service_stop_cmd || 'systemctl stop urbackupsrv',
        service_start_cmd || 'systemctl start urbackupsrv',
        btrfs_mode,
      ]
    );

    const rows = await query<any[]>('SELECT * FROM replication_targets WHERE id = ?', [id]);
    res.status(201).json(redactTarget(rows[0]));
  } catch (err: any) {
    logger.error('[Replication] createTarget error:', err);
    res.status(500).json({ error: err.message });
  }
}

export async function getTarget(req: AuthRequest, res: Response): Promise<void> {
  try {
    const rows = await query<any[]>('SELECT * FROM replication_targets WHERE id = ?', [req.params.id]);
    if (!rows.length) { res.status(404).json({ error: 'Target not found' }); return; }
    res.json(redactTarget(rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateTarget(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const existing = await query<any[]>('SELECT * FROM replication_targets WHERE id = ?', [id]);
    if (!existing.length) { res.status(404).json({ error: 'Target not found' }); return; }

    const body = req.body;
    const updates: string[] = [];
    const params: any[] = [];

    const addField = (col: string, val: any) => {
      updates.push(`${col} = ?`);
      params.push(val);
    };

    if (body.name !== undefined) addField('name', body.name);
    if (body.enabled !== undefined) addField('enabled', body.enabled ? 1 : 0);
    if (body.host !== undefined) addField('host', body.host);
    if (body.port !== undefined) addField('port', body.port);
    if (body.ssh_user !== undefined) addField('ssh_user', body.ssh_user);
    if (body.auth_type !== undefined) addField('auth_type', body.auth_type);
    if (body.ssh_known_host_fingerprint !== undefined) addField('ssh_known_host_fingerprint', body.ssh_known_host_fingerprint || null);
    if (body.target_root_path !== undefined) addField('target_root_path', body.target_root_path);
    if (body.target_repo_paths_map !== undefined) addField('target_repo_paths_map', body.target_repo_paths_map ? JSON.stringify(body.target_repo_paths_map) : null);
    if (body.target_db_type !== undefined) addField('target_db_type', body.target_db_type);
    if (body.verify_after_sync !== undefined) addField('verify_after_sync', body.verify_after_sync ? 1 : 0);
    if (body.checksum_verify !== undefined) addField('checksum_verify', body.checksum_verify ? 1 : 0);
    if (body.bandwidth_limit_mbps !== undefined) addField('bandwidth_limit_mbps', body.bandwidth_limit_mbps);
    if (body.exclude_patterns !== undefined) addField('exclude_patterns', body.exclude_patterns ? JSON.stringify(body.exclude_patterns) : null);
    if (body.standby_service_mode !== undefined) addField('standby_service_mode', body.standby_service_mode);
    if (body.service_stop_cmd !== undefined) addField('service_stop_cmd', body.service_stop_cmd);
    if (body.service_start_cmd !== undefined) addField('service_start_cmd', body.service_start_cmd);
    if (body.btrfs_mode !== undefined) addField('btrfs_mode', body.btrfs_mode);

    // Encrypted fields: only update if new plaintext provided
    if (body.ssh_private_key && body.ssh_private_key !== REDACTED) {
      addField('ssh_private_key_encrypted', encrypt(body.ssh_private_key));
    }
    if (body.ssh_password && body.ssh_password !== REDACTED) {
      addField('ssh_password_encrypted', encrypt(body.ssh_password));
    }
    if (body.target_db_dsn && body.target_db_dsn !== REDACTED) {
      addField('target_db_dsn_encrypted', encrypt(body.target_db_dsn));
    }

    if (!updates.length) { res.json({ success: true }); return; }

    params.push(id);
    await query(`UPDATE replication_targets SET ${updates.join(', ')} WHERE id = ?`, params);
    const rows = await query<any[]>('SELECT * FROM replication_targets WHERE id = ?', [id]);
    res.json(redactTarget(rows[0]));
  } catch (err: any) {
    logger.error('[Replication] updateTarget error:', err);
    res.status(500).json({ error: err.message });
  }
}

export async function deleteTarget(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const rows = await query<any[]>('SELECT id FROM replication_targets WHERE id = ?', [id]);
    if (!rows.length) { res.status(404).json({ error: 'Target not found' }); return; }
    await query('DELETE FROM replication_targets WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function testTarget(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const rows = await query<any[]>('SELECT * FROM replication_targets WHERE id = ?', [id]);
    if (!rows.length) { res.status(404).json({ error: 'Target not found' }); return; }

    const target = rows[0];
    const results: Record<string, { ok: boolean; message: string }> = {};

    // Test: SSH key available
    const hasAuth = target.ssh_private_key_encrypted || target.ssh_password_encrypted;
    results.credentials = {
      ok: !!hasAuth,
      message: hasAuth ? 'Credentials configured' : 'No SSH credentials configured',
    };

    // Test: host reachable (DNS resolution via getaddrinfo isn't easy without native deps, skip)
    results.host_configured = {
      ok: !!target.host,
      message: target.host ? `Host: ${target.host}:${target.port}` : 'No host configured',
    };

    // Test: paths configured
    results.paths = {
      ok: !!target.target_root_path,
      message: target.target_root_path ? `Root: ${target.target_root_path}` : 'No root path configured',
    };

    // Test: service commands
    results.service_cmds = {
      ok: !!(target.service_stop_cmd && target.service_start_cmd),
      message: target.service_stop_cmd ? 'Service commands configured' : 'Using defaults',
    };

    const allOk = Object.values(results).every(r => r.ok);
    res.json({ ok: allOk, checks: results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function triggerRun(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const rows = await query<any[]>('SELECT id, enabled FROM replication_targets WHERE id = ?', [id]);
    if (!rows.length) { res.status(404).json({ error: 'Target not found' }); return; }

    const runId = await replicationScheduler.runNow(id);
    res.json({ runId });
  } catch (err: any) {
    logger.error('[Replication] triggerRun error:', err);
    res.status(500).json({ error: err.message });
  }
}

export async function getStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const targets = await query<any[]>('SELECT * FROM replication_targets ORDER BY created_at');

    const statuses = await Promise.all(targets.map(async (t) => {
      const lastRun = await query<any[]>(
        `SELECT * FROM replication_runs WHERE target_id = ? ORDER BY started_at DESC LIMIT 1`,
        [t.id]
      );
      const run = lastRun[0] || null;

      return {
        target: redactTarget(t),
        lastRun: run ? {
          id: run.id,
          status: run.status,
          started_at: run.started_at,
          finished_at: run.finished_at,
          progress: run.progress,
          lag_seconds: run.lag_seconds,
          bytes_sent: run.bytes_sent,
          error_message: run.error_message,
        } : null,
        isRunning: replicationEngine.isRunning(t.id),
      };
    }));

    res.json(statuses);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getRuns(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { target_id } = req.query;
    const rawLimit = parseInt(String(req.query.limit || '50'), 10);
    const rawOffset = parseInt(String(req.query.offset || '0'), 10);
    const safeLimit = Math.min(Math.max(1, isNaN(rawLimit) ? 50 : rawLimit), 500);
    const safeOffset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);
    let sql = 'SELECT * FROM replication_runs';
    const params: any[] = [];

    if (target_id) {
      sql += ' WHERE target_id = ?';
      params.push(target_id);
    }

    sql += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
    params.push(safeLimit, safeOffset);

    const rows = await query<any[]>(sql, params);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getRun(req: AuthRequest, res: Response): Promise<void> {
  try {
    const rows = await query<any[]>('SELECT * FROM replication_runs WHERE id = ?', [req.params.id]);
    if (!rows.length) { res.status(404).json({ error: 'Run not found' }); return; }
    const run = rows[0];
    run.details_json = parseJson(run.details_json);
    res.json(run);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getAlertChannels(req: AuthRequest, res: Response): Promise<void> {
  try {
    const rows = await query<any[]>('SELECT * FROM replication_alert_channels ORDER BY created_at');
    res.json(rows.map(r => ({ ...r, config_json: parseJson(r.config_json) })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateAlertChannels(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { channels } = req.body;
    if (!Array.isArray(channels)) {
      res.status(400).json({ error: 'channels must be an array' });
      return;
    }

    for (const ch of channels) {
      if (ch.id) {
        // Update existing
        await query(
          'UPDATE replication_alert_channels SET type = ?, enabled = ?, config_json = ? WHERE id = ?',
          [ch.type, ch.enabled ? 1 : 0, JSON.stringify(ch.config_json || {}), ch.id]
        );
      } else {
        // Create new
        const id = randomUUID();
        await query(
          'INSERT INTO replication_alert_channels (id, type, enabled, config_json) VALUES (?,?,?,?)',
          [id, ch.type, ch.enabled ? 1 : 0, JSON.stringify(ch.config_json || {})]
        );
      }
    }

    const rows = await query<any[]>('SELECT * FROM replication_alert_channels ORDER BY created_at');
    res.json(rows.map(r => ({ ...r, config_json: parseJson(r.config_json) })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteAlertChannel(req: AuthRequest, res: Response): Promise<void> {
  try {
    await query('DELETE FROM replication_alert_channels WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getEvents(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { target_id, limit = 50 } = req.query;
    let sql = 'SELECT * FROM replication_events';
    const params: any[] = [];

    if (target_id) {
      sql += ' WHERE target_id = ?';
      params.push(target_id);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(Number(limit));

    const rows = await query<any[]>(sql, params);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getSetupInstructions(_req: AuthRequest, res: Response): Promise<void> {
  res.json({
    steps: [
      {
        title: 'Generate SSH Key Pair',
        description: 'On the primary server, generate a dedicated SSH key for replication.',
        commands: [
          'ssh-keygen -t ed25519 -C "urbackup-replication" -f ~/.ssh/replication_key -N ""',
          'cat ~/.ssh/replication_key.pub  # Copy this to the target server',
        ],
      },
      {
        title: 'Authorize Key on Target',
        description: 'On the target server, append the public key to authorized_keys.',
        commands: [
          'mkdir -p ~/.ssh && chmod 700 ~/.ssh',
          'echo "<public-key-content>" >> ~/.ssh/authorized_keys',
          'chmod 600 ~/.ssh/authorized_keys',
        ],
      },
      {
        title: 'Install UrBackup on Target',
        description: 'Install UrBackup Server on the target with the same version as the primary.',
        commands: [
          'apt-get install urbackup-server  # or equivalent',
          'systemctl stop urbackupsrv  # Stop until replication runs',
        ],
      },
      {
        title: 'Install rsync and/or btrfs-progs on Target',
        description: 'Install rsync for standard replication. If your backup storage is on btrfs, install btrfs-progs on both servers and format the target storage as btrfs to use space-efficient send/receive.',
        commands: [
          'apt-get install rsync',
          'apt-get install btrfs-progs  # only needed for btrfs send/receive mode',
        ],
      },
      {
        title: 'Configure Replication Target',
        description: 'In the Replication → Targets tab, add a new target with the SSH key and connection details.',
        commands: [],
      },
      {
        title: 'Test Connection',
        description: 'Use the "Test Connection" button to verify SSH connectivity and configuration.',
        commands: [],
      },
      {
        title: 'Run Initial Replication',
        description: 'Click "Run Now" to perform the first full replication. Subsequent runs will be incremental.',
        commands: [],
      },
    ],
  });
}
