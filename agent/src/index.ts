import 'dotenv/config';
import express from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import { createServer } from 'http';

const execFileAsync = promisify(execFile);

const CONFIG_DIR = process.env.STOR_AGENT_CONFIG_DIR || '/etc/stor-agent';
const CONFIG_FILE = `${CONFIG_DIR}/config.json`;
const LOG_DIR = '/var/log';

interface AgentConfig {
  api_key: string;
  port: number;
  allowed_ips: string[];
}

function loadOrCreateConfig(): AgentConfig {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  if (existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as AgentConfig;
    } catch {
      // fall through to create new
    }
  }
  const config: AgentConfig = {
    api_key: randomBytes(32).toString('hex'),
    port: parseInt(process.env.STOR_AGENT_PORT || '7420', 10),
    allowed_ips: [],
  };
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  console.log(`[stor-agent] New API key generated. Config saved to ${CONFIG_FILE}`);
  console.log(`[stor-agent] API_KEY=${config.api_key}`);
  return config;
}

const config = loadOrCreateConfig();
const PORT = parseInt(process.env.PORT || String(config.port), 10);

// ---------- /proc helpers ----------

let prevCpuStat: { total: number; idle: number } | null = null;
let prevNetStat: { iface: string; rx: bigint; tx: bigint } | null = null;
let prevNetTime = 0;

async function getCpu() {
  const [stat, cpuinfo] = await Promise.all([
    readFile('/proc/stat', 'utf-8'),
    readFile('/proc/cpuinfo', 'utf-8'),
  ]);
  const line = stat.split('\n').find(l => l.startsWith('cpu '))!;
  const f = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = f[3] + (f[4] || 0);
  const total = f.reduce((a, b) => a + b, 0);
  let usage = 0;
  if (prevCpuStat) {
    const dt = total - prevCpuStat.total;
    const di = idle - prevCpuStat.idle;
    usage = dt > 0 ? Math.round(((dt - di) / dt) * 100) : 0;
  }
  prevCpuStat = { total, idle };
  const cores = (cpuinfo.match(/^processor\s*:/gm) || []).length || 1;
  const modelMatch = cpuinfo.match(/^model name\s*:\s*(.+)/m);
  return { usage: Math.min(100, Math.max(0, usage)), cores, model: modelMatch ? modelMatch[1].trim() : 'Unknown' };
}

