import { useState, useEffect } from 'react';
import { X, Folder, FolderOpen, ChevronRight, ChevronDown, Loader2, Plus, HardDrive, Archive, Home, CornerDownRight } from 'lucide-react';
import { api } from '../services/api';

interface Props {
  clientId: string;
  onSelect: (path: string) => void;
  onClose: () => void;
  existingPaths: string[];
}

// Tree of common Windows paths, organized by drive → subfolder
const DRIVES = ['C', 'D', 'E', 'F', 'G', 'H'];

const DRIVE_SUBDIRS: Record<string, { path: string; label: string; children?: { path: string; label: string }[] }[]> = {
  default: [
    {
      path: 'Users', label: 'Users', children: [
        { path: 'Users\\All Users', label: 'All Users' },
        { path: 'Users\\Default', label: 'Default' },
        { path: 'Users\\Public', label: 'Public' },
      ]
    },
    { path: 'Program Files', label: 'Program Files' },
    { path: 'Program Files (x86)', label: 'Program Files (x86)' },
    { path: 'ProgramData', label: 'ProgramData' },
    { path: 'Windows', label: 'Windows' },
    { path: 'inetpub', label: 'inetpub (IIS)' },
    { path: 'Backup', label: 'Backup' },
    { path: 'Data', label: 'Data' },
  ],
};

function makeFullPath(drive: string, sub: string): string {
  return `${drive}:\\${sub}`;
}

type Mode = 'quick' | 'archive';

