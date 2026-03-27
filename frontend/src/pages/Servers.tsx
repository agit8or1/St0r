import { useState, useEffect, useRef, useCallback } from 'react';
import { Layout } from '../components/Layout';
import { useAuth } from '../hooks/useAuth';
import {
  Server, Plus, Wifi, WifiOff, RefreshCw, Trash2, Edit3, Terminal,
  Cpu, HardDrive, MemoryStick, Network, Clock, ChevronDown, ChevronUp,
  CheckCircle, Download, RotateCcw, Power, X, Eye, EyeOff,
  Key, Loader, Copy, Check, Link
} from 'lucide-react';

interface ManagedServer {
  id: string;
  name: string;
  is_local: boolean;
  host: string | null;
  agent_port: number;
  agent_installed: boolean;
  has_agent_key: boolean;
  has_ssh_key: boolean;
  has_ssh_password: boolean;
  ssh_user: string | null;
  ssh_port: number;
  auth_type: 'ssh_key' | 'password' | null;
  ssh_known_host_fingerprint: string | null;
  last_seen: number | null;
  notes: string | null;
  enabled: boolean;
}

interface Metrics {
  cpu: { usage: number; cores: number; model: string };
  memory: { total: number; used: number; free: number; usagePercent: number };
  disk: { total: number; used: number; available: number; usagePercent: number };
  network: { iface: string; rxBytesPerSec: number; txBytesPerSec: number };
  uptime: number;
  hostname: string;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function GaugeBar({ label, value, color }: { label: string; value: number; color: string }) {
  const barColor = value >= 90 ? 'bg-red-500' : value >= 75 ? 'bg-yellow-500' : color;
  return (
    <div className="flex-1 min-w-0">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
        <span className="text-xs font-mono font-medium text-gray-900 dark:text-gray-100">{value}%</span>
      </div>
      <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          className={`h-2 rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}

// ---------- Add/Edit Server Modal ----------

type InstallMethod = 'command' | 'ssh' | 'manual';

interface ServerModalProps {
  server?: ManagedServer | null;
  onClose: () => void;
  onSaved: () => void;
}

function ServerModal({ server, onClose, onSaved }: ServerModalProps) {
  // Step: 'method' (new only) → 'details' → 'done'
  const [step, setStep] = useState<'method' | 'details' | 'done'>(server ? 'details' : 'method');
  const [method, setMethod] = useState<InstallMethod>('command');

  // Common fields
  const [name, setName] = useState(server?.name || '');
  const [host, setHost] = useState(server?.host || '');
  const [agentPort, setAgentPort] = useState(String(server?.agent_port || 7420));
  const [notes, setNotes] = useState(server?.notes || '');

  // SSH fields
  const [sshPort, setSshPort] = useState(String(server?.ssh_port || 22));
  const [sshUser, setSshUser] = useState(server?.ssh_user || 'root');
  const [authType, setAuthType] = useState<'ssh_key' | 'password'>(server?.auth_type || 'ssh_key');
  const [sshKey, setSshKey] = useState('');
  const [sshPassword, setSshPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; hostname?: string; os?: string; fingerprint?: string; error?: string } | null>(null);

  // Manual key field
  const [apiKey, setApiKey] = useState('');

  // Status
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Install command result
  const [installCmd, setInstallCmd] = useState('');
  const [cmdCopied, setCmdCopied] = useState(false);
  const [fqdnWarning, setFqdnWarning] = useState(false);

  const saveServer = async (): Promise<string> => {
    const body: any = { name, host, agent_port: agentPort, notes };
    if (method === 'ssh' || server) {
      Object.assign(body, { ssh_port: sshPort, ssh_user: sshUser, auth_type: authType });
      if (authType === 'ssh_key' && sshKey) body.ssh_private_key = sshKey;
      if (authType === 'password' && sshPassword) body.ssh_password = sshPassword;
    }
    const url = server ? `/api/servers/${server.id}` : '/api/servers';
    const httpMethod = server ? 'PUT' : 'POST';
    const resp = await fetch(url, { method: httpMethod, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
    if (!resp.ok) { const d = await resp.json(); throw new Error(d.error || 'Save failed'); }
    const d = await resp.json();
    return d.id || server?.id || '';
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    if (!host.trim()) { setError('Host / IP is required'); return; }
    setSaving(true); setError('');
    try {
      const serverId = await saveServer();
      onSaved();

      if (method === 'command') {
        const tokenResp = await fetch(`/api/servers/${serverId}/generate-token`, { method: 'POST', credentials: 'include' });
        const td = await tokenResp.json();
        if (!tokenResp.ok || !td.command) throw new Error(td.error || 'Failed to generate install command');
        setInstallCmd(td.command);
        setFqdnWarning(!td.baseUrl || td.baseUrl.includes('localhost'));
        setStep('done');
      } else if (method === 'ssh') {
        // Trigger install in background; user sees server card with progress
        fetch(`/api/servers/${serverId}/install-agent`, { method: 'POST', credentials: 'include' }).catch(() => {});
        onClose();
      } else if (method === 'manual') {
        if (apiKey.trim()) {
          await fetch(`/api/servers/${serverId}/register-agent-key`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey.trim() }),
          });
        }
        onClose();
      } else {
        onClose();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTestSsh = async () => {
    if (!server) { setError('Save the server first to test SSH'); return; }
    setTesting(true); setTestResult(null);
    try {
      const resp = await fetch(`/api/servers/${server.id}/test-ssh`, { method: 'POST', credentials: 'include' });
      setTestResult(await resp.json());
    } catch (e: any) {
      setTestResult({ ok: false, error: e.message });
    } finally {
      setTesting(false);
    }
  };

  const copyCmd = () => {
    navigator.clipboard.writeText(installCmd).then(() => {
      setCmdCopied(true);
      setTimeout(() => setCmdCopied(false), 2000);
    });
  };

  // ---- Step 1: Method selection ----
  if (step === 'method') {
    const methods: { id: InstallMethod; icon: React.ReactNode; title: string; desc: string }[] = [
      {
        id: 'command',
        icon: <Link className="h-6 w-6 text-blue-600 dark:text-blue-400" />,
        title: 'Install Command',
        desc: 'Get a one-time curl command to run on the remote server. No SSH access needed from here.',
      },
      {
        id: 'ssh',
        icon: <Terminal className="h-6 w-6 text-green-600 dark:text-green-400" />,
        title: 'Auto-Install via SSH',
        desc: 'Provide SSH credentials and St0r will install the agent automatically.',
      },
      {
        id: 'manual',
        icon: <Key className="h-6 w-6 text-purple-600 dark:text-purple-400" />,
        title: 'Agent Already Installed',
        desc: 'The agent is already running on the remote server — just enter the API key.',
      },
    ];

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg">
          <div className="flex items-center justify-between p-6 border-b dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Add Remote Server</h2>
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"><X className="h-5 w-5" /></button>
          </div>
          <div className="p-6">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">How would you like to install the St0r agent on the remote server?</p>
            <div className="space-y-3">
              {methods.map(m => (
                <button key={m.id} onClick={() => { setMethod(m.id); setStep('details'); }}
                  className="w-full flex items-start gap-4 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-primary-400 dark:hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-all text-left group">
                  <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 flex-shrink-0 group-hover:bg-white dark:group-hover:bg-gray-600 transition-colors">
                    {m.icon}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-gray-100">{m.title}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{m.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- Step 3: Show install command ----
  if (step === 'done') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg">
          <div className="flex items-center justify-between p-6 border-b dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Install Command</h2>
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"><X className="h-5 w-5" /></button>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Run this command on <strong>{name}</strong> as root. The agent will install itself and register automatically.
            </p>
            <div className="bg-gray-950 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">Shell command</span>
                <button onClick={copyCmd} className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-green-400 hover:text-green-300 transition-colors">
                  {cmdCopied ? <><Check className="h-3.5 w-3.5" /> Copied!</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                </button>
              </div>
              <code className="text-sm text-green-400 font-mono break-all leading-relaxed">{installCmd}</code>
            </div>
            {fqdnWarning && (
              <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-700 text-sm text-yellow-800 dark:text-yellow-200">
                <svg className="h-4 w-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                <span>No FQDN configured — this command uses <code className="font-mono">localhost</code> and won't work on a remote server. Go to <strong>Settings → Client Installer</strong> and set your Server Hostname / FQDN first, then regenerate the command.</span>
              </div>
            )}
            <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm text-blue-700 dark:text-blue-300">
              <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>This command expires in 24 hours. Once the agent is running, the server card will show as online automatically.</span>
            </div>
          </div>
          <div className="flex justify-end p-6 border-t dark:border-gray-700">
            <button onClick={onClose} className="btn btn-primary">Done</button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Step 2: Details form ----
  const titles: Record<InstallMethod, string> = {
    command: 'Install Command',
    ssh: 'Auto-Install via SSH',
    manual: 'Agent Already Installed',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b dark:border-gray-700">
          <div className="flex items-center gap-3">
            {!server && (
              <button onClick={() => setStep('method')} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </button>
            )}
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {server ? 'Edit Server' : titles[method]}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-6 space-y-4">
          {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">{error}</div>}

          {/* Common fields */}
          <div>
            <label className="label">Display Name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Office Server" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Host / IP</label>
              <input className="input" value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.1.100" />
            </div>
            <div>
              <label className="label">Agent Port</label>
              <input className="input" type="number" value={agentPort} onChange={e => setAgentPort(e.target.value)} />
            </div>
          </div>

          {/* SSH fields */}
          {(method === 'ssh' || server) && (
            <div className="border-t dark:border-gray-700 pt-4 space-y-3">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">SSH Credentials</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">SSH User</label>
                  <input className="input" value={sshUser} onChange={e => setSshUser(e.target.value)} />
                </div>
                <div>
                  <label className="label">SSH Port</label>
                  <input className="input" type="number" value={sshPort} onChange={e => setSshPort(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-3">
                {(['ssh_key', 'password'] as const).map(t => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={authType === t} onChange={() => setAuthType(t)} className="text-primary-600" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{t === 'ssh_key' ? 'SSH Key' : 'Password'}</span>
                  </label>
                ))}
              </div>
              {authType === 'ssh_key' ? (
                <div>
                  <label className="label">Private Key (PEM){server?.has_ssh_key && ' — leave blank to keep existing'}</label>
                  <textarea className="input font-mono text-xs" rows={5} value={sshKey} onChange={e => setSshKey(e.target.value)}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----" />
                </div>
              ) : (
                <div>
                  <label className="label">SSH Password{server?.has_ssh_password && ' — leave blank to keep existing'}</label>
                  <div className="relative">
                    <input className="input pr-10" type={showPw ? 'text' : 'password'} value={sshPassword} onChange={e => setSshPassword(e.target.value)} />
                    <button type="button" className="absolute right-3 top-2.5" onClick={() => setShowPw(v => !v)}>
                      {showPw ? <EyeOff className="h-4 w-4 text-gray-400" /> : <Eye className="h-4 w-4 text-gray-400" />}
                    </button>
                  </div>
                </div>
              )}
              {server && (
                <div>
                  <button onClick={handleTestSsh} disabled={testing} className="btn btn-secondary text-sm flex items-center gap-2">
                    {testing ? <Loader className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                    {testing ? 'Testing...' : 'Test SSH Connection'}
                  </button>
                  {testResult && (
                    <div className={`mt-2 p-3 rounded-lg text-sm ${testResult.ok ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}>
                      {testResult.ok
                        ? <><div className="font-medium">✓ Connected — {testResult.hostname} ({testResult.os})</div>{testResult.fingerprint && <div className="text-xs mt-1 font-mono opacity-70">Key: {testResult.fingerprint.slice(0, 32)}...</div>}</>
                        : <div>✗ {testResult.error}</div>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Manual API key */}
          {method === 'manual' && !server && (
            <div className="border-t dark:border-gray-700 pt-4">
              <label className="label">Agent API Key</label>
              <input className="input font-mono text-sm" value={apiKey} onChange={e => setApiKey(e.target.value)}
                placeholder="Paste the API key from /etc/stor-agent/config.json" />
            </div>
          )}

          <div>
            <label className="label">Notes (optional)</label>
            <textarea className="input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="flex gap-3 justify-end p-6 border-t dark:border-gray-700">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary flex items-center gap-2">
            {saving && <Loader className="h-4 w-4 animate-spin" />}
            {saving ? 'Working...' : server ? 'Save Changes' : method === 'command' ? 'Save & Get Command' : method === 'ssh' ? 'Save & Install' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Log Modal ----------

function LogModal({ title, log, inProgress, onClose }: { title: string; log: string; inProgress: boolean; onClose: () => void }) {
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl">
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
            {inProgress && <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400"><Loader className="h-3 w-3 animate-spin" /> Running...</span>}
            {!inProgress && log && <span className="text-xs text-green-600 dark:text-green-400">Complete</span>}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <pre ref={logRef} className="p-4 h-80 overflow-y-auto bg-gray-950 text-green-400 text-xs font-mono whitespace-pre-wrap rounded-b-xl">
          {log || 'Waiting for output...'}
        </pre>
      </div>
    </div>
  );
}

// ---------- Server Card ----------

interface ServerCardProps {
  server: ManagedServer;
  onEdit: () => void;
  onDelete: () => void;
  onRefresh: () => void;
}

function ServerCard({ server, onEdit, onDelete, onRefresh }: ServerCardProps) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(true);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [metricsError, setMetricsError] = useState('');
  const [online, setOnline] = useState<boolean | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);

  // Operation state
  const [op, setOp] = useState<string | null>(null); // current operation name
  const [opLog, setOpLog] = useState('');
  const [opInProgress, setOpInProgress] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const hasSeenInProgressRef = useRef(false);

  // Agent install state
  const [installingAgent, setInstallingAgent] = useState(false);
  const [installError, setInstallError] = useState('');
  const [showManualKey, setShowManualKey] = useState(false);
  const [manualKey, setManualKey] = useState('');
  const [confirmReboot, setConfirmReboot] = useState(false);

  // Install command state
  const [installCmd, setInstallCmd] = useState('');
  const [installCmdLoading, setInstallCmdLoading] = useState(false);
  const [installCmdCopied, setInstallCmdCopied] = useState(false);
  const [showInstallCmd, setShowInstallCmd] = useState(false);

  // OS upgradable count
  const [upgradableCount, setUpgradableCount] = useState<number | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoadingMetrics(true);
    try {
      const resp = await fetch(`/api/servers/${server.id}/metrics`, { credentials: 'include' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setMetrics(data);
      setOnline(true);
      setMetricsError('');
    } catch (e: any) {
      setOnline(false);
      setMetricsError(e.message);
    } finally {
      setLoadingMetrics(false);
    }
  }, [server.id]);

  useEffect(() => {
    fetchMetrics();
    const t = setInterval(fetchMetrics, 30000);
    return () => clearInterval(t);
  }, [fetchMetrics]);

  const checkOsUpdates = async () => {
    try {
      const resp = await fetch(`/api/servers/${server.id}/os-updates`, { credentials: 'include' });
      const d = await resp.json();
      setUpgradableCount(d.count || 0);
    } catch { /* ignore */ }
  };

  // Poll log for active operation
  useEffect(() => {
    if (!op) return;
    hasSeenInProgressRef.current = false;
    const logEndpoint: Record<string, string> = {
      os_update: 'os-update-log',
      stor_update: 'stor-update-log',
    };
    const endpoint = logEndpoint[op];
    if (!endpoint) return;

    const interval = setInterval(async () => {
      try {
        const resp = await fetch(`/api/servers/${server.id}/${endpoint}`, { credentials: 'include' });
        const d = await resp.json();
        setOpLog(d.log || '');
        if (d.inProgress) hasSeenInProgressRef.current = true;
        if (!d.inProgress && hasSeenInProgressRef.current) {
          setOpInProgress(false);
          clearInterval(interval);
        } else {
          setOpInProgress(d.inProgress);
        }
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [op, server.id]);

  const triggerOp = async (opName: string, apiPath: string) => {
    setOp(opName);
    setOpLog('');
    setOpInProgress(true);
    setShowLog(true);
    hasSeenInProgressRef.current = false;
    try {
      await fetch(`/api/servers/${server.id}/${apiPath}`, { method: 'POST', credentials: 'include' });
    } catch (e: any) {
      setOpLog(`Error: ${e.message}`);
      setOpInProgress(false);
    }
  };

  const installAgentAuto = async () => {
    setInstallingAgent(true);
    setInstallError('');
    try {
      const resp = await fetch(`/api/servers/${server.id}/install-agent`, { method: 'POST', credentials: 'include' });
      const d = await resp.json();
      if (!resp.ok || !d.success) throw new Error(d.error || 'Installation failed');
      onRefresh();
    } catch (e: any) {
      setInstallError(e.message);
    } finally {
      setInstallingAgent(false);
    }
  };

  const registerManualKey = async () => {
    if (!manualKey.trim()) return;
    try {
      const resp = await fetch(`/api/servers/${server.id}/register-agent-key`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: manualKey.trim() }),
      });
      const d = await resp.json();
      if (!resp.ok || !d.success) throw new Error(d.error || 'Failed');
      setShowManualKey(false); setManualKey('');
      onRefresh();
    } catch (e: any) {
      setInstallError(e.message);
    }
  };

  const getInstallCommand = async () => {
    setInstallCmdLoading(true);
    setInstallError('');
    try {
      const resp = await fetch(`/api/servers/${server.id}/generate-token`, { method: 'POST', credentials: 'include' });
      const d = await resp.json();
      if (!resp.ok || !d.command) throw new Error(d.error || 'Failed to generate token');
      setInstallCmd(d.command);
      setShowInstallCmd(true);
      setInstallCmdCopied(false);
    } catch (e: any) {
      setInstallError(e.message);
    } finally {
      setInstallCmdLoading(false);
    }
  };

  const copyInstallCmd = () => {
    navigator.clipboard.writeText(installCmd).then(() => {
      setInstallCmdCopied(true);
      setTimeout(() => setInstallCmdCopied(false), 2000);
    });
  };

  const doReboot = async () => {
    setConfirmReboot(false);
    try {
      await fetch(`/api/servers/${server.id}/reboot`, { method: 'POST', credentials: 'include' });
    } catch { /* ignore */ }
  };

  const lastSeenText = server.last_seen
    ? `Last seen ${Math.round((Date.now() - server.last_seen) / 60000)}m ago`
    : 'Never connected';

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`p-2 rounded-lg flex-shrink-0 ${server.is_local ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-gray-100 dark:bg-gray-700'}`}>
            <Server className={`h-5 w-5 ${server.is_local ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300'}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{server.name}</span>
              {server.is_local && <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full">Local</span>}
              {!server.is_local && <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-full">Remote</span>}
              {online === true && <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400"><Wifi className="h-3 w-3" /> Online</span>}
              {online === false && <span className="flex items-center gap-1 text-xs text-red-500 dark:text-red-400"><WifiOff className="h-3 w-3" /> Offline</span>}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {server.is_local ? (metrics?.hostname || 'localhost') : `${server.host}:${server.agent_port}`}
              {!server.is_local && ` · ${lastSeenText}`}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={fetchMetrics} disabled={loadingMetrics} title="Refresh metrics"
            className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
            <RefreshCw className={`h-4 w-4 ${loadingMetrics ? 'animate-spin' : ''}`} />
          </button>
          {user?.isAdmin && !server.is_local && (
            <>
              <button onClick={onEdit} className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
                <Edit3 className="h-4 w-4" />
              </button>
              <button onClick={onDelete} className="p-2 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400">
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
          <button onClick={() => setExpanded(v => !v)} className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <>
          {/* Agent not installed warning */}
          {!server.is_local && !server.agent_installed && user?.isAdmin && (
            <div className="mb-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg">
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-3">
                St0r Agent is not installed on this server.
              </p>
              <div className="flex flex-wrap gap-2">
                {(server.has_ssh_key || server.has_ssh_password) && (
                  <button onClick={installAgentAuto} disabled={installingAgent}
                    className="btn btn-primary text-sm flex items-center gap-2">
                    {installingAgent ? <Loader className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {installingAgent ? 'Installing...' : 'Auto-Install via SSH'}
                  </button>
                )}
                <button onClick={getInstallCommand} disabled={installCmdLoading} className="btn btn-secondary text-sm flex items-center gap-2">
                  {installCmdLoading ? <Loader className="h-4 w-4 animate-spin" /> : <Link className="h-4 w-4" />}
                  {installCmdLoading ? 'Generating...' : 'Get Install Command'}
                </button>
                <button onClick={() => setShowManualKey(v => !v)} className="btn btn-secondary text-sm flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  Enter API Key
                </button>
              </div>
              {showManualKey && (
                <div className="mt-3 flex gap-2">
                  <input className="input text-sm font-mono" value={manualKey} onChange={e => setManualKey(e.target.value)}
                    placeholder="Paste API key from /etc/stor-agent/config.json" />
                  <button onClick={registerManualKey} className="btn btn-primary text-sm flex-shrink-0">Register</button>
                </div>
              )}
              {showInstallCmd && installCmd && (
                <div className="mt-3 bg-gray-950 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">Run on remote server</span>
                    <button onClick={copyInstallCmd} className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-green-400 hover:text-green-300 transition-colors">
                      {installCmdCopied ? <><Check className="h-3 w-3" /> Copied!</> : <><Copy className="h-3 w-3" /> Copy</>}
                    </button>
                  </div>
                  <code className="text-xs text-green-400 font-mono break-all leading-relaxed">{installCmd}</code>
                  <p className="text-xs text-gray-500 mt-2">Expires in 24 hours. The agent registers automatically after install.</p>
                </div>
              )}
              {installError && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{installError}</p>}
            </div>
          )}

          {/* Metrics */}
          {metrics ? (
            <div className="mb-4 space-y-3">
              <div className="flex flex-wrap gap-4">
                <GaugeBar label={`CPU (${metrics.cpu.cores}c)`} value={metrics.cpu.usage} color="bg-blue-500" />
                <GaugeBar label="Memory" value={metrics.memory.usagePercent} color="bg-purple-500" />
                <GaugeBar label="Disk" value={metrics.disk.usagePercent} color="bg-green-500" />
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Uptime: {formatUptime(metrics.uptime)}</span>
                <span className="flex items-center gap-1"><HardDrive className="h-3 w-3" /> Disk: {formatBytes(metrics.disk.used)} / {formatBytes(metrics.disk.total)}</span>
                <span className="flex items-center gap-1"><MemoryStick className="h-3 w-3" /> RAM: {formatBytes(metrics.memory.used)} / {formatBytes(metrics.memory.total)}</span>
                {metrics.network.rxBytesPerSec > 0 && (
                  <span className="flex items-center gap-1"><Network className="h-3 w-3" />
                    ↓{formatBytes(metrics.network.rxBytesPerSec)}/s ↑{formatBytes(metrics.network.txBytesPerSec)}/s
                  </span>
                )}
                <span className="flex items-center gap-1"><Cpu className="h-3 w-3" /> {metrics.cpu.model.split('@')[0].trim()}</span>
              </div>
            </div>
          ) : metricsError ? (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
              Could not fetch metrics: {metricsError}
            </div>
          ) : (
            <div className="mb-4 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Loader className="h-4 w-4 animate-spin" /> Loading metrics...
            </div>
          )}

          {/* Action buttons */}
          {(server.is_local || server.agent_installed) && user?.isAdmin && (
            <div className="flex flex-wrap gap-2 pt-3 border-t dark:border-gray-700">
              <div className="relative">
                <button onClick={checkOsUpdates} className="btn btn-secondary text-sm flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Check OS Updates
                  {upgradableCount !== null && (
                    <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${upgradableCount > 0 ? 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300' : 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'}`}>
                      {upgradableCount > 0 ? `${upgradableCount} available` : 'Up to date'}
                    </span>
                  )}
                </button>
              </div>

              <button onClick={() => triggerOp('os_update', 'os-update')}
                className="btn btn-secondary text-sm flex items-center gap-2 hover:bg-orange-50 dark:hover:bg-orange-900/20 hover:text-orange-700 dark:hover:text-orange-300 hover:border-orange-300">
                <Download className="h-4 w-4" />
                Apply OS Updates
              </button>

              {!server.is_local && (
                <button onClick={() => triggerOp('stor_update', 'stor-update')}
                  className="btn btn-secondary text-sm flex items-center gap-2">
                  <RotateCcw className="h-4 w-4" />
                  Update St0r
                </button>
              )}

              <button onClick={() => setConfirmReboot(true)}
                className="btn btn-secondary text-sm flex items-center gap-2 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-700 dark:hover:text-red-300 hover:border-red-300">
                <Power className="h-4 w-4" />
                Reboot
              </button>

              {op && (
                <button onClick={() => setShowLog(true)} className="btn btn-secondary text-sm flex items-center gap-2">
                  <Terminal className="h-4 w-4" />
                  View Log
                  {opInProgress && <Loader className="h-3 w-3 animate-spin" />}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Confirm reboot dialog */}
      {confirmReboot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Reboot {server.name}?</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              The server will restart. {server.is_local ? 'You will lose connection briefly.' : 'The agent will reconnect automatically.'}
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmReboot(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={doReboot} className="btn bg-red-600 hover:bg-red-700 text-white border-red-600">Reboot Now</button>
            </div>
          </div>
        </div>
      )}

      {/* Log modal */}
      {showLog && (
        <LogModal
          title={op === 'os_update' ? `OS Update — ${server.name}` : `St0r Update — ${server.name}`}
          log={opLog}
          inProgress={opInProgress}
          onClose={() => setShowLog(false)}
        />
      )}
    </div>
  );
}

// ---------- Main Servers Page ----------

export function Servers() {
  const { user } = useAuth();
  const [servers, setServers] = useState<ManagedServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingServer, setEditingServer] = useState<ManagedServer | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadServers = async () => {
    try {
      const resp = await fetch('/api/servers', { credentials: 'include' });
      if (resp.ok) setServers(await resp.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { loadServers(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this server from St0r? This will not uninstall the agent.')) return;
    await fetch(`/api/servers/${id}`, { method: 'DELETE', credentials: 'include' });
    setDeletingId(null);
    loadServers();
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl">
              <Server className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Servers</h1>
              <p className="text-gray-600 dark:text-gray-400">Manage and monitor this server and remote servers</p>
            </div>
          </div>
          {user?.isAdmin && (
            <button onClick={() => { setEditingServer(null); setShowModal(true); }} className="btn btn-primary flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add Server
            </button>
          )}
        </div>

        {/* How to install agent info box */}
        {user?.isAdmin && servers.some(s => !s.is_local) === false && !loading && (
          <div className="card bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700">
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Add Remote Servers</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                  Click <strong>Add Server</strong> to add a remote Linux server. St0r will install a lightweight agent
                  on the remote server via SSH, or you can install it manually.
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  The agent enables remote OS updates, St0r updates, metrics monitoring, and reboots — all from this UI.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Server cards */}
        {loading ? (
          <div className="card flex items-center justify-center py-12 text-gray-500 dark:text-gray-400">
            <Loader className="h-6 w-6 animate-spin mr-3" /> Loading servers...
          </div>
        ) : (
          <div className="space-y-4">
            {servers.map(server => (
              <ServerCard
                key={server.id}
                server={server}
                onEdit={() => { setEditingServer(server); setShowModal(true); }}
                onDelete={() => handleDelete(server.id)}
                onRefresh={loadServers}
              />
            ))}
          </div>
        )}

        {/* Add/Edit modal */}
        {showModal && (
          <ServerModal
            server={editingServer}
            onClose={() => { setShowModal(false); setEditingServer(null); }}
            onSaved={loadServers}
          />
        )}
      </div>
    </Layout>
  );
}
