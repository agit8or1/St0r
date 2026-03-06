import { useState, useEffect } from 'react';
import { X, Folder, FolderOpen, ChevronRight, Loader2, Home, Plus, HardDrive, Archive } from 'lucide-react';
import { api } from '../services/api';

interface Props {
  clientId: string;
  onSelect: (path: string) => void;
  onClose: () => void;
  existingPaths: string[];
}

// Common Windows drives and folders shown when no backup exists or at root
const QUICK_PATHS = [
  { path: 'C:\\', label: 'C: (entire drive)' },
  { path: 'D:\\', label: 'D: (entire drive)' },
  { path: 'E:\\', label: 'E: (entire drive)' },
  { path: 'C:\\Users', label: 'C:\\Users' },
  { path: 'C:\\Users\\All Users', label: 'C:\\Users\\All Users' },
  { path: 'C:\\Program Files', label: 'C:\\Program Files' },
  { path: 'C:\\Program Files (x86)', label: 'C:\\Program Files (x86)' },
  { path: 'C:\\ProgramData', label: 'C:\\ProgramData' },
  { path: 'C:\\inetpub', label: 'C:\\inetpub' },
];

// Convert archive-relative path (e.g. "C/Users/Foo") → backup_dirs path (e.g. "C:\Users\Foo")
function toBackupPath(archivePath: string): string {
  if (!archivePath) return '';
  const parts = archivePath.split('/').filter(Boolean);
  if (parts.length === 0) return '';
  if (parts[0].length === 1 && /^[A-Za-z]$/.test(parts[0])) {
    return parts[0].toUpperCase() + ':\\' + parts.slice(1).join('\\');
  }
  return '/' + parts.join('/');
}

type Mode = 'quick' | 'archive';

