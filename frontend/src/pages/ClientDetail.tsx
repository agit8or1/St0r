import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  HardDrive,
  Play,
  Calendar,
  Database,
  Activity,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  FolderOpen,
  Settings,
  Download,
  Monitor,
  Server as ServerIcon,
  Apple,
  Eye,
  EyeOff
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import { BackupSchedule } from '../components/BackupSchedule';
import { api } from '../services/api';
import type { Client, Backup } from '../types';
import { formatBytes, formatTimeAgo, formatTimestamp, formatDuration } from '../utils/format';

export function ClientDetail() {
  const { clientName } = useParams<{ clientName: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingBackup, setStartingBackup] = useState<string | null>(null);
  const [tab, setTab] = useState<'file' | 'image'>('file');
  const [view, setView] = useState<'overview' | 'schedule'>('overview');
  const [authKey, setAuthKey] = useState<string | null>(null);
  const [showAuthKey, setShowAuthKey] = useState(false);
  const [loadingAuthKey, setLoadingAuthKey] = useState(false);
  const [serverInfo, setServerInfo] = useState<{ serverIP: string; serverPort: string; serverUrl: string } | null>(null);

  useEffect(() => {
    loadClientData();
    loadServerInfo();
  }, [clientName]);

  const loadClientData = async () => {
    try {
      const clients = await api.getClients();
      const foundClient = clients.find(c => c.name === clientName);
      setClient(foundClient || null);

      if (foundClient?.id) {
        const backupData = await api.getBackups(foundClient.id);

        // Handle different response formats
        if (Array.isArray(backupData)) {
          setBackups(backupData);
        } else if (backupData && typeof backupData === 'object') {
          // If it's an object, try to extract backup arrays
          const objData = backupData as any;
          const allBackups = [
            ...(objData.backups || []),
            ...(objData.file_backups || []),
            ...(objData.image_backups || []),
            ...(objData.file || []),  // API returns 'file' key
            ...(objData.image || [])  // API returns 'image' key
          ];
          setBackups(allBackups);
        } else {
          setBackups([]);
        }
      }
    } catch (err) {
      console.error('Failed to load client data:', err);
      setBackups([]);
    } finally {
      setLoading(false);
    }
  };

  const loadServerInfo = async () => {
    try {
      const info = await api.getServerInfo();
      setServerInfo(info);
    } catch (err) {
      console.error('Failed to load server info:', err);
    }
  };

  const loadAuthKey = async () => {
    if (!client?.id || authKey) return;

    setLoadingAuthKey(true);
    try {
      const result = await api.getClientAuthkey(client.id);
      setAuthKey(result.authkey);
    } catch (err) {
      console.error('Failed to load auth key:', err);
      alert('Failed to load authentication key');
    } finally {
      setLoadingAuthKey(false);
    }
  };

  const handleDownloadWithKey = async (platform: 'windows' | 'linux') => {
    try {
      // Load auth key if not already loaded
      let keyToUse = authKey;
      if (!keyToUse) {
        await loadAuthKey();
        // Wait a moment for state to update, then get the key directly from API
        if (!authKey && client?.id) {
          const result = await api.getClientAuthkey(client.id);
          keyToUse = result.authkey;
        } else {
          keyToUse = authKey;
        }
      }

      if (!keyToUse) {
        alert('Failed to load authentication key. Please try clicking "Show Key" first.');
        return;
      }

      if (!client?.id) {
        alert('Client ID not available.');
        return;
      }

      // Download with the loaded key and client ID
      if (platform === 'windows') {
        api.downloadWindowsInstaller(keyToUse, client.id.toString());
      } else {
        api.downloadLinuxInstaller(keyToUse, client.id.toString());
      }
    } catch (error) {
      console.error('Failed to download with key:', error);
      alert('Failed to prepare download. Please try again.');
    }
  };

  const handleStartBackup = async (type: 'file' | 'image', incremental: boolean) => {
    if (!clientName || !client) return;

    const backupKey = `${type}-${incremental ? 'incr' : 'full'}`;
    setStartingBackup(backupKey);

    try {
      // Try to use client.id if available, otherwise just use clientName
      const clientId = client.id || (client as any).clientid;
      console.log('Starting backup with:', { clientName, clientId, type, incremental });
      await api.startBackup(clientName, type, incremental, clientId);
      alert(`${incremental ? 'Incremental' : 'Full'} ${type} backup started successfully`);
    } catch (err: any) {
      console.error('Backup start error:', err);
      alert(err.response?.data?.error || 'Failed to start backup');
    } finally {
      setStartingBackup(null);
    }
  };

  if (loading) {
    return (
      <Layout>
        <Loading />
      </Layout>
    );
  }

  if (!client) {
    return (
      <Layout>
        <div className="card text-center py-12">
          <p className="text-gray-600 dark:text-gray-400">Client not found</p>
          <button onClick={() => navigate('/clients')} className="btn btn-primary mt-4">
            Back to Clients
          </button>
        </div>
      </Layout>
    );
  }

  const fileBackups = backups.filter(b => !b.image);
  const imageBackups = backups.filter(b => b.image);
  const displayBackups = tab === 'file' ? fileBackups : imageBackups;

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/clients')}
            className="btn btn-secondary flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
              <HardDrive className="h-8 w-8" />
              {client.name}
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {client.online ? (
                <span className="text-green-600 dark:text-green-400">● Online</span>
              ) : (
                <span className="text-gray-400 dark:text-gray-400">● Offline</span>
              )}
              {' • Last seen: '}
              {formatTimeAgo(client.lastseen || 0)}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate(`/clients/${encodeURIComponent(clientName!)}/settings`)}
              className="btn btn-secondary flex items-center gap-2"
            >
              <Settings className="h-4 w-4" />
              Settings
            </button>
            <button
              onClick={() => navigate(`/clients/${encodeURIComponent(clientName!)}/browse`)}
              className="btn btn-primary flex items-center gap-2"
            >
              <FolderOpen className="h-4 w-4" />
              Browse Files
            </button>
          </div>
        </div>

        {/* Download Client Software for THIS Client */}
        <div className="card bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20">
          <div className="flex items-center gap-3 mb-4">
            <Download className="h-6 w-6 text-green-600 dark:text-green-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Download Client Software for {client.name}
            </h2>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Install the UrBackup client on this computer with pre-configured authentication
          </p>

          {/* Auth Key Display */}
          {client.id && (
            <div className="mb-4 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Authentication Key:</span>
                <button
                  onClick={() => {
                    if (!authKey) {
                      loadAuthKey();
                    }
                    setShowAuthKey(!showAuthKey);
                  }}
                  disabled={loadingAuthKey}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded text-sm flex items-center gap-2"
                >
                  {loadingAuthKey ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading...
                    </>
                  ) : showAuthKey && authKey ? (
                    <>
                      <EyeOff className="h-3 w-3" />
                      Hide
                    </>
                  ) : (
                    <>
                      <Eye className="h-3 w-3" />
                      Show Key
                    </>
                  )}
                </button>
              </div>
              {showAuthKey && authKey && (
                <code className="block px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-xs font-mono text-gray-900 dark:text-gray-100 break-all">
                  {authKey}
                </code>
              )}
            </div>
          )}

          {serverInfo && (
            <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                ✅ Pre-configured for: <span className="font-mono">{serverInfo.serverUrl}</span>
              </p>
              <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                <strong>Windows:</strong> Downloads a preconfigured .exe installer with all settings embedded (server, port, auth key, encryption).
                <br />
                <strong>Linux:</strong> Downloads a preconfigured installer script that sets up the client automatically.
                <br />
                <strong>Generated by UrBackup Server:</strong> Installers are created on-demand with your client's authentication key!
              </p>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <button
              onClick={() => handleDownloadWithKey('windows')}
              className="flex items-center gap-3 p-4 rounded-lg bg-white dark:bg-gray-800 border-2 border-green-500 dark:border-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors group"
            >
              <Monitor className="h-8 w-8 text-green-600 dark:text-green-400 group-hover:scale-110 transition-transform" />
              <div className="text-left">
                <p className="font-semibold text-gray-900 dark:text-gray-100">Windows Client</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Preconfigured .exe installer</p>
              </div>
            </button>
            <button
              onClick={() => handleDownloadWithKey('linux')}
              className="flex items-center gap-3 p-4 rounded-lg bg-white dark:bg-gray-800 border-2 border-green-500 dark:border-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors group"
            >
              <ServerIcon className="h-8 w-8 text-green-600 dark:text-green-400 group-hover:scale-110 transition-transform" />
              <div className="text-left">
                <p className="font-semibold text-gray-900 dark:text-gray-100">Linux Client</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Preconfigured installer script</p>
              </div>
            </button>
            <a
              href="https://www.urbackup.org/download.html#client_macos"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-4 rounded-lg bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-700 hover:border-green-500 dark:hover:border-green-400 transition-colors group"
            >
              <Apple className="h-8 w-8 text-gray-600 dark:text-gray-400 group-hover:text-green-600 dark:group-hover:text-green-400 group-hover:scale-110 transition-all" />
              <div className="text-left">
                <p className="font-semibold text-gray-900 dark:text-gray-100">macOS</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Manual config needed</p>
              </div>
            </a>
          </div>
        </div>

        {/* View Toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => setView('overview')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              view === 'overview'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setView('schedule')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              view === 'schedule'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            <Calendar className="h-4 w-4 inline mr-2" />
            Backup Schedule
          </button>
        </div>

        {/* Schedule View */}
        {view === 'schedule' && client.id && (
          <BackupSchedule clientId={client.id.toString()} clientName={client.name} />
        )}

        {/* Overview Content */}
        {view === 'overview' && (
          <>
            {/* Quick Stats */}
            <div className="grid gap-4 md:grid-cols-5">
          <div className="card">
            <div className="flex items-center gap-3">
              <Calendar className="h-8 w-8 text-blue-600" />
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Last File Backup</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {formatTimeAgo(client.lastbackup || 0)}
                </p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center gap-3">
              <Database className="h-8 w-8 text-purple-600" />
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Last Image Backup</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {formatTimeAgo(client.lastbackup_image || 0)}
                </p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center gap-3">
              {client.file_ok ? (
                <CheckCircle className="h-8 w-8 text-green-600" />
              ) : (
                <XCircle className="h-8 w-8 text-red-600" />
              )}
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">File Backup Status</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {client.file_ok ? 'OK' : 'Failed'}
                </p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center gap-3">
              {client.image_ok ? (
                <CheckCircle className="h-8 w-8 text-green-600" />
              ) : (
                <XCircle className="h-8 w-8 text-red-600" />
              )}
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Image Backup Status</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {client.image_ok ? 'OK' : 'Failed'}
                </p>
              </div>
            </div>
          </div>

          {(client.bytes_used_files || client.bytes_used_images) && (
            <div className="card">
              <div className="flex items-center gap-3">
                <HardDrive className="h-8 w-8 text-orange-600" />
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Storage Used</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {formatBytes((client.bytes_used_files || 0) + (client.bytes_used_images || 0))}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Backup Controls */}
        <div className="card">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Start Backup
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <h3 className="font-medium text-gray-900 dark:text-gray-100">File Backups</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => handleStartBackup('file', false)}
                  disabled={!!startingBackup}
                  className="btn btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  {startingBackup === 'file-full' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Full Backup
                </button>
                <button
                  onClick={() => handleStartBackup('file', true)}
                  disabled={!!startingBackup}
                  className="btn btn-secondary flex-1 flex items-center justify-center gap-2"
                >
                  {startingBackup === 'file-incr' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Activity className="h-4 w-4" />
                  )}
                  Incremental
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="font-medium text-gray-900 dark:text-gray-100">Image Backups</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => handleStartBackup('image', false)}
                  disabled={!!startingBackup}
                  className="btn btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  {startingBackup === 'image-full' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Full Image
                </button>
                <button
                  onClick={() => handleStartBackup('image', true)}
                  disabled={!!startingBackup}
                  className="btn btn-secondary flex-1 flex items-center justify-center gap-2"
                >
                  {startingBackup === 'image-incr' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Activity className="h-4 w-4" />
                  )}
                  Incremental
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Backup History */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Backup History
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => setTab('file')}
                className={`px-4 py-2 rounded-lg font-medium ${
                  tab === 'file'
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100'
                }`}
              >
                File Backups ({fileBackups.length})
              </button>
              <button
                onClick={() => setTab('image')}
                className={`px-4 py-2 rounded-lg font-medium ${
                  tab === 'image'
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100'
                }`}
              >
                Image Backups ({imageBackups.length})
              </button>
            </div>
          </div>

          {displayBackups.length === 0 ? (
            <p className="text-center text-gray-600 dark:text-gray-400 py-8">
              No {tab} backups found
            </p>
          ) : (
            <div className="space-y-2">
              {displayBackups.map((backup) => (
                <div
                  key={backup.id}
                  className="flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className={`rounded-full p-2 ${
                      backup.incremental
                        ? 'bg-blue-100 dark:bg-blue-900'
                        : 'bg-green-100 dark:bg-green-900'
                    }`}>
                      <Database className={`h-5 w-5 ${
                        backup.incremental
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-green-600 dark:text-green-400'
                      }`} />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">
                        {backup.incremental ? 'Incremental' : 'Full'} Backup
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {formatTimestamp(backup.backuptime)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {formatBytes(backup.size_bytes)}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {backup.duration && !isNaN(backup.duration) ? formatDuration(backup.duration) : 'N/A'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
          </>
        )}
      </div>
    </Layout>
  );
}