export function ClientFileBrowser({ clientId, onSelect, onClose, existingPaths }: Props) {
  const [mode, setMode] = useState<Mode>('quick');
  const [customPath, setCustomPath] = useState('');
  const [expandedDrives, setExpandedDrives] = useState<Set<string>>(new Set(['C']));
  const [expandedSubdirs, setExpandedSubdirs] = useState<Set<string>>(new Set());

  // Archive browse state
  const [pathParts, setPathParts] = useState<string[]>([]);
  const [backupId, setBackupId] = useState<string | null>(null);
  const [backupTime, setBackupTime] = useState<number | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveLoaded, setArchiveLoaded] = useState(false);

  useEffect(() => {
    if (mode === 'archive' && !archiveLoaded) browseArchive([], null);
  }, [mode]);

  const browseArchive = async (parts: string[], bkId: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const path = parts.length === 0 ? '/' : parts.join('/');
      const result = await api.browseClientFilesystem(clientId, path, bkId ?? undefined);
      setEntries(result?.files || []);
      setPathParts(parts);
      if (result?.backupId) setBackupId(result.backupId);
      if (result?.backupTime) setBackupTime(result.backupTime);
      setArchiveLoaded(true);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to browse backup');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = (path: string) => {
    if (path && !existingPaths.includes(path)) {
      onSelect(path);
      onClose();
    }
  };

  const toggleDrive = (drive: string) => {
    setExpandedDrives(prev => {
      const next = new Set(prev);
      if (next.has(drive)) next.delete(drive); else next.add(drive);
      return next;
    });
  };

  const toggleSubdir = (key: string) => {
    setExpandedSubdirs(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Archive breadcrumbs/navigation helpers
  const toBackupPath = (parts: string[]) => {
    if (parts.length === 0) return '';
    if (parts[0].length === 1 && /^[A-Za-z]$/.test(parts[0]))
      return parts[0].toUpperCase() + ':\\' + parts.slice(1).join('\\');
    return '/' + parts.join('/');
  };

  const selectedArchivePath = toBackupPath(pathParts);
  const archiveAlreadyAdded = !!selectedArchivePath && existingPaths.includes(selectedArchivePath);

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

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setMode('quick')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              mode === 'quick' ? 'border-b-2 border-primary-600 text-primary-600 dark:text-primary-400' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <HardDrive className="h-4 w-4" /> Common Paths
          </button>
          <button
            onClick={() => setMode('archive')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              mode === 'archive' ? 'border-b-2 border-primary-600 text-primary-600 dark:text-primary-400' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Archive className="h-4 w-4" /> Last Backup
          </button>
        </div>

        {/* ── Browse Drives tab ─────────────────────────────────────── */}
        {mode === 'quick' && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 pt-3 pb-2 space-y-1">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Common Windows paths — click to expand drives and pick a folder to back up.
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Note: UrBackup does not support live client filesystem browsing. These are common path templates. Use <strong>Last Backup</strong> to browse folders from an actual completed backup.
              </p>
            </div>

            {/* Drive tree */}
            <div className="px-2 pb-2">
              {DRIVES.map(drive => {
                const drivePath = `${drive}:\\`;
                const driveAdded = existingPaths.includes(drivePath);
                const expanded = expandedDrives.has(drive);
                const subdirs = DRIVE_SUBDIRS.default;

                return (
                  <div key={drive}>
                    {/* Drive row */}
                    <div className="flex items-center gap-1 group">
                      <button
                        onClick={() => toggleDrive(drive)}
                        className="flex items-center gap-2 flex-1 px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-left"
                      >
                        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />}
                        <HardDrive className="h-4 w-4 text-blue-500 shrink-0" />
                        <span className="font-mono font-semibold text-sm text-gray-900 dark:text-gray-100">{drivePath}</span>
                      </button>
                      <button
                        onClick={() => !driveAdded && handleAdd(drivePath)}
                        disabled={driveAdded}
                        className="shrink-0 px-2 py-1 text-xs rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        {driveAdded ? 'Added' : '+ Add'}
                      </button>
                    </div>

                    {/* Subdirectories */}
                    {expanded && (
                      <div className="ml-6 border-l border-gray-200 dark:border-gray-700 pl-2">
                        {subdirs.map(sub => {
                          const fullPath = makeFullPath(drive, sub.path);
                          const added = existingPaths.includes(fullPath);
                          const subKey = `${drive}:${sub.path}`;
                          const hasChildren = sub.children && sub.children.length > 0;
                          const subExpanded = expandedSubdirs.has(subKey);

                          return (
                            <div key={sub.path}>
                              <div className="flex items-center gap-1 group">
                                <button
                                  onClick={() => hasChildren ? toggleSubdir(subKey) : undefined}
                                  className={`flex items-center gap-2 flex-1 px-2 py-1.5 rounded-lg text-left ${hasChildren ? 'hover:bg-gray-100 dark:hover:bg-gray-700' : ''}`}
                                >
                                  {hasChildren
                                    ? (subExpanded ? <ChevronDown className="h-3 w-3 text-gray-400 shrink-0" /> : <ChevronRight className="h-3 w-3 text-gray-400 shrink-0" />)
                                    : <CornerDownRight className="h-3 w-3 text-gray-300 shrink-0" />
                                  }
                                  <Folder className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                                  <span className={`font-mono text-sm truncate ${added ? 'text-gray-400 line-through' : 'text-gray-800 dark:text-gray-200'}`}>{sub.label}</span>
                                </button>
                                {!added && (
                                  <button
                                    onClick={() => handleAdd(fullPath)}
                                    className="shrink-0 px-2 py-1 text-xs rounded-lg bg-primary-600 text-white hover:bg-primary-700 opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    + Add
                                  </button>
                                )}
                              </div>

                              {/* Children */}
                              {hasChildren && subExpanded && sub.children!.map(child => {
                                const childPath = makeFullPath(drive, child.path);
                                const childAdded = existingPaths.includes(childPath);
                                return (
                                  <div key={child.path} className="ml-5 flex items-center gap-1 group">
                                    <div className="flex items-center gap-2 flex-1 px-2 py-1">
                                      <CornerDownRight className="h-3 w-3 text-gray-300 shrink-0" />
                                      <Folder className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
                                      <span className={`font-mono text-xs truncate ${childAdded ? 'text-gray-400 line-through' : 'text-gray-700 dark:text-gray-300'}`}>{child.label}</span>
                                    </div>
                                    {!childAdded && (
                                      <button
                                        onClick={() => handleAdd(childPath)}
                                        className="shrink-0 px-2 py-1 text-xs rounded-lg bg-primary-600 text-white hover:bg-primary-700 opacity-0 group-hover:opacity-100 transition-opacity"
                                      >
                                        + Add
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Custom path */}
            <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Custom path</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customPath}
                  onChange={e => setCustomPath(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && customPath.trim() && handleAdd(customPath.trim())}
                  placeholder="e.g. C:\MyData or D:\Backups"
                  className="input flex-1 font-mono text-sm"
                />
                <button
                  onClick={() => customPath.trim() && handleAdd(customPath.trim())}
                  disabled={!customPath.trim() || existingPaths.includes(customPath.trim())}
                  className="btn btn-primary flex items-center gap-1"
                >
                  <Plus className="h-4 w-4" /> Add
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Last Backup tab ──────────────────────────────────────── */}
        {mode === 'archive' && (
          <>
            {backupTime && (
              <div className="px-4 py-1.5 bg-blue-50 dark:bg-blue-900/20 text-xs text-blue-700 dark:text-blue-300 border-b border-blue-100 dark:border-blue-800">
                Browsing backup from {new Date(backupTime * 1000).toLocaleString()}
              </div>
            )}

            {/* Breadcrumb */}
            {!error && (
              <div className="flex items-center gap-1 px-4 py-2 bg-gray-50 dark:bg-gray-700/50 text-sm overflow-x-auto border-b border-gray-200 dark:border-gray-700">
                <button onClick={() => browseArchive([], backupId)} className="flex items-center gap-1 text-primary-600 hover:underline shrink-0">
                  <Home className="h-3 w-3" /> Root
                </button>
                {pathParts.map((part, i) => (
                  <span key={i} className="flex items-center gap-1 shrink-0">
                    <ChevronRight className="h-3 w-3 text-gray-400" />
                    <button
                      onClick={() => browseArchive(pathParts.slice(0, i + 1), backupId)}
                      className={`hover:underline ${i === pathParts.length - 1 ? 'text-gray-900 dark:text-gray-100 font-medium' : 'text-primary-600'}`}
                    >
                      {part}
                    </button>
                  </span>
                ))}
              </div>
            )}

            {selectedArchivePath && !error && (
              <div className="px-4 py-2 bg-green-50 dark:bg-green-900/20 border-b border-green-100 dark:border-green-800 flex items-center justify-between gap-2">
                <code className="text-sm text-green-800 dark:text-green-200 font-mono truncate">{selectedArchivePath}</code>
                <button
                  onClick={() => handleAdd(selectedArchivePath)}
                  disabled={archiveAlreadyAdded}
                  className="shrink-0 px-3 py-1 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {archiveAlreadyAdded ? 'Added' : 'Use this path'}
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-2">
              {loading && (
                <div className="flex items-center justify-center py-8 text-gray-500">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
                </div>
              )}
              {error && (
                <div className="p-4 space-y-3">
                  <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">{error}</p>
                  <button onClick={() => setMode('quick')} className="text-sm text-primary-600 dark:text-primary-400 hover:underline">
                    ← Back to Common Paths
                  </button>
                </div>
              )}
              {!loading && !error && entries.length === 0 && (
                <p className="text-center text-sm text-gray-400 py-8">No subdirectories found</p>
              )}
              {!loading && !error && entries.map((entry, i) => (
                <button
                  key={i}
                  onClick={() => browseArchive([...pathParts, entry.name], backupId)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-left"
                >
                  <Folder className="h-4 w-4 text-yellow-500 shrink-0" />
                  <span className="text-sm font-mono text-gray-900 dark:text-gray-100 truncate">{entry.name}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button onClick={onClose} className="btn btn-secondary">Close</button>
        </div>
      </div>
    </div>
  );
}
