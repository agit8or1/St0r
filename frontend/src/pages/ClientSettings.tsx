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
        credentials: 'include'
      });

      if (response.status === 404) {
        // Client exists in our DB but not yet known to UrBackup — show empty settings
        setSettings({});
        return;
      }

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
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(settings)
      });

      const data = await response.json();

      if (!response.ok || data.success === false) {
        throw new Error(data.error || 'UrBackup did not confirm the save (saved_ok was false)');
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
            checked={settings[key] === 'true' || settings[key] === true || settings[key] === '1' || settings[key] === 1}
            onChange={(e) => updateSetting(key, e.target.checked ? '1' : '0')}
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
              Back to Endpoint
            </button>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
              <SettingsIcon className="h-8 w-8" />
              Endpoint Settings - {clientName}
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Configure backup settings for this endpoint
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
                {renderSettingField('Incremental Backup Window', 'backup_window_incr_file', 'text')}
                {renderSettingField('Full Backup Window', 'backup_window_full_file', 'text')}
                {renderSettingField('Max Full File Backups', 'max_file_full', 'number')}
                {renderSettingField('Max Incremental File Backups', 'max_file_incr', 'number')}
                {renderSettingField('Min Full Backup Age (days)', 'min_file_full', 'number')}
                {renderSettingField('Min Incremental Age (minutes)', 'min_file_incr', 'number')}
                {renderSettingField('Full Backup Interval (seconds)', 'update_freq_full', 'number')}
                {renderSettingField('Incremental Interval (seconds)', 'update_freq_incr', 'number')}
              </div>

              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 mt-8">
                Image Backup Settings
              </h2>
              <div className="grid gap-6 md:grid-cols-2">
                {renderSettingField('Max Full Image Backups', 'max_image_full', 'number')}
                {renderSettingField('Max Incremental Image Backups', 'max_image_incr', 'number')}
                {renderSettingField('Min Full Image Age (days)', 'min_image_full', 'number')}
                {renderSettingField('Min Incremental Age (days)', 'min_image_incr', 'number')}
                {renderSettingField('Full Image Interval (seconds)', 'update_freq_image_full', 'number')}
                {renderSettingField('Incremental Interval (seconds)', 'update_freq_image_incr', 'number')}
              </div>

              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 mt-8">
                Options
              </h2>
              <div className="space-y-3">
                {renderSettingField('Enable Internet File Backups', 'internet_full_file_backups', 'checkbox')}
                {renderSettingField('Enable Internet Image Backups', 'internet_image_backups', 'checkbox')}
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
                {renderSettingField('Client Quota (bytes, 0=unlimited)', 'client_quota', 'number')}
                {renderSettingField('Internet Speed Limit (bytes/s, -1=unlimited)', 'internet_speed', 'number')}
                {renderSettingField('Local Speed Limit (bytes/s, -1=unlimited)', 'local_speed', 'number')}
                {renderSettingField('Internet Full File Transfer Mode', 'internet_full_file_transfer_mode', 'select', ['raw', 'compressed', 'hashed'])}
              </div>

              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 mt-8">
                Other Settings
              </h2>
              <div className="space-y-4">
                {Object.keys(settings).map(key => {
                  // Skip settings we've already displayed
                  const displayedKeys = [
                    'backup_window_incr_file', 'backup_window_full_file', 'max_file_full', 'max_file_incr',
                    'min_file_full', 'min_file_incr', 'update_freq_full', 'update_freq_incr',
                    'max_image_full', 'max_image_incr', 'min_image_full', 'min_image_incr',
                    'update_freq_image_full', 'update_freq_image_incr',
                    'internet_full_file_backups', 'internet_image_backups', 'internet_mode_enabled',
                    'client_quota', 'internet_speed', 'local_speed', 'internet_full_file_transfer_mode',
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
