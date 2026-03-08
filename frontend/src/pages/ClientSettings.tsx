import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import { ArrowLeft, Save, Settings as SettingsIcon, Plus, Trash2, ChevronDown, ChevronRight, Lock, Unlock, FolderSearch, Loader2, ScanSearch, Pencil, Check, X, AlertTriangle, XCircle, HardDrive } from 'lucide-react';
import { ClientFileBrowser } from '../components/ClientFileBrowser';
import type { StorageLimitStatus } from '../types';
import { Tooltip } from '../components/Tooltip';

interface ClientSettings {
  [key: string]: any;
}

const TRANSFER_MODES = ['raw', 'compressed', 'hashed', 'blockhash'];
const IMAGE_STYLES_FULL = ['full', 'synthetic'];
const IMAGE_STYLES_INCR = ['to-last', 'to-full'];

// VSS components commonly available on Windows
const VSS_COMPONENTS = [
  { id: 'System State', label: 'System State' },
  { id: 'Active Directory', label: 'Active Directory' },
  { id: 'SYSVOL', label: 'SYSVOL' },
  { id: 'Exchange', label: 'Exchange' },
  { id: 'SQL Server', label: 'SQL Server' },
  { id: 'IIS', label: 'IIS (Internet Information Services)' },
  { id: 'SharePoint', label: 'SharePoint' },
  { id: 'Hyper-V', label: 'Hyper-V' },
];

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="input">
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
        checked ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

