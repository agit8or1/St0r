import { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { useAuth } from '../hooks/useAuth';
import { Save, Settings as SettingsIcon, Server as ServerIcon } from 'lucide-react';
import { useTooltips } from '../hooks/useTooltips';
import { DiskGuardPanel } from '../components/DiskGuardPanel';
import { TwoFactorSection } from '../components/TwoFactorSection';

interface ServerSettings {
  [key: string]: any;
}

export function Settings() {
  const { user } = useAuth();
  const { tooltipsEnabled, toggleTooltips } = useTooltips();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<ServerSettings>({});
  const [clientSettings, setClientSettings] = useState({ urbackupServerHost: '', urbackupServerPort: '55414', corsLock: false });
  const [tab, setTab] = useState<'general' | 'backup' | 'storage' | 'email' | 'client' | 'user'>('general');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadSettings();
    loadClientSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);

      const response = await fetch('/api/server-settings', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to load settings');
      }

      const data = await response.json();
      setSettings(data.settings || data);
    } catch (err) {
      console.error('Failed to load settings:', err);
      setMessage({ type: 'error', text: 'Failed to load server settings' });
    } finally {
      setLoading(false);
    }
  };

  const loadClientSettings = async () => {
    try {
      const response = await fetch('/api/settings', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setClientSettings({ urbackupServerHost: data.urbackupServerHost || '', urbackupServerPort: data.urbackupServerPort || '55414', corsLock: !!data.corsLock });
      }
    } catch (err) {
      console.error('Failed to load client settings:', err);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setMessage(null);

      const response = await fetch('/api/server-settings', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(settings)
      });

      if (!response.ok) {
        throw new Error('Failed to save settings');
      }

      setMessage({ type: 'success', text: 'Settings saved successfully!' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveClientSettings = async () => {
    try {
      setSaving(true);
      setMessage(null);

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(clientSettings)
      });

      if (!response.ok) {
        throw new Error('Failed to save client settings');
      }

      setMessage({ type: 'success', text: 'Client settings saved successfully!' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      console.error('Failed to save client settings:', err);
      setMessage({ type: 'error', text: 'Failed to save client settings' });
    } finally {
      setSaving(false);
    }
  };

  const updateSetting = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const renderSettingField = (label: string, key: string, type: 'text' | 'number' | 'checkbox' | 'password', description?: string) => {
    if (type === 'checkbox') {
      const isChecked = settings[key] === 'true' || settings[key] === true || settings[key] === '1' || settings[key] === 1;

      return (
        <div key={key} className="flex items-start justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-900 dark:text-gray-100 block">
              {label}
            </label>
            {description && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{description}</p>
            )}
          </div>
          <input
            type="checkbox"
            checked={isChecked}
            onChange={(e) => {
              console.log(`Checkbox ${key} changed to:`, e.target.checked);
              updateSetting(key, e.target.checked ? true : false);
            }}
            className="h-5 w-5 rounded-sm border-gray-300 text-primary-600 focus:ring-primary-500 mt-0.5"
          />
        </div>
      );
    }

    return (
      <div key={key} className="flex flex-col gap-2">
        <label className="label">
          {label}
          {description && (
            <span className="block text-xs font-normal text-gray-500 dark:text-gray-400 mt-1">{description}</span>
          )}
        </label>
        <input
          type={type}
          value={settings[key] || ''}
          onChange={(e) => updateSetting(key, type === 'number' ? Number(e.target.value) : e.target.value)}
          className="input"
          placeholder={type === 'password' ? '••••••••' : ''}
        />
      </div>
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
              <SettingsIcon className="h-8 w-8" />
              Settings
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Manage your account and server settings
            </p>
          </div>
          {tab !== 'user' && tab !== 'storage' && (
            <button
              onClick={tab === 'client' ? handleSaveClientSettings : handleSave}
              disabled={saving || loading}
              className="btn btn-primary flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          )}
        </div>

        {/* Message */}
        {message && (
          <div className={`rounded-lg p-4 ${
            message.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'
          }`}>
            {message.text}
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="flex gap-8">
            <button
              onClick={() => setTab('general')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                tab === 'general'
                  ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              General
            </button>
            <button
              onClick={() => setTab('backup')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                tab === 'backup'
                  ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Backup Defaults
            </button>
            <button
              onClick={() => setTab('storage')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                tab === 'storage'
                  ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Storage Protection
            </button>
            <button
              onClick={() => setTab('email')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                tab === 'email'
                  ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Email & Alerts
            </button>
            <button
              onClick={() => setTab('client')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                tab === 'client'
                  ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Client Configuration
            </button>
            <button
              onClick={() => setTab('user')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                tab === 'user'
                  ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              User Info
            </button>
          </nav>
        </div>

        {/* Settings Content */}
        <div className="card">
          {tab === 'general' && !loading && (
            <div className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                {renderSettingField('Backup Storage Path', 'backupfolder', 'text', 'Directory where backups are stored')}
                {renderSettingField('Server Port', 'port', 'number', 'Port for client connections (default: 55414)')}
                {renderSettingField('Max Simultaneous Backups', 'max_active_clients', 'number', 'Maximum number of concurrent backup operations')}
                {renderSettingField('Global Soft Client Quota (GB)', 'global_soft_fs_quota', 'number', 'Warning threshold for client storage usage')}
              </div>

              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-8 mb-4">
                Network Settings
              </h3>
              <div className="grid gap-6 md:grid-cols-2">
                {renderSettingField('Internet Server Name', 'internet_server', 'text', 'Public hostname for internet clients')}
                {renderSettingField('Internet Server Port', 'internet_server_port', 'number', 'Port for internet client connections')}
                {renderSettingField('UrBackup Admin Password', 'urbackup_password', 'password', 'Password for UrBackup web interface (required for pre-configured installers)')}
              </div>

              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-8 mb-4">
                Options
              </h3>
              <div className="space-y-3">
                {renderSettingField('Enable Download from Client', 'allow_restore', 'checkbox', 'Allow clients to download files from backups')}
                {renderSettingField('Enable Internet Clients', 'internet_mode_enabled', 'checkbox', 'Allow backups from internet clients')}
                {renderSettingField('Disable Image Backups', 'no_images', 'checkbox', 'Stop taking whole-disk image backups server-wide. Images are the largest consumer of backup storage.')}
                {renderSettingField('Disable File Backups', 'no_file_backups', 'checkbox', 'Stop taking file backups server-wide')}
                {renderSettingField('Storage Soft Quota', 'global_soft_fs_quota', 'text', 'UrBackup starts deleting old backups above this usage, e.g. 85%. Leave headroom so cleanup finishes before the volume fills.')}
              </div>

              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-8 mb-4">
                Interface
              </h3>
              <div className="space-y-3">
                <div className="flex items-start justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                  <div className="flex-1">
                    <label className="text-sm font-medium text-gray-900 dark:text-gray-100 block">
                      Show Tooltips
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Show helpful tooltip hints when hovering over buttons and icons
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={tooltipsEnabled}
                    onChange={toggleTooltips}
                    className="h-5 w-5 rounded-sm border-gray-300 text-primary-600 focus:ring-primary-500 mt-0.5"
                  />
                </div>
              </div>
            </div>
          )}

          {tab === 'backup' && !loading && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6">
                Default File Backup Settings
              </h2>
              <div className="grid gap-6 md:grid-cols-2">
                {renderSettingField('Default Max Full Backups', 'max_file_full', 'number', 'Default max full file backups to keep')}
                {renderSettingField('Default Max Incremental Backups', 'max_file_incr', 'number', 'Default max incremental file backups')}
                {renderSettingField('Min Full Backups Kept', 'min_file_full', 'number', 'Floor that even an out-of-space cleanup will not delete below. Cannot be more than the max above.')}
                {renderSettingField('Min Incremental Backups Kept', 'min_file_incr', 'number', 'Floor that even an out-of-space cleanup will not delete below. Cannot be more than the max above.')}
                {renderSettingField('Default Full Backup Interval (days)', 'interval_full', 'number', 'How often to run full file backups')}
                {renderSettingField('Default Incremental Interval (hours)', 'interval_incr', 'number', 'How often to run incremental backups')}
                {renderSettingField('Min Full Backup Age (days)', 'min_file_full_age', 'number', 'Minimum age before deleting full backups')}
                {renderSettingField('Min Incremental Age (days)', 'min_file_incr_age', 'number', 'Minimum age before deleting incremental backups')}
              </div>

              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 mt-8">
                Default Image Backup Settings
              </h2>
              <div className="grid gap-6 md:grid-cols-2">
                {renderSettingField('Default Max Full Images', 'max_image_full', 'number', 'Default max full image backups to keep. Images are the largest consumer of storage — keep this tight.')}
                {renderSettingField('Default Max Incremental Images', 'max_image_incr', 'number', 'Default max incremental image backups')}
                {renderSettingField('Min Full Images Kept', 'min_image_full', 'number', 'Floor that even an out-of-space cleanup will not delete below. Cannot be more than the max above.')}
                {renderSettingField('Min Incremental Images Kept', 'min_image_incr', 'number', 'Floor that even an out-of-space cleanup will not delete below. Cannot be more than the max above.')}
                {renderSettingField('Default Full Image Interval (days)', 'interval_full_image', 'number', 'How often to run full image backups')}
                {renderSettingField('Default Incremental Interval (days)', 'interval_incr_image', 'number', 'How often to run incremental image backups')}
                {renderSettingField('Min Full Image Age (days)', 'min_image_full_age', 'number', 'Minimum age before deleting full images')}
                {renderSettingField('Min Incremental Age (days)', 'min_image_incr_age', 'number', 'Minimum age before deleting incremental images')}
              </div>
            </div>
          )}

          {tab === 'storage' && (
            <DiskGuardPanel isAdmin={!!user?.isAdmin} />
          )}

          {tab === 'email' && !loading && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6">
                Email Configuration
              </h2>
              <div className="grid gap-6 md:grid-cols-2">
                {renderSettingField('SMTP Server', 'mail_server', 'text', 'SMTP server hostname')}
                {renderSettingField('SMTP Port', 'mail_serverport', 'number', 'SMTP server port (usually 25, 465, or 587)')}
                {renderSettingField('SMTP Username', 'mail_username', 'text', 'Username for SMTP authentication')}
                {renderSettingField('SMTP Password', 'mail_password', 'text', 'Password for SMTP authentication')}
                {renderSettingField('From Email', 'mail_from', 'text', 'Email address to send from')}
                {renderSettingField('Admin Email', 'mail_admin', 'text', 'Email address to send reports to')}
              </div>

              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-8 mb-4">
                Email Options
              </h3>
              <div className="space-y-3">
                {renderSettingField('Use SSL/TLS', 'mail_ssl', 'checkbox', 'Use SSL/TLS for secure email connection')}
                {renderSettingField('Send Reports', 'send_reports', 'checkbox', 'Send backup status reports via email')}
                {renderSettingField('Report Frequency (days)', 'report_mail_freq', 'number', 'How often to send status reports')}
              </div>

              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 mt-8">
                Pushover Integration
              </h2>
              <div className="grid gap-6 md:grid-cols-2">
                {renderSettingField('Pushover User Key', 'pushover_user_key', 'text', 'Your Pushover user key')}
                {renderSettingField('Pushover API Token', 'pushover_api_token', 'text', 'Your Pushover application API token')}
              </div>
              <div className="space-y-3 mt-4">
                {renderSettingField('Enable Pushover Alerts', 'pushover_enabled', 'checkbox', 'Send alerts via Pushover')}
                {renderSettingField('Alert on Backup Failure', 'pushover_alert_failures', 'checkbox', 'Send notification when backups fail')}
              </div>
            </div>
          )}

          {tab === 'client' && !loading && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6">
                <ServerIcon className="inline h-6 w-6 mr-2" />
                Client Installer Configuration
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Configure the public hostname for this St0r server. Used for auto-generated client installer scripts and remote agent install commands.
              </p>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label className="label">
                    Server Hostname / FQDN
                    <span className="block text-xs font-normal text-gray-500 dark:text-gray-400 mt-1">
                      Public hostname for this St0r server (e.g., backup.example.com). Used for client installer scripts and remote agent install commands.
                    </span>
                  </label>
                  <input
                    type="text"
                    value={clientSettings.urbackupServerHost}
                    onChange={(e) => setClientSettings(prev => ({ ...prev, urbackupServerHost: e.target.value }))}
                    className="input"
                    placeholder="backup.example.com"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="label">
                    Server Port
                    <span className="block text-xs font-normal text-gray-500 dark:text-gray-400 mt-1">
                      Port number for client connections (default: 55414)
                    </span>
                  </label>
                  <input
                    type="number"
                    value={clientSettings.urbackupServerPort}
                    onChange={(e) => setClientSettings(prev => ({ ...prev, urbackupServerPort: e.target.value }))}
                    className="input"
                    placeholder="55414"
                    min="1"
                    max="65535"
                  />
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mt-6">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">How This Works</h3>
                <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-disc list-inside">
                  <li>Windows installer downloads the UrBackup client .exe directly from your server</li>
                  <li>Linux Bash installer scripts are pre-configured and will automatically connect to your server</li>
                  <li>No manual configuration required on client machines</li>
                  <li>Makes client deployment simple and error-free</li>
                </ul>
              </div>

              <div className="border-t dark:border-gray-700 pt-6 mt-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Security</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Control which origins can make requests to the St0r API.</p>
                <label className="flex items-start gap-4 cursor-pointer group">
                  <div className="shrink-0 mt-0.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={clientSettings.corsLock}
                      onClick={() => setClientSettings(prev => ({ ...prev, corsLock: !prev.corsLock }))}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
                        clientSettings.corsLock ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        clientSettings.corsLock ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">Lock CORS to configured FQDN</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                      When enabled, the API only accepts requests from <strong>{clientSettings.urbackupServerHost || 'your FQDN'}</strong> and localhost.
                      Disable this if you access St0r from multiple origins or an IP address.
                    </p>
                    {clientSettings.corsLock && !clientSettings.urbackupServerHost && (
                      <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-1">
                        ⚠ Set a Server Hostname / FQDN above before enabling CORS lock, or you may lock yourself out.
                      </p>
                    )}
                  </div>
                </label>
              </div>
            </div>
          )}

          {tab === 'user' && (
            <div className="space-y-8">
              {/* User Information Section */}
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  User Information
                </h2>
                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <label className="label">Username</label>
                    <input
                      type="text"
                      value={user?.username || ''}
                      disabled
                      className="input bg-gray-100 dark:bg-gray-700"
                    />
                  </div>
                  <div>
                    <label className="label">Email</label>
                    <input
                      type="email"
                      value={user?.email || ''}
                      disabled
                      className="input bg-gray-100 dark:bg-gray-700"
                    />
                  </div>
                  <div>
                    <label className="label">Role</label>
                    <input
                      type="text"
                      value={user?.isAdmin ? 'Administrator' : 'User'}
                      disabled
                      className="input bg-gray-100 dark:bg-gray-700"
                    />
                  </div>
                </div>
              </div>

              {/* Two-Factor Authentication Section */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-8">
                <TwoFactorSection />
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
