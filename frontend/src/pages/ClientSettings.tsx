import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import { ArrowLeft, Save, Settings as SettingsIcon } from 'lucide-react';
import { api } from '../services/api';

interface ClientSettings {
  [key: string]: any;
}

export function ClientSettings() {
  const { clientName } = useParams<{ clientName: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<ClientSettings>({});
  const [clientId, setClientId] = useState<string>('');
  const [tab, setTab] = useState<'backup' | 'advanced'>('backup');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadSettings();
  }, [clientName]);

  const loadSettings = async () => {
    try {
      setLoading(true);

      // Get client ID first
      const clients = await api.getClients();
      const foundClient = clients.find(c => c.name === clientName);

      if (!foundClient?.id) {
        throw new Error('Client not found');
      }

      setClientId(foundClient.id);

      // Get settings
      const response = await fetch(`/api/client-settings/${foundClient.id}`, {
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
      setMessage({ type: 'error', text: 'Failed to load settings' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setMessage(null);

      const response = await fetch(`/api/client-settings/${clientId}`, {
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

  const updateSetting = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const renderSettingField = (label: string, key: string, type: 'text' | 'number' | 'checkbox' | 'select', options?: string[]) => {
    if (type === 'checkbox') {
      return (
        <div key={key} className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
          <label className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {label}
          </label>
          <input
            type="checkbox"
            checked={settings[key] === 'true' || settings[key] === true || settings[key] === '1'}
            onChange={(e) => updateSetting(key, e.target.checked ? 'true' : 'false')}
            className="h-5 w-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
        </div>
      );
    }

    if (type === 'select' && options) {
      return (
        <div key={key} className="space-y-2">
          <label className="label">{label}</label>
          <select
            value={settings[key] || ''}
            onChange={(e) => updateSetting(key, e.target.value)}
            className="input"
          >
            {options.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );
    }

    return (
      <div key={key} className="space-y-2">
        <label className="label">{label}</label>
        <input
          type={type}
          value={settings[key] || ''}
          onChange={(e) => updateSetting(key, type === 'number' ? Number(e.target.value) : e.target.value)}
          className="input"
        />
      </div>
    );
  };

  if (loading) {
    return (
      <Layout>
        <Loading />
      </Layout>
    );
  }

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
              <ArrowLeft className="h-4 w-4" />
              Back to Client
            </button>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
              <SettingsIcon className="h-8 w-8" />
              Client Settings - {clientName}
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Configure backup settings for this client
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
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
              onClick={() => setTab('backup')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                tab === 'backup'
                  ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Backup Settings
            </button>
            <button
              onClick={() => setTab('advanced')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                tab === 'advanced'
                  ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Advanced
            </button>
          </nav>
        </div>

        {/* Settings Content */}
        <div className="card">
          {tab === 'backup' && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                File Backup Settings
              </h2>
              <div className="grid gap-6 md:grid-cols-2">
                {renderSettingField('Backup Window Start (HH:MM)', 'backup_window_incr_file', 'text')}
                {renderSettingField('Backup Window End (HH:MM)', 'backup_window_full_file', 'text')}
                {renderSettingField('Max Full File Backups', 'max_file_full', 'number')}
                {renderSettingField('Max Incremental File Backups', 'max_file_incr', 'number')}
                {renderSettingField('Min File Backup Age (days)', 'min_file_full_age', 'number')}
                {renderSettingField('Min Incremental Age (days)', 'min_file_incr_age', 'number')}
                {renderSettingField('Full Backup Frequency (days)', 'interval_full_file', 'number')}
                {renderSettingField('Incremental Frequency (hours)', 'interval_incr_file', 'number')}
              </div>

              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 mt-8">
                Image Backup Settings
              </h2>
              <div className="grid gap-6 md:grid-cols-2">
                {renderSettingField('Max Full Image Backups', 'max_image_full', 'number')}
                {renderSettingField('Max Incremental Image Backups', 'max_image_incr', 'number')}
                {renderSettingField('Min Image Backup Age (days)', 'min_image_full_age', 'number')}
                {renderSettingField('Min Incremental Age (days)', 'min_image_incr_age', 'number')}
                {renderSettingField('Full Image Frequency (days)', 'interval_full_image', 'number')}
                {renderSettingField('Incremental Frequency (days)', 'interval_incr_image', 'number')}
              </div>

              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 mt-8">
                Options
              </h2>
              <div className="space-y-3">
                {renderSettingField('Enable File Backups', 'file_backup_enabled', 'checkbox')}
                {renderSettingField('Enable Image Backups', 'image_backup_enabled', 'checkbox')}
                {renderSettingField('Separate Hard Drive Volumes', 'separate_hdd', 'checkbox')}
                {renderSettingField('Enable Internet Mode', 'internet_mode_enabled', 'checkbox')}
              </div>
            </div>
          )}

          {tab === 'advanced' && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Advanced Settings
              </h2>
              <div className="grid gap-6 md:grid-cols-2">
                {renderSettingField('Client Quota (GB)', 'soft_client_quota', 'number')}
                {renderSettingField('Internet Speed Limit (Mbps)', 'internet_speed_limit', 'number')}
                {renderSettingField('Local Speed Limit (Mbps)', 'local_speed_limit', 'number')}
                {renderSettingField('Internet Transfer Mode', 'internet_transfer_mode', 'select', ['raw', 'compressed', 'hashed'])}
              </div>

              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 mt-8">
                Notification Settings
              </h2>
              <div className="space-y-3">
                {renderSettingField('Email Notifications', 'email_notifications', 'checkbox')}
                {renderSettingField('Alert on Backup Error', 'alert_on_error', 'checkbox')}
                {renderSettingField('Alert Script', 'alert_script', 'text')}
              </div>

              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 mt-8">
                Other Settings
              </h2>
              <div className="space-y-4">
                {Object.keys(settings).map(key => {
                  // Skip settings we've already displayed
                  const displayedKeys = [
                    'backup_window_incr_file', 'backup_window_full_file', 'max_file_full', 'max_file_incr',
                    'min_file_full_age', 'min_file_incr_age', 'interval_full_file', 'interval_incr_file',
                    'max_image_full', 'max_image_incr', 'min_image_full_age', 'min_image_incr_age',
                    'interval_full_image', 'interval_incr_image', 'file_backup_enabled', 'image_backup_enabled',
                    'separate_hdd', 'internet_mode_enabled', 'soft_client_quota', 'internet_speed_limit',
                    'local_speed_limit', 'internet_transfer_mode', 'email_notifications', 'alert_on_error',
                    'alert_script'
                  ];

                  if (displayedKeys.includes(key)) {
                    return null;
                  }

                  return (
                    <div key={key} className="flex items-center gap-4">
                      <label className="label flex-1">{key}</label>
                      <input
                        type="text"
                        value={String(settings[key] || '')}
                        onChange={(e) => updateSetting(key, e.target.value)}
                        className="input max-w-md"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
