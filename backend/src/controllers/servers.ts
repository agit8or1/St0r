import { Request, Response } from 'express';
import { query } from '../config/database.js';
import { encrypt, decrypt } from '../services/secrets.js';
import { agentGet, agentPost, pingAgent } from '../services/agentClient.js';
import { testSshConnection, installAgentViaSsh } from '../services/serverSsh.js';
import { logger } from '../utils/logger.js';
import { randomUUID } from 'crypto';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

// Also import local system functions for the "local" server
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Path to the bundled agent directory (relative to this compiled file location)
function getAgentDir(): string {
  // In production: /opt/urbackup-gui/backend/dist/controllers/ → /opt/urbackup-gui/agent
  // In dev: /home/administrator/St0r/backend/src/controllers/ → /home/administrator/St0r/agent
  const candidates = [
    resolve(__dirname, '../../../agent'),
    resolve(__dirname, '../../../../agent'),
    resolve(__dirname, '../../agent'),
  ];
  for (const c of candidates) {
    if (existsSync(c + '/install.sh')) return c;
  }
  return resolve(__dirname, '../../../agent');
}

// ---- Ensure managed_servers table exists ----
async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS managed_servers (
      id            CHAR(36)      NOT NULL,
      name          VARCHAR(255)  NOT NULL,
      is_local      TINYINT(1)    NOT NULL DEFAULT 0,
      host          VARCHAR(255)  NULL,
      agent_port    INT           NOT NULL DEFAULT 7420,
      agent_api_key_encrypted TEXT NULL,
      ssh_port      INT           NOT NULL DEFAULT 22,
      ssh_user      VARCHAR(100)  NULL,
      auth_type     ENUM('ssh_key','password') NULL,
      ssh_private_key_encrypted TEXT NULL,
      ssh_password_encrypted TEXT  NULL,
      ssh_known_host_fingerprint TEXT NULL,
      agent_installed TINYINT(1)  NOT NULL DEFAULT 0,
      last_seen     BIGINT        NULL,
      notes         TEXT          NULL,
      enabled       TINYINT(1)    NOT NULL DEFAULT 1,
      sort_order    INT           NOT NULL DEFAULT 0,
      created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Seed local server if none exist
  const rows: any[] = await query('SELECT id FROM managed_servers WHERE is_local = 1 LIMIT 1');
  if (!rows.length) {
    const id = randomUUID();
    await query(
      'INSERT INTO managed_servers (id, name, is_local, agent_installed, enabled) VALUES (?, ?, 1, 1, 1)',
      [id, 'This Server']
    );
    logger.info('[servers] Seeded local server entry');
  }
}

ensureTable().catch(e => logger.error('[servers] ensureTable failed:', e));

// ---- Helpers ----

function safeDecrypt(encrypted: string | null): string | null {
  if (!encrypted) return null;
  try { return decrypt(encrypted); } catch { return null; }
}

function buildAgentRef(row: any) {
  return {
    id: row.id,
    host: row.host,
    agent_port: row.agent_port,
    agent_api_key_encrypted: row.agent_api_key_encrypted,
    decryptedKey: safeDecrypt(row.agent_api_key_encrypted) || '',
  };
}

// Sanitize a row for API response (strip encrypted fields)
function sanitizeRow(row: any) {
  const { ssh_private_key_encrypted, ssh_password_encrypted, agent_api_key_encrypted, ...safe } = row;
  return {
    ...safe,
    has_ssh_key: !!ssh_private_key_encrypted,
    has_ssh_password: !!ssh_password_encrypted,
    has_agent_key: !!agent_api_key_encrypted,
  };
}

// ---- Controllers ----

export async function listServers(req: Request, res: Response) {
  try {
    const rows: any[] = await query('SELECT * FROM managed_servers ORDER BY is_local DESC, sort_order ASC, name ASC');
    res.json(rows.map(sanitizeRow));
  } catch (e: any) {
    logger.error('[servers] listServers:', e);
    res.status(500).json({ error: 'Failed to list servers' });
  }
}

export async function getServer(req: Request, res: Response) {
  try {
    const rows: any[] = await query('SELECT * FROM managed_servers WHERE id = ?', [req.params.id]);
    if (!rows.length) { res.status(404).json({ error: 'Server not found' }); return; }
    res.json(sanitizeRow(rows[0]));
  } catch (e: any) {
    logger.error('[servers] getServer:', e);
    res.status(500).json({ error: 'Failed to get server' });
  }
}

