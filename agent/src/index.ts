import 'dotenv/config';
import express from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { readFile } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';

const execFileAsync = promisify(execFile);

const CONFIG_DIR = process.env.STOR_AGENT_CONFIG_DIR || '/etc/stor-agent';
const CONFIG_FILE = `${CONFIG_DIR}/config.json`;
const LOG_DIR = '/var/log';

interface AgentConfig {
  api_key: string;
  port: number;
  allowed_ips: string[];
}

// Reported by /health so St0r can tell when this agent is older than the one
// it ships (agent/package.json is in the installed package, one level up).
const AGENT_VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version || 'unknown';
  } catch {
    return 'unknown';
  }
})();

function saveConfig(config: AgentConfig): void {
  const tmp = `${CONFIG_FILE}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  renameSync(tmp, CONFIG_FILE);
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
  // An empty allowlist is pinned to the first source that presents the key
  // (see below); install.sh normally fills it with St0r's address.
  const config: AgentConfig = {
    api_key: randomBytes(32).toString('hex'),
    port: parseInt(process.env.STOR_AGENT_PORT || '7420', 10),
    allowed_ips: [],
  };
  saveConfig(config);
  console.log(`[stor-agent] New API key generated. Config saved to ${CONFIG_FILE}`);
  // The API key is only in the root-readable config file: printing it put it
  // in the journal, readable by anyone in the adm or systemd-journal group.
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

/**
 * Constant-time API key check. Both sides are hashed first so the comparison
 * is over equal-length buffers and the key's length is not leaked either.
 */
function keyMatches(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

const normalizeIp = (ip: string) => ip.trim().replace(/^::ffff:/, '');
const refusedLogged = new Set<string>();

// Health — no auth required. Carries the agent version so St0r can offer an update.
app.get('/health', (_req, res) => {
  res.json({ ok: true, version: AGENT_VERSION });
});

// Source allowlist and API key, BEFORE anything reads the request body.
//  - allowed_ips lists the addresses St0r connects from; "*" allows any.
//  - Empty (agents installed without one): the first source that presents the
//    valid key — St0r, which polls right after registration — is pinned and
//    saved. Nothing is open to every address.
app.use((req, res, next) => {
  const peer = normalizeIp(req.socket.remoteAddress || '');
  const allowed = Array.isArray(config.allowed_ips) ? config.allowed_ips.filter((ip) => typeof ip === 'string').map(normalizeIp).filter(Boolean) : [];
  const pinNow = allowed.length === 0;
  if (!pinNow && !allowed.includes('*') && !allowed.includes(peer)) {
    if (refusedLogged.size < 100 && !refusedLogged.has(peer)) {
      refusedLogged.add(peer);
      console.warn(`[stor-agent] Refused ${peer}: not in allowed_ips in ${CONFIG_FILE}`);
    }
    res.status(403).json({ error: 'Source address not permitted' });
    return;
  }
  const key = req.headers['x-stor-agent-key'] as string || req.headers['authorization']?.replace('Bearer ', '');
  if (!keyMatches(key, config.api_key)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (pinNow && peer) {
    config.allowed_ips = [peer];
    try {
      saveConfig(config);
      console.log(`[stor-agent] allowed_ips was empty; pinned to ${peer}, the first source with the valid API key`);
    } catch (e) {
      console.error('[stor-agent] could not save the pinned allowlist:', e);
    }
  }
  next();
});

// Only authenticated requests get this far.
app.use(express.json());

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

// Trigger St0r update (if installed). St0r installs a root-owned launcher that
// takes no arguments; installs from before it existed still have only the
// updater under /opt, which (when run once) installs the launcher.
const STOR_START_UPDATE = '/usr/local/lib/st0r/start-update';
const STOR_LEGACY_UPDATER = '/opt/urbackup-gui/setup/auto-update.sh';
app.post('/stor-update', async (_req, res) => {
  const logFile = '/var/log/urbackup-gui-update.log';
  const useLauncher = existsSync(STOR_START_UPDATE);
  if (!useLauncher && !existsSync(STOR_LEGACY_UPDATER)) {
    res.status(404).json({ error: 'St0r not installed at /opt/urbackup-gui' });
    return;
  }
  try {
    writeFileSync(logFile, '');
    const [cmd, args] = useLauncher
      ? [STOR_START_UPDATE, [] as string[]]
      : ['systemd-run', ['--unit=urbackup-gui-update',
          `--property=StandardOutput=append:${logFile}`,
          `--property=StandardError=append:${logFile}`,
          STOR_LEGACY_UPDATER]];
    if (!useLauncher) {
      try { await execFileAsync('systemctl', ['reset-failed', 'urbackup-gui-update.service']); } catch { /* ok */ }
    }
    execFile(cmd, args, (err) => { if (err) console.error('[stor-agent] stor-update error:', err); });
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

const tlsCert = process.env.STOR_AGENT_TLS_CERT;
const tlsKey = process.env.STOR_AGENT_TLS_KEY;
if (!!tlsCert !== !!tlsKey) throw new Error('Both STOR_AGENT_TLS_CERT and STOR_AGENT_TLS_KEY are required');
const hasTls = !!tlsCert && !!tlsKey;
const server = hasTls
  ? createHttpsServer({ cert: readFileSync(tlsCert!), key: readFileSync(tlsKey!) }, app)
  : createHttpServer(app);
// Plain HTTP is only safe behind a local TLS proxy or an authenticated tunnel.
const bindHost = process.env.STOR_AGENT_BIND_HOST || (hasTls ? '0.0.0.0' : '127.0.0.1');
if (!hasTls && !['127.0.0.1', '::1', 'localhost'].includes(bindHost)) {
  throw new Error('Cleartext agent must bind to loopback; configure TLS for remote access');
}
server.listen(PORT, bindHost, () => {
  console.log(`[stor-agent] Listening on port ${PORT}`);
  console.log(`[stor-agent] Config: ${CONFIG_FILE}`);
});
