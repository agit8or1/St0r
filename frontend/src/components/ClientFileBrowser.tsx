import { useState, useEffect } from 'react';
import { X, Folder, FolderOpen, ChevronRight, Loader2, Home } from 'lucide-react';
import { api } from '../services/api';

interface Props {
  clientId: string;
  onSelect: (path: string) => void;
  onClose: () => void;
  existingPaths: string[];
}

export function ClientFileBrowser({ clientId, onSelect, onClose, existingPaths }: Props) {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { browse(''); }, []);

  const browse = async (newPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.browseClientFilesystem(clientId, newPath);
      // UrBackup returns { files: [{name, isdir, ...}] } or similar
      const files: any[] = result?.files || result?.dirs || result || [];
      const dirs = Array.isArray(files) ? files.filter((f: any) => f.isdir || f.dir || f.type === 'dir') : [];
      setEntries(dirs);
      setPath(newPath);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Client must be online to browse its filesystem');
    } finally {
      setLoading(false);
    }
  };

  const breadcrumbs = () => {
    if (!path) return [{ label: 'Root', path: '' }];
    // Handle Windows paths like C:\Users\foo
    const sep = path.includes('\\') ? '\\' : '/';
    const parts = path.split(sep).filter(Boolean);
    return [
      { label: 'Root', path: '' },
      ...parts.map((p, i) => ({
        label: p,
        path: parts.slice(0, i + 1).join(sep) + (sep === '\\' && i === 0 ? sep : ''),
      })),
    ];
  };

  const navigate = (entry: any) => {
    const sep = path.includes('\\') || (!path && entry.name?.includes(':')) ? '\\' : '/';
    const newPath = path ? `${path}${sep}${entry.name}` : entry.name;
    browse(newPath);
  };

  const alreadyAdded = existingPaths.includes(path);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary-600" />
            <span className="font-semibold text-gray-900 dark:text-gray-100">Browse Client Filesystem</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 px-4 py-2 bg-gray-50 dark:bg-gray-700/50 text-sm overflow-x-auto">
          {breadcrumbs().map((crumb, i, arr) => (
            <span key={crumb.path} className="flex items-center gap-1 shrink-0">
              {i === 0 ? (
                <button onClick={() => browse('')} className="flex items-center gap-1 text-primary-600 hover:underline">
                  <Home className="h-3 w-3" /> Root
                </button>
              ) : (
                <button onClick={() => browse(crumb.path)} className={`hover:underline ${i === arr.length - 1 ? 'text-gray-900 dark:text-gray-100 font-medium' : 'text-primary-600'}`}>
                  {crumb.label}
                </button>
              )}
              {i < arr.length - 1 && <ChevronRight className="h-3 w-3 text-gray-400" />}
            </span>
          ))}
        </div>

        {/* Current path display */}
        {path && (
          <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800 flex items-center justify-between gap-2">
            <code className="text-sm text-blue-800 dark:text-blue-200 font-mono truncate">{path}</code>
            <button
              onClick={() => { onSelect(path); onClose(); }}
              disabled={alreadyAdded}
              className="shrink-0 px-3 py-1 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {alreadyAdded ? 'Added' : 'Use this path'}
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
            <div className="p-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg m-2">
              {error}
            </div>
          )}
          {!loading && !error && entries.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-8">No subdirectories found</p>
          )}
          {!loading && !error && entries.map((entry, i) => (
            <button
              key={i}
              onClick={() => navigate(entry)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-left"
            >
              <Folder className="h-4 w-4 text-yellow-500 shrink-0" />
              <span className="text-sm font-mono text-gray-900 dark:text-gray-100 truncate">{entry.name}</span>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-secondary">Close</button>
        </div>
      </div>
    </div>
  );
}