export async function addServer(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user?.isAdmin) { res.status(403).json({ error: 'Admins only' }); return; }

  const { name, host, agent_port, notes, ssh_port, ssh_user, auth_type, ssh_private_key, ssh_password } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  if (!host?.trim()) { res.status(400).json({ error: 'host is required' }); return; }

  try {
    const id = randomUUID();
    await query(
      `INSERT INTO managed_servers
       (id, name, is_local, host, agent_port, ssh_port, ssh_user, auth_type,
        ssh_private_key_encrypted, ssh_password_encrypted, notes, enabled)
       VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        id, name.trim(), host.trim(),
        parseInt(agent_port || '7420'),
        parseInt(ssh_port || '22'),
        ssh_user || 'root',
        auth_type || 'ssh_key',
        ssh_private_key ? encrypt(ssh_private_key) : null,
        ssh_password ? encrypt(ssh_password) : null,
        notes || null,
      ]
    );
    const rows: any[] = await query('SELECT * FROM managed_servers WHERE id = ?', [id]);
    res.status(201).json(sanitizeRow(rows[0]));
  } catch (e: any) {
    logger.error('[servers] addServer:', e);
    res.status(500).json({ error: 'Failed to add server' });
  }
}

export async function updateServer(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user?.isAdmin) { res.status(403).json({ error: 'Admins only' }); return; }

  const rows: any[] = await query('SELECT * FROM managed_servers WHERE id = ?', [req.params.id]);
  if (!rows.length) { res.status(404).json({ error: 'Server not found' }); return; }
  const existing = rows[0];

  const { name, host, agent_port, notes, ssh_port, ssh_user, auth_type, ssh_private_key, ssh_password, agent_api_key, enabled } = req.body;

  try {
    await query(
      `UPDATE managed_servers SET
        name = ?,
        host = ?,
        agent_port = ?,
        ssh_port = ?,
        ssh_user = ?,
        auth_type = ?,
        ssh_private_key_encrypted = ?,
        ssh_password_encrypted = ?,
        agent_api_key_encrypted = ?,
        notes = ?,
        enabled = ?,
        updated_at = NOW()
       WHERE id = ?`,
      [
        name?.trim() || existing.name,
        existing.is_local ? null : (host?.trim() || existing.host),
        parseInt(agent_port || existing.agent_port),
        parseInt(ssh_port || existing.ssh_port),
        ssh_user || existing.ssh_user,
        auth_type || existing.auth_type,
        ssh_private_key ? encrypt(ssh_private_key) : existing.ssh_private_key_encrypted,
        ssh_password ? encrypt(ssh_password) : existing.ssh_password_encrypted,
        agent_api_key ? encrypt(agent_api_key) : existing.agent_api_key_encrypted,
        notes !== undefined ? notes : existing.notes,
        enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
        req.params.id,
      ]
    );
    const updated: any[] = await query('SELECT * FROM managed_servers WHERE id = ?', [req.params.id]);
    res.json(sanitizeRow(updated[0]));
  } catch (e: any) {
    logger.error('[servers] updateServer:', e);
    res.status(500).json({ error: 'Failed to update server' });
  }
}

export async function deleteServer(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user?.isAdmin) { res.status(403).json({ error: 'Admins only' }); return; }

  const rows: any[] = await query('SELECT * FROM managed_servers WHERE id = ?', [req.params.id]);
  if (!rows.length) { res.status(404).json({ error: 'Server not found' }); return; }
  if (rows[0].is_local) { res.status(400).json({ error: 'Cannot delete the local server' }); return; }

  try {
    await query('DELETE FROM managed_servers WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e: any) {
    logger.error('[servers] deleteServer:', e);
    res.status(500).json({ error: 'Failed to delete server' });
  }
}

// ---- Metrics ----

export async function getMetrics(req: Request, res: Response) {
  try {
    const rows: any[] = await query('SELECT * FROM managed_servers WHERE id = ?', [req.params.id]);
    if (!rows.length) { res.status(404).json({ error: 'Server not found' }); return; }
    const server = rows[0];

    if (server.is_local) {
      // Use local /proc files (same as system.ts)
      const [statRaw, cpuinfoRaw, memRaw, netRaw, uptimeRaw, hostnameRaw] = await Promise.all([
        readFile('/proc/stat', 'utf-8'),
        readFile('/proc/cpuinfo', 'utf-8'),
        readFile('/proc/meminfo', 'utf-8'),
        readFile('/proc/net/dev', 'utf-8'),
        readFile('/proc/uptime', 'utf-8'),
        readFile('/proc/sys/kernel/hostname', 'utf-8'),
      ]);
      const { stdout: dfOut } = await execFileAsync('df', ['-B1', '/']);

      // CPU
      const cpuLine = statRaw.split('\n').find(l => l.startsWith('cpu '))!;
      const f = cpuLine.trim().split(/\s+/).slice(1).map(Number);
      const idle = f[3] + (f[4] || 0);
      const total = f.reduce((a, b) => a + b, 0);
      const cores = (cpuinfoRaw.match(/^processor\s*:/gm) || []).length || 1;
      const modelMatch = cpuinfoRaw.match(/^model name\s*:\s*(.+)/m);
      const cpu = { usage: 0, cores, model: modelMatch ? modelMatch[1].trim() : 'Unknown', _total: total, _idle: idle };

      // Memory
      const getKB = (key: string) => { const m = memRaw.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm')); return m ? parseInt(m[1]) * 1024 : 0; };
      const memTotal = getKB('MemTotal');
      const memAvail = getKB('MemAvailable');
      const memory = { total: memTotal, used: memTotal - memAvail, free: memAvail, usagePercent: memTotal > 0 ? Math.round(((memTotal - memAvail) / memTotal) * 100) : 0 };

      // Disk
      const dfLines = dfOut.trim().split('\n');
      const dfParts = dfLines[1].trim().split(/\s+/);
      const diskTotal = parseInt(dfParts[1]);
      const diskUsed = parseInt(dfParts[2]);
      const diskAvail = parseInt(dfParts[3]);
      const disk = { total: diskTotal, used: diskUsed, available: diskAvail, usagePercent: diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0 };

      // Network (simplified — no delta state in this path, just 0)
      let iface = 'eth0';
      for (const line of netRaw.split('\n').slice(2)) {
        const m = line.match(/^\s*(\w+):/);
        if (m && m[1] !== 'lo') { iface = m[1]; break; }
      }
      const network = { iface, rxBytesPerSec: 0, txBytesPerSec: 0 };

      const uptime = Math.floor(parseFloat(uptimeRaw.split(' ')[0]));

      // Update last_seen
      await query('UPDATE managed_servers SET last_seen = ? WHERE id = ?', [Date.now(), req.params.id]);

      res.json({ cpu, memory, disk, network, uptime, hostname: hostnameRaw.trim() });
      return;
    }

    // Remote: call agent
    if (!server.agent_installed || !server.agent_api_key_encrypted) {
      res.status(400).json({ error: 'Agent not installed on this server' });
      return;
    }
    const agentRef = buildAgentRef(server);
    const data = await agentGet(agentRef, '/metrics');
    await query('UPDATE managed_servers SET last_seen = ? WHERE id = ?', [Date.now(), req.params.id]);
    res.json(data);
  } catch (e: any) {
    logger.error('[servers] getMetrics:', e);
    res.status(500).json({ error: e.message || 'Failed to get metrics' });
  }
}

// ---- Test SSH ----

export async function testSsh(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user?.isAdmin) { res.status(403).json({ error: 'Admins only' }); return; }

  const rows: any[] = await query('SELECT * FROM managed_servers WHERE id = ?', [req.params.id]);
  if (!rows.length) { res.status(404).json({ error: 'Server not found' }); return; }
  const server = rows[0];
  if (server.is_local) { res.status(400).json({ error: 'Not applicable for local server' }); return; }

  const result = await testSshConnection({
    host: server.host,
    ssh_port: server.ssh_port || 22,
    ssh_user: server.ssh_user || 'root',
    auth_type: server.auth_type || 'ssh_key',
    ssh_private_key: safeDecrypt(server.ssh_private_key_encrypted) || undefined,
    ssh_password: safeDecrypt(server.ssh_password_encrypted) || undefined,
    ssh_known_host_fingerprint: server.ssh_known_host_fingerprint,
  });

  if (result.ok && result.fingerprint) {
    await query('UPDATE managed_servers SET ssh_known_host_fingerprint = ? WHERE id = ?', [result.fingerprint, server.id]);
  }

  res.json(result);
}

// ---- Install Agent ----

export async function installAgent(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user?.isAdmin) { res.status(403).json({ error: 'Admins only' }); return; }

  const rows: any[] = await query('SELECT * FROM managed_servers WHERE id = ?', [req.params.id]);
  if (!rows.length) { res.status(404).json({ error: 'Server not found' }); return; }
  const server = rows[0];
  if (server.is_local) { res.status(400).json({ error: 'Not applicable for local server' }); return; }

  if (!server.ssh_user || (!server.ssh_private_key_encrypted && !server.ssh_password_encrypted)) {
    res.status(400).json({ error: 'SSH credentials required for agent installation' });
    return;
  }

  const agentDir = getAgentDir();
  if (!existsSync(agentDir + '/install.sh')) {
    res.status(500).json({ error: `Agent files not found at ${agentDir}` });
    return;
  }

  const result = await installAgentViaSsh(
    {
      host: server.host,
      ssh_port: server.ssh_port || 22,
      ssh_user: server.ssh_user,
      auth_type: server.auth_type || 'ssh_key',
      ssh_private_key: safeDecrypt(server.ssh_private_key_encrypted) || undefined,
      ssh_password: safeDecrypt(server.ssh_password_encrypted) || undefined,
      ssh_known_host_fingerprint: server.ssh_known_host_fingerprint,
    },
    agentDir,
    server.agent_port || 7420
  );

  if (result.ok && result.apiKey) {
    await query(
      'UPDATE managed_servers SET agent_installed = 1, agent_api_key_encrypted = ?, updated_at = NOW() WHERE id = ?',
      [encrypt(result.apiKey), server.id]
    );
    logger.info(`[servers] Agent installed on ${server.host} (id: ${server.id})`);
    res.json({ success: true, message: 'Agent installed successfully' });
  } else {
    res.status(500).json({ success: false, error: result.error || 'Installation failed' });
  }
}

// ---- Manual agent key registration ----
export async function registerAgentKey(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user?.isAdmin) { res.status(403).json({ error: 'Admins only' }); return; }

  const { api_key } = req.body;
  if (!api_key?.trim()) { res.status(400).json({ error: 'api_key is required' }); return; }

  const rows: any[] = await query('SELECT * FROM managed_servers WHERE id = ?', [req.params.id]);
  if (!rows.length) { res.status(404).json({ error: 'Server not found' }); return; }
  const server = rows[0];
  if (server.is_local) { res.status(400).json({ error: 'Not applicable for local server' }); return; }

  // Verify the key works before saving
  const agentRef = buildAgentRef({ ...server, agent_api_key_encrypted: encrypt(api_key.trim()), decryptedKey: api_key.trim() });
  const pingResult = await pingAgent(agentRef);
  if (!pingResult.ok) {
    res.status(400).json({ error: `Could not connect to agent: ${pingResult.error}` });
    return;
  }

  await query(
    'UPDATE managed_servers SET agent_installed = 1, agent_api_key_encrypted = ?, updated_at = NOW() WHERE id = ?',
    [encrypt(api_key.trim()), server.id]
  );
  res.json({ success: true, latencyMs: pingResult.latencyMs });
}

// ---- Ping Agent ----
export async function pingAgentEndpoint(req: Request, res: Response) {
  const rows: any[] = await query('SELECT * FROM managed_servers WHERE id = ?', [req.params.id]);
  if (!rows.length) { res.status(404).json({ error: 'Server not found' }); return; }
  const server = rows[0];

  if (server.is_local) {
    res.json({ ok: true, latencyMs: 0 });
    return;
  }
  if (!server.agent_installed) {
    res.json({ ok: false, error: 'Agent not installed' });
    return;
  }

  const result = await pingAgent(buildAgentRef(server));
  if (result.ok) {
    await query('UPDATE managed_servers SET last_seen = ? WHERE id = ?', [Date.now(), server.id]);
  }
  res.json(result);
}

// ---- OS Updates ----

export async function getOsUpdates(req: Request, res: Response) {
  try {
    const rows: any[] = await query('SELECT * FROM managed_servers WHERE id = ?', [req.params.id]);
    if (!rows.length) { res.status(404).json({ error: 'Server not found' }); return; }
    const server = rows[0];

    if (server.is_local) {
      await execFileAsync('apt-get', ['update', '-qq']);
      const { stdout } = await execFileAsync('apt', ['list', '--upgradable', '--quiet=2']);
      const packages = stdout.trim().split('\n').filter((l: string) => l && !l.startsWith('Listing'));
      res.json({ count: packages.length, packages: packages.slice(0, 50) });
      return;
    }

    const data = await agentGet(buildAgentRef(server), '/os-updates', 30000);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

export async function triggerOsUpdate(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user?.isAdmin) { res.status(403).json({ error: 'Admins only' }); return; }

  try {
    const rows: any[] = await query('SELECT * FROM managed_servers WHERE id = ?', [req.params.id]);
    if (!rows.length) { res.status(404).json({ error: 'Server not found' }); return; }
    const server = rows[0];

    if (server.is_local) {
      const { truncateSync, existsSync: es } = await import('fs');
      const logFile = '/var/log/stor-os-update.log';
      try { await execFileAsync('systemctl', ['reset-failed', 'stor-local-os-update.service']); } catch { /* ok */ }
      try { truncateSync(logFile, 0); } catch { /* ok */ }
      execFile('sudo', [
        'systemd-run', '--unit=stor-local-os-update',
        `--property=StandardOutput=append:${logFile}`,
        `--property=StandardError=append:${logFile}`,
        '/bin/bash', '-c',
        'DEBIAN_FRONTEND=noninteractive apt-get update -q 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y 2>&1 && echo "SUCCESS: OS packages updated" || echo "FAILED: OS update failed"',
      ], (err) => { if (err) logger.error('[servers] os-update error:', err); });
      res.json({ success: true });
      return;
    }

    const data = await agentPost(buildAgentRef(server), '/os-update');
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

export async function getOsUpdateLog(req: Request, res: Response) {
  try {
    const rows: any[] = await query('SELECT * FROM managed_servers WHERE id = ?', [req.params.id]);
    if (!rows.length) { res.status(404).json({ error: 'Server not found' }); return; }
    const server = rows[0];

    if (server.is_local) {
      const logFile = '/var/log/stor-os-update.log';
      let log = '';
      try { log = await readFile(logFile, 'utf-8'); } catch { /* not exists */ }
      let inProgress = false;
      try {
        const { stdout } = await execFileAsync('systemctl', ['is-active', 'stor-local-os-update']);
        inProgress = ['active', 'activating'].includes(stdout.trim());
      } catch { /* not running */ }
      res.json({ log, inProgress });
      return;
    }

    const data = await agentGet(buildAgentRef(server), '/os-update-log');
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

// ---- Reboot ----

export async function rebootServer(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user?.isAdmin) { res.status(403).json({ error: 'Admins only' }); return; }

  try {
    const rows: any[] = await query('SELECT * FROM managed_servers WHERE id = ?', [req.params.id]);
    if (!rows.length) { res.status(404).json({ error: 'Server not found' }); return; }
    const server = rows[0];

    if (server.is_local) {
      res.json({ success: true, message: 'Rebooting in 5 seconds' });
      setTimeout(async () => {
        try { await execFileAsync('sudo', ['systemctl', 'reboot']); } catch (e) { logger.error('[servers] reboot:', e); }
      }, 5000);
      return;
    }

    const data = await agentPost(buildAgentRef(server), '/reboot');
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

// ---- St0r update (remote only — local already handled by system.ts) ----

export async function getStorVersion(req: Request, res: Response) {
  try {
    const rows: any[] = await query('SELECT * FROM managed_servers WHERE id = ?', [req.params.id]);
    if (!rows.length) { res.status(404).json({ error: 'Server not found' }); return; }
    const server = rows[0];

    if (server.is_local) {
      // Local version from version.json
      let installed = 'unknown';
      try {
        const vf = resolve(__dirname, '../../../../version.json');
        const vfAlt = resolve(__dirname, '../../../version.json');
        const vfPath = existsSync(vf) ? vf : vfAlt;
        if (existsSync(vfPath)) {
          const v = JSON.parse(await readFile(vfPath, 'utf-8'));
          installed = v.version || 'unknown';
        }
      } catch { /* ok */ }
      res.json({ installed });
      return;
    }

    const data = await agentGet(buildAgentRef(server), '/stor-version');
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

export async function triggerStorUpdate(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user?.isAdmin) { res.status(403).json({ error: 'Admins only' }); return; }

  const rows: any[] = await query('SELECT * FROM managed_servers WHERE id = ?', [req.params.id]);
  if (!rows.length) { res.status(404).json({ error: 'Server not found' }); return; }
  const server = rows[0];
  if (server.is_local) { res.status(400).json({ error: 'Use /api/system-update/update for local St0r updates' }); return; }

  try {
    const data = await agentPost(buildAgentRef(server), '/stor-update');
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

export async function getStorUpdateLog(req: Request, res: Response) {
  const rows: any[] = await query('SELECT * FROM managed_servers WHERE id = ?', [req.params.id]);
  if (!rows.length) { res.status(404).json({ error: 'Server not found' }); return; }
  const server = rows[0];
  if (server.is_local) { res.status(400).json({ error: 'Use /api/system-update/update-log for local' }); return; }

  try {
    const data = await agentGet(buildAgentRef(server), '/stor-update-log');
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

// ---- UrBackup version (remote) ----

export async function getUrBackupVersion(req: Request, res: Response) {
  const rows: any[] = await query('SELECT * FROM managed_servers WHERE id = ?', [req.params.id]);
  if (!rows.length) { res.status(404).json({ error: 'Server not found' }); return; }
  const server = rows[0];
  if (server.is_local) { res.status(400).json({ error: 'Use /api/system-update/urbackup-version for local' }); return; }

  try {
    const data = await agentGet(buildAgentRef(server), '/urbackup-version');
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
