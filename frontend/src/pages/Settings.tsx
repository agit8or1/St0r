import { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { useAuth } from '../hooks/useAuth';
import { Save, Settings as SettingsIcon, Server as ServerIcon, Smartphone, Key, Check, X, Copy } from 'lucide-react';

interface ServerSettings {
  [key: string]: any;
}

export function Settings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<ServerSettings>({});
  const [clientSettings, setClientSettings] = useState({ urbackupServerHost: '', urbackupServerPort: '55414' });
  const [tab, setTab] = useState<'general' | 'backup' | 'email' | 'client' | 'user'>('general');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 2FA state
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [showQRCode, setShowQRCode] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [loading2FA, setLoading2FA] = useState(false);

  useEffect(() => {
    loadSettings();
    loadClientSettings();
    loadTwoFactorStatus();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);

      const response = await fetch('/api/server-settings', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
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
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setClientSettings(data);
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
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
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
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
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

  const loadTwoFactorStatus = async () => {
    try {
      const response = await fetch('/api/2fa/status', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setTwoFactorEnabled(data.enabled);
      }
    } catch (err) {
      console.error('Failed to load 2FA status:', err);
    }
  };

  const handleEnable2FA = async () => {
    try {
      setLoading2FA(true);
      const response = await fetch('/api/2fa/setup', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to enable 2FA');
      }

      const data = await response.json();
      setQrCodeUrl(data.qrCode);
      setSecret(data.secret);
      setShowQRCode(true);
      setMessage({ type: 'success', text: 'Scan the QR code with your authenticator app' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading2FA(false);
    }
  };

  const handleVerify2FA = async () => {
    try {
      setLoading2FA(true);
      const response = await fetch('/api/2fa/verify', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token: verificationCode })
      });

      if (!response.ok) {
        throw new Error('Invalid verification code');
      }

      const data = await response.json();
      setBackupCodes(data.backupCodes || []);
      setTwoFactorEnabled(true);
      setShowQRCode(false);
      setVerificationCode('');
      setMessage({ type: 'success', text: '2FA enabled successfully! Save your backup codes.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading2FA(false);
    }
  };

  const handleDisable2FA = async () => {
    if (!confirm('Are you sure you want to disable two-factor authentication?')) {
      return;
    }

    try {
      setLoading2FA(true);
      const response = await fetch('/api/2fa/disable', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to disable 2FA');
      }

      setTwoFactorEnabled(false);
      setBackupCodes([]);
      setMessage({ type: 'success', text: '2FA disabled successfully' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading2FA(false);
    }
  };

  const copySecret = () => {
    navigator.clipboard.writeText(secret);
    setMessage({ type: 'success', text: 'Secret copied to clipboard' });
  };

  const copyBackupCodes = () => {
    navigator.clipboard.writeText(backupCodes.join('\n'));
    setMessage({ type: 'success', text: 'Backup codes copied to clipboard' });
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
            className="h-5 w-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 mt-0.5"
          />
        </div>
      );
    }

    return (
      <div key={key} className="space-y-2">
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
          {tab !== 'user' && (
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
                {renderSettingField('Automatic Backup Database Repair', 'autoshutdown', 'checkbox', 'Automatically repair backup database on startup')}
                {renderSettingField('Enable Download from Client', 'allow_restore', 'checkbox', 'Allow clients to download files from backups')}
                {renderSettingField('Enable Internet Clients', 'internet_mode_enabled', 'checkbox', 'Allow backups from internet clients')}
                {renderSettingField('Headless Mode (API Only)', 'no_images', 'checkbox', 'Run UrBackup server without web interface, API only')}
              </div>
            </div>
          )}

          {tab === 'backup' && !loading && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Default File Backup Settings
              </h2>
              <div className="grid gap-6 md:grid-cols-2">
                {renderSettingField('Default Max Full Backups', 'max_file_full', 'number', 'Default max full file backups to keep')}
                {renderSettingField('Default Max Incremental Backups', 'max_file_incr', 'number', 'Default max incremental file backups')}
                {renderSettingField('Default Full Backup Interval (days)', 'interval_full', 'number', 'How often to run full file backups')}
                {renderSettingField('Default Incremental Interval (hours)', 'interval_incr', 'number', 'How often to run incremental backups')}
                {renderSettingField('Min Full Backup Age (days)', 'min_file_full_age', 'number', 'Minimum age before deleting full backups')}
                {renderSettingField('Min Incremental Age (days)', 'min_file_incr_age', 'number', 'Minimum age before deleting incremental backups')}
              </div>

              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 mt-8">
                Default Image Backup Settings
              </h2>
              <div className="grid gap-6 md:grid-cols-2">
                {renderSettingField('Default Max Full Images', 'max_image_full', 'number', 'Default max full image backups to keep')}
                {renderSettingField('Default Max Incremental Images', 'max_image_incr', 'number', 'Default max incremental image backups')}
                {renderSettingField('Default Full Image Interval (days)', 'interval_full_image', 'number', 'How often to run full image backups')}
                {renderSettingField('Default Incremental Interval (days)', 'interval_incr_image', 'number', 'How often to run incremental image backups')}
                {renderSettingField('Min Full Image Age (days)', 'min_image_full_age', 'number', 'Minimum age before deleting full images')}
                {renderSettingField('Min Incremental Age (days)', 'min_image_incr_age', 'number', 'Minimum age before deleting incremental images')}
              </div>
            </div>
          )}

          {tab === 'email' && !loading && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
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
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                <ServerIcon className="inline h-6 w-6 mr-2" />
                Client Installer Configuration
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Configure the UrBackup server connection information for auto-generated client installer scripts.
                Downloaded installers will be pre-configured with these settings.
              </p>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="label">
                    Server Hostname / FQDN
                    <span className="block text-xs font-normal text-gray-500 dark:text-gray-400 mt-1">
                      Fully qualified domain name or IP address for the UrBackup server (e.g., stor.agit8or.net)
                    </span>
                  </label>
                  <input
                    type="text"
                    value={clientSettings.urbackupServerHost}
                    onChange={(e) => setClientSettings(prev => ({ ...prev, urbackupServerHost: e.target.value }))}
                    className="input"
                    placeholder="stor.agit8or.net"
                  />
                </div>

                <div className="space-y-2">
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
                <div className="flex items-center gap-3 mb-4">
                  <Smartphone className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    Two-Factor Authentication (2FA)
                  </h2>
                </div>

                {!twoFactorEnabled && !showQRCode && (
                  <div className="space-y-4">
                    <p className="text-gray-600 dark:text-gray-400">
                      Add an extra layer of security to your account by enabling two-factor authentication.
                      You'll need an authenticator app like Google Authenticator, Authy, or Microsoft Authenticator.
                    </p>

                    <button
                      onClick={handleEnable2FA}
                      disabled={loading2FA}
                      className="btn btn-primary"
                    >
                      <Key className="h-4 w-4 mr-2" />
                      {loading2FA ? 'Setting up...' : 'Enable 2FA'}
                    </button>
                  </div>
                )}

                {showQRCode && (
                  <div className="space-y-4">
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Step 1: Scan QR Code</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        Open your authenticator app and scan this QR code:
                      </p>

                      <div className="bg-white p-4 rounded-lg inline-block">
                        <img src={qrCodeUrl} alt="2FA QR Code" className="w-48 h-48" />
                      </div>

                      <div className="mt-4">
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                          Or manually enter this secret key:
                        </p>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 p-2 bg-gray-900 text-green-400 rounded font-mono text-sm break-all">
                            {secret}
                          </code>
                          <button
                            onClick={copySecret}
                            className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                            title="Copy secret"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Step 2: Verify Code</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        Enter the 6-digit code from your authenticator app:
                      </p>

                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={verificationCode}
                          onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          className="input w-32 text-center text-lg font-mono"
                          placeholder="000000"
                          maxLength={6}
                        />
                        <button
                          onClick={handleVerify2FA}
                          disabled={loading2FA || verificationCode.length !== 6}
                          className="btn btn-primary"
                        >
                          {loading2FA ? 'Verifying...' : 'Verify & Enable'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {twoFactorEnabled && (
                  <div className="space-y-4">
                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                      <div className="flex items-center gap-3">
                        <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
                        <div>
                          <p className="font-semibold text-gray-900 dark:text-gray-100">2FA is Enabled</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            Your account is protected with two-factor authentication
                          </p>
                        </div>
                      </div>
                    </div>

                    {backupCodes.length > 0 && (
                      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
                          <Key className="h-4 w-4" />
                          Backup Codes
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                          Save these backup codes in a safe place. You can use them to access your account if you lose your authenticator device.
                        </p>

                        <div className="bg-gray-900 dark:bg-gray-950 rounded-lg p-4 mb-3">
                          <div className="grid grid-cols-2 gap-2 font-mono text-sm text-green-400">
                            {backupCodes.map((code, index) => (
                              <div key={index}>{code}</div>
                            ))}
                          </div>
                        </div>

                        <button
                          onClick={copyBackupCodes}
                          className="btn btn-secondary text-sm"
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          Copy Backup Codes
                        </button>
                      </div>
                    )}

                    <button
                      onClick={handleDisable2FA}
                      disabled={loading2FA}
                      className="btn bg-red-600 hover:bg-red-700 text-white"
                    >
                      {loading2FA ? 'Disabling...' : 'Disable 2FA'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
