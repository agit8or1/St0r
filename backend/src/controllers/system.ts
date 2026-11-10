import { Request, Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';
import { runHelper, HelperMissingError } from '../utils/privileged.js';
import { existsSync, truncateSync } from 'fs';
import { readFile } from 'fs/promises';

function compareVersionStrings(latest: string, installed: string): boolean {
  const a = latest.replace(/[^0-9.]/g, '').split('.').map(Number);
  const b = installed.replace(/[^0-9.]/g, '').split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const la = a[i] || 0, lb = b[i] || 0;
    if (la > lb) return true;
    if (la < lb) return false;
  }
  return false;
}

// --- /proc-based metrics helpers ---

// CPU delta state
let prevCpuStat: { total: number; idle: number } | null = null;
let prevCpuTime = 0;

// Network delta state
let prevNetStat: { iface: string; rx: bigint; tx: bigint } | null = null;
let prevNetTime = 0;

async function readProcFile(path: string): Promise<string> {
  return readFile(path, 'utf-8');
}

async function getCpuUsage(): Promise<{ usage: number; cores: number; model: string }> {
  const [statRaw, cpuinfoRaw] = await Promise.all([
    readProcFile('/proc/stat'),
    readProcFile('/proc/cpuinfo'),
  ]);

  // Parse first cpu line: cpu user nice system idle iowait irq softirq steal ...
  const cpuLine = statRaw.split('\n').find(l => l.startsWith('cpu '));
  const fields = cpuLine!.trim().split(/\s+/).slice(1).map(Number);
  const idle = fields[3] + (fields[4] || 0); // idle + iowait
  const total = fields.reduce((a, b) => a + b, 0);

  const now = Date.now();
  let usage = 0;
  if (prevCpuStat && now > prevCpuTime) {
    const totalDelta = total - prevCpuStat.total;
    const idleDelta = idle - prevCpuStat.idle;
    usage = totalDelta > 0 ? Math.round(((totalDelta - idleDelta) / totalDelta) * 100) : 0;
  }
  prevCpuStat = { total, idle };
  prevCpuTime = now;

  const cores = (cpuinfoRaw.match(/^processor\s*:/gm) || []).length || 1;
  const modelMatch = cpuinfoRaw.match(/^model name\s*:\s*(.+)/m);
  const model = modelMatch ? modelMatch[1].trim() : 'Unknown';

  return { usage: Math.min(100, Math.max(0, usage)), cores, model };
}

async function getMemoryUsage(): Promise<{ total: number; used: number; free: number; usagePercent: number }> {
  const raw = await readProcFile('/proc/meminfo');
  const get = (key: string) => {
    const m = raw.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
    return m ? parseInt(m[1], 10) * 1024 : 0; // kB → bytes
  };
  const total = get('MemTotal');
  const available = get('MemAvailable');
  const used = total - available;
  const usagePercent = total > 0 ? Math.round((used / total) * 100) : 0;
  return { total, used, free: available, usagePercent };
}

async function getNetworkUsage(): Promise<{ iface: string; rxBytesPerSec: number; txBytesPerSec: number; linkSpeedMbps: number }> {
  const raw = await readProcFile('/proc/net/dev');
  const now = Date.now();

  // Parse all non-loopback interfaces
  let bestIface = '';
  let bestRx = BigInt(0);
  let bestTx = BigInt(0);
  for (const line of raw.split('\n').slice(2)) {
    const m = line.match(/^\s*(\w+):\s*(\d+)(?:\s+\d+){7}\s+(\d+)/);
    if (!m || m[1] === 'lo') continue;
    const rx = BigInt(m[2]);
    const tx = BigInt(m[3]);
    if (!bestIface || rx + tx > bestRx + bestTx) {
      bestIface = m[1]; bestRx = rx; bestTx = tx;
    }
  }

  let rxRate = 0;
  let txRate = 0;
  const elapsed = (now - prevNetTime) / 1000; // seconds
  if (prevNetStat && prevNetStat.iface === bestIface && elapsed > 0) {
    rxRate = Math.max(0, Number(bestRx - prevNetStat.rx) / elapsed);
    txRate = Math.max(0, Number(bestTx - prevNetStat.tx) / elapsed);
  }
  prevNetStat = { iface: bestIface, rx: bestRx, tx: bestTx };
  prevNetTime = now;

  // Read link speed: env override → sysfs → fallback 1000 Mbps
  let linkSpeedMbps = 1000;
  const envSpeed = parseInt(process.env.NETWORK_LINK_SPEED_MBPS || '', 10);
  if (envSpeed > 0) {
    linkSpeedMbps = envSpeed;
  } else {
    try {
      const speedStr = await readFile(`/sys/class/net/${bestIface}/speed`, 'utf-8');
      const parsed = parseInt(speedStr.trim(), 10);
      if (parsed > 0) linkSpeedMbps = parsed;
    } catch { /* virtual/wireless interfaces may not expose speed */ }
  }

  return { iface: bestIface || 'eth0', rxBytesPerSec: Math.round(rxRate), txBytesPerSec: Math.round(txRate), linkSpeedMbps };
}