function Section({ title, children, collapsible = false }: { title: string; children: React.ReactNode; collapsible?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => collapsible && setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700/50 text-left ${collapsible ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700' : 'cursor-default'}`}
      >
        <span className="font-semibold text-gray-900 dark:text-gray-100">{title}</span>
        {collapsible && (open ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />)}
      </button>
      {open && <div className="p-4 space-y-4">{children}</div>}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</p>
        {hint && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

export function ClientSettings() {
  const { clientName } = useParams<{ clientName: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<ClientSettings>({});
  const [clientId, setClientId] = useState<string>('');
  const [tab, setTab] = useState<'paths' | 'schedule' | 'transfer' | 'image' | 'permissions' | 'storage'>('paths');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [noBackupPaths, setNoBackupPaths] = useState(false);
  const [newIncludePath, setNewIncludePath] = useState('');
  const [newExcludePattern, setNewExcludePattern] = useState('');
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [showImageBrowser, setShowImageBrowser] = useState(false);
  const [failedPaths, setFailedPaths] = useState<{ path: string; count: number }[] | null>(null);
  const [failedPathsLoading, setFailedPathsLoading] = useState(false);
  const [editingExcludeIdx, setEditingExcludeIdx] = useState<number | null>(null);
  const [editingExcludeVal, setEditingExcludeVal] = useState('');

  // Storage limit state
  const [storageLimit, setStorageLimit] = useState<StorageLimitStatus | null>(null);
  const [limitInput, setLimitInput] = useState('');
  const [limitUnit, setLimitUnit] = useState<'GB' | 'TB'>('GB');
  const [limitWarn, setLimitWarn] = useState(80);
  const [limitCritical, setLimitCritical] = useState(95);
  const [savingLimit, setSavingLimit] = useState(false);
  const [limitMessage, setLimitMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => { loadSettings(); }, [clientName]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const clients = await (await fetch('/api/urbackup/clients', { credentials: 'include' })).json();
      const foundClient = clients.find((c: any) => c.name === clientName);
      if (!foundClient?.id) throw new Error('Client not found');
      setClientId(foundClient.id);
      setNoBackupPaths(foundClient.no_backup_paths === true);

      const [settingsResp, limitResp] = await Promise.all([
        fetch(`/api/client-settings/${foundClient.id}`, { credentials: 'include' }),
        fetch(`/api/storage-limits`, { credentials: 'include' }),
      ]);
      if (settingsResp.status === 404) { setSettings(getDefaults()); }
      else if (!settingsResp.ok) throw new Error('Failed to load settings');
      else {
        const data = await settingsResp.json();
        const raw = data.settings || data;
        const cleanRaw = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null && v !== undefined));
        setSettings({ ...getDefaults(), ...cleanRaw });
      }

      if (limitResp.ok) {
        const limits = await limitResp.json();
        const match = limits.find((l: any) => l.client_name === clientName);
        if (match) {
          setStorageLimit({ name: clientName!, has_limit: true, limit_bytes: match.limit_bytes, used_bytes: 0, pct: 0, status: 'ok', warn_threshold_pct: match.warn_threshold_pct, critical_threshold_pct: match.critical_threshold_pct });
          const gb = match.limit_bytes / 1e9;
          if (gb >= 1000) { setLimitUnit('TB'); setLimitInput(String(+(gb / 1000).toFixed(2))); }
          else { setLimitUnit('GB'); setLimitInput(String(+gb.toFixed(2))); }
          setLimitWarn(match.warn_threshold_pct ?? 80);
          setLimitCritical(match.critical_threshold_pct ?? 95);
        } else {
          setStorageLimit({ name: clientName!, has_limit: false });
        }
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
      setMessage({ type: 'error', text: 'Failed to load settings' });
      setSettings(getDefaults());
    } finally {
      setLoading(false);
    }
  };

  const getDefaults = (): ClientSettings => ({
    // UrBackup default backup path for Windows
    default_dirs: 'C:\\Users',
    // Standard Windows exclusions: only junction points, OS files, and cache dirs.
    // Does NOT exclude whole dirs like ProgramData or Program Files — add those
    // manually if you don't want them backed up.
    exclude_files: [
      // OS virtual / swap files (no backup value)
      ':\\pagefile.sys',
      ':\\hiberfil.sys',
      ':\\swapfile.sys',
      ':\\$Recycle.Bin',
      ':\\System Volume Information',
      // Windows OS dirs (rarely needed in a restore)
      'C:\\Windows',
      'C:\\Windows.old',
      'C:\\$Windows.~BT',
      'C:\\$GetCurrent',
      // Junction points — Windows compatibility symlinks that duplicate content
      'C:\\Documents and Settings',           // → C:\Users
      'C:\\Users\\All Users',                 // → C:\ProgramData
      'C:\\Users\\Default User',              // → C:\Users\Default
      'C:\\Users\\*\\Application Data',       // → AppData\Roaming
      'C:\\Users\\*\\Local Settings',         // → AppData\Local
      'C:\\Users\\*\\My Documents',           // → Documents
      'C:\\Users\\*\\My Music',               // → Music
      'C:\\Users\\*\\My Pictures',            // → Pictures
      'C:\\Users\\*\\My Videos',              // → Videos
      'C:\\Users\\*\\Cookies',
      'C:\\Users\\*\\Recent',
      'C:\\Users\\*\\NetHood',
      'C:\\Users\\*\\PrintHood',
      'C:\\Users\\*\\SendTo',
      'C:\\Users\\*\\Start Menu',
      'C:\\Users\\*\\Templates',
      // Cache / temp files
      'C:\\Windows\\Temp',
      'C:\\Users\\*\\AppData\\Local\\Temp',
      'C:\\Users\\*\\AppData\\Local\\Microsoft\\Windows\\Temporary Internet Files',
      'C:\\Users\\*\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache',
      'C:\\Users\\*\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Media Cache',
      'C:\\Users\\*\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Code Cache',
      'C:\\Users\\*\\AppData\\Local\\Mozilla\\Firefox\\Profiles\\*\\cache2',
      'C:\\Users\\*\\AppData\\Local\\Mozilla\\Firefox\\Profiles\\*\\cache',
      'C:\\Users\\*\\AppData\\Local\\Microsoft\\Windows\\Explorer\\thumbcache*',
      // ProgramData — large volatile files not worth backing up
      'C:\\ProgramData\\Microsoft\\Windows Defender\\Scans\\mpcache-*',
      'C:\\ProgramData\\Microsoft\\Network\\Downloader\\*',
      'C:\\ProgramData\\Microsoft\\Windows\\WER\\*',
      'C:\\Windows\\softwaredistribution\\*.*',
    ].join(';'),
    include_files: '',
    backup_dirs_optional: false,
    // Schedule
    backup_window_incr_file: '1-7/0-24',
    backup_window_full_file: '1-7/0-24',
    backup_window_incr_image: '1-7/0-24',
    backup_window_full_image: '1-7/0-24',
    update_freq_incr: 18000,
    update_freq_full: 2592000,
    update_freq_image_incr: 604800,
    update_freq_image_full: 5184000,
    max_file_incr: 100,
    max_file_full: 10,
    max_image_incr: 30,
    max_image_full: 5,
    min_file_incr: 40,
    min_file_full: 2,
    min_image_incr: 4,
    min_image_full: 2,
    // Transfer
    internet_full_file_transfer_mode: 'raw',
    internet_incr_file_transfer_mode: 'blockhash',
    internet_full_image_transfer_mode: 'raw',
    internet_image_transfer_mode: 'raw',
    local_full_file_transfer_mode: 'hashed',
    local_incr_file_transfer_mode: 'hashed',
    local_image_transfer_mode: 'hashed',
    internet_compress: true,
    internet_encrypt: true,
    local_compress: true,
    local_encrypt: true,
    internet_speed: -1,
    local_speed: -1,
    internet_full_file_backups: true,
    internet_image_backups: false,
    internet_mode_enabled: true,
    internet_file_dataplan_limit: 5242880000,
    internet_image_dataplan_limit: 20971520000,
    // Image
    image_letters: 'C',
    internet_full_image_style: 'synthetic',
    internet_incr_image_style: 'to-last',
    local_full_image_style: 'full',
    local_incr_image_style: 'to-full',
    vss_select_components: '',
    cbt_volumes: 'ALL',
    image_file_format: 'default',
    // Permissions
    client_set_settings: false,
    allow_config_paths: false,
    allow_file_restore: true,
    allow_component_restore: true,
    allow_component_config: true,
    allow_log_view: true,
    allow_overwrite: true,
    allow_pause: true,
    allow_tray_exit: true,
    allow_starting_full_file_backups: true,
    allow_starting_incr_file_backups: true,
    allow_starting_full_image_backups: true,
    allow_starting_incr_image_backups: true,
    silent_update: true,
    background_backups: true,
    end_to_end_file_backup_verification: false,
    client_quota: '',
    startup_backup_delay: 0,
  });

  const s = <T = any>(key: string): T => settings[key] as T;
  const set = (key: string, value: any) => setSettings(prev => ({ ...prev, [key]: value }));
  const bool = (key: string) => {
    const v = settings[key];
    return v === true || v === 1 || v === '1' || v === 'true';
  };

  // Backup path helpers
  const getPaths = () => String(s('default_dirs') || '').split(/\n|;/).map(p => p.trim()).filter(Boolean);
  const setPaths = (paths: string[]) => set('default_dirs', paths.join('\n'));
  const addPath = () => {
    const t = newIncludePath.trim();
    if (t && !getPaths().includes(t)) setPaths([...getPaths(), t]);
    setNewIncludePath('');
  };

  // Exclude helpers
  const getExcludes = () => String(s('exclude_files') || '').split(';').map(p => p.trim()).filter(Boolean);
  const setExcludes = (arr: string[]) => set('exclude_files', arr.join(';'));
  const addExclude = () => {
    const t = newExcludePattern.trim();
    if (t && !getExcludes().includes(t)) setExcludes([...getExcludes(), t]);
    setNewExcludePattern('');
  };

  const detectFailedPaths = async () => {
    setFailedPathsLoading(true);
    setFailedPaths(null);
    try {
      const res = await fetch(`/api/urbackup/clients/${clientId}/failed-paths`, { credentials: 'include' });
      const data = await res.json();
      setFailedPaths(data.paths || []);
    } catch {
      setFailedPaths([]);
    } finally {
      setFailedPathsLoading(false);
    }
  };

  const addFailedPathsToExcludes = (paths: { path: string; count: number }[]) => {
    const current = getExcludes();
    const toAdd = paths.map(p => p.path).filter(p => !current.includes(p));
    if (toAdd.length > 0) setExcludes([...current, ...toAdd]);
    setFailedPaths(null);
  };

  // VSS components
  const getVssComponents = (): string[] => {
    const raw = String(s('vss_select_components') || '');
    if (!raw || raw === 'default=1') return [];
    return raw.split(';').map(c => c.replace(/=\d+$/, '').trim()).filter(Boolean);
  };
  const setVssComponents = (components: string[]) => {
    set('vss_select_components', components.length ? components.map(c => `${c}=1`).join(';') : 'default=1');
  };
  const toggleVss = (id: string) => {
    const cur = getVssComponents();
    setVssComponents(cur.includes(id) ? cur.filter(c => c !== id) : [...cur, id]);
  };

  const [managedSaving, setManagedSaving] = useState(false);

  const toggleManaged = async (serverManaged: boolean) => {
    set('client_set_settings', !serverManaged);
    setManagedSaving(true);
    try {
      const response = await fetch(`/api/client-settings/${clientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        // Backend handles locking/unlocking all allow_* settings automatically
        body: JSON.stringify({ client_set_settings: !serverManaged }),
      });
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.error || 'Save failed');
      setMessage({ type: 'success', text: serverManaged ? 'Managed mode enabled. Tray will lock after the client reconnects or completes its next backup.' : 'Managed mode disabled.' });
      setTimeout(() => { setMessage(null); loadSettings(); }, 5000);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save managed mode' });
    } finally {
      setManagedSaving(false);
    }
  };

  const saveStorageLimit = async () => {
    const val = parseFloat(limitInput);
    if (!val || val <= 0) { setLimitMessage({ type: 'error', text: 'Enter a valid limit' }); return; }
    if (limitWarn >= limitCritical) { setLimitMessage({ type: 'error', text: 'Warning % must be less than critical %' }); return; }
    setSavingLimit(true);
    try {
      const bytes = Math.round(val * (limitUnit === 'TB' ? 1e12 : 1e9));
      const resp = await fetch(`/api/storage-limits/${encodeURIComponent(clientName!)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ limit_bytes: bytes, warn_threshold_pct: limitWarn, critical_threshold_pct: limitCritical }),
      });
      if (!resp.ok) throw new Error('Failed to save');
      setStorageLimit({ name: clientName!, has_limit: true, limit_bytes: bytes, used_bytes: 0, pct: 0, status: 'ok', warn_threshold_pct: limitWarn, critical_threshold_pct: limitCritical });
      setLimitMessage({ type: 'success', text: 'Storage limit saved.' });
      setTimeout(() => setLimitMessage(null), 3000);
    } catch {
      setLimitMessage({ type: 'error', text: 'Failed to save storage limit' });
    } finally {
      setSavingLimit(false);
    }
  };

  const removeStorageLimit = async () => {
    setSavingLimit(true);
    try {
      await fetch(`/api/storage-limits/${encodeURIComponent(clientName!)}`, { method: 'DELETE', credentials: 'include' });
      setStorageLimit({ name: clientName!, has_limit: false });
      setLimitInput('');
      setLimitUnit('GB');
      setLimitWarn(80);
      setLimitCritical(95);
      setLimitMessage({ type: 'success', text: 'Storage limit removed.' });
      setTimeout(() => setLimitMessage(null), 3000);
    } catch {
      setLimitMessage({ type: 'error', text: 'Failed to remove storage limit' });
    } finally {
      setSavingLimit(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch(`/api/client-settings/${clientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(settings),
      });
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.error || 'Save failed');
      setMessage({ type: 'success', text: 'Settings saved successfully!' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: 'paths', label: 'Backup Paths' },
    { id: 'schedule', label: 'Schedule & Retention' },
    { id: 'transfer', label: 'Transfer' },
    { id: 'image', label: 'Image Backup' },
    { id: 'permissions', label: 'Permissions' },
    { id: 'storage', label: 'Storage Limit' },
  ] as const;

  if (loading) return <Layout><Loading /></Layout>;

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <Tooltip text="Return to the endpoint detail page">
              <button
                onClick={() => navigate(`/clients/${encodeURIComponent(clientName!)}`)}
                className="mb-2 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
              >
                <ArrowLeft className="h-4 w-4" /> Back to Endpoint
              </button>
            </Tooltip>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
              <SettingsIcon className="h-8 w-8" /> Endpoint Settings — {clientName}
            </h1>
          </div>
          <Tooltip text="Save all setting changes to the UrBackup server for this endpoint">
            <button onClick={handleSave} disabled={saving} className="btn btn-primary flex items-center gap-2">
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </Tooltip>
        </div>

        {message && (
          <div className={`rounded-lg p-4 ${message.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'}`}>
            {message.text}
          </div>
        )}

        {/* Server-managed mode banner */}
        <div className={`rounded-lg border p-4 flex items-center justify-between gap-4 ${
          !bool('client_set_settings')
            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700'
            : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-700'
        }`}>
          <div className="flex items-center gap-3">
            {!bool('client_set_settings')
              ? <Lock className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
              : <Unlock className="h-5 w-5 text-yellow-600 dark:text-yellow-400 shrink-0" />
            }
            <div>
              <p className={`text-sm font-semibold ${!bool('client_set_settings') ? 'text-green-800 dark:text-green-200' : 'text-yellow-800 dark:text-yellow-200'}`}>
                {!bool('client_set_settings') ? 'Server-managed' : 'Client-managed'}
              </p>
              <p className={`text-xs mt-0.5 ${!bool('client_set_settings') ? 'text-green-700 dark:text-green-300' : 'text-yellow-700 dark:text-yellow-300'}`}>
                {!bool('client_set_settings')
                  ? 'Server controls backup settings. Tray lock enforced after client reconnects or next backup.'
                  : 'Client controls its own backup settings via the tray app.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {managedSaving && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
            <Tooltip text={!bool('client_set_settings') ? 'Server enforces all backup settings; client tray is locked' : 'Client can change its own backup settings via the tray icon'}>
              <span className={`text-xs font-medium ${!bool('client_set_settings') ? 'text-green-700 dark:text-green-300' : 'text-yellow-700 dark:text-yellow-300'}`}>
                {!bool('client_set_settings') ? 'Managed' : 'Unmanaged'}
              </span>
            </Tooltip>
            <Tooltip text="Toggle server-managed mode — when ON the client tray is locked and server settings take effect">
              <Toggle checked={!bool('client_set_settings')} onChange={v => toggleManaged(v)} />
            </Tooltip>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="flex gap-6 overflow-x-auto">
            {tabs.map(t => {
              const tabTooltips: Record<string, string> = {
                paths: 'Which folders and files on this client to include or exclude from backups',
                schedule: 'How often backups run and how many snapshots to keep',
                transfer: 'Compression, encryption, speed limits, and data-plan caps',
                image: 'Bare-metal disk image backup volumes, VSS writers, and image style',
                permissions: 'What the client tray app is allowed to show or do',
                storage: 'Set a soft storage quota and alert thresholds for this endpoint',
              };
              return (
                <Tooltip key={t.id} text={tabTooltips[t.id] || t.label}>
                  <button onClick={() => setTab(t.id)}
                    className={`py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                      tab === t.id
                        ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                        : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                    }`}
                  >
                    {t.label}
                  </button>
                </Tooltip>
              );
            })}
          </nav>
        </div>

        <div className="space-y-4">

          {/* ── BACKUP PATHS ─────────────────────────────────────── */}
          {tab === 'paths' && (
            <>
              {noBackupPaths && bool('allow_config_paths') && (
                <div className="rounded-lg border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 p-4">
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">No backup paths on client</p>
                  <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                    The <strong>{clientName}</strong> client is reporting no backup paths.
                    Enable <strong>Server-managed paths</strong> below to use the server's configured path list, or configure paths on the client machine via the UrBackup tray icon.
                  </p>
                </div>
              )}
              <Section title="Folders to Back Up">
                <Row label="Server-managed paths" hint="When ON, the server's path list below is used. When OFF, the client decides its own backup paths via the tray icon.">
                  <Tooltip text="When ON, the server's path list is pushed to the client. When OFF, the client manages its own paths via the tray icon.">
                    <Toggle checked={!bool('allow_config_paths')} onChange={v => set('allow_config_paths', !v)} />
                  </Tooltip>
                </Row>
                {!bool('allow_config_paths') && (
                  <p className="text-xs text-green-600 dark:text-green-400">Server-managed paths active — the list below controls what gets backed up.</p>
                )}
                {bool('allow_config_paths') && (
                  <p className="text-xs text-gray-400">Client-managed — the client's own tray icon settings control what gets backed up. Paths below are ignored.</p>
                )}
                <div className="space-y-2">
                  {getPaths().length === 0
                    ? <p className="text-sm text-amber-600 dark:text-amber-400 italic">No backup paths configured — file backups will fail.</p>
                    : getPaths().map(path => (
                      <div key={path} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2">
                        <span className="flex-1 font-mono text-sm">{path}</span>
                        <Tooltip text={`Remove ${path} from the backup path list`}>
                          <button onClick={() => setPaths(getPaths().filter(p => p !== path))} className="text-red-500 hover:text-red-700">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </Tooltip>
                      </div>
                    ))
                  }
                </div>
                <div className="flex gap-2">
                  <Tooltip text="Type a Windows path to add — e.g. C:\Users or %USERPROFILE%" position="bottom">
                    <input type="text" value={newIncludePath} onChange={e => setNewIncludePath(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addPath()}
                      placeholder="e.g. C:\Users or %USERPROFILE%" className="input flex-1 font-mono text-sm" />
                  </Tooltip>
                  <Tooltip text="Add this path to the backup list">
                    <button onClick={addPath} className="btn btn-primary flex items-center gap-1"><Plus className="h-4 w-4" /> Add</button>
                  </Tooltip>
                  <Tooltip text="Browse the client's live filesystem to pick a folder">
                    <button onClick={() => setShowFileBrowser(true)} className="btn btn-secondary flex items-center gap-1">
                      <FolderSearch className="h-4 w-4" /> Browse
                    </button>
                  </Tooltip>
                </div>
                {showFileBrowser && (
                  <ClientFileBrowser
                    clientId={clientId}
                    onSelect={p => { if (!getPaths().includes(p)) setPaths([...getPaths(), p]); }}
                    onClose={() => setShowFileBrowser(false)}
                    existingPaths={getPaths()}
                  />
                )}
              </Section>

              <Section title="Exclude Patterns" collapsible>
                <p className="text-sm text-gray-500 dark:text-gray-400">Files/folders matching these patterns will be skipped. Semicolon-separated wildcards (e.g. <code className="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">*.tmp</code>, <code className="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">C:\Windows\Temp</code>).</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {getExcludes().length === 0
                    ? <p className="text-sm text-gray-400 italic">No exclusions configured.</p>
                    : getExcludes().map((pat, i) => (
                      <div key={i} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700/50 rounded px-3 py-1.5">
                        {editingExcludeIdx === i ? (
                          <>
                            <input
                              autoFocus
                              type="text"
                              value={editingExcludeVal}
                              onChange={e => setEditingExcludeVal(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  const v = editingExcludeVal.trim();
                                  if (v) { const arr = getExcludes(); arr[i] = v; setExcludes(arr); }
                                  setEditingExcludeIdx(null);
                                } else if (e.key === 'Escape') {
                                  setEditingExcludeIdx(null);
                                }
                              }}
                              className="input flex-1 font-mono text-xs py-0.5 h-6"
                            />
                            <Tooltip text="Save this exclusion pattern edit">
                              <button
                                onClick={() => {
                                  const v = editingExcludeVal.trim();
                                  if (v) { const arr = getExcludes(); arr[i] = v; setExcludes(arr); }
                                  setEditingExcludeIdx(null);
                                }}
                                className="text-green-600 hover:text-green-800 flex-shrink-0"
                              ><Check className="h-3.5 w-3.5" /></button>
                            </Tooltip>
                            <Tooltip text="Discard this edit">
                              <button onClick={() => setEditingExcludeIdx(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </Tooltip>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 font-mono text-xs truncate">{pat}</span>
                            <Tooltip text="Edit this exclusion pattern">
                              <button
                                onClick={() => { setEditingExcludeIdx(i); setEditingExcludeVal(pat); }}
                                className="text-gray-400 hover:text-primary-600 flex-shrink-0"
                              ><Pencil className="h-3 w-3" /></button>
                            </Tooltip>
                            <Tooltip text="Remove this exclusion pattern">
                              <button onClick={() => setExcludes(getExcludes().filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700 flex-shrink-0">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </Tooltip>
                          </>
                        )}
                      </div>
                    ))
                  }
                </div>
                <div className="flex gap-2">
                  <Tooltip text="Enter a path or wildcard pattern to exclude — e.g. *.tmp" position="bottom">
                    <input type="text" value={newExcludePattern} onChange={e => setNewExcludePattern(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addExclude()}
                      placeholder="e.g. *.tmp or C:\Windows\Temp\*" className="input flex-1 font-mono text-sm" />
                  </Tooltip>
                  <Tooltip text="Add this pattern to the exclusion list">
                    <button onClick={addExclude} className="btn btn-primary flex items-center gap-1"><Plus className="h-4 w-4" /> Add</button>
                  </Tooltip>
                </div>
                <Tooltip text="Replace exclusions with a curated list of Windows junctions, temp dirs, and OS files" position="bottom">
                  <button
                    onClick={() => setExcludes(getDefaults().exclude_files.split(';').filter(Boolean))}
                    className="text-sm text-primary-600 dark:text-primary-400 hover:underline text-left"
                  >
                    Apply default Windows exclusions (junction points, temp files, Windows dir)
                  </button>
                </Tooltip>
                <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-1">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Detect from last backup</p>
                    <Tooltip text="Scan the last backup log for paths that caused errors">
                      <button
                        onClick={detectFailedPaths}
                        disabled={failedPathsLoading || !clientId}
                        className="btn btn-secondary flex items-center gap-1 text-sm py-1"
                      >
                        {failedPathsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />}
                        Scan for failed paths
                      </button>
                    </Tooltip>
                  </div>
                  {failedPaths !== null && (
                    failedPaths.length === 0
                      ? <p className="text-sm text-gray-400 italic">No failed paths found in the last backup.</p>
                      : <>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                            These directories had files that couldn't be read during the last backup. Add them to exclusions to suppress errors.
                          </p>
                          <div className="space-y-1 max-h-40 overflow-y-auto mb-2">
                            {failedPaths.map(({ path, count }) => {
                              const alreadyExcluded = getExcludes().includes(path);
                              return (
                                <div key={path} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700/50 rounded px-3 py-1.5">
                                  <span className={`flex-1 font-mono text-xs truncate ${alreadyExcluded ? 'text-gray-400 line-through' : ''}`}>{path}</span>
                                  <span className="text-xs text-gray-400 flex-shrink-0">{count} {count === 1 ? 'error' : 'errors'}</span>
                                  {!alreadyExcluded && (
                                    <Tooltip text="Add this path to the exclusion list">
                                      <button
                                        onClick={() => setExcludes([...getExcludes(), path])}
                                        className="text-primary-600 dark:text-primary-400 hover:text-primary-800 flex-shrink-0"
                                      >
                                        <Plus className="h-3.5 w-3.5" />
                                      </button>
                                    </Tooltip>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {failedPaths.some(p => !getExcludes().includes(p.path)) && (
                            <Tooltip text="Add every failed path at once to suppress backup errors">
                              <button
                                onClick={() => addFailedPathsToExcludes(failedPaths)}
                                className="btn btn-primary text-sm py-1"
                              >
                                Add all to exclusions
                              </button>
                            </Tooltip>
                          )}
                        </>
                  )}
                </div>
                <div className="pt-2">
                  <Row label="Backup paths are optional" hint="If enabled, the backup will succeed even if backup paths don't exist on the client.">
                    <Tooltip text="Allow backup to succeed even when configured paths don't exist on the client">
                      <Toggle checked={bool('backup_dirs_optional')} onChange={v => set('backup_dirs_optional', v)} />
                    </Tooltip>
                  </Row>
                </div>
              </Section>
            </>
          )}

          {/* ── SCHEDULE & RETENTION ─────────────────────────────── */}
          {tab === 'schedule' && (
            <>
              <Section title="File Backup Schedule">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Tooltip text="How often to run file backups — minimum seconds between incremental runs" position="bottom">
                      <label className="label">Incremental interval (seconds)</label>
                    </Tooltip>
                    <Tooltip text="How often to run incremental file backups (seconds). Default: 18000 = 5 hrs" position="bottom">
                      <input type="number" className="input" value={s('update_freq_incr')} onChange={e => set('update_freq_incr', Number(e.target.value))} />
                    </Tooltip>
                    <p className="text-xs text-gray-400">Default: 18000 (5 hours)</p>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="How often to run a full file backup (all files re-transferred)" position="bottom">
                      <label className="label">Full backup interval (seconds)</label>
                    </Tooltip>
                    <Tooltip text="Seconds between full file backups. Default: 2592000 = 30 days" position="bottom">
                      <input type="number" className="input" value={s('update_freq_full')} onChange={e => set('update_freq_full', Number(e.target.value))} />
                    </Tooltip>
                    <p className="text-xs text-gray-400">Default: 2592000 (30 days)</p>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="Days/hours when incremental file backups are allowed. Format: 1-7/0-24" position="bottom">
                      <label className="label">Incremental backup window</label>
                    </Tooltip>
                    <Tooltip text="Time window for incremental file backups. e.g. 1-7/0-24 = any time" position="bottom">
                      <input type="text" className="input" value={s('backup_window_incr_file')} onChange={e => set('backup_window_incr_file', e.target.value)} />
                    </Tooltip>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="Days/hours when full file backups are allowed. Format: 1-7/0-24" position="bottom">
                      <label className="label">Full backup window</label>
                    </Tooltip>
                    <Tooltip text="Time window for full file backups. e.g. 1-7/0-24 = any time" position="bottom">
                      <input type="text" className="input" value={s('backup_window_full_file')} onChange={e => set('backup_window_full_file', e.target.value)} />
                    </Tooltip>
                    <p className="text-xs text-gray-400">Format: 1-7/0-24 (all week, all hours)</p>
                  </div>
                </div>
              </Section>

              <Section title="File Backup Retention">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Tooltip text="Number of incremental file backup snapshots to keep before oldest is deleted" position="bottom">
                      <label className="label">Max incremental backups</label>
                    </Tooltip>
                    <Tooltip text="Max incremental file backups to retain. Oldest are pruned when exceeded." position="bottom">
                      <input type="number" className="input" value={s('max_file_incr')} onChange={e => set('max_file_incr', Number(e.target.value))} />
                    </Tooltip>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="Number of full file backup snapshots to keep before oldest is deleted" position="bottom">
                      <label className="label">Max full backups</label>
                    </Tooltip>
                    <Tooltip text="Max full file backups to retain. Oldest are pruned when exceeded." position="bottom">
                      <input type="number" className="input" value={s('max_file_full')} onChange={e => set('max_file_full', Number(e.target.value))} />
                    </Tooltip>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="Minimum age in minutes before an incremental backup can be deleted" position="bottom">
                      <label className="label">Min incremental age (minutes)</label>
                    </Tooltip>
                    <Tooltip text="Protects recent incremental backups from early deletion (minutes)" position="bottom">
                      <input type="number" className="input" value={s('min_file_incr')} onChange={e => set('min_file_incr', Number(e.target.value))} />
                    </Tooltip>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="Minimum age in days before a full backup can be deleted" position="bottom">
                      <label className="label">Min full backup age (days)</label>
                    </Tooltip>
                    <Tooltip text="Protects recent full backups from early deletion (days)" position="bottom">
                      <input type="number" className="input" value={s('min_file_full')} onChange={e => set('min_file_full', Number(e.target.value))} />
                    </Tooltip>
                  </div>
                </div>
              </Section>

              <Section title="Image Backup Schedule">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Tooltip text="How often to run incremental disk image (bare-metal) backups" position="bottom">
                      <label className="label">Incremental interval (seconds)</label>
                    </Tooltip>
                    <Tooltip text="How often to run incremental image backups (seconds). Default: 604800 = 7 days" position="bottom">
                      <input type="number" className="input" value={s('update_freq_image_incr')} onChange={e => set('update_freq_image_incr', Number(e.target.value))} />
                    </Tooltip>
                    <p className="text-xs text-gray-400">Default: 604800 (7 days)</p>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="How often to run a full disk image backup (bare-metal)" position="bottom">
                      <label className="label">Full image interval (seconds)</label>
                    </Tooltip>
                    <Tooltip text="Seconds between full image backups. Default: 5184000 = 60 days" position="bottom">
                      <input type="number" className="input" value={s('update_freq_image_full')} onChange={e => set('update_freq_image_full', Number(e.target.value))} />
                    </Tooltip>
                    <p className="text-xs text-gray-400">Default: 5184000 (60 days)</p>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="Days/hours when incremental image backups are allowed" position="bottom">
                      <label className="label">Incremental image window</label>
                    </Tooltip>
                    <Tooltip text="Time window for incremental image backups. e.g. 1-7/0-24" position="bottom">
                      <input type="text" className="input" value={s('backup_window_incr_image')} onChange={e => set('backup_window_incr_image', e.target.value)} />
                    </Tooltip>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="Days/hours when full image backups are allowed" position="bottom">
                      <label className="label">Full image window</label>
                    </Tooltip>
                    <Tooltip text="Time window for full image backups. e.g. 1-7/0-24" position="bottom">
                      <input type="text" className="input" value={s('backup_window_full_image')} onChange={e => set('backup_window_full_image', e.target.value)} />
                    </Tooltip>
                  </div>
                </div>
              </Section>

              <Section title="Image Backup Retention">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Tooltip text="Number of incremental image backups to keep before oldest is deleted" position="bottom">
                      <label className="label">Max incremental image backups</label>
                    </Tooltip>
                    <Tooltip text="Max incremental image backups to retain. Oldest pruned when exceeded." position="bottom">
                      <input type="number" className="input" value={s('max_image_incr')} onChange={e => set('max_image_incr', Number(e.target.value))} />
                    </Tooltip>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="Number of full image backups to keep before oldest is deleted" position="bottom">
                      <label className="label">Max full image backups</label>
                    </Tooltip>
                    <Tooltip text="Max full image backups to retain. Oldest pruned when exceeded." position="bottom">
                      <input type="number" className="input" value={s('max_image_full')} onChange={e => set('max_image_full', Number(e.target.value))} />
                    </Tooltip>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="Minimum age in days before an incremental image backup can be deleted" position="bottom">
                      <label className="label">Min incremental age (days)</label>
                    </Tooltip>
                    <Tooltip text="Protects recent incremental image backups from early deletion (days)" position="bottom">
                      <input type="number" className="input" value={s('min_image_incr')} onChange={e => set('min_image_incr', Number(e.target.value))} />
                    </Tooltip>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="Minimum age in days before a full image backup can be deleted" position="bottom">
                      <label className="label">Min full image age (days)</label>
                    </Tooltip>
                    <Tooltip text="Protects recent full image backups from early deletion (days)" position="bottom">
                      <input type="number" className="input" value={s('min_image_full')} onChange={e => set('min_image_full', Number(e.target.value))} />
                    </Tooltip>
                  </div>
                </div>
              </Section>
            </>
          )}

          {/* ── TRANSFER ─────────────────────────────────────────── */}
          {tab === 'transfer' && (
            <>
              <Section title="Internet Transfer Modes">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Tooltip text="Transfer mode for full file backups over internet (raw, compressed, hashed, blockhash)" position="bottom">
                      <label className="label">Full file backup mode</label>
                    </Tooltip>
                    <Tooltip text="raw=send all data; hashed=skip unchanged; blockhash=block-level dedup" position="bottom">
                      <Select value={s('internet_full_file_transfer_mode') || 'raw'} onChange={v => set('internet_full_file_transfer_mode', v)} options={TRANSFER_MODES} />
                    </Tooltip>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="Transfer mode for incremental file backups over internet" position="bottom">
                      <label className="label">Incremental file backup mode</label>
                    </Tooltip>
                    <Tooltip text="blockhash recommended for internet — only changed blocks transferred" position="bottom">
                      <Select value={s('internet_incr_file_transfer_mode') || 'blockhash'} onChange={v => set('internet_incr_file_transfer_mode', v)} options={TRANSFER_MODES} />
                    </Tooltip>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="Transfer mode for disk image backups over internet" position="bottom">
                      <label className="label">Image backup mode</label>
                    </Tooltip>
                    <Tooltip text="raw=send full sectors; blockhash=only changed sectors (saves bandwidth)" position="bottom">
                      <Select value={s('internet_image_transfer_mode') || 'raw'} onChange={v => set('internet_image_transfer_mode', v)} options={TRANSFER_MODES} />
                    </Tooltip>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <Row label="Compress internet transfers" hint="Reduce bandwidth usage">
                    <Tooltip text="Compress data in transit to reduce internet bandwidth usage">
                      <Toggle checked={bool('internet_compress')} onChange={v => set('internet_compress', v)} />
                    </Tooltip>
                  </Row>
                  <Row label="Encrypt internet transfers" hint="End-to-end encryption">
                    <Tooltip text="Encrypt backup data end-to-end before sending over the internet">
                      <Toggle checked={bool('internet_encrypt')} onChange={v => set('internet_encrypt', v)} />
                    </Tooltip>
                  </Row>
                </div>
              </Section>

              <Section title="Local Transfer Modes">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Tooltip text="Transfer mode for full file backups on the local network" position="bottom">
                      <label className="label">Full file backup mode</label>
                    </Tooltip>
                    <Tooltip text="hashed recommended for LAN — only files with changed hash are transferred" position="bottom">
                      <Select value={s('local_full_file_transfer_mode') || 'hashed'} onChange={v => set('local_full_file_transfer_mode', v)} options={TRANSFER_MODES} />
                    </Tooltip>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="Transfer mode for incremental file backups on the local network" position="bottom">
                      <label className="label">Incremental file backup mode</label>
                    </Tooltip>
                    <Tooltip text="hashed recommended for LAN incremental — skips unchanged files efficiently" position="bottom">
                      <Select value={s('local_incr_file_transfer_mode') || 'hashed'} onChange={v => set('local_incr_file_transfer_mode', v)} options={TRANSFER_MODES} />
                    </Tooltip>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="Transfer mode for disk image backups on the local network" position="bottom">
                      <label className="label">Image backup mode</label>
                    </Tooltip>
                    <Tooltip text="hashed = only changed blocks sent; raw = full disk sectors every time" position="bottom">
                      <Select value={s('local_image_transfer_mode') || 'hashed'} onChange={v => set('local_image_transfer_mode', v)} options={TRANSFER_MODES} />
                    </Tooltip>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <Row label="Compress local transfers">
                    <Tooltip text="Compress data on LAN transfers — usually not needed on fast local networks">
                      <Toggle checked={bool('local_compress')} onChange={v => set('local_compress', v)} />
                    </Tooltip>
                  </Row>
                  <Row label="Encrypt local transfers">
                    <Tooltip text="Encrypt backup data on the local network — adds CPU overhead">
                      <Toggle checked={bool('local_encrypt')} onChange={v => set('local_encrypt', v)} />
                    </Tooltip>
                  </Row>
                </div>
              </Section>

              <Section title="Speed Limits &amp; Data Plans">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Tooltip text="Max internet backup speed in bytes/sec — use -1 for unlimited" position="bottom">
                      <label className="label">Internet speed limit (bytes/s, -1 = unlimited)</label>
                    </Tooltip>
                    <Tooltip text="Throttle internet backup bandwidth. -1 = no limit. e.g. 1048576 = 1 MB/s" position="bottom">
                      <input type="number" className="input" value={s('internet_speed')} onChange={e => set('internet_speed', Number(e.target.value))} />
                    </Tooltip>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="Max local network backup speed in bytes/sec — use -1 for unlimited" position="bottom">
                      <label className="label">Local speed limit (bytes/s, -1 = unlimited)</label>
                    </Tooltip>
                    <Tooltip text="Throttle LAN backup bandwidth. -1 = no limit. e.g. 104857600 = 100 MB/s" position="bottom">
                      <input type="number" className="input" value={s('local_speed')} onChange={e => set('local_speed', Number(e.target.value))} />
                    </Tooltip>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="Max bytes of file backup data transferred per billing period over internet" position="bottom">
                      <label className="label">File data plan limit (bytes)</label>
                    </Tooltip>
                    <Tooltip text="Monthly data cap for internet file backups. Default 5 GB = 5242880000" position="bottom">
                      <input type="number" className="input" value={s('internet_file_dataplan_limit')} onChange={e => set('internet_file_dataplan_limit', Number(e.target.value))} />
                    </Tooltip>
                    <p className="text-xs text-gray-400">Default: 5 GB (5242880000)</p>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="Max bytes of image backup data transferred per billing period over internet" position="bottom">
                      <label className="label">Image data plan limit (bytes)</label>
                    </Tooltip>
                    <Tooltip text="Monthly data cap for internet image backups. Default 20 GB = 20971520000" position="bottom">
                      <input type="number" className="input" value={s('internet_image_dataplan_limit')} onChange={e => set('internet_image_dataplan_limit', Number(e.target.value))} />
                    </Tooltip>
                    <p className="text-xs text-gray-400">Default: 20 GB (20971520000)</p>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="Total storage quota for this client in bytes — leave empty for no limit" position="bottom">
                      <label className="label">Client quota (bytes, empty = unlimited)</label>
                    </Tooltip>
                    <Tooltip text="Hard storage quota for this client's backups on the server (bytes)" position="bottom">
                      <input type="text" className="input" value={s('client_quota') || ''} onChange={e => set('client_quota', e.target.value)} />
                    </Tooltip>
                  </div>
                </div>
              </Section>

              <Section title="Internet Mode" collapsible>
                <Row label="Enable internet mode" hint="Allow this client to back up over the internet">
                  <Tooltip text="Allow this client to connect and back up over the internet">
                    <Toggle checked={bool('internet_mode_enabled')} onChange={v => set('internet_mode_enabled', v)} />
                  </Tooltip>
                </Row>
                <Row label="Enable internet file backups">
                  <Tooltip text="Allow file backups when this client connects via the internet">
                    <Toggle checked={bool('internet_full_file_backups')} onChange={v => set('internet_full_file_backups', v)} />
                  </Tooltip>
                </Row>
                <Row label="Enable internet image backups">
                  <Tooltip text="Allow disk image (bare-metal) backups when connected via the internet">
                    <Toggle checked={bool('internet_image_backups')} onChange={v => set('internet_image_backups', v)} />
                  </Tooltip>
                </Row>
              </Section>
            </>
          )}

          {/* ── IMAGE BACKUP ─────────────────────────────────────── */}
          {tab === 'image' && (
            <>
              <Section title="Volumes to Image">
                <div className="space-y-2">
                  <Tooltip text="Which drive letters to capture in disk image backups — e.g. C or C D or ALL" position="bottom">
                    <label className="label">Drive letters to include (comma or space separated)</label>
                  </Tooltip>
                  <Tooltip text="Enter drive letters to image. e.g. C for system drive, or ALL for every volume" position="bottom">
                    <input type="text" className="input font-mono" value={s('image_letters') || 'C'} onChange={e => set('image_letters', e.target.value)} placeholder="C" />
                  </Tooltip>
                  <p className="text-xs text-gray-400">e.g. <code className="font-mono">C</code> or <code className="font-mono">C D E</code> — use <code className="font-mono">ALL</code> for all volumes</p>
                </div>
              </Section>

              <Section title="VSS Components" collapsible>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Select Windows VSS writer components to include in image backups. These are only available if the relevant Windows role/feature is installed on the client.</p>
                <div className="space-y-2">
                  {VSS_COMPONENTS.map(comp => (
                    <Row key={comp.id} label={comp.label}>
                      <Tooltip text={`Include the ${comp.label} VSS writer in image backups`}>
                        <Toggle checked={getVssComponents().includes(comp.id)} onChange={() => toggleVss(comp.id)} />
                      </Tooltip>
                    </Row>
                  ))}
                </div>
                <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                  <div className="space-y-1">
                    <Tooltip text="Raw semicolon-separated VSS component string sent directly to UrBackup" position="bottom">
                      <label className="label text-xs">Raw VSS components string</label>
                    </Tooltip>
                    <Tooltip text="Advanced: edit the raw VSS component selection string. Format: Name=1;Name2=1" position="bottom">
                      <input type="text" className="input font-mono text-xs" value={s('vss_select_components') || 'default=1'}
                        onChange={e => set('vss_select_components', e.target.value)} />
                    </Tooltip>
                  </div>
                </div>
              </Section>

              <Section title="Image Style">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Tooltip text="How full image backups are created over internet — synthetic builds incrementally" position="bottom">
                      <label className="label">Internet full image style</label>
                    </Tooltip>
                    <Tooltip text="synthetic: builds a new full by applying increments (saves bandwidth); full: complete retransfer" position="bottom">
                      <Select value={s('internet_full_image_style') || 'synthetic'} onChange={v => set('internet_full_image_style', v)} options={IMAGE_STYLES_FULL} />
                    </Tooltip>
                    <p className="text-xs text-gray-400">Synthetic: incremental approach saving bandwidth</p>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="How incremental image backups reference previous images over internet" position="bottom">
                      <label className="label">Internet incremental image style</label>
                    </Tooltip>
                    <Tooltip text="to-last: increments chain to last backup; to-full: increments all reference the last full" position="bottom">
                      <Select value={s('internet_incr_image_style') || 'to-last'} onChange={v => set('internet_incr_image_style', v)} options={IMAGE_STYLES_INCR} />
                    </Tooltip>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="How full image backups are created on the local network" position="bottom">
                      <label className="label">Local full image style</label>
                    </Tooltip>
                    <Tooltip text="full: complete disk image; synthetic: builds new full from increments" position="bottom">
                      <Select value={s('local_full_image_style') || 'full'} onChange={v => set('local_full_image_style', v)} options={IMAGE_STYLES_FULL} />
                    </Tooltip>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="How incremental image backups reference previous images on the local network" position="bottom">
                      <label className="label">Local incremental image style</label>
                    </Tooltip>
                    <Tooltip text="to-full: all increments reference the last full; to-last: chain to previous" position="bottom">
                      <Select value={s('local_incr_image_style') || 'to-full'} onChange={v => set('local_incr_image_style', v)} options={IMAGE_STYLES_INCR} />
                    </Tooltip>
                  </div>
                </div>
              </Section>

              <Section title="Changed Block Tracking" collapsible>
                <div className="space-y-1">
                  <Tooltip text="Drives to use CBT on — tracks only changed disk blocks for faster image backups" position="bottom">
                    <label className="label">CBT volumes (comma-separated drive letters or ALL)</label>
                  </Tooltip>
                  <Tooltip text="Changed Block Tracking volumes. ALL = track every drive. e.g. C D" position="bottom">
                    <input type="text" className="input font-mono" value={s('cbt_volumes') || 'ALL'} onChange={e => set('cbt_volumes', e.target.value)} />
                  </Tooltip>
                </div>
              </Section>
            </>
          )}

          {/* ── PERMISSIONS ──────────────────────────────────────── */}
          {tab === 'permissions' && (
            <>
              <Section title="Client Control">
                <Row label="Silent update" hint="Update client silently without user interaction">
                  <Tooltip text="Install client software updates silently without showing prompts to the user">
                    <Toggle checked={bool('silent_update')} onChange={v => set('silent_update', v)} />
                  </Tooltip>
                </Row>
                <Row label="Background backups" hint="Run backups in the background">
                  <Tooltip text="Run backups as a background service with no user-visible progress window">
                    <Toggle checked={bool('background_backups')} onChange={v => set('background_backups', v)} />
                  </Tooltip>
                </Row>
                <Row label="Allow tray exit" hint="Allow user to exit the tray icon application">
                  <Tooltip text="When OFF the user cannot quit the UrBackup tray icon (requires managed mode)">
                    <Toggle checked={bool('allow_tray_exit')} onChange={v => set('allow_tray_exit', v)} />
                  </Tooltip>
                </Row>
                <div className="pt-2">
                  <div className="space-y-1">
                    <Tooltip text="Delay in seconds before the first backup runs after the client starts" position="bottom">
                      <label className="label">Startup backup delay (seconds)</label>
                    </Tooltip>
                    <Tooltip text="Wait this many seconds after client startup before triggering the first backup" position="bottom">
                      <input type="number" className="input w-40" value={s('startup_backup_delay') || 0} onChange={e => set('startup_backup_delay', Number(e.target.value))} />
                    </Tooltip>
                  </div>
                </div>
              </Section>

              <Section title="Manual Backup Actions">
                <Row label="Allow starting full file backups">
                  <Tooltip text="Allow the user to manually trigger a full file backup from the tray">
                    <Toggle checked={bool('allow_starting_full_file_backups')} onChange={v => set('allow_starting_full_file_backups', v)} />
                  </Tooltip>
                </Row>
                <Row label="Allow starting incremental file backups">
                  <Tooltip text="Allow the user to manually trigger an incremental file backup from the tray">
                    <Toggle checked={bool('allow_starting_incr_file_backups')} onChange={v => set('allow_starting_incr_file_backups', v)} />
                  </Tooltip>
                </Row>
                <Row label="Allow starting full image backups">
                  <Tooltip text="Allow the user to manually trigger a full disk image backup from the tray">
                    <Toggle checked={bool('allow_starting_full_image_backups')} onChange={v => set('allow_starting_full_image_backups', v)} />
                  </Tooltip>
                </Row>
                <Row label="Allow starting incremental image backups">
                  <Tooltip text="Allow the user to manually trigger an incremental image backup from the tray">
                    <Toggle checked={bool('allow_starting_incr_image_backups')} onChange={v => set('allow_starting_incr_image_backups', v)} />
                  </Tooltip>
                </Row>
              </Section>

              <Section title="Restore &amp; View Permissions">
                <Row label="Allow file restore">
                  <Tooltip text="Allow the user to restore individual files from backups via the tray">
                    <Toggle checked={bool('allow_file_restore')} onChange={v => set('allow_file_restore', v)} />
                  </Tooltip>
                </Row>
                <Row label="Allow component restore">
                  <Tooltip text="Allow the user to restore VSS components (e.g. Active Directory, Exchange)">
                    <Toggle checked={bool('allow_component_restore')} onChange={v => set('allow_component_restore', v)} />
                  </Tooltip>
                </Row>
                <Row label="Allow component config">
                  <Tooltip text="Allow the user to configure which VSS components are backed up">
                    <Toggle checked={bool('allow_component_config')} onChange={v => set('allow_component_config', v)} />
                  </Tooltip>
                </Row>
                <Row label="Allow log view">
                  <Tooltip text="Allow the user to view backup logs in the tray application">
                    <Toggle checked={bool('allow_log_view')} onChange={v => set('allow_log_view', v)} />
                  </Tooltip>
                </Row>
                <Row label="Allow overwrite">
                  <Tooltip text="Allow restoring files over existing files — shows settings panel in the tray">
                    <Toggle checked={bool('allow_overwrite')} onChange={v => set('allow_overwrite', v)} />
                  </Tooltip>
                </Row>
                <Row label="Allow pause">
                  <Tooltip text="Allow the user to pause/resume backups from the tray icon">
                    <Toggle checked={bool('allow_pause')} onChange={v => set('allow_pause', v)} />
                  </Tooltip>
                </Row>
              </Section>

              <Section title="Verification" collapsible>
                <Row label="End-to-end file backup verification" hint="Verify backup integrity after each file backup (slower)">
                  <Tooltip text="After each file backup, verify every file's hash matches — slower but detects corruption">
                    <Toggle checked={bool('end_to_end_file_backup_verification')} onChange={v => set('end_to_end_file_backup_verification', v)} />
                  </Tooltip>
                </Row>
              </Section>
            </>
          )}

          {/* ── STORAGE LIMIT ────────────────────────────────────── */}
          {tab === 'storage' && (
            <div className="space-y-6">
              {limitMessage && (
                <div className={`rounded-lg p-4 ${limitMessage.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'}`}>
                  {limitMessage.text}
                </div>
              )}

              <Section title="Storage Limit">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Set a soft storage limit for this endpoint. A warning is shown on the Endpoints page when usage approaches or exceeds the limit. This does not hard-block backups.
                </p>

                {storageLimit?.has_limit && storageLimit.limit_bytes && storageLimit.used_bytes !== undefined && storageLimit.used_bytes > 0 && (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-700 dark:text-gray-300">Current usage</span>
                      <span className={`font-semibold ${storageLimit.status === 'exceeded' || storageLimit.status === 'critical' ? 'text-red-600 dark:text-red-400' : storageLimit.status === 'warning' ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-700 dark:text-gray-300'}`}>
                        {((storageLimit.used_bytes ?? 0) / 1e9).toFixed(1)} GB / {(storageLimit.limit_bytes / 1e9).toFixed(1)} GB
                        {(storageLimit.pct ?? 0) > 0 && ` (${Math.round(storageLimit.pct ?? 0)}%)`}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${storageLimit.status === 'exceeded' || storageLimit.status === 'critical' ? 'bg-red-500' : storageLimit.status === 'warning' ? 'bg-yellow-400' : 'bg-green-500'}`}
                        style={{ width: `${Math.min(storageLimit.pct ?? 0, 100)}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      {(storageLimit.status === 'warning') && (
                        <Tooltip text={`Usage is at ${Math.round(storageLimit.pct ?? 0)}% — approaching the configured limit`}>
                          <span className="flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5 text-yellow-500" /> Approaching limit</span>
                        </Tooltip>
                      )}
                      {(storageLimit.status === 'critical' || storageLimit.status === 'exceeded') && (
                        <Tooltip text={`Usage is at ${Math.round(storageLimit.pct ?? 0)}% — the configured limit has been reached or exceeded`}>
                          <span className="flex items-center gap-1"><XCircle className="h-3.5 w-3.5 text-red-500" /> Limit exceeded</span>
                        </Tooltip>
                      )}
                      {(storageLimit.status === 'ok') && (
                        <Tooltip text={`Usage is at ${Math.round(storageLimit.pct ?? 0)}% — well within the configured limit`}>
                          <span className="flex items-center gap-1"><HardDrive className="h-3.5 w-3.5 text-green-500" /> Within limit</span>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Tooltip text="Maximum storage this endpoint's backups should use on the server" position="bottom">
                      <label className="label">Storage limit</label>
                    </Tooltip>
                    <div className="flex gap-2">
                      <Tooltip text="Enter the numeric storage limit value for this endpoint" position="bottom">
                        <input
                          type="number"
                          min="0.1"
                          step="0.1"
                          className="input flex-1"
                          placeholder={storageLimit?.has_limit ? '' : 'No limit set'}
                          value={limitInput}
                          onChange={e => setLimitInput(e.target.value)}
                        />
                      </Tooltip>
                      <Tooltip text="Select the unit for the storage limit: GB or TB">
                        <select value={limitUnit} onChange={e => setLimitUnit(e.target.value as 'GB' | 'TB')} className="input w-20">
                          <option value="GB">GB</option>
                          <option value="TB">TB</option>
                        </select>
                      </Tooltip>
                    </div>
                  </div>
                  <div className="space-y-1" />
                  <div className="space-y-1">
                    <Tooltip text="Show a warning badge on the Endpoints page when usage hits this percentage" position="bottom">
                      <label className="label">Warn at (%)</label>
                    </Tooltip>
                    <Tooltip text="Percentage of limit at which a yellow warning badge is shown" position="bottom">
                      <input type="number" min="1" max="99" className="input" value={limitWarn} onChange={e => setLimitWarn(Number(e.target.value))} />
                    </Tooltip>
                    <p className="text-xs text-gray-400">Show warning badge when usage reaches this %</p>
                  </div>
                  <div className="space-y-1">
                    <Tooltip text="Show a red critical badge on the Endpoints page when usage hits this percentage" position="bottom">
                      <label className="label">Critical at (%)</label>
                    </Tooltip>
                    <Tooltip text="Percentage of limit at which a red critical/exceeded badge is shown" position="bottom">
                      <input type="number" min="1" max="100" className="input" value={limitCritical} onChange={e => setLimitCritical(Number(e.target.value))} />
                    </Tooltip>
                    <p className="text-xs text-gray-400">Show critical/exceeded badge when usage reaches this %</p>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Tooltip text={storageLimit?.has_limit ? 'Update the storage limit for this endpoint' : 'Set a new storage limit for this endpoint'}>
                    <button onClick={saveStorageLimit} disabled={savingLimit || !limitInput} className="btn btn-primary flex items-center gap-2 disabled:opacity-50">
                      <Save className="h-4 w-4" /> {savingLimit ? 'Saving…' : storageLimit?.has_limit ? 'Update Limit' : 'Set Limit'}
                    </button>
                  </Tooltip>
                  {storageLimit?.has_limit && (
                    <Tooltip text="Remove the storage limit for this endpoint — usage will be unconstrained">
                      <button onClick={removeStorageLimit} disabled={savingLimit} className="btn bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-red-300 disabled:opacity-50">
                        Remove Limit
                      </button>
                    </Tooltip>
                  )}
                </div>
              </Section>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
