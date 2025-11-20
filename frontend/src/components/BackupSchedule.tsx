import { useEffect, useState } from 'react';
import { Calendar, Clock, Save, Loader2, RefreshCw, FolderOpen, Plus, X, FolderSearch, HardDrive } from 'lucide-react';
import { api } from '../services/api';
import { PathSelector } from './PathSelector';
import { VolumeSelector } from './VolumeSelector';

interface BackupScheduleProps {
  clientId: string;
  clientName: string;
}

interface ScheduleSettings {
  backup_window_incr_file?: string;
  backup_window_full_file?: string;
  backup_window_incr_image?: string;
  backup_window_full_image?: string;
  update_freq_incr?: number;
  update_freq_full?: number;
  update_freq_image_incr?: number;
  update_freq_image_full?: number;
  max_file_incr?: number;
  min_file_incr?: number;
  max_file_full?: number;
  min_file_full?: number;
  max_image_incr?: number;
  min_image_incr?: number;
  max_image_full?: number;
  min_image_full?: number;
  default_dirs?: string;
  include_files?: string;
  exclude_files?: string;
  image_letters?: string;
}

interface BackupPath {
  path: string;
  name?: string;
  flags: string[];
}

export function BackupSchedule({ clientId, clientName }: BackupScheduleProps) {
  const [settings, setSettings] = useState<ScheduleSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Backup paths management
  const [backupPaths, setBackupPaths] = useState<BackupPath[]>([]);
  const [newPath, setNewPath] = useState('');
  const [newPathName, setNewPathName] = useState('');
  const [selectedFlags, setSelectedFlags] = useState<string[]>([]);

  // Image volumes management
  const [imageVolumes, setImageVolumes] = useState<string[]>([]);
  const [newVolume, setNewVolume] = useState('');

  // Modal states
  const [showPathSelector, setShowPathSelector] = useState(false);
  const [showVolumeSelector, setShowVolumeSelector] = useState(false);

  useEffect(() => {
    loadSettings();
  }, [clientId]);

  // Parse backup paths from default_dirs setting
  const parseBackupPaths = (defaultDirs: string): BackupPath[] => {
    // Handle corrupted/invalid values
    if (!defaultDirs ||
        typeof defaultDirs !== 'string' ||
        defaultDirs.trim() === '' ||
        defaultDirs === '[object Object]' ||
        defaultDirs === 'NaN' ||
        defaultDirs === 'undefined' ||
        defaultDirs === 'null') {
      return [];
    }

    const paths: BackupPath[] = [];
    const entries = defaultDirs.split(';').filter(e => e.trim());

    for (const entry of entries) {
      // Skip corrupted entries
      if (entry.includes('[object Object]') || entry === 'NaN' || entry === 'undefined') {
        continue;
      }

      // Format: path|name/flag1,flag2
      const parts = entry.split('|');
      const pathPart = parts[0].trim();

      // Skip empty or invalid paths
      if (!pathPart || pathPart === '[object Object]') {
        continue;
      }

      let name = '';
      let flags: string[] = [];

      if (parts.length > 1) {
        const nameAndFlags = parts[1];
        const flagIndex = nameAndFlags.indexOf('/');

        if (flagIndex !== -1) {
          name = nameAndFlags.substring(0, flagIndex).trim();
          flags = nameAndFlags.substring(flagIndex + 1).split(',').map(f => f.trim()).filter(f => f);
        } else {
          name = nameAndFlags.trim();
        }
      }

      paths.push({ path: pathPart, name: name || undefined, flags });
    }

    return paths;
  };

  // Serialize backup paths to default_dirs format
  const serializeBackupPaths = (paths: BackupPath[]): string => {
    return paths.map(p => {
      let result = p.path;
      if (p.name || p.flags.length > 0) {
        result += '|' + (p.name || '');
        if (p.flags.length > 0) {
          result += '/' + p.flags.join(',');
        }
      }
      return result;
    }).join(';');
  };

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('Loading settings for client ID:', clientId);
      const data = await api.getClientSettings(clientId);
      console.log('Received settings data:', data);

      if (data && data.settings) {
        console.log('Setting settings with', Object.keys(data.settings).length, 'keys');
        setSettings(data.settings);

        // Parse backup paths
        if (data.settings.default_dirs) {
          const paths = parseBackupPaths(data.settings.default_dirs);
          setBackupPaths(paths);
        }

        // Parse image volumes - handle corrupted values
        if (data.settings.image_letters &&
            typeof data.settings.image_letters === 'string' &&
            data.settings.image_letters !== '[object Object]' &&
            data.settings.image_letters !== 'NaN' &&
            data.settings.image_letters !== 'undefined' &&
            data.settings.image_letters !== 'null') {
          const volumes = data.settings.image_letters
            .split(';')
            .filter((v: string) => v.trim())
            .filter((v: string) => v !== '[object Object]' && v !== 'NaN' && v !== 'undefined');
          setImageVolumes(volumes);
        } else {
          setImageVolumes([]);
        }
      } else {
        console.warn('No settings in response:', data);
        setSettings({});
      }
    } catch (err: any) {
      console.error('Failed to load settings:', err);
      const errorMessage = err.response?.data?.error || err.message || 'Failed to load backup schedule settings';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!settings) return;

    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      // Serialize backup paths and image volumes before saving
      const updatedSettings = {
        ...settings,
        default_dirs: serializeBackupPaths(backupPaths),
        image_letters: imageVolumes.join(';')
      };

      await api.updateClientSettings(clientId, updatedSettings);
      setSuccessMessage('Backup schedule updated successfully!');

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      console.error('Failed to save settings:', err);
      setError(err.response?.data?.error || 'Failed to save backup schedule');
    } finally {
      setSaving(false);
    }
  };

  // Backup path management functions
  const addBackupPath = () => {
    if (!newPath.trim()) return;

    const newBackupPath: BackupPath = {
      path: newPath.trim(),
      name: newPathName.trim() || undefined,
      flags: selectedFlags
    };

    setBackupPaths([...backupPaths, newBackupPath]);
    setNewPath('');
    setNewPathName('');
    setSelectedFlags([]);
  };

  const removeBackupPath = (index: number) => {
    setBackupPaths(backupPaths.filter((_, i) => i !== index));
  };

  const toggleFlag = (flag: string) => {
    setSelectedFlags(prev =>
      prev.includes(flag)
        ? prev.filter(f => f !== flag)
        : [...prev, flag]
    );
  };

  const togglePathFlag = (pathIndex: number, flag: string) => {
    setBackupPaths(paths => paths.map((p, i) => {
      if (i !== pathIndex) return p;
      return {
        ...p,
        flags: p.flags.includes(flag)
          ? p.flags.filter(f => f !== flag)
          : [...p.flags, flag]
      };
    }));
  };

  // Image volume management functions
  const addImageVolume = () => {
    if (!newVolume.trim()) return;
    if (imageVolumes.includes(newVolume.trim())) return;
    setImageVolumes([...imageVolumes, newVolume.trim()]);
    setNewVolume('');
  };

  const removeImageVolume = (volume: string) => {
    setImageVolumes(imageVolumes.filter(v => v !== volume));
  };

  // Selector handlers
  const handlePathSelect = (path: string, name?: string) => {
    const newBackupPath: BackupPath = {
      path: path,
      name: name || undefined,
      flags: []
    };
    setBackupPaths([...backupPaths, newBackupPath]);
  };

  const handleVolumeSelect = (volumes: string[]) => {
    setImageVolumes(volumes);
  };

  const updateSetting = (key: keyof ScheduleSettings, value: any) => {
    setSettings(prev => prev ? { ...prev, [key]: value } : { [key]: value });
  };

  const formatInterval = (hours: number | undefined): string => {
    if (!hours) return 'Not set';
    if (hours < 24) return `${hours} hours`;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    if (remainingHours === 0) return `${days} ${days === 1 ? 'day' : 'days'}`;
    return `${days}d ${remainingHours}h`;
  };

  if (loading && !settings) {
    return (
      <div className="card">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600 dark:text-primary-400" />
          <p className="ml-3 text-gray-600 dark:text-gray-400">Loading schedule settings...</p>
        </div>
      </div>
    );
  }

  if (error && !settings) {
    return (
      <div className="card">
        <div className="text-center py-8">
          <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
          <button onClick={loadSettings} className="btn btn-primary flex items-center gap-2 mx-auto">
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Show info message if settings loaded but are empty (client may use server defaults)
  const hasAnySettings = settings && Object.keys(settings).some(key =>
    settings[key as keyof typeof settings] !== undefined &&
    settings[key as keyof typeof settings] !== 0 &&
    settings[key as keyof typeof settings] !== ''
  );

  return (
    <div className="space-y-6">
      {/* Success/Error Messages */}
      {successMessage && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <p className="text-green-800 dark:text-green-200">{successMessage}</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {!hasAnySettings && !error && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <p className="text-blue-800 dark:text-blue-200">
            This client is currently using server default settings. You can customize the backup schedule below and save your changes.
          </p>
        </div>
      )}

      {/* File Backup Schedule */}
      <div className="card">
        <div className="flex items-center gap-3 mb-6">
          <Calendar className="h-6 w-6 text-blue-600" />
          <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            File Backup Schedule
          </h3>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Incremental File Backup */}
          <div className="space-y-4">
            <h4 className="font-medium text-gray-900 dark:text-gray-100">Incremental Backups</h4>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Backup Interval (hours)
              </label>
              <input
                type="number"
                min="0"
                value={settings?.update_freq_incr || 0}
                onChange={(e) => updateSetting('update_freq_incr', parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Current: {formatInterval(settings?.update_freq_incr)}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Backup Window (e.g., 1-5,18-23)
              </label>
              <input
                type="text"
                value={settings?.backup_window_incr_file || ''}
                onChange={(e) => updateSetting('backup_window_incr_file', e.target.value)}
                placeholder="Leave empty for 24/7"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Hour ranges when backups can run (comma-separated)
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Min Incremental
                </label>
                <input
                  type="number"
                  min="0"
                  value={settings?.min_file_incr || 0}
                  onChange={(e) => updateSetting('min_file_incr', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Max Incremental
                </label>
                <input
                  type="number"
                  min="0"
                  value={settings?.max_file_incr || 0}
                  onChange={(e) => updateSetting('max_file_incr', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
              </div>
            </div>
          </div>

          {/* Full File Backup */}
          <div className="space-y-4">
            <h4 className="font-medium text-gray-900 dark:text-gray-100">Full Backups</h4>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Backup Interval (hours)
              </label>
              <input
                type="number"
                min="0"
                value={settings?.update_freq_full || 0}
                onChange={(e) => updateSetting('update_freq_full', parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Current: {formatInterval(settings?.update_freq_full)}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Backup Window (e.g., 1-5,18-23)
              </label>
              <input
                type="text"
                value={settings?.backup_window_full_file || ''}
                onChange={(e) => updateSetting('backup_window_full_file', e.target.value)}
                placeholder="Leave empty for 24/7"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Hour ranges when backups can run (comma-separated)
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Min Full
                </label>
                <input
                  type="number"
                  min="0"
                  value={settings?.min_file_full || 0}
                  onChange={(e) => updateSetting('min_file_full', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Max Full
                </label>
                <input
                  type="number"
                  min="0"
                  value={settings?.max_file_full || 0}
                  onChange={(e) => updateSetting('max_file_full', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Image Backup Schedule */}
      <div className="card">
        <div className="flex items-center gap-3 mb-6">
          <Clock className="h-6 w-6 text-purple-600" />
          <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Image Backup Schedule
          </h3>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Incremental Image Backup */}
          <div className="space-y-4">
            <h4 className="font-medium text-gray-900 dark:text-gray-100">Incremental Backups</h4>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Backup Interval (hours)
              </label>
              <input
                type="number"
                min="0"
                value={settings?.update_freq_image_incr || 0}
                onChange={(e) => updateSetting('update_freq_image_incr', parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Current: {formatInterval(settings?.update_freq_image_incr)}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Backup Window (e.g., 1-5,18-23)
              </label>
              <input
                type="text"
                value={settings?.backup_window_incr_image || ''}
                onChange={(e) => updateSetting('backup_window_incr_image', e.target.value)}
                placeholder="Leave empty for 24/7"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Hour ranges when backups can run (comma-separated)
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Min Incremental
                </label>
                <input
                  type="number"
                  min="0"
                  value={settings?.min_image_incr || 0}
                  onChange={(e) => updateSetting('min_image_incr', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Max Incremental
                </label>
                <input
                  type="number"
                  min="0"
                  value={settings?.max_image_incr || 0}
                  onChange={(e) => updateSetting('max_image_incr', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
              </div>
            </div>
          </div>

          {/* Full Image Backup */}
          <div className="space-y-4">
            <h4 className="font-medium text-gray-900 dark:text-gray-100">Full Backups</h4>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Backup Interval (hours)
              </label>
              <input
                type="number"
                min="0"
                value={settings?.update_freq_image_full || 0}
                onChange={(e) => updateSetting('update_freq_image_full', parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Current: {formatInterval(settings?.update_freq_image_full)}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Backup Window (e.g., 1-5,18-23)
              </label>
              <input
                type="text"
                value={settings?.backup_window_full_image || ''}
                onChange={(e) => updateSetting('backup_window_full_image', e.target.value)}
                placeholder="Leave empty for 24/7"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Hour ranges when backups can run (comma-separated)
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Min Full
                </label>
                <input
                  type="number"
                  min="0"
                  value={settings?.min_image_full || 0}
                  onChange={(e) => updateSetting('min_image_full', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Max Full
                </label>
                <input
                  type="number"
                  min="0"
                  value={settings?.max_image_full || 0}
                  onChange={(e) => updateSetting('max_image_full', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Image/Volume Selection Section */}
      <div className="card">
        <div className="flex items-center gap-3 mb-6">
          <Clock className="h-6 w-6 text-orange-600" />
          <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Image Backup Volumes
          </h3>
        </div>

        <div className="space-y-6">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Select which drives/volumes to include in image backups. Use drive letters (C:, D:) for Windows or device paths (/dev/sda1) for Linux.
          </p>

          {/* Current Volumes */}
          {imageVolumes.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Selected Volumes ({imageVolumes.length})
              </h4>
              <div className="flex flex-wrap gap-2">
                {imageVolumes.map((volume, index) => (
                  <div
                    key={index}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-orange-100 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700 rounded-lg"
                  >
                    <span className="font-mono text-sm text-gray-900 dark:text-gray-100">{volume}</span>
                    <button
                      onClick={() => removeImageVolume(volume)}
                      className="text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300"
                      title="Remove volume"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add New Volume */}
          <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
              Select Volumes
            </h4>

            <button
              onClick={() => setShowVolumeSelector(true)}
              className="w-full py-8 px-6 bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 hover:from-orange-100 hover:to-orange-200 dark:hover:from-orange-800/30 dark:hover:to-orange-700/30 border-2 border-orange-300 dark:border-orange-700 rounded-lg transition-all shadow-sm hover:shadow-md"
            >
              <div className="flex flex-col items-center gap-3">
                <HardDrive className="h-12 w-12 text-orange-600 dark:text-orange-400" />
                <div>
                  <div className="text-lg font-semibold text-orange-900 dark:text-orange-100">
                    Choose Volumes
                  </div>
                  <div className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                    Select drives and partitions for image backup
                  </div>
                </div>
              </div>
            </button>
          </div>

          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <h4 className="font-medium text-yellow-900 dark:text-yellow-100 mb-2">Important Notes</h4>
            <ul className="text-sm text-yellow-800 dark:text-yellow-200 space-y-1 list-disc list-inside">
              <li>Image backups capture entire disk volumes/partitions</li>
              <li>Requires sufficient storage space for full disk images</li>
              <li>Windows uses drive letters (C:, D:), Linux uses device paths</li>
              <li>Leave empty to disable image backups for this client</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Backup Paths Section */}
      <div className="card">
        <div className="flex items-center gap-3 mb-6">
          <FolderOpen className="h-6 w-6 text-green-600" />
          <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            File Backup Directories
          </h3>
        </div>

        <div className="space-y-6">
          {/* Current Backup Paths */}
          {backupPaths.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Current Backup Directories ({backupPaths.length})
              </h4>
              {backupPaths.map((path, index) => (
                <div key={index} className="border border-gray-300 dark:border-gray-600 rounded-lg p-4 bg-gray-50 dark:bg-gray-800/50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="font-mono text-sm text-gray-900 dark:text-gray-100 mb-1">
                        {path.path}
                      </div>
                      {path.name && (
                        <div className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                          Display as: {path.name}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {['optional', 'follow_symlinks', 'one_filesystem', 'require_snapshot', 'keep'].map(flag => (
                          <label key={flag} className="inline-flex items-center text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={path.flags.includes(flag)}
                              onChange={() => togglePathFlag(index, flag)}
                              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-1"
                            />
                            <span className="text-gray-700 dark:text-gray-300">{flag}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => removeBackupPath(index)}
                      className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 p-1"
                      title="Remove path"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add New Path */}
          <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
              Add Backup Directory
            </h4>

            <button
              onClick={() => setShowPathSelector(true)}
              className="w-full py-8 px-6 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 hover:from-green-100 hover:to-green-200 dark:hover:from-green-800/30 dark:hover:to-green-700/30 border-2 border-green-300 dark:border-green-700 rounded-lg transition-all shadow-sm hover:shadow-md"
            >
              <div className="flex flex-col items-center gap-3">
                <FolderSearch className="h-12 w-12 text-green-600 dark:text-green-400" />
                <div>
                  <div className="text-lg font-semibold text-green-900 dark:text-green-100">
                    Browse for Directory
                  </div>
                  <div className="text-sm text-green-700 dark:text-green-300 mt-1">
                    Select from common paths or enter custom location
                  </div>
                </div>
              </div>
            </button>
          </div>

          {/* Include/Exclude Files */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Include File Patterns
              </label>
              <textarea
                value={settings?.include_files || ''}
                onChange={(e) => updateSetting('include_files', e.target.value)}
                placeholder="*.doc&#10;*.pdf&#10;important_file.txt"
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                One pattern per line
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Exclude File Patterns
              </label>
              <textarea
                value={settings?.exclude_files || ''}
                onChange={(e) => updateSetting('exclude_files', e.target.value)}
                placeholder="*.tmp&#10;*.log&#10;cache/*"
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                One pattern per line
              </p>
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">Path Examples</h4>
            <div className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
              <div><strong>Windows:</strong> C:\Users, C:\Program Files, D:\Data</div>
              <div><strong>Linux/Mac:</strong> /home/username, /etc, /var/www</div>
              <div><strong>Network:</strong> \\server\share (Windows) or /mnt/share (Linux)</div>
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn btn-primary flex items-center gap-2"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save Schedule
            </>
          )}
        </button>
      </div>

      {/* Modals */}
      {showPathSelector && (
        <PathSelector
          clientId={clientId}
          onSelect={handlePathSelect}
          onClose={() => setShowPathSelector(false)}
          existingPaths={backupPaths.map(p => p.path)}
        />
      )}

      {showVolumeSelector && (
        <VolumeSelector
          clientId={clientId}
          onSelect={handleVolumeSelect}
          onClose={() => setShowVolumeSelector(false)}
          existingVolumes={imageVolumes}
        />
      )}
    </div>
  );
}