export async function getSystemMetrics(req: Request, res: Response) {
  try {
    const [cpu, memory, network] = await Promise.all([
      getCpuUsage(),
      getMemoryUsage(),
      getNetworkUsage(),
    ]);

    const uptimeRaw = await readProcFile('/proc/uptime');
    const uptime = Math.floor(parseFloat(uptimeRaw.split(' ')[0]));
    const hostname = (await readProcFile('/proc/sys/kernel/hostname')).trim();

    res.json({ cpu, memory, network, uptime, hostname });
  } catch (error: any) {
    logger.error('Failed to get system metrics:', error);
    res.status(500).json({ error: 'Failed to get system metrics' });
  }
}

const execFileAsync = promisify(execFile);

/** Root-owned, takes no arguments; the panel's sudo rule allows exactly this. */
export const UPDATE_LAUNCHER = '/usr/local/lib/st0r/start-update';
/**
 * Installs from before the launcher existed. Their next update runs this copy
 * of the updater once, which installs the launcher and the root-owned files.
 */
export const LEGACY_UPDATE_SCRIPT = '/opt/urbackup-gui/setup/auto-update.sh';

/** The command that starts an update, or null when there is no updater at all. */
export function updateLaunchCommand(launcherInstalled: boolean, legacyExists = existsSync(LEGACY_UPDATE_SCRIPT)): [string, string[]] | null {
  if (launcherInstalled) return ['sudo', ['-n', UPDATE_LAUNCHER]];
  if (!legacyExists) return null;
  return ['sudo', [
    '-n',
    'systemd-run',
    '--unit=urbackup-gui-update',
    '--description=UrBackup GUI Update',
    '--property=StandardOutput=append:/var/log/urbackup-gui-update.log',
    '--property=StandardError=append:/var/log/urbackup-gui-update.log',
    LEGACY_UPDATE_SCRIPT,
  ]];
}

export async function triggerUpdate(req: Request, res: Response) {
  try {
    const user = (req as any).user;

    // Only admins can trigger updates
    if (!user.isAdmin) {
      res.status(403).json({ error: 'Only administrators can trigger updates' });
      return;
    }

    logger.info(`Update triggered by user: ${user.username}`);

    const launch = updateLaunchCommand(existsSync(UPDATE_LAUNCHER));
    if (!launch) {
      logger.error('Update launcher not found');
      res.status(500).json({
        error: 'Update script not found',
        message: 'The auto-update script is not installed. Re-run install.sh to restore it.'
      });
      return;
    }

    // If a previous update is still running, return success rather than failing
    try {
      const { stdout } = await execFileAsync('systemctl', ['is-active', 'urbackup-gui-update']);
      if (['active', 'activating'].includes(stdout.trim())) {
        res.json({ success: true, alreadyRunning: true, message: 'Update is already in progress' });
        return;
      }
    } catch (_e) { /* non-zero exit = not active, continue */ }

    // The launcher starts the log afresh (root-owned) and the root-owned updater
    // as a background unit, then returns; waiting for it means the first poll
    // from the page never reads a previous run's "SUCCESS". It takes no arguments.
    if (launch[1][1] !== UPDATE_LAUNCHER) {
      // Legacy install (no launcher yet; its service user still has full sudo):
      // clear the log and the previous unit here, once.
      try { truncateSync('/var/log/urbackup-gui-update.log', 0); } catch (_e) { /* not there yet */ }
      try { await execFileAsync('sudo', ['-n', 'systemctl', 'reset-failed', 'urbackup-gui-update.service']); } catch (_e) { /* no such unit */ }
    }
    try {
      await execFileAsync(launch[0], launch[1], { timeout: 30_000 });
    } catch (error: any) {
      logger.error('Failed to start update script:', error);
      res.status(500).json({ error: 'Failed to start the update', message: String(error?.stderr || error?.message || '').trim() });
      return;
    }

    logger.info('Update process started in background');

    res.json({
      success: true,
      message: 'Update process started. The service will restart automatically. This may take a few minutes.',
      note: 'You may be disconnected during the update. Please wait 1-2 minutes and refresh the page.'
    });
  } catch (error: any) {
    logger.error('Failed to trigger update:', error);
    res.status(500).json({
      error: 'Failed to trigger update',
      message: 'An internal error occurred'
    });
  }
}

