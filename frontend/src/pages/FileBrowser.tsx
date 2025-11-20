import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import { FolderOpen, File, Download, ChevronRight, ArrowLeft, HardDrive, RotateCcw, CheckSquare, Square } from 'lucide-react';
import { api } from '../services/api';

interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  modifiedTime?: string;
}

interface Backup {
  id: string;
  backuptime: string;
  size_bytes: number;
  archived: boolean;
}

export function FileBrowser() {
  const { clientName } = useParams<{ clientName: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [selectedBackup, setSelectedBackup] = useState<Backup | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState('/');
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [clientId, setClientId] = useState<string>('');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    loadBackups();
  }, [clientName]);

  useEffect(() => {
    if (selectedBackup && clientId) {
      loadFiles(currentPath);
    }
  }, [selectedBackup, currentPath, clientId]);

  const loadBackups = async () => {
    try {
      setLoading(true);
      const data = await fetch(`/api/browse/backups?clientName=${encodeURIComponent(clientName!)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      }).then(res => res.json());

      // Parse the response to extract backups and client ID
      if (data.backups && Array.isArray(data.backups)) {
        setBackups(data.backups);
        if (data.backups.length > 0 && data.backups[0].clientid) {
          setClientId(data.backups[0].clientid);
        }
      }
    } catch (err) {
      console.error('Failed to load backups:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadFiles = async (path: string) => {
    try {
      setLoadingFiles(true);
      const data = await fetch(
        `/api/browse/files?clientId=${clientId}&backupId=${selectedBackup!.id}&path=${encodeURIComponent(path)}`,
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        }
      ).then(res => res.json());

      // Parse the response to extract files
      if (data.files && Array.isArray(data.files)) {
        setFiles(data.files);
      } else if (Array.isArray(data)) {
        setFiles(data);
      } else {
        setFiles([]);
      }
    } catch (err) {
      console.error('Failed to load files:', err);
      setFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  };

  const navigateToFolder = (folderPath: string) => {
    setCurrentPath(folderPath);
  };

  const navigateUp = () => {
    if (currentPath === '/' || currentPath === '') return;
    const parts = currentPath.split('/').filter(p => p);
    parts.pop();
    const newPath = '/' + parts.join('/');
    setCurrentPath(newPath || '/');
  };

  const downloadFile = async (file: FileEntry) => {
    try {
      // Download directly from the API
      const downloadUrl = `/api/browse/download?clientId=${clientId}&backupId=${selectedBackup!.id}&path=${encodeURIComponent(file.path)}`;

      // Create a temporary link and click it to trigger download
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = file.name;
      link.style.display = 'none';

      // Set authorization header by opening in same window with credentials
      const token = localStorage.getItem('token');

      // Use fetch to download with auth
      const response = await fetch(downloadUrl, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Download failed');
      }

      // Create blob and download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download file:', err);
      alert('Failed to download file. Please try again.');
    }
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return 'N/A';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  };

  const formatDate = (timestamp: string | number) => {
    return new Date(timestamp).toLocaleString();
  };

  const toggleFileSelection = (filePath: string) => {
    const newSelection = new Set(selectedFiles);
    if (newSelection.has(filePath)) {
      newSelection.delete(filePath);
    } else {
      newSelection.add(filePath);
    }
    setSelectedFiles(newSelection);
  };

  const selectAll = () => {
    if (selectedFiles.size === files.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(files.map(f => f.path)));
    }
  };

  const restoreFiles = async () => {
    if (selectedFiles.size === 0) {
      alert('Please select files to restore');
      return;
    }

    const confirmed = confirm(
      `Are you sure you want to restore ${selectedFiles.size} file(s) to ${clientName}? This will overwrite existing files on the client.`
    );

    if (!confirmed) return;

    setRestoring(true);
    try {
      const response = await fetch('/api/browse/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          clientId,
          backupId: selectedBackup!.id,
          paths: Array.from(selectedFiles),
          restorePath: '' // Restore to original location
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Restore failed');
      }

      alert(`Restore initiated successfully for ${selectedFiles.size} file(s)!`);
      setSelectedFiles(new Set());
    } catch (err: any) {
      console.error('Failed to restore files:', err);
      alert(`Failed to restore files: ${err.message}`);
    } finally {
      setRestoring(false);
    }
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
              onClick={() => navigate('/clients')}
              className="mb-2 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Clients
            </button>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              File Browser - {clientName}
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Browse and restore files from backups
            </p>
          </div>
        </div>

        {/* Backup Selection */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Select Backup
          </h2>
          {backups.length === 0 ? (
            <p className="text-gray-600 dark:text-gray-400">No backups available</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {backups.map((backup) => (
                <button
                  key={backup.id}
                  onClick={() => {
                    setSelectedBackup(backup);
                    setCurrentPath('/');
                  }}
                  className={`p-4 rounded-lg border-2 text-left transition-colors ${
                    selectedBackup?.id === backup.id
                      ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/20 dark:border-primary-500'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <HardDrive className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {formatDate(backup.backuptime)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Size: {formatSize(backup.size_bytes)}
                  </p>
                  {backup.archived && (
                    <span className="mt-2 inline-block rounded bg-yellow-100 dark:bg-yellow-900 px-2 py-1 text-xs text-yellow-800 dark:text-yellow-200">
                      Archived
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* File Browser */}
        {selectedBackup && (
          <div className="card">
            <div className="mb-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Files
                  </h2>
                  {currentPath !== '/' && (
                    <button
                      onClick={navigateUp}
                      className="btn btn-secondary flex items-center gap-1 text-sm"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Up
                    </button>
                  )}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Path: {currentPath}
                </div>
              </div>

              {files.length > 0 && (
                <div className="flex items-center justify-between gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={selectAll}
                      className="btn btn-secondary flex items-center gap-2 text-sm"
                    >
                      {selectedFiles.size === files.length ? (
                        <>
                          <CheckSquare className="h-4 w-4" />
                          Deselect All
                        </>
                      ) : (
                        <>
                          <Square className="h-4 w-4" />
                          Select All
                        </>
                      )}
                    </button>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {selectedFiles.size} selected
                    </span>
                  </div>
                  {selectedFiles.size > 0 && (
                    <button
                      onClick={restoreFiles}
                      disabled={restoring}
                      className="btn bg-green-600 hover:bg-green-700 text-white flex items-center gap-2"
                    >
                      <RotateCcw className={`h-4 w-4 ${restoring ? 'animate-spin' : ''}`} />
                      {restoring ? 'Restoring...' : `Restore ${selectedFiles.size} file(s)`}
                    </button>
                  )}
                </div>
              )}
            </div>

            {loadingFiles ? (
              <div className="py-12 text-center">
                <Loading />
              </div>
            ) : files.length === 0 ? (
              <div className="py-12 text-center">
                <FolderOpen className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-4 text-gray-600 dark:text-gray-400">No files found</p>
              </div>
            ) : (
              <div className="space-y-1 max-h-[600px] overflow-y-auto">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                      selectedFiles.has(file.path)
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <button
                      onClick={() => toggleFileSelection(file.path)}
                      className="flex-shrink-0"
                    >
                      {selectedFiles.has(file.path) ? (
                        <CheckSquare className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                      ) : (
                        <Square className="h-5 w-5 text-gray-400" />
                      )}
                    </button>

                    {file.isDir ? (
                      <FolderOpen className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
                    ) : (
                      <File className="h-5 w-5 text-gray-600 dark:text-gray-400 flex-shrink-0" />
                    )}

                    <div className="flex-1 min-w-0">
                      {file.isDir ? (
                        <button
                          onClick={() => navigateToFolder(file.path)}
                          className="text-left hover:text-primary-600 dark:hover:text-primary-400"
                        >
                          <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                            {file.name}
                          </p>
                        </button>
                      ) : (
                        <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                          {file.name}
                        </p>
                      )}
                      {file.size !== undefined && (
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {formatSize(file.size)}
                          {file.modifiedTime && ` • ${formatDate(file.modifiedTime)}`}
                        </p>
                      )}
                    </div>

                    {file.isDir ? (
                      <button
                        onClick={() => navigateToFolder(file.path)}
                        className="btn btn-secondary flex items-center gap-1 text-sm"
                      >
                        Open
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => downloadFile(file)}
                        className="btn btn-primary flex items-center gap-1 text-sm"
                      >
                        <Download className="h-4 w-4" />
                        Download
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