async function getMemory() {
  const raw = await readFile('/proc/meminfo', 'utf-8');
  const get = (k: string) => { const m = raw.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm')); return m ? parseInt(m[1]) * 1024 : 0; };
  const total = get('MemTotal');
  const available = get('MemAvailable');
  const used = total - available;
  return { total, used, free: available, usagePercent: total > 0 ? Math.round((used / total) * 100) : 0 };
}

async function getNetwork() {
  const raw = await readFile('/proc/net/dev', 'utf-8');
  const now = Date.now();
  let bestIface = '', bestRx = BigInt(0), bestTx = BigInt(0);
  for (const line of raw.split('\n').slice(2)) {
    const m = line.match(/^\s*(\w+):\s*(\d+)(?:\s+\d+){7}\s+(\d+)/);
    if (!m || m[1] === 'lo') continue;
    const rx = BigInt(m[2]), tx = BigInt(m[3]);
    if (!bestIface || rx + tx > bestRx + bestTx) { bestIface = m[1]; bestRx = rx; bestTx = tx; }
  }
  let rxRate = 0, txRate = 0;
  const elapsed = (now - prevNetTime) / 1000;
  if (prevNetStat && prevNetStat.iface === bestIface && elapsed > 0) {
    rxRate = Math.max(0, Number(bestRx - prevNetStat.rx) / elapsed);
    txRate = Math.max(0, Number(bestTx - prevNetStat.tx) / elapsed);
  }
  prevNetStat = { iface: bestIface, rx: bestRx, tx: bestTx };
  prevNetTime = now;
  return { iface: bestIface || 'eth0', rxBytesPerSec: Math.round(rxRate), txBytesPerSec: Math.round(txRate) };
}

async function getDisk() {
  const { stdout } = await execFileAsync('df', ['-B1', '/']);
  const lines = stdout.trim().split('\n');
  const parts = lines[1].trim().split(/\s+/);
  const total = parseInt(parts[1]);
  const used = parseInt(parts[2]);
  const available = parseInt(parts[3]);
  return { total, used, available, usagePercent: total > 0 ? Math.round((used / total) * 100) : 0 };
}

// ---------- Express app ----------

const app = express();
app.use(express.json());

// API key auth middleware
app.use((req, res, next) => {
  if (req.path === '/health') { next(); return; }
  const key = req.headers['x-stor-agent-key'] as string || req.headers['authorization']?.replace('Bearer ', '');
  if (key !== config.api_key) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

// Health — no auth required
app.get('/health', (_req, res) => {
  res.json({ ok: true, version: '1.0.0' });
});

// Metrics
app.get('/metrics', async (_req, res) => {
  try {
    const [cpu, memory, network, disk] = await Promise.all([getCpu(), getMemory(), getNetwork(), getDisk()]);
    const uptimeRaw = await readFile('/proc/uptime', 'utf-8');
    const uptime = Math.floor(parseFloat(uptimeRaw.split(' ')[0]));
    const hostname = (await readFile('/proc/sys/kernel/hostname', 'utf-8')).trim();
    res.json({ cpu, memory, network, disk, uptime, hostname });
  } catch (e: any) {
    res.status(500).json({ error: String(e.message) });
  }
});

// OS upgradable packages
app.get('/os-updates', async (_req, res) => {
  try {
    await execFileAsync('apt-get', ['update', '-qq']);
    const { stdout } = await execFileAsync('apt', ['list', '--upgradable', '--quiet=2']);
    const packages = stdout.trim().split('\n').filter(l => l && !l.startsWith('Listing'));
    res.json({ count: packages.length, packages: packages.slice(0, 50) });
  } catch (e: any) {
    res.status(500).json({ error: String(e.message) });
  }
});

// Trigger OS update
app.post('/os-update', async (_req, res) => {
  const logFile = `${LOG_DIR}/stor-agent-os-update.log`;
  try {
    // Check if already running
    try {
      const { stdout } = await execFileAsync('systemctl', ['is-active', 'stor-agent-os-update']);
      if (['active', 'activating'].includes(stdout.trim())) {
        res.json({ success: true, alreadyRunning: true });
        return;
      }
    } catch { /* not running */ }
    try { await execFileAsync('systemctl', ['reset-failed', 'stor-agent-os-update.service']); } catch { /* ok */ }
    // Truncate log
    writeFileSync(logFile, '');
    execFile('systemd-run', [
      '--unit=stor-agent-os-update',
      '--description=St0r Agent OS Update',
      `--property=StandardOutput=append:${logFile}`,
      `--property=StandardError=append:${logFile}`,
      '/bin/bash', '-c',
      'DEBIAN_FRONTEND=noninteractive apt-get update -q 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y 2>&1 && echo "SUCCESS: OS packages updated" || echo "FAILED: OS update failed"',
    ], (err) => { if (err) console.error('[stor-agent] os-update error:', err); });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: String(e.message) });
  }
});

// OS update log
app.get('/os-update-log', async (_req, res) => {
  const logFile = `${LOG_DIR}/stor-agent-os-update.log`;
  try {
    let log = '';
    try { log = await readFile(logFile, 'utf-8'); } catch { /* not exists */ }
    let inProgress = false;
    try {
      const { stdout } = await execFileAsync('systemctl', ['is-active', 'stor-agent-os-update']);
      inProgress = ['active', 'activating'].includes(stdout.trim());
    } catch { /* not running */ }
    res.json({ log, inProgress });
  } catch (e: any) {
    res.status(500).json({ error: String(e.message) });
  }
});

// St0r version (if installed on this remote)
app.get('/stor-version', async (_req, res) => {
  try {
    let installed = 'unknown';
    try {
      const versionFile = '/opt/urbackup-gui/version.json';
      if (existsSync(versionFile)) {
        const v = JSON.parse(readFileSync(versionFile, 'utf-8'));
        installed = v.version || 'unknown';
      }
    } catch { /* not installed */ }
    res.json({ installed });
  } catch (e: any) {
    res.status(500).json({ error: String(e.message) });
  }
});

// Trigger St0r update (if installed)
app.post('/stor-update', async (_req, res) => {
  const updateScript = '/opt/urbackup-gui/auto-update.sh';
  const logFile = '/var/log/urbackup-gui-update.log';
  if (!existsSync(updateScript)) {
    res.status(404).json({ error: 'St0r not installed at /opt/urbackup-gui' });
    return;
  }
  try {
    try { await execFileAsync('systemctl', ['reset-failed', 'urbackup-gui-update.service']); } catch { /* ok */ }
    writeFileSync(logFile, '');
    execFile('systemd-run', [
      '--unit=urbackup-gui-update',
      `--property=StandardOutput=append:${logFile}`,
      `--property=StandardError=append:${logFile}`,
      updateScript,
    ], (err) => { if (err) console.error('[stor-agent] stor-update error:', err); });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: String(e.message) });
  }
});

