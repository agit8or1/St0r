import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import {
  FolderOpen, File, Download, ChevronRight, ArrowLeft,
  ChevronLeft, ChevronDown, RotateCcw, CheckSquare, Square,
  Archive, Clock, HardDrive, Calendar
} from 'lucide-react';

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
  incremental?: boolean;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatSize(bytes: number) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

function formatDate(ts: string | number) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatTime(ts: string | number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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
  const [downloadingFolder, setDownloadingFolder] = useState<string | null>(null);

  // Calendar state
  const [calendarDate, setCalendarDate] = useState<Date>(new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayBackups, setDayBackups] = useState<Backup[]>([]);

  useEffect(() => { loadBackups(); }, [clientName]);
  useEffect(() => { if (selectedBackup && clientId) loadFiles(currentPath); }, [selectedBackup, currentPath, clientId]);

  const loadBackups = async () => {
    try {
      setLoading(true);
      const data = await fetch(`/api/browse/backups?clientName=${encodeURIComponent(clientName!)}`, {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      }).then(r => r.json());

      if (data.backups && Array.isArray(data.backups)) {
        setBackups(data.backups);
        if (data.backups[0]?.clientid) setClientId(data.backups[0].clientid);
        // Jump calendar to most recent backup
        if (data.backups.length > 0) {
          const latest = data.backups.reduce((a: Backup, b: Backup) =>
            new Date(a.backuptime) > new Date(b.backuptime) ? a : b);
          setCalendarDate(new Date(latest.backuptime));
        }
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const loadFiles = async (path: string) => {
    try {
      setLoadingFiles(true);
      const data = await fetch(
        `/api/browse/files?clientId=${clientId}&backupId=${selectedBackup!.id}&path=${encodeURIComponent(path)}`,
        { credentials: 'include', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } }
      ).then(r => r.json());
      setFiles(Array.isArray(data.files) ? data.files : Array.isArray(data) ? data : []);
    } catch { setFiles([]); }
    finally { setLoadingFiles(false); }
  };

  // ---- Calendar helpers ----
  const backupsByDay = useMemo(() => {
    const map: Record<string, Backup[]> = {};
    backups.forEach(b => {
      const day = new Date(b.backuptime).toISOString().slice(0, 10);
      if (!map[day]) map[day] = [];
      map[day].push(b);
    });
    return map;
  }, [backups]);

  const calendarCells = useMemo(() => {
    const y = calendarDate.getFullYear(), m = calendarDate.getMonth();
    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells: (string | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(`${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [calendarDate]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const monthLabel = calendarDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  const handleDayClick = (day: string) => {
    const list = backupsByDay[day];
    if (!list?.length) return;
    setSelectedDay(day);
    setDayBackups(list);
    if (list.length === 1) {
      setSelectedBackup(list[0]);
      setCurrentPath('/');
    }
  };

  // ---- File operations ----
  const downloadFile = async (file: FileEntry) => {
    try {
      const url = `/api/browse/download?clientId=${clientId}&backupId=${selectedBackup!.id}&path=${encodeURIComponent(file.path)}`;
      const resp = await fetch(url, { credentials: 'include', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
      if (!resp.ok) throw new Error('Download failed');
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { setMessage({ type: 'error', text: 'Download failed' }); }
  };

  const downloadFolderAsZip = async (file: FileEntry) => {
    setDownloadingFolder(file.path);
    try {
      const url = `/api/browse/download-folder?clientId=${clientId}&backupId=${selectedBackup!.id}&path=${encodeURIComponent(file.path)}`;
      const resp = await fetch(url, { credentials: 'include', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
      if (!resp.ok) throw new Error('Download failed');
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${file.name}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { setMessage({ type: 'error', text: 'Folder download failed' }); }
    finally { setDownloadingFolder(null); }
  };

  const toggleSelect = (path: string) => {
    const s = new Set(selectedFiles);
    s.has(path) ? s.delete(path) : s.add(path);
    setSelectedFiles(s);
  };

  const selectAll = () => {
    setSelectedFiles(selectedFiles.size === files.length ? new Set() : new Set(files.map(f => f.path)));
  };

  const doRestore = async () => {
    setConfirmRestore(false);
    setRestoring(true);
    try {
      const resp = await fetch('/api/browse/restore', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ clientId, backupId: selectedBackup!.id, paths: Array.from(selectedFiles), restorePath: '' })
      });
      const d = await resp.json();
      if (!resp.ok) throw new Error(d.error || 'Restore failed');
      setMessage({ type: 'success', text: `Restore initiated for ${selectedFiles.size} item(s)` });
      setSelectedFiles(new Set());
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message });
    } finally { setRestoring(false); }
  };

  const navigateUp = () => {
    if (currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath('/' + parts.join('/') || '/');
  };

  if (loading) return <Layout><Loading /></Layout>;

  return (
    <Layout>
      <div className="space-y-6">
        {/* Message toast */}
        {message && (
          <div className={`rounded-xl p-4 flex items-center justify-between ${
            message.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'
          }`}>
            <span>{message.text}</span>
            <button onClick={() => setMessage(null)} className="ml-4 text-sm underline opacity-70 hover:opacity-100">Dismiss</button>
          </div>
        )}

        {/* Confirm restore */}
        {confirmRestore && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full shadow-2xl">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Confirm Restore</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Restore {selectedFiles.size} item(s) to <strong>{clientName}</strong>? This will overwrite existing files.
              </p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setConfirmRestore(false)} className="btn btn-secondary">Cancel</button>
                <button onClick={doRestore} className="btn btn-primary">Restore</button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div>
          <button onClick={() => navigate('/clients')}
            className="mb-2 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200">
            <ArrowLeft className="h-4 w-4" /> Back to Clients
          </button>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">File Browser</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{clientName} — {backups.length} backup{backups.length !== 1 ? 's' : ''} available</p>
        </div>

        {/* Backup calendar + selector */}
        {backups.length === 0 ? (
          <div className="card text-center py-16">
            <Calendar className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-gray-500 dark:text-gray-400">No backups available for this client</p>
          </div>
        ) : (
          <div className="card">
            <div className="flex flex-col lg:flex-row lg:gap-8">
              {/* Left: Calendar */}
              <div className="flex-shrink-0 lg:w-72">
                {/* Month nav */}
                <div className="flex items-center justify-between mb-4">
                  <button onClick={() => setCalendarDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{monthLabel}</span>
                  <button onClick={() => setCalendarDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>

                {/* Day headers */}
                <div className="grid grid-cols-7 mb-1">
                  {DAYS.map(d => (
                    <div key={d} className="text-center text-xs font-medium text-gray-400 dark:text-gray-500 py-1">{d}</div>
                  ))}
                </div>

                {/* Calendar grid */}
                <div className="grid grid-cols-7 gap-0.5">
                  {calendarCells.map((day, i) => {
                    if (!day) return <div key={`e${i}`} />;
                    const hasBackups = !!backupsByDay[day];
                    const count = backupsByDay[day]?.length || 0;
                    const isToday = day === todayStr;
                    const isSelected = day === selectedDay;

                    return (
                      <button key={day} onClick={() => handleDayClick(day)} disabled={!hasBackups}
                        className={[
                          'relative flex flex-col items-center justify-center rounded-lg h-9 w-full text-sm font-medium transition-all',
                          isSelected
                            ? 'bg-primary-600 dark:bg-primary-500 text-white shadow-sm'
                            : hasBackups
                              ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/50 cursor-pointer'
                              : 'text-gray-300 dark:text-gray-600 cursor-default',
                          isToday && !isSelected ? 'ring-2 ring-primary-500 ring-offset-1 dark:ring-offset-gray-800' : '',
                        ].join(' ')}
                      >
                        <span className="leading-none">{parseInt(day.slice(8), 10)}</span>
                        {hasBackups && (
                          <span className={`mt-0.5 text-[9px] font-semibold leading-none ${isSelected ? 'text-primary-200' : 'text-primary-500 dark:text-primary-400'}`}>
                            {count > 1 ? `×${count}` : '●'}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="mt-4 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm bg-primary-100 dark:bg-primary-900/40 border border-primary-300 dark:border-primary-700" />
                    Has backup
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm ring-2 ring-primary-500" />
                    Today
                  </span>
                </div>
              </div>

              {/* Right: Backup selection for selected day */}
              <div className="flex-1 mt-6 lg:mt-0 lg:border-l lg:dark:border-gray-700 lg:pl-8">
                {!selectedDay ? (
                  <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                    <Calendar className="h-10 w-10 text-gray-300 dark:text-gray-600 mb-3" />
                    <p className="text-gray-500 dark:text-gray-400 font-medium">Select a date with a backup</p>
                    <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Highlighted days have backups available</p>
                  </div>
                ) : (
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">
                      {new Date(selectedDay + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                      {dayBackups.length} backup{dayBackups.length !== 1 ? 's' : ''} — {dayBackups.length > 1 ? 'choose one to browse' : 'click to browse'}
                    </p>

                    <div className="space-y-2">
                      {dayBackups.map(backup => {
                        const isActive = selectedBackup?.id === backup.id;
                        return (
                          <button key={backup.id} onClick={() => { setSelectedBackup(backup); setCurrentPath('/'); }}
                            className={[
                              'w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all',
                              isActive
                                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/40',
                            ].join(' ')}>
                            <div className={`p-2.5 rounded-lg flex-shrink-0 ${isActive ? 'bg-primary-100 dark:bg-primary-900/40' : 'bg-gray-100 dark:bg-gray-700'}`}>
                              {backup.incremental
                                ? <ChevronDown className={`h-5 w-5 ${isActive ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}`} />
                                : <Archive className={`h-5 w-5 ${isActive ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}`} />
                              }
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-gray-900 dark:text-gray-100">
                                  {formatTime(backup.backuptime)}
                                </span>
                                {backup.incremental && (
                                  <span className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded">Incremental</span>
                                )}
                                {backup.archived && (
                                  <span className="text-xs px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 rounded">Archived</span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                                <span className="flex items-center gap-1"><HardDrive className="h-3 w-3" />{formatSize(backup.size_bytes)}</span>
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDate(backup.backuptime)}</span>
                              </div>
                            </div>
                            {isActive && <span className="text-xs font-medium text-primary-600 dark:text-primary-400 flex-shrink-0">Browsing</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* File Browser */}
        {selectedBackup && (
          <div className="card">
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex-shrink-0">Files</h2>
                {currentPath !== '/' && (
                  <button onClick={navigateUp} className="btn btn-secondary flex items-center gap-1 text-sm flex-shrink-0">
                    <ArrowLeft className="h-4 w-4" /> Up
                  </button>
                )}
                <div className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate hidden sm:block ml-2">
                  {currentPath}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {selectedFiles.size > 0 && (
                  <>
                    <span className="text-sm text-gray-500 dark:text-gray-400">{selectedFiles.size} selected</span>
                    <button onClick={() => setConfirmRestore(true)} disabled={restoring}
                      className="btn text-sm bg-green-600 hover:bg-green-700 text-white border-green-600 flex items-center gap-1.5">
                      <RotateCcw className={`h-4 w-4 ${restoring ? 'animate-spin' : ''}`} />
                      {restoring ? 'Restoring…' : 'Restore'}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Select all row */}
            {files.length > 0 && (
              <div className="flex items-center gap-2 mb-2 px-1">
                <button onClick={selectAll} className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                  {selectedFiles.size === files.length
                    ? <><CheckSquare className="h-4 w-4" /> Deselect all</>
                    : <><Square className="h-4 w-4" /> Select all</>
                  }
                </button>
                <span className="text-xs text-gray-400 dark:text-gray-500">({files.length} items)</span>
              </div>
            )}

            {/* File list */}
            {loadingFiles ? (
              <div className="py-16 text-center"><Loading /></div>
            ) : files.length === 0 ? (
              <div className="py-16 text-center">
                <FolderOpen className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600 mb-3" />
                <p className="text-gray-500 dark:text-gray-400">Empty folder</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700/50 max-h-[600px] overflow-y-auto rounded-xl border border-gray-100 dark:border-gray-700">
                {files.map((file, idx) => {
                  const isSelected = selectedFiles.has(file.path);
                  const isDownloading = downloadingFolder === file.path;
                  return (
                    <div key={idx} className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                      isSelected ? 'bg-primary-50 dark:bg-primary-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
                    }`}>
                      {/* Checkbox */}
                      <button onClick={() => toggleSelect(file.path)} className="flex-shrink-0 text-gray-400">
                        {isSelected
                          ? <CheckSquare className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                          : <Square className="h-5 w-5" />}
                      </button>

                      {/* Icon */}
                      {file.isDir
                        ? <FolderOpen className="h-5 w-5 text-yellow-500 dark:text-yellow-400 flex-shrink-0" />
                        : <File className="h-5 w-5 text-gray-400 dark:text-gray-500 flex-shrink-0" />}

                      {/* Name + meta */}
                      <div className="flex-1 min-w-0">
                        {file.isDir ? (
                          <button onClick={() => setCurrentPath(file.path)}
                            className="font-medium text-gray-900 dark:text-gray-100 hover:text-primary-600 dark:hover:text-primary-400 truncate block text-left w-full">
                            {file.name}
                          </button>
                        ) : (
                          <span className="font-medium text-gray-900 dark:text-gray-100 truncate block">{file.name}</span>
                        )}
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                          {file.size !== undefined && <span>{formatSize(file.size)}</span>}
                          {file.modifiedTime && <span>{formatDate(file.modifiedTime)}</span>}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {file.isDir ? (
                          <>
                            <button onClick={() => setCurrentPath(file.path)}
                              className="btn btn-secondary text-xs flex items-center gap-1 px-2.5 py-1.5">
                              Open <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => downloadFolderAsZip(file)} disabled={isDownloading}
                              className="btn btn-secondary text-xs flex items-center gap-1 px-2.5 py-1.5"
                              title="Download folder as ZIP">
                              {isDownloading
                                ? <RotateCcw className="h-3.5 w-3.5 animate-spin" />
                                : <Download className="h-3.5 w-3.5" />}
                              {isDownloading ? 'Zipping…' : '.zip'}
                            </button>
                          </>
                        ) : (
                          <button onClick={() => downloadFile(file)}
                            className="btn btn-primary text-xs flex items-center gap-1 px-2.5 py-1.5">
                            <Download className="h-3.5 w-3.5" /> Download
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
