import { useState } from 'react';
import { X, Check } from 'lucide-react';

interface PathSelectorProps {
  clientId: string;
  onSelect: (path: string, name?: string) => void;
  onClose: () => void;
  existingPaths: string[];
}

export function PathSelector({ clientId, onSelect, onClose, existingPaths }: PathSelectorProps) {
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [customName, setCustomName] = useState('');
  const [manualPath, setManualPath] = useState<string>('');

  const handleSelect = (path: string) => {
    setSelectedPath(path);
    setManualPath(''); // Clear manual entry when selecting from browser
  };

  const handleManualPathChange = (value: string) => {
    setManualPath(value);
    setSelectedPath(value); // Sync with selectedPath
  };

  const handleConfirm = () => {
    const pathToAdd = manualPath || selectedPath;
    if (!pathToAdd) return;
    if (existingPaths.includes(pathToAdd)) return;

    onSelect(pathToAdd, customName.trim() || undefined);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Browse Client Filesystem
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Navigate the client's directories and select a path to backup
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Manual Path Entry */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
              Enter Path Manually
            </label>
            <input
              type="text"
              value={manualPath}
              onChange={(e) => handleManualPathChange(e.target.value)}
              placeholder="e.g., C:\Users\Username\Documents or /home/user/documents"
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Type the full path you want to backup
            </p>
          </div>

          <div className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg p-4">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Enter the full path to the directory you want to backup. Use the examples below as a guide.
            </p>
            <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
              <div><strong>Windows:</strong> C:\Users\Username\Documents, D:\Projects</div>
              <div><strong>Linux:</strong> /home/username/documents, /var/www</div>
              <div><strong>Network:</strong> \\server\share (Windows) or /mnt/share (Linux)</div>
            </div>
            <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs text-yellow-800 dark:text-yellow-200">
              <strong>Note:</strong> Live filesystem browsing requires the UrBackup web interface to be enabled (headless mode must be OFF).
            </div>
          </div>

          {/* Selected Path Display */}
          {selectedPath && (
            <div className="mt-6 p-4 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <Check className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                <span className="text-sm font-medium text-primary-900 dark:text-primary-100">
                  Selected Path
                </span>
              </div>
              <div className="font-mono text-sm text-primary-800 dark:text-primary-200 mb-4 break-all">
                {selectedPath}
              </div>

              {/* Optional Display Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Display Name (optional)
                </label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="e.g., User Files"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Give this path a friendly name for easier identification
                </p>
              </div>

              {existingPaths.includes(selectedPath) && (
                <div className="mt-3 text-sm text-yellow-700 dark:text-yellow-300">
                  ⚠️ This path is already added
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {selectedPath ? 'Click Add to confirm selection' : 'Click a directory to select it'}
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selectedPath || existingPaths.includes(selectedPath)}
              className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Selected Path
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