export async function getUpdateLog(req: Request, res: Response) {
  try {
    const logFile = '/var/log/urbackup-gui-update.log';

    if (!existsSync(logFile)) {
      res.json({ log: '', inProgress: false });
      return;
    }

    const log = await readFile(logFile, 'utf-8');

    // Check if update is still in progress by checking the transient update unit
    let inProgress = false;
    try {
      const { stdout } = await execFileAsync('systemctl', ['is-active', 'urbackup-gui-update']);
      const status = stdout.trim();
      inProgress = status === 'active' || status === 'activating';
    } catch (_e) {
      // Non-zero exit means unit is inactive, failed, or not found — not running.
      inProgress = false;
    }

    res.json({
      log,
      inProgress,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    logger.error('Failed to get update log:', error);
    res.status(500).json({
      error: 'Failed to get update log',
      message: 'An internal error occurred'
    });
  }
}

export async function getUrBackupServerVersion(req: Request, res: Response) {
  try {
    // Installed version from dpkg
    let installed = 'unknown';
    try {
      const { stdout } = await execFileAsync('dpkg', ['-l', 'urbackup-server']);
      const m = stdout.match(/^ii\s+urbackup-server\s+([\d.]+)/m);
      if (m) installed = m[1];
    } catch (_e) { /* dpkg unavailable or package not found */ }

    // Latest from GitHub
    let latest = 'unknown';
    let updateAvailable = false;
    try {
      const resp = await fetch('https://api.github.com/repos/uroni/urbackup_backend/releases/latest', {
        headers: { 'User-Agent': 'st0r', 'Accept': 'application/vnd.github.v3+json' }
      });
      if (resp.ok) {
        const data: any = await resp.json();
        latest = (data.tag_name || '').replace(/^v/, '') || 'unknown';
        if (installed !== 'unknown' && latest !== 'unknown') {
          updateAvailable = compareVersionStrings(latest, installed);
        }
      }
    } catch (_e) { /* no network */ }

    res.json({ installed, latest, updateAvailable });
  } catch (error: any) {
    logger.error('Failed to get UrBackup server version:', error);
    res.status(500).json({ error: 'Failed to get UrBackup server version' });
  }
}

export async function triggerUrBackupServerUpdate(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    if (!user?.isAdmin) {
      res.status(403).json({ error: 'Only administrators can trigger updates' });
      return;
    }

    // Check if already running
    try {
      const { stdout } = await execFileAsync('systemctl', ['is-active', 'urbackup-server-pkg-update']);
      if (['active', 'activating'].includes(stdout.trim())) {
        res.json({ success: true, alreadyRunning: true, message: 'UrBackup update already in progress' });
        return;
      }
    } catch (_e) { /* not running */ }

    // The helper resets the unit, starts the log afresh and runs the upgrade as
    // a background unit; this waits only for the start.
    try {
      await runHelper('urbackup-server-update');
    } catch (error: any) {
      logger.error('Failed to start UrBackup server update:', error);
      res.status(error instanceof HelperMissingError ? 503 : 500).json({ error: error.message || 'Failed to start the update' });
      return;
    }

    logger.info(`UrBackup server update triggered by ${user.username}`);
    res.json({ success: true, message: 'UrBackup server update started' });
  } catch (error: any) {
    logger.error('Failed to trigger UrBackup server update:', error);
    res.status(500).json({ error: 'Failed to trigger UrBackup server update' });
  }
}

export async function getUrBackupUpdateLog(req: Request, res: Response) {
  try {
    const logFile = '/var/log/urbackup-server-update.log';
    if (!existsSync(logFile)) {
      res.json({ log: '', inProgress: false });
      return;
    }
    const log = await readFile(logFile, 'utf-8');
    let inProgress = false;
    try {
      const { stdout } = await execFileAsync('systemctl', ['is-active', 'urbackup-server-pkg-update']);
      inProgress = ['active', 'activating'].includes(stdout.trim());
    } catch (_e) { inProgress = false; }
    res.json({ log, inProgress });
  } catch (error: any) {
    logger.error('Failed to get UrBackup update log:', error);
    res.status(500).json({ error: 'Failed to get UrBackup update log' });
  }
}

export async function getUrBackupClientVersions(req: Request, res: Response) {
  try {
    const URBACKUP_API_URL = process.env.URBACKUP_API_URL || 'http://localhost:55414/x';
    const URBACKUP_USERNAME = process.env.URBACKUP_USERNAME || 'admin';
    const URBACKUP_PASSWORD = process.env.URBACKUP_PASSWORD || '';

    // Login to get a session
    const loginUrl = `${URBACKUP_API_URL}?a=login&username=${encodeURIComponent(URBACKUP_USERNAME)}&password=${encodeURIComponent(URBACKUP_PASSWORD)}`;
    const loginResp = await fetch(loginUrl);
    const loginData: any = await loginResp.json();
    if (!loginData.success) {
      throw new Error('UrBackup login failed');
    }
    const session: string = loginData.session || '';

    // Fetch status to get client list with version info
    const statusResp = await fetch(`${URBACKUP_API_URL}?a=status&ses=${encodeURIComponent(session)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'st0r' },
      body: `ses=${encodeURIComponent(session)}`,
    });
    const data: any = await statusResp.json();
    const clients = (data?.status || []).map((c: any) => ({
      id: c.id,
      name: c.name,
      online: c.online === true,
      client_version_string: c.client_version_string || null,
      os_simple: c.os_simple || null,
    }));
    res.json({ clients });
  } catch (error: any) {
    logger.error('Failed to get UrBackup client versions:', error);
    res.status(500).json({ error: 'Failed to get UrBackup client versions' });
  }
}
