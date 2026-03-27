import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import { FolderOpen, File, Download, ChevronRight, ArrowLeft, ChevronLeft, Calendar, RotateCcw, CheckSquare, Square } from 'lucide-react';
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
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);

  // Calendar state
  const [calendarDate, setCalendarDate] = useState<Date>(new Date());
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<string | null>(null);
  const [dayBackups, setDayBackups] = useState<Backup[]>([]);

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

      if (data.backups && Array.isArray(data.backups)) {
        setBackups(data.backups);
        if (data.backups.length > 0 && data.backups[0].clientid) {
          setClientId(data.backups[0].clientid);
        }
        // Initialize calendar to the month of the most recent backup
        if (data.backups.length > 0) {
          const mostRecent = data.backups.reduce((a: Backup, b: Backup) =>
            new Date(a.backuptime) > new Date(b.backuptime) ? a : b
          );
          setCalendarDate(new Date(mostRecent.backuptime));
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
      const downloadUrl = `/api/browse/download?clientId=${clientId}&backupId=${selectedBackup!.id}&path=${encodeURIComponent(file.path)}`;
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = file.name;
      link.style.display = 'none';

      const token = localStorage.getItem('token');
      const response = await fetch(downloadUrl, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download file:', err);
      setMessage({ type: 'error', text: 'Failed to download file. Please try again.' });
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
      setMessage({ type: 'error', text: 'Please select files to restore' });
      return;
    }
    setConfirmRestore(true);
  };

  const doRestore = async () => {
    setConfirmRestore(false);
    setRestoring(true);
    try {
      const response = await fetch('/api/browse/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        credentials: 'include',
        body: JSON.stringify({
          clientId,
          backupId: selectedBackup!.id,
          paths: Array.from(selectedFiles),
          restorePath: ''
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Restore failed');
      }

      setMessage({ type: 'success', text: `Restore initiated successfully for ${selectedFiles.size} file(s)!` });
      setSelectedFiles(new Set());
    } catch (err: any) {
      console.error('Failed to restore files:', err);
      setMessage({ type: 'error', text: `Failed to restore files: ${err.message}` });
    } finally {
      setRestoring(false);
    }
  };

  // Calendar helpers
  const backupsByDay = useMemo(() => {
    const map: Record<string, Backup[]> = {};
    backups.forEach(b => {
      const day = new Date(b.backuptime).toISOString().slice(0, 10);
      if (!map[day]) map[day] = [];
      map[day].push(b);
    });
    return map;
  }, [backups]);

  const handleCalendarDayClick = (day: string) => {
    const dayList = backupsByDay[day];
    if (!dayList || dayList.length === 0) return;
    setSelectedCalendarDay(day);
    setDayBackups(dayList);
    if (dayList.length === 1) {
      setSelectedBackup(dayList[0]);
      setCurrentPath('/');
    }
  };

  const prevMonth = () => {
    setCalendarDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCalendarDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  };

  const calendarCells = useMemo(() => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (string | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const mm = String(month + 1).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      cells.push(`${year}-${mm}-${dd}`);
    }
    while (cells.length < 42) cells.push(null);
    return cells;
  }, [calendarDate]);

  const todayStr = new Date().toISOString().slice(0, 10);

  const monthLabel = calendarDate.toLocaleString('default', { month: 'long', year: 'numeric' });

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
        {/* Message */}
        {message && (
          <div className={`rounded-lg p-4 ${
            message.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'
          }`}>
            {message.text}
            <button onClick={() => setMessage(null)} className="ml-2 underline text-sm">Dismiss</button>
          </div>
        )}

        {/* Restore confirm dialog */}
        {confirmRestore && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Confirm Restore</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Are you sure you want to restore {selectedFiles.size} file(s) to {clientName}? This will overwrite existing files on the client.
              </p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setConfirmRestore(false)} className="btn btn-secondary">Cancel</button>
                <button onClick={doRestore} className="btn btn-primary">Restore</button>
              </div>
            </div>
          </div>
        )}

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

        {/* Backup Selection — Calendar */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary-600 dark:text-primary-400" />
            Select Backup
          </h2>

          {backups.length === 0 ? (
            <p className="text-gray-600 dark:text-gray-400">No backups available</p>
          ) : (
            <>
              {/* Month navigator */}
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={prevMonth}
                  className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {monthLabel}
                </span>
                <button
                  onClick={nextMonth}
                  className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
                  aria-label="Next month"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>

              {/* Day-of-week header */}
              <div className="grid grid-cols-7 mb-1">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                  <div key={d} className="text-center text-xs font-medium text-gray-500 dark:text-gray-400 py-1">
                    {d}
                  </div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-1">
                {calendarCells.map((day, idx) => {
                  if (!day) {
                    return <div key={`empty-${idx}`} />;
                  }
                  const hasBackups = !!backupsByDay[day];
                  const isToday = day === todayStr;
                  const isSelected = day === selectedCalendarDay;

                  return (
                    <button
                      key={day}
                      onClick={() => handleCalendarDayClick(day)}
                      disabled={!hasBackups}
                      className={[
                        'relative flex flex-col items-center justify-center rounded-lg py-1.5 text-sm transition-colors',
                        isToday && !isSelected
                          ? 'ring-2 ring-primary-400 dark:ring-primary-500'
                          : '',
                        isSelected
                          ? 'bg-primary-600 text-white dark:bg-primary-500'
                          : hasBackups
                            ? 'hover:bg-primary-50 dark:hover:bg-primary-900/30 text-gray-900 dark:text-gray-100 cursor-pointer font-medium'
                            : 'text-gray-400 dark:text-gray-600 cursor-default',
                      ].join(' ')}
                    >
                      <span>{parseInt(day.slice(8), 10)}</span>
                      {hasBackups && (
                        <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-primary-500 dark:bg-primary-400'}`} />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Backups for selected day (when multiple) */}
              {selectedCalendarDay && dayBackups.length > 1 && (
                <div className="mt-4">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {dayBackups.length} backups on {new Date(selectedCalendarDay + 'T12:00:00').toLocaleDateString()} — choose one:
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {dayBackups.map(backup => (
                      <button
                        key={backup.id}
                        onClick={() => { setSelectedBackup(backup); setCurrentPath('/'); }}
                        className={`p-3 rounded-lg border-2 text-left transition-colors ${
                          selectedBackup?.id === backup.id
                            ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/20 dark:border-primary-500'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                        }`}
                      >
                        <span className="block font-medium text-gray-900 dark:text-gray-100 text-sm">
                          {new Date(backup.backuptime).toLocaleTimeString()}
                        </span>
                        <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {formatSize(backup.size_bytes)}
                          {backup.archived && (
                            <span className="ml-2 rounded bg-yellow-100 dark:bg-yellow-900 px-1.5 py-0.5 text-yellow-800 dark:text-yellow-200">
                              Archived
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Currently selected backup summary */}
              {selectedBackup && (
                <div className="mt-4 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-3">
                  <span className="font-medium text-gray-900 dark:text-gray-100">Selected:</span>
                  {formatDate(selectedBackup.backuptime)} — {formatSize(selectedBackup.size_bytes)}
                  {selectedBackup.archived && (
                    <span className="rounded bg-yellow-100 dark:bg-yellow-900 px-2 py-0.5 text-xs text-yellow-800 dark:text-yellow-200">
                      Archived
                    </span>
                  )}
                </div>
              )}
            </>
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
