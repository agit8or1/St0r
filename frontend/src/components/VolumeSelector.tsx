import { useState, useEffect } from 'react';
import { HardDrive, X, Check, Loader2, AlertCircle } from 'lucide-react';

interface VolumeSelectorProps {
  clientId: string;
  onSelect: (volumes: string[]) => void;
  onClose: () => void;
  existingVolumes: string[];
}

export function VolumeSelector({ clientId, onSelect, onClose, existingVolumes }: VolumeSelectorProps) {
  const [selectedVolumes, setSelectedVolumes] = useState<string[]>([...existingVolumes]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableVolumes, setAvailableVolumes] = useState<string[]>([]);
  const [manualVolume, setManualVolume] = useState<string>('');

  useEffect(() => {
    loadVolumes();
  }, [clientId]);

  const loadVolumes = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get configured volumes from client settings
      const response = await fetch(`/api/client-filesystem/${clientId}/volumes`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });

      if (!response.ok) {
        throw new Error('Failed to load volumes');
      }

      const data = await response.json();
      const volumes = data.volumes || [];
      setAvailableVolumes(volumes);
    } catch (err: any) {
      console.error('Failed to load volumes:', err);
      setError('Could not load client volumes. You can still add volumes manually below.');
    } finally {
      setLoading(false);
    }
  };

  const toggleVolume = (volume: string) => {
    setSelectedVolumes(prev =>
      prev.includes(volume)
        ? prev.filter(v => v !== volume)
        : [...prev, volume]
    );
  };

  const addManualVolume = () => {
    const trimmed = manualVolume.trim().toUpperCase();
    if (trimmed && !selectedVolumes.includes(trimmed)) {
      setSelectedVolumes(prev => [...prev, trimmed]);
      if (!availableVolumes.includes(trimmed)) {
        setAvailableVolumes(prev => [...prev, trimmed]);
      }
      setManualVolume('');
    }
  };

  const handleSave = () => {
    onSelect(selectedVolumes);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Select Volumes for Image Backup
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Choose which drives/volumes to include in image backups
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
          {/* Manual Volume Entry */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
              Add Volume Manually
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualVolume}
                onChange={(e) => setManualVolume(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addManualVolume()}
                placeholder="e.g., C, D, E or /dev/sda1"
                className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
              />
              <button
                onClick={addManualVolume}
                disabled={!manualVolume.trim()}
                className="px-6 py-3 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
              >
                Add
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Enter volume letter (Windows) or device path (Linux)
            </p>
          </div>

          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
            <span className="text-sm text-gray-500 dark:text-gray-400">Configured volumes</span>
            <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
          </div>

          {/* Loading State */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-12 w-12 animate-spin text-primary-600 dark:text-primary-400 mb-4" />
              <p className="text-gray-600 dark:text-gray-400">Loading client volumes...</p>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">{error}</p>
                  <button
                    onClick={loadVolumes}
                    className="mt-2 text-sm text-yellow-900 dark:text-yellow-100 underline hover:no-underline"
                  >
                    Try again
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Volumes Grid */}
          {!loading && availableVolumes.length > 0 && (
            <>
              <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  <strong>{selectedVolumes.length}</strong> of <strong>{availableVolumes.length}</strong> volume{availableVolumes.length !== 1 ? 's' : ''} selected for backup
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {availableVolumes.map((volume) => {
                  const isSelected = selectedVolumes.includes(volume);

                  return (
                    <button
                      key={volume}
                      onClick={() => toggleVolume(volume)}
                      className={`flex flex-col items-center gap-3 p-6 rounded-lg border-2 transition-all ${
                        isSelected
                          ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20 shadow-md'
                          : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                      }`}
                    >
                      <div className="flex-shrink-0">
                        {isSelected ? (
                          <div className="h-12 w-12 rounded-full bg-orange-500 flex items-center justify-center">
                            <Check className="h-6 w-6 text-white" />
                          </div>
                        ) : (
                          <HardDrive className="h-12 w-12 text-gray-400" />
                        )}
                      </div>
                      <div className="text-center">
                        <div className={`font-mono font-semibold text-lg ${
                          isSelected
                            ? 'text-orange-900 dark:text-orange-100'
                            : 'text-gray-900 dark:text-gray-100'
                        }`}>
                          {volume}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* No volumes found */}
          {!loading && !error && availableVolumes.length === 0 && (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <HardDrive className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">No Volumes Found</p>
              <p className="text-sm">
                The client may be offline or has no backups configured yet.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {selectedVolumes.length === 0 ? (
              'Select at least one volume to enable image backups'
            ) : (
              `${selectedVolumes.length} volume${selectedVolumes.length !== 1 ? 's' : ''} will be backed up`
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="btn btn-primary"
            >
              Save Selection
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