// St0r update log
app.get('/stor-update-log', async (_req, res) => {
  const logFile = '/var/log/urbackup-gui-update.log';
  try {
    let log = '';
    try { log = await readFile(logFile, 'utf-8'); } catch { /* not exists */ }
    let inProgress = false;
    try {
      const { stdout } = await execFileAsync('systemctl', ['is-active', 'urbackup-gui-update']);
      inProgress = ['active', 'activating'].includes(stdout.trim());
    } catch { /* not running */ }
    res.json({ log, inProgress });
  } catch (e: any) {
    res.status(500).json({ error: String(e.message) });
  }
});

// UrBackup server version
app.get('/urbackup-version', async (_req, res) => {
  try {
    let installed = 'not installed';
    try {
      const { stdout } = await execFileAsync('dpkg', ['-l', 'urbackup-server']);
      const m = stdout.match(/^ii\s+urbackup-server\s+([\d.]+)/m);
      if (m) installed = m[1];
    } catch { /* not installed */ }
    res.json({ installed });
  } catch (e: any) {
    res.status(500).json({ error: String(e.message) });
  }
});

// Trigger UrBackup update
app.post('/urbackup-update', async (_req, res) => {
  const logFile = `${LOG_DIR}/stor-agent-urbackup-update.log`;
  try {
    try { await execFileAsync('systemctl', ['reset-failed', 'stor-agent-urbackup-update.service']); } catch { /* ok */ }
    writeFileSync(logFile, '');
    execFile('systemd-run', [
      '--unit=stor-agent-urbackup-update',
      `--property=StandardOutput=append:${logFile}`,
      `--property=StandardError=append:${logFile}`,
      '/bin/bash', '-c',
      'DEBIAN_FRONTEND=noninteractive apt-get update -q 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade urbackup-server 2>&1 && systemctl restart urbackupsrv && echo "SUCCESS: UrBackup updated" || echo "FAILED: UrBackup update failed"',
    ], (err) => { if (err) console.error('[stor-agent] urbackup-update error:', err); });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: String(e.message) });
  }
});

// UrBackup update log
app.get('/urbackup-update-log', async (_req, res) => {
  const logFile = `${LOG_DIR}/stor-agent-urbackup-update.log`;
  try {
    let log = '';
    try { log = await readFile(logFile, 'utf-8'); } catch { /* not exists */ }
    let inProgress = false;
    try {
      const { stdout } = await execFileAsync('systemctl', ['is-active', 'stor-agent-urbackup-update']);
      inProgress = ['active', 'activating'].includes(stdout.trim());
    } catch { /* not running */ }
    res.json({ log, inProgress });
  } catch (e: any) {
    res.status(500).json({ error: String(e.message) });
  }
});

// Reboot
app.post('/reboot', async (_req, res) => {
  res.json({ success: true, message: 'Rebooting in 5 seconds' });
  setTimeout(async () => {
    try { await execFileAsync('systemctl', ['reboot']); } catch (e) { console.error('[stor-agent] reboot error:', e); }
  }, 5000);
});

const server = createServer(app);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[stor-agent] Listening on port ${PORT}`);
  console.log(`[stor-agent] Config: ${CONFIG_FILE}`);
});
