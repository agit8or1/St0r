import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import {
  Copy as DocumentDuplicateIcon,
  RefreshCw as ArrowPathIcon,
  Trash2 as TrashIcon,
  CheckCircle as CheckCircleIcon,
  AlertTriangle as ExclamationTriangleIcon,
  Download as CloudArrowDownIcon,
  ShieldCheck as ShieldCheckIcon,
  Save as SaveIcon,
  Settings as SettingsIcon,
  Globe as GlobeIcon,
  ArrowLeft as ArrowLeftIcon
} from 'lucide-react';

interface Backup {
  id: number;
  name: string;
  createdAt: string;
  createdBy: string;
}

interface BackupDetails extends Backup {
  settingsCount: number;
  settings: any;
}

interface ServerSettings {
  [key: string]: any;
}

export default function ServerSettings() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'backup' | 'general' | 'internet'>('backup');
  const [backups, setBackups] = useState<Backup[]>([]);
  const [selectedBackup, setSelectedBackup] = useState<BackupDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [backupName, setBackupName] = useState('');
  const [showCreateBackup, setShowCreateBackup] = useState(false);

  // Settings state
  const [settings, setSettings] = useState<ServerSettings>({});
  const [originalSettings, setOriginalSettings] = useState<ServerSettings>({});
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);

  useEffect(() => {
    if (activeTab === 'backup') {
      loadBackups();
    } else if (activeTab === 'general' || activeTab === 'internet') {
      loadSettings();
    }
  }, [activeTab]);

  const loadSettings = async () => {
    try {
      setSettingsLoading(true);
      const response = await fetch('/api/server-settings', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await response.json();

      if (response.ok) {
        setSettings(data);
        setOriginalSettings(data);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to load settings' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: `Failed to load settings: ${error.message}` });
    } finally {
      setSettingsLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!confirm('Are you sure you want to save these settings? This will update the UrBackup server configuration.')) {
      return;
    }

    try {
      setSaveLoading(true);

      // Only send changed settings
      const changedSettings: ServerSettings = {};
      for (const key in settings) {
        if (settings[key] !== originalSettings[key]) {
          changedSettings[key] = settings[key];
        }
      }

      if (Object.keys(changedSettings).length === 0) {
        setMessage({ type: 'error', text: 'No settings were changed' });
        return;
      }

      const response = await fetch('/api/server-settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(changedSettings)
      });

      const data = await response.json();

      if (data.success) {
        setMessage({
          type: 'success',
          text: `Settings saved successfully! ${Object.keys(changedSettings).length} settings updated.`
        });
        setOriginalSettings(settings);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save settings' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: `Failed to save settings: ${error.message}` });
    } finally {
      setSaveLoading(false);
    }
  };

  const updateSetting = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const hasChanges = () => {
    return JSON.stringify(settings) !== JSON.stringify(originalSettings);
  };

  const loadBackups = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/server-config-backup/list', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await response.json();
      if (data.success) {
        setBackups(data.backups);
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const createBackup = async () => {
    if (!backupName.trim()) {
      setMessage({ type: 'error', text: 'Please enter a backup name' });
      return;
    }

    try {
      setLoading(true);
      const response = await fetch('/api/server-config-backup/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ backupName })
      });
      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: `Backup created: ${data.settingsCount} settings saved` });
        setBackupName('');
        setShowCreateBackup(false);
        loadBackups();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to create backup' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const viewBackup = async (backupId: number) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/server-config-backup/${backupId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await response.json();

      if (data.success) {
        setSelectedBackup(data.backup);
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const restoreBackup = async (backupId: number, backupName: string) => {
    if (!confirm(`Are you sure you want to restore settings from "${backupName}"? This will overwrite current server settings.`)) {
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`/api/server-config-backup/${backupId}/restore`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: `Settings restored successfully! ${data.restored} settings applied.` });
        loadSettings();
      } else {
        setMessage({ type: 'error', text: data.message || 'Failed to restore backup' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const deleteBackup = async (backupId: number, backupName: string) => {
    if (!confirm(`Are you sure you want to delete backup "${backupName}"?`)) {
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`/api/server-config-backup/${backupId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: 'Backup deleted successfully' });
        setSelectedBackup(null);
        loadBackups();
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  // Render setting field based on type
  const renderSettingField = (key: string, value: any, label: string, description?: string, type: 'text' | 'number' | 'boolean' | 'select' = 'text', options?: string[]) => {
    if (type === 'boolean') {
      return (
        <div className="flex items-start">
          <div className="flex items-center h-5">
            <input
              id={key}
              type="checkbox"
              checked={value === true || value === 'true'}
              onChange={(e) => updateSetting(key, e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600 rounded"
            />
          </div>
          <div className="ml-3 text-sm">
            <label htmlFor={key} className="font-medium text-gray-700 dark:text-gray-300">{label}</label>
            {description && <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">{description}</p>}
          </div>
        </div>
      );
    }

    if (type === 'select' && options) {
      return (
        <div>
          <label htmlFor={key} className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
          {description && <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">{description}</p>}
          <select
            id={key}
            value={value || ''}
            onChange={(e) => updateSetting(key, e.target.value)}
            className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          >
            {options.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );
    }

    return (
      <div>
        <label htmlFor={key} className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
        {description && <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">{description}</p>}
        <input
          id={key}
          type={type}
          value={value !== null && value !== undefined ? value : ''}
          onChange={(e) => updateSetting(key, type === 'number' ? parseInt(e.target.value) || 0 : e.target.value)}
          className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        />
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header with Back Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <ArrowLeftIcon className="h-4 w-4 mr-2" />
            Back
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">UrBackup Server Settings</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Manage and backup your UrBackup server configuration
            </p>
          </div>
        </div>
      </div>

      {/* Alert Messages */}
      {message && (
        <div className={`rounded-md p-4 ${message.type === 'success' ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
          <div className="flex">
            <div className="flex-shrink-0">
              {message.type === 'success' ? (
                <CheckCircleIcon className="h-5 w-5 text-green-400" />
              ) : (
                <ExclamationTriangleIcon className="h-5 w-5 text-red-400" />
              )}
            </div>
            <div className="ml-3">
              <p className={`text-sm font-medium ${message.type === 'success' ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}`}>
                {message.text}
              </p>
            </div>
            <div className="ml-auto pl-3">
              <div className="-mx-1.5 -my-1.5">
                <button
                  onClick={() => setMessage(null)}
                  className={`inline-flex rounded-md p-1.5 ${message.type === 'success' ? 'text-green-500 hover:bg-green-100 dark:hover:bg-green-800' : 'text-red-500 hover:bg-red-100 dark:hover:bg-red-800'}`}
                >
                  <span className="sr-only">Dismiss</span>
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('backup')}
            className={`${
              activeTab === 'backup'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            } whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium flex items-center`}
          >
            <ShieldCheckIcon className="h-5 w-5 mr-2" />
            Configuration Backup
          </button>
          <button
            onClick={() => setActiveTab('general')}
            className={`${
              activeTab === 'general'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            } whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium flex items-center`}
          >
            <SettingsIcon className="h-5 w-5 mr-2" />
            General Settings
          </button>
          <button
            onClick={() => setActiveTab('internet')}
            className={`${
              activeTab === 'internet'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            } whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium flex items-center`}
          >
            <GlobeIcon className="h-5 w-5 mr-2" />
            Internet Mode
          </button>
        </nav>
      </div>

      {/* Configuration Backup Tab */}
      {activeTab === 'backup' && (
        <div className="space-y-6">
          {/* Warning Banner */}
          <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <ExclamationTriangleIcon className="h-5 w-5 text-yellow-400" />
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  Important: Always Backup Before Making Changes
                </h3>
                <div className="mt-2 text-sm text-yellow-700 dark:text-yellow-300">
                  <p>
                    Creating a backup saves all current UrBackup server settings. You can restore from any backup if something goes wrong.
                    Database corruption can occur - always keep recent backups!
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Create Backup Section */}
          <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-gray-900 dark:text-white">Create New Backup</h2>
              <button
                onClick={() => setShowCreateBackup(!showCreateBackup)}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <DocumentDuplicateIcon className="h-5 w-5 mr-2" />
                New Backup
              </button>
            </div>

            {showCreateBackup && (
              <div className="mt-4 space-y-4">
                <div>
                  <label htmlFor="backup-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Backup Name
                  </label>
                  <input
                    type="text"
                    id="backup-name"
                    value={backupName}
                    onChange={(e) => setBackupName(e.target.value)}
                    placeholder="e.g., Before changing internet settings"
                    className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => {
                      setShowCreateBackup(false);
                      setBackupName('');
                    }}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={createBackup}
                    disabled={loading || !backupName.trim()}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <>
                        <ArrowPathIcon className="h-5 w-5 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <CloudArrowDownIcon className="h-5 w-5 mr-2" />
                        Create Backup
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Backups List */}
          <div className="bg-white dark:bg-gray-800 shadow rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-medium text-gray-900 dark:text-white">Saved Backups</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {backups.length} backup{backups.length !== 1 ? 's' : ''} available
              </p>
            </div>

            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading && backups.length === 0 ? (
                <div className="px-6 py-8 text-center">
                  <ArrowPathIcon className="h-8 w-8 mx-auto text-gray-400 animate-spin" />
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading backups...</p>
                </div>
              ) : backups.length === 0 ? (
                <div className="px-6 py-8 text-center">
                  <DocumentDuplicateIcon className="h-12 w-12 mx-auto text-gray-400" />
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No backups yet. Create your first backup above.</p>
                </div>
              ) : (
                backups.map((backup) => (
                  <div key={backup.id} className="px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h3 className="text-sm font-medium text-gray-900 dark:text-white">{backup.name}</h3>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Created {new Date(backup.createdAt).toLocaleString()} by {backup.createdBy}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => viewBackup(backup.id)}
                          className="inline-flex items-center px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-xs font-medium rounded text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"
                        >
                          View
                        </button>
                        <button
                          onClick={() => restoreBackup(backup.id, backup.name)}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded text-white bg-blue-600 hover:bg-blue-700"
                        >
                          <ArrowPathIcon className="h-4 w-4 mr-1" />
                          Restore
                        </button>
                        <button
                          onClick={() => deleteBackup(backup.id, backup.name)}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded text-white bg-red-600 hover:bg-red-700"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Backup Details Modal */}
          {selectedBackup && (
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg max-w-4xl w-full max-h-[80vh] overflow-hidden shadow-xl">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">{selectedBackup.name}</h3>
                    <button
                      onClick={() => setSelectedBackup(null)}
                      className="text-gray-400 hover:text-gray-500"
                    >
                      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {selectedBackup.settingsCount} settings • Created {new Date(selectedBackup.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="px-6 py-4 overflow-y-auto max-h-[60vh]">
                  <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-4 rounded overflow-x-auto">
                    {JSON.stringify(selectedBackup.settings, null, 2)}
                  </pre>
                </div>
                <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-3">
                  <button
                    onClick={() => setSelectedBackup(null)}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => {
                      restoreBackup(selectedBackup.id, selectedBackup.name);
                      setSelectedBackup(null);
                    }}
                    className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
                  >
                    Restore This Backup
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* General Settings Tab */}
      {activeTab === 'general' && (
        <div className="space-y-6">
          {settingsLoading ? (
            <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-12 text-center">
              <ArrowPathIcon className="h-12 w-12 mx-auto text-gray-400 animate-spin" />
              <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading settings...</p>
            </div>
          ) : (
            <>
              {/* Save Button Bar */}
              {hasChanges() && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <ExclamationTriangleIcon className="h-5 w-5 text-blue-600 dark:text-blue-400 mr-3" />
                      <span className="text-sm font-medium text-blue-900 dark:text-blue-200">
                        You have unsaved changes
                      </span>
                    </div>
                    <div className="flex space-x-3">
                      <button
                        onClick={() => {
                          setSettings(originalSettings);
                          setMessage({ type: 'success', text: 'Changes discarded' });
                        }}
                        className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"
                      >
                        Discard Changes
                      </button>
                      <button
                        onClick={saveSettings}
                        disabled={saveLoading}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {saveLoading ? (
                          <>
                            <ArrowPathIcon className="h-5 w-5 mr-2 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <SaveIcon className="h-5 w-5 mr-2" />
                            Save Settings
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Backup Settings */}
              <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">Backup Storage</h2>
                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Configure backup storage locations</p>
                </div>
                <div className="px-6 py-5 space-y-5">
                  {renderSettingField('backupfolder', settings.backupfolder, 'Backup Folder', 'Path where backups are stored', 'text')}
                  {renderSettingField('use_tmpfiles', settings.use_tmpfiles, 'Use Temporary Files', 'Use temporary files during backup', 'boolean')}
                  {renderSettingField('tmpdir', settings.tmpdir, 'Temporary Directory', 'Path for temporary files during backup', 'text')}
                </div>
              </div>

              {/* Performance Settings */}
              <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">Performance</h2>
                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Control concurrent operations and resource usage</p>
                </div>
                <div className="px-6 py-5 space-y-5">
                  {renderSettingField('max_sim_backups', settings.max_sim_backups, 'Max Simultaneous Backups', 'Maximum number of concurrent backups', 'number')}
                  {renderSettingField('max_active_clients', settings.max_active_clients, 'Max Active Clients', 'Maximum number of active client connections', 'number')}
                </div>
              </div>

              {/* Speed Settings */}
              <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">Speed Limits</h2>
                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Set bandwidth limits for local and internet backups</p>
                </div>
                <div className="px-6 py-5 space-y-5">
                  {renderSettingField('global_local_speed', settings.global_local_speed, 'Global Local Speed', 'Local network speed limit (KB/s, -1 = unlimited)', 'number')}
                  {renderSettingField('global_internet_speed', settings.global_internet_speed, 'Global Internet Speed', 'Internet speed limit (KB/s, -1 = unlimited)', 'number')}
                </div>
              </div>

              {/* Client Management */}
              <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">Client Management</h2>
                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Configure client software distribution</p>
                </div>
                <div className="px-6 py-5 space-y-5">
                  {renderSettingField('download_client', settings.download_client, 'Allow Client Download', 'Allow clients to download installer from server', 'boolean')}
                  {renderSettingField('autoupdate_clients', settings.autoupdate_clients, 'Auto-update Clients', 'Automatically update client software', 'boolean')}
                </div>
              </div>

              {/* Maintenance */}
              <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">Maintenance</h2>
                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Schedule cleanup and database backup operations</p>
                </div>
                <div className="px-6 py-5 space-y-5">
                  {renderSettingField('cleanup_window', settings.cleanup_window, 'Cleanup Window', 'Time window for cleanup operations (e.g., "1-7/3:00-4:00")', 'text')}
                  {renderSettingField('backup_database', settings.backup_database, 'Backup Database', 'Enable automatic database backups', 'boolean')}
                  {renderSettingField('autoshutdown', settings.autoshutdown, 'Auto Shutdown', 'Shutdown server after backups complete', 'boolean')}
                </div>
              </div>

              {/* All Other Settings */}
              <div className="bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden">
                <div className="px-6 py-5 border-b border-gray-200 dark:border-gray-700">
                  <h2 className="text-lg font-medium text-gray-900 dark:text-white">Advanced Settings</h2>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    All additional settings ({Object.keys(settings).filter(key => ![
                      'backupfolder', 'use_tmpfiles', 'tmpdir', 'max_sim_backups', 'max_active_clients',
                      'global_local_speed', 'global_internet_speed', 'download_client', 'autoupdate_clients',
                      'cleanup_window', 'backup_database', 'autoshutdown', 'internet_server', 'internet_server_port'
                    ].includes(key)).length} total). Settings not shown in categories above.
                  </p>
                </div>
                <div className="px-6 py-5 max-h-[500px] overflow-y-auto bg-gray-50 dark:bg-gray-900/20">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {Object.entries(settings)
                      .filter(([key]) => ![
                        'backupfolder', 'use_tmpfiles', 'tmpdir', 'max_sim_backups', 'max_active_clients',
                        'global_local_speed', 'global_internet_speed', 'download_client', 'autoupdate_clients',
                        'cleanup_window', 'backup_database', 'autoshutdown', 'internet_server', 'internet_server_port'
                      ].includes(key))
                      .map(([key, value]) => (
                        <div key={key} className="bg-white dark:bg-gray-800 p-3 rounded-md border border-gray-200 dark:border-gray-700">
                          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            {key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                          </label>
                          {typeof value === 'boolean' || value === 'true' || value === 'false' ? (
                            <div className="flex items-center">
                              <input
                                type="checkbox"
                                checked={value === true || value === 'true'}
                                onChange={(e) => updateSetting(key, e.target.checked)}
                                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600 rounded"
                              />
                              <span className="ml-2 text-xs text-gray-600 dark:text-gray-400">
                                {value === true || value === 'true' ? 'Enabled' : 'Disabled'}
                              </span>
                            </div>
                          ) : typeof value === 'number' || !isNaN(Number(value)) ? (
                            <input
                              type="number"
                              value={value || 0}
                              onChange={(e) => updateSetting(key, parseInt(e.target.value) || 0)}
                              className="block w-full border border-gray-300 dark:border-gray-600 rounded-md py-1.5 px-3 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          ) : typeof value === 'object' ? (
                            <div className="text-xs text-gray-500 dark:text-gray-400 italic py-1.5">
                              Complex object (view in backup)
                            </div>
                          ) : (
                            <input
                              type="text"
                              value={value || ''}
                              onChange={(e) => updateSetting(key, e.target.value)}
                              className="block w-full border border-gray-300 dark:border-gray-600 rounded-md py-1.5 px-3 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Internet Mode Tab */}
      {activeTab === 'internet' && (
        <div className="space-y-6">
          {settingsLoading ? (
            <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-12 text-center">
              <ArrowPathIcon className="h-12 w-12 mx-auto text-gray-400 animate-spin" />
              <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading settings...</p>
            </div>
          ) : (
            <>
              {/* Save Button Bar */}
              {hasChanges() && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <ExclamationTriangleIcon className="h-5 w-5 text-blue-600 dark:text-blue-400 mr-3" />
                      <span className="text-sm font-medium text-blue-900 dark:text-blue-200">
                        You have unsaved changes
                      </span>
                    </div>
                    <div className="flex space-x-3">
                      <button
                        onClick={() => {
                          setSettings(originalSettings);
                          setMessage({ type: 'success', text: 'Changes discarded' });
                        }}
                        className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"
                      >
                        Discard Changes
                      </button>
                      <button
                        onClick={saveSettings}
                        disabled={saveLoading}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {saveLoading ? (
                          <>
                            <ArrowPathIcon className="h-5 w-5 mr-2 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <SaveIcon className="h-5 w-5 mr-2" />
                            Save Settings
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Internet Mode Configuration */}
              <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-6 py-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-b border-gray-200 dark:border-gray-700">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">Internet Mode Configuration</h2>
                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                    Configure how clients connect to this server over the internet
                  </p>
                </div>
                <div className="px-6 py-5 space-y-5">
                  {renderSettingField('internet_server', settings.internet_server, 'Internet Server FQDN', 'The domain name or IP clients use to connect (e.g., backup.example.com)', 'text')}
                  {renderSettingField('internet_server_port', settings.internet_server_port, 'Internet Server Port', 'Port number for internet connections (default: 55414)', 'number')}
                </div>
              </div>

              {/* All Settings */}
              <div className="bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden">
                <div className="px-6 py-5 border-b border-gray-200 dark:border-gray-700">
                  <h2 className="text-lg font-medium text-gray-900 dark:text-white">All Server Settings</h2>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    Complete list of all {Object.keys(settings).length} settings loaded from UrBackup server.
                  </p>
                </div>
                <div className="px-6 py-5 max-h-[500px] overflow-y-auto bg-gray-50 dark:bg-gray-900/20">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {Object.entries(settings).map(([key, value]) => (
                      <div key={key} className="bg-white dark:bg-gray-800 p-3 rounded-md border border-gray-200 dark:border-gray-700">
                        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                          {key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </label>
                        {typeof value === 'boolean' || value === 'true' || value === 'false' ? (
                          <div className="flex items-center">
                            <input
                              type="checkbox"
                              checked={value === true || value === 'true'}
                              onChange={(e) => updateSetting(key, e.target.checked)}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600 rounded"
                            />
                            <span className="ml-2 text-xs text-gray-600 dark:text-gray-400">
                              {value === true || value === 'true' ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                        ) : typeof value === 'number' || !isNaN(Number(value)) ? (
                          <input
                            type="number"
                            value={value || 0}
                            onChange={(e) => updateSetting(key, parseInt(e.target.value) || 0)}
                            className="block w-full border border-gray-300 dark:border-gray-600 rounded-md py-1.5 px-3 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : typeof value === 'object' ? (
                          <div className="text-xs text-gray-500 dark:text-gray-400 italic py-1.5">
                            Complex object (view in backup)
                          </div>
                        ) : (
                          <input
                            type="text"
                            value={value || ''}
                            onChange={(e) => updateSetting(key, e.target.value)}
                            className="block w-full border border-gray-300 dark:border-gray-600 rounded-md py-1.5 px-3 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