export function ClientFileBrowser({ clientId, onSelect, onClose, existingPaths }: Props) {
  const [mode, setMode] = useState<Mode>('quick');
  const [customPath, setCustomPath] = useState('');

  // Archive browse state
  const [archivePath, setArchivePath] = useState('');
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupTime, setBackupTime] = useState<number | null>(null);
  const [archiveLoaded, setArchiveLoaded] = useState(false);

  const handleAdd = (path: string) => {
    if (path && !existingPaths.includes(path)) {
      onSelect(path);
      onClose();
    }
  };

  const handleCustomAdd = () => {
    const p = customPath.trim();
    if (p) handleAdd(p);
  };

  // ── Archive browser ──────────────────────────────────────────────────────
  useEffect(() => {
    if (mode === 'archive' && !archiveLoaded) {
      browseArchive('');
    }
  }, [mode]);

  const browseArchive = async (newPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.browseClientFilesystem(clientId, newPath);
      setEntries((result?.files || []).filter((f: any) => f.isdir || f.isDir));
      setArchivePath(newPath);
      if (result?.backupTime) setBackupTime(result.backupTime);
      setArchiveLoaded(true);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to browse backup archive');
    } finally {
      setLoading(false);
    }
  };

  const archiveBreadcrumbs = () => {
    const crumbs = [{ label: 'Root', ap: '' }];
    if (!archivePath) return crumbs;
    const parts = archivePath.split('/').filter(Boolean);
    parts.forEach((p, i) => crumbs.push({ label: p, ap: parts.slice(0, i + 1).join('/') }));
    return crumbs;
  };

  const navigateArchive = (entry: any) => {
    const newPath = archivePath ? `${archivePath}/${entry.name}` : entry.name;
    browseArchive(newPath);
  };

  const selectedArchiveBackupPath = toBackupPath(archivePath);
  const archiveAlreadyAdded = !!selectedArchiveBackupPath && existingPaths.includes(selectedArchiveBackupPath);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary-600" />
            <span className="font-semibold text-gray-900 dark:text-gray-100">Add Backup Folder</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setMode('quick')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              mode === 'quick'
                ? 'border-b-2 border-primary-600 text-primary-600 dark:text-primary-400'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <HardDrive className="h-4 w-4" /> Common Paths
          </button>
          <button
            onClick={() => setMode('archive')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              mode === 'archive'
                ? 'border-b-2 border-primary-600 text-primary-600 dark:text-primary-400'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Archive className="h-4 w-4" /> From Last Backup
          </button>
        </div>

        {/* ── Common paths tab ─────────────────────────────────────────── */}
        {mode === 'quick' && (
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 space-y-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Select a common Windows path, or type a custom path below. The client must be configured to allow these paths.
              </p>

              <div className="space-y-1">
                {QUICK_PATHS.map(({ path, label }) => {
                  const added = existingPaths.includes(path);
                  return (
                    <button
                      key={path}
                      onClick={() => !added && handleAdd(path)}
                      disabled={added}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                        added
                          ? 'opacity-40 cursor-not-allowed'
                          : 'hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:text-primary-700 dark:hover:text-primary-300'
                      }`}
                    >
                      <Folder className="h-4 w-4 text-yellow-500 shrink-0" />
                      <code className="flex-1 text-sm font-mono text-gray-900 dark:text-gray-100">{label}</code>
                      {added
                        ? <span className="text-xs text-gray-400">Added</span>
                        : <Plus className="h-4 w-4 text-primary-500 shrink-0" />
                      }
                    </button>
                  );
                })}
              </div>

              {/* Custom path input */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Custom path</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customPath}
                    onChange={e => setCustomPath(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCustomAdd()}
                    placeholder="e.g. C:\MyData or D:\Backups"
                    className="input flex-1 font-mono text-sm"
                  />
                  <button
                    onClick={handleCustomAdd}
                    disabled={!customPath.trim() || existingPaths.includes(customPath.trim())}
                    className="btn btn-primary flex items-center gap-1"
                  >
                    <Plus className="h-4 w-4" /> Add
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Archive browser tab ──────────────────────────────────────── */}
        {mode === 'archive' && (
          <>
            {/* Backup time banner */}
            {backupTime && (
              <div className="px-4 py-1.5 bg-amber-50 dark:bg-amber-900/20 text-xs text-amber-700 dark:text-amber-300 border-b border-amber-100 dark:border-amber-800">
                Browsing backup from {new Date(backupTime * 1000).toLocaleString()} — shows folders that have already been backed up
              </div>
            )}

            {/* Breadcrumb */}
            {!error && (
              <div className="flex items-center gap-1 px-4 py-2 bg-gray-50 dark:bg-gray-700/50 text-sm overflow-x-auto border-b border-gray-200 dark:border-gray-700">
                {archiveBreadcrumbs().map((crumb, i, arr) => (
                  <span key={crumb.ap} className="flex items-center gap-1 shrink-0">
                    {i === 0 ? (
                      <button onClick={() => browseArchive('')} className="flex items-center gap-1 text-primary-600 hover:underline">
                        <Home className="h-3 w-3" /> Root
                      </button>
                    ) : (
                      <button
                        onClick={() => browseArchive(crumb.ap)}
                        className={`hover:underline ${i === arr.length - 1 ? 'text-gray-900 dark:text-gray-100 font-medium' : 'text-primary-600'}`}
                      >
                        {crumb.label}
                      </button>
                    )}
                    {i < arr.length - 1 && <ChevronRight className="h-3 w-3 text-gray-400" />}
                  </span>
                ))}
              </div>
            )}

            {/* Current path selection bar */}
            {selectedArchiveBackupPath && !error && (
              <div className="px-4 py-2 bg-green-50 dark:bg-green-900/20 border-b border-green-100 dark:border-green-800 flex items-center justify-between gap-2">
                <code className="text-sm text-green-800 dark:text-green-200 font-mono truncate">{selectedArchiveBackupPath}</code>
                <button
                  onClick={() => handleAdd(selectedArchiveBackupPath)}
                  disabled={archiveAlreadyAdded}
                  className="shrink-0 px-3 py-1 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {archiveAlreadyAdded ? 'Added' : 'Use this path'}
                </button>
              </div>
            )}

            {/* Directory listing */}
            <div className="flex-1 overflow-y-auto p-2">
              {loading && (
                <div className="flex items-center justify-center py-8 text-gray-500">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
                </div>
              )}
              {error && (
                <div className="p-4 space-y-3">
                  <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
                    {error}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Use the <strong>Common Paths</strong> tab to add folders manually.
                  </p>
                </div>
              )}
              {!loading && !error && entries.length === 0 && (
                <p className="text-center text-sm text-gray-400 py-8">No subdirectories found</p>
              )}
              {!loading && !error && entries.map((entry, i) => (
                <button
                  key={i}
                  onClick={() => navigateArchive(entry)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-left"
                >
                  <Folder className="h-4 w-4 text-yellow-500 shrink-0" />
                  <span className="text-sm font-mono text-gray-900 dark:text-gray-100 truncate">{entry.name}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button onClick={onClose} className="btn btn-secondary">Close</button>
        </div>
      </div>
    </div>
  );
}
