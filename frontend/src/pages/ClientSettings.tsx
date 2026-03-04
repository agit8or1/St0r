import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import { ArrowLeft, Save, Settings as SettingsIcon, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';

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
  const [tab, setTab] = useState<'paths' | 'schedule' | 'transfer' | 'image' | 'permissions'>('paths');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [noBackupPaths, setNoBackupPaths] = useState(false);
  const [newIncludePath, setNewIncludePath] = useState('');
  const [newExcludePattern, setNewExcludePattern] = useState('');

  useEffect(() => { loadSettings(); }, [clientName]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const clients = await (await fetch('/api/urbackup/clients', { credentials: 'include' })).json();
      const foundClient = clients.find((c: any) => c.name === clientName);
      if (!foundClient?.id) throw new Error('Client not found');
      setClientId(foundClient.id);
      setNoBackupPaths(foundClient.no_backup_paths === true);

      const response = await fetch(`/api/client-settings/${foundClient.id}`, { credentials: 'include' });
      if (response.status === 404) { setSettings(getDefaults()); return; }
      if (!response.ok) throw new Error('Failed to load settings');

      const data = await response.json();
      const raw = data.settings || data;
      // Merge with defaults so all fields are always present
      setSettings({ ...getDefaults(), ...raw });
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
    // UrBackup's standard Windows exclusions (matches client defaults)
    exclude_files: [
      ':\\pagefile.sys',
      ':\\hiberfil.sys',
      ':\\swapfile.sys',
      ':\\$Recycle.Bin',
      ':\\System Volume Information',
      'C:\\Windows',
      'C:\\Windows.old',
      'C:\\$Windows.~BT',
      'C:\\$GetCurrent',
      'C:\\Program Files',
      'C:\\Program Files (x86)',
      'C:\\ProgramData',
      'C:\\Windows\\Temp',
      'C:\\Users\\*\\AppData\\Local\\Temp',
      'C:\\Users\\*\\AppData\\Local\\Microsoft\\Windows\\Temporary Internet Files',
      'C:\\Users\\*\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache',
      'C:\\Users\\*\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Media Cache',
      'C:\\Users\\*\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Code Cache',
      'C:\\Users\\*\\AppData\\Local\\Mozilla\\Firefox\\Profiles\\*\\cache2',
      'C:\\Users\\*\\AppData\\Local\\Mozilla\\Firefox\\Profiles\\*\\cache',
      'C:\\Users\\*\\AppData\\Local\\Microsoft\\Windows\\Explorer\\thumbcache*',
      'C:\\ProgramData\\Microsoft\\Windows Defender\\Scans\\mpcache-*',
      'C:\\ProgramData\\Microsoft\\Network\\Downloader\\*',
      'C:\\Windows\\softwaredistribution\\*.*',
      'C:\\ProgramData\\Microsoft\\Windows\\WER\\*',
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
  ] as const;

  if (loading) return <Layout><Loading /></Layout>;

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <button
              onClick={() => navigate(`/clients/${encodeURIComponent(clientName!)}`)}
              className="mb-2 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
            >
              <ArrowLeft className="h-4 w-4" /> Back to Endpoint
            </button>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
              <SettingsIcon className="h-8 w-8" /> Endpoint Settings — {clientName}
            </h1>
          </div>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary flex items-center gap-2">
            <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>

        {message && (
          <div className={`rounded-lg p-4 ${message.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'}`}>
            {message.text}
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="flex gap-6 overflow-x-auto">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                  tab === t.id
                    ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                {t.label}
              </button>
            ))}
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
                  <Toggle checked={!bool('allow_config_paths')} onChange={v => set('allow_config_paths', !v)} />
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
                        <button onClick={() => setPaths(getPaths().filter(p => p !== path))} className="text-red-500 hover:text-red-700">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))
                  }
                </div>
                <div className="flex gap-2">
                  <input type="text" value={newIncludePath} onChange={e => setNewIncludePath(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addPath()}
                    placeholder="e.g. C:\Users or %USERPROFILE%" className="input flex-1 font-mono text-sm" />
                  <button onClick={addPath} className="btn btn-primary flex items-center gap-1"><Plus className="h-4 w-4" /> Add</button>
                </div>
              </Section>

              <Section title="Exclude Patterns" collapsible>
                <p className="text-sm text-gray-500 dark:text-gray-400">Files/folders matching these patterns will be skipped. Semicolon-separated wildcards (e.g. <code className="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">*.tmp</code>, <code className="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">C:\Windows\Temp</code>).</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {getExcludes().length === 0
                    ? <p className="text-sm text-gray-400 italic">No exclusions configured.</p>
                    : getExcludes().map((pat, i) => (
                      <div key={i} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700/50 rounded px-3 py-1.5">
                        <span className="flex-1 font-mono text-xs truncate">{pat}</span>
                        <button onClick={() => setExcludes(getExcludes().filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700 flex-shrink-0">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))
                  }
                </div>
                <div className="flex gap-2">
                  <input type="text" value={newExcludePattern} onChange={e => setNewExcludePattern(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addExclude()}
                    placeholder="e.g. *.tmp or C:\Windows\Temp\*" className="input flex-1 font-mono text-sm" />
                  <button onClick={addExclude} className="btn btn-primary flex items-center gap-1"><Plus className="h-4 w-4" /> Add</button>
                </div>
                <div className="pt-2">
                  <Row label="Backup paths are optional" hint="If enabled, the backup will succeed even if backup paths don't exist on the client.">
                    <Toggle checked={bool('backup_dirs_optional')} onChange={v => set('backup_dirs_optional', v)} />
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
                    <label className="label">Incremental interval (seconds)</label>
                    <input type="number" className="input" value={s('update_freq_incr')} onChange={e => set('update_freq_incr', Number(e.target.value))} />
                    <p className="text-xs text-gray-400">Default: 18000 (5 hours)</p>
                  </div>
                  <div className="space-y-1">
                    <label className="label">Full backup interval (seconds)</label>
                    <input type="number" className="input" value={s('update_freq_full')} onChange={e => set('update_freq_full', Number(e.target.value))} />
                    <p className="text-xs text-gray-400">Default: 2592000 (30 days)</p>
                  </div>
                  <div className="space-y-1">
                    <label className="label">Incremental backup window</label>
                    <input type="text" className="input" value={s('backup_window_incr_file')} onChange={e => set('backup_window_incr_file', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Full backup window</label>
                    <input type="text" className="input" value={s('backup_window_full_file')} onChange={e => set('backup_window_full_file', e.target.value)} />
                    <p className="text-xs text-gray-400">Format: 1-7/0-24 (all week, all hours)</p>
                  </div>
                </div>
              </Section>

              <Section title="File Backup Retention">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="label">Max incremental backups</label>
                    <input type="number" className="input" value={s('max_file_incr')} onChange={e => set('max_file_incr', Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Max full backups</label>
                    <input type="number" className="input" value={s('max_file_full')} onChange={e => set('max_file_full', Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Min incremental age (minutes)</label>
                    <input type="number" className="input" value={s('min_file_incr')} onChange={e => set('min_file_incr', Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Min full backup age (days)</label>
                    <input type="number" className="input" value={s('min_file_full')} onChange={e => set('min_file_full', Number(e.target.value))} />
                  </div>
                </div>
              </Section>

              <Section title="Image Backup Schedule">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="label">Incremental interval (seconds)</label>
                    <input type="number" className="input" value={s('update_freq_image_incr')} onChange={e => set('update_freq_image_incr', Number(e.target.value))} />
                    <p className="text-xs text-gray-400">Default: 604800 (7 days)</p>
                  </div>
                  <div className="space-y-1">
                    <label className="label">Full image interval (seconds)</label>
                    <input type="number" className="input" value={s('update_freq_image_full')} onChange={e => set('update_freq_image_full', Number(e.target.value))} />
                    <p className="text-xs text-gray-400">Default: 5184000 (60 days)</p>
                  </div>
                  <div className="space-y-1">
                    <label className="label">Incremental image window</label>
                    <input type="text" className="input" value={s('backup_window_incr_image')} onChange={e => set('backup_window_incr_image', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Full image window</label>
                    <input type="text" className="input" value={s('backup_window_full_image')} onChange={e => set('backup_window_full_image', e.target.value)} />
                  </div>
                </div>
              </Section>

              <Section title="Image Backup Retention">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="label">Max incremental image backups</label>
                    <input type="number" className="input" value={s('max_image_incr')} onChange={e => set('max_image_incr', Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Max full image backups</label>
                    <input type="number" className="input" value={s('max_image_full')} onChange={e => set('max_image_full', Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Min incremental age (days)</label>
                    <input type="number" className="input" value={s('min_image_incr')} onChange={e => set('min_image_incr', Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Min full image age (days)</label>
                    <input type="number" className="input" value={s('min_image_full')} onChange={e => set('min_image_full', Number(e.target.value))} />
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
                    <label className="label">Full file backup mode</label>
                    <Select value={s('internet_full_file_transfer_mode') || 'raw'} onChange={v => set('internet_full_file_transfer_mode', v)} options={TRANSFER_MODES} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Incremental file backup mode</label>
                    <Select value={s('internet_incr_file_transfer_mode') || 'blockhash'} onChange={v => set('internet_incr_file_transfer_mode', v)} options={TRANSFER_MODES} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Image backup mode</label>
                    <Select value={s('internet_image_transfer_mode') || 'raw'} onChange={v => set('internet_image_transfer_mode', v)} options={TRANSFER_MODES} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <Row label="Compress internet transfers" hint="Reduce bandwidth usage"><Toggle checked={bool('internet_compress')} onChange={v => set('internet_compress', v)} /></Row>
                  <Row label="Encrypt internet transfers" hint="End-to-end encryption"><Toggle checked={bool('internet_encrypt')} onChange={v => set('internet_encrypt', v)} /></Row>
                </div>
              </Section>

              <Section title="Local Transfer Modes">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="label">Full file backup mode</label>
                    <Select value={s('local_full_file_transfer_mode') || 'hashed'} onChange={v => set('local_full_file_transfer_mode', v)} options={TRANSFER_MODES} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Incremental file backup mode</label>
                    <Select value={s('local_incr_file_transfer_mode') || 'hashed'} onChange={v => set('local_incr_file_transfer_mode', v)} options={TRANSFER_MODES} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Image backup mode</label>
                    <Select value={s('local_image_transfer_mode') || 'hashed'} onChange={v => set('local_image_transfer_mode', v)} options={TRANSFER_MODES} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <Row label="Compress local transfers"><Toggle checked={bool('local_compress')} onChange={v => set('local_compress', v)} /></Row>
                  <Row label="Encrypt local transfers"><Toggle checked={bool('local_encrypt')} onChange={v => set('local_encrypt', v)} /></Row>
                </div>
              </Section>

              <Section title="Speed Limits &amp; Data Plans">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="label">Internet speed limit (bytes/s, -1 = unlimited)</label>
                    <input type="number" className="input" value={s('internet_speed')} onChange={e => set('internet_speed', Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Local speed limit (bytes/s, -1 = unlimited)</label>
                    <input type="number" className="input" value={s('local_speed')} onChange={e => set('local_speed', Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">File data plan limit (bytes)</label>
                    <input type="number" className="input" value={s('internet_file_dataplan_limit')} onChange={e => set('internet_file_dataplan_limit', Number(e.target.value))} />
                    <p className="text-xs text-gray-400">Default: 5 GB (5242880000)</p>
                  </div>
                  <div className="space-y-1">
                    <label className="label">Image data plan limit (bytes)</label>
                    <input type="number" className="input" value={s('internet_image_dataplan_limit')} onChange={e => set('internet_image_dataplan_limit', Number(e.target.value))} />
                    <p className="text-xs text-gray-400">Default: 20 GB (20971520000)</p>
                  </div>
                  <div className="space-y-1">
                    <label className="label">Client quota (bytes, empty = unlimited)</label>
                    <input type="text" className="input" value={s('client_quota') || ''} onChange={e => set('client_quota', e.target.value)} />
                  </div>
                </div>
              </Section>

              <Section title="Internet Mode" collapsible>
                <Row label="Enable internet mode" hint="Allow this client to back up over the internet">
                  <Toggle checked={bool('internet_mode_enabled')} onChange={v => set('internet_mode_enabled', v)} />
                </Row>
                <Row label="Enable internet file backups">
                  <Toggle checked={bool('internet_full_file_backups')} onChange={v => set('internet_full_file_backups', v)} />
                </Row>
                <Row label="Enable internet image backups">
                  <Toggle checked={bool('internet_image_backups')} onChange={v => set('internet_image_backups', v)} />
                </Row>
              </Section>
            </>
          )}

          {/* ── IMAGE BACKUP ─────────────────────────────────────── */}
          {tab === 'image' && (
            <>
              <Section title="Volumes to Image">
                <div className="space-y-2">
                  <label className="label">Drive letters to include (comma or space separated)</label>
                  <input type="text" className="input font-mono" value={s('image_letters') || 'C'} onChange={e => set('image_letters', e.target.value)} placeholder="C" />
                  <p className="text-xs text-gray-400">e.g. <code className="font-mono">C</code> or <code className="font-mono">C D E</code> — use <code className="font-mono">ALL</code> for all volumes</p>
                </div>
              </Section>

              <Section title="VSS Components" collapsible>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Select Windows VSS writer components to include in image backups. These are only available if the relevant Windows role/feature is installed on the client.</p>
                <div className="space-y-2">
                  {VSS_COMPONENTS.map(comp => (
                    <Row key={comp.id} label={comp.label}>
                      <Toggle checked={getVssComponents().includes(comp.id)} onChange={() => toggleVss(comp.id)} />
                    </Row>
                  ))}
                </div>
                <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                  <div className="space-y-1">
                    <label className="label text-xs">Raw VSS components string</label>
                    <input type="text" className="input font-mono text-xs" value={s('vss_select_components') || 'default=1'}
                      onChange={e => set('vss_select_components', e.target.value)} />
                  </div>
                </div>
              </Section>

              <Section title="Image Style">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="label">Internet full image style</label>
                    <Select value={s('internet_full_image_style') || 'synthetic'} onChange={v => set('internet_full_image_style', v)} options={IMAGE_STYLES_FULL} />
                    <p className="text-xs text-gray-400">Synthetic: incremental approach saving bandwidth</p>
                  </div>
                  <div className="space-y-1">
                    <label className="label">Internet incremental image style</label>
                    <Select value={s('internet_incr_image_style') || 'to-last'} onChange={v => set('internet_incr_image_style', v)} options={IMAGE_STYLES_INCR} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Local full image style</label>
                    <Select value={s('local_full_image_style') || 'full'} onChange={v => set('local_full_image_style', v)} options={IMAGE_STYLES_FULL} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Local incremental image style</label>
                    <Select value={s('local_incr_image_style') || 'to-full'} onChange={v => set('local_incr_image_style', v)} options={IMAGE_STYLES_INCR} />
                  </div>
                </div>
              </Section>

              <Section title="Changed Block Tracking" collapsible>
                <div className="space-y-1">
                  <label className="label">CBT volumes (comma-separated drive letters or ALL)</label>
                  <input type="text" className="input font-mono" value={s('cbt_volumes') || 'ALL'} onChange={e => set('cbt_volumes', e.target.value)} />
                </div>
              </Section>
            </>
          )}

          {/* ── PERMISSIONS ──────────────────────────────────────── */}
          {tab === 'permissions' && (
            <>
              <Section title="Client Control">
                <Row label="Silent update" hint="Update client silently without user interaction">
                  <Toggle checked={bool('silent_update')} onChange={v => set('silent_update', v)} />
                </Row>
                <Row label="Background backups" hint="Run backups in the background">
                  <Toggle checked={bool('background_backups')} onChange={v => set('background_backups', v)} />
                </Row>
                <Row label="Allow tray exit" hint="Allow user to exit the tray icon application">
                  <Toggle checked={bool('allow_tray_exit')} onChange={v => set('allow_tray_exit', v)} />
                </Row>
                <div className="pt-2">
                  <div className="space-y-1">
                    <label className="label">Startup backup delay (seconds)</label>
                    <input type="number" className="input w-40" value={s('startup_backup_delay') || 0} onChange={e => set('startup_backup_delay', Number(e.target.value))} />
                  </div>
                </div>
              </Section>

              <Section title="Manual Backup Actions">
                <Row label="Allow starting full file backups">
                  <Toggle checked={bool('allow_starting_full_file_backups')} onChange={v => set('allow_starting_full_file_backups', v)} />
                </Row>
                <Row label="Allow starting incremental file backups">
                  <Toggle checked={bool('allow_starting_incr_file_backups')} onChange={v => set('allow_starting_incr_file_backups', v)} />
                </Row>
                <Row label="Allow starting full image backups">
                  <Toggle checked={bool('allow_starting_full_image_backups')} onChange={v => set('allow_starting_full_image_backups', v)} />
                </Row>
                <Row label="Allow starting incremental image backups">
                  <Toggle checked={bool('allow_starting_incr_image_backups')} onChange={v => set('allow_starting_incr_image_backups', v)} />
                </Row>
              </Section>

              <Section title="Restore &amp; View Permissions">
                <Row label="Allow file restore">
                  <Toggle checked={bool('allow_file_restore')} onChange={v => set('allow_file_restore', v)} />
                </Row>
                <Row label="Allow component restore">
                  <Toggle checked={bool('allow_component_restore')} onChange={v => set('allow_component_restore', v)} />
                </Row>
                <Row label="Allow component config">
                  <Toggle checked={bool('allow_component_config')} onChange={v => set('allow_component_config', v)} />
                </Row>
                <Row label="Allow log view">
                  <Toggle checked={bool('allow_log_view')} onChange={v => set('allow_log_view', v)} />
                </Row>
                <Row label="Allow overwrite">
                  <Toggle checked={bool('allow_overwrite')} onChange={v => set('allow_overwrite', v)} />
                </Row>
                <Row label="Allow pause">
                  <Toggle checked={bool('allow_pause')} onChange={v => set('allow_pause', v)} />
                </Row>
              </Section>

              <Section title="Verification" collapsible>
                <Row label="End-to-end file backup verification" hint="Verify backup integrity after each file backup (slower)">
                  <Toggle checked={bool('end_to_end_file_backup_verification')} onChange={v => set('end_to_end_file_backup_verification', v)} />
                </Row>
              </Section>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
