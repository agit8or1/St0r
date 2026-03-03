import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, X, RefreshCw, AlertTriangle, AlertCircle } from 'lucide-react';

interface VersionInfo {
  version: string;
  releaseDate: string;
  changelog: string[];
}

export function UpdateNotification() {
  const navigate = useNavigate();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<VersionInfo | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Generate or retrieve installation ID
  const getInstallId = () => {
    let installId = localStorage.getItem('installId');
    if (!installId) {
      installId = `stor-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      localStorage.setItem('installId', installId);
    }
    return installId;
  };

  useEffect(() => {
    checkForUpdates();
    // Check for updates every 30 minutes
    const interval = setInterval(checkForUpdates, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const checkForUpdates = async () => {
    try {
      const installId = getInstallId();

      // Fetch current version
      const currentResponse = await fetch(`/api/version?installId=${encodeURIComponent(installId)}`);
      if (!currentResponse.ok) return;

      const currentInfo: VersionInfo = await currentResponse.json();
      setCurrentVersion(currentInfo.version);

      // Fetch latest available version
      const latestResponse = await fetch('/api/version/latest');
      if (!latestResponse.ok) {
        // No release found on GitHub — we're on the latest
        setUpdateAvailable(false);
        return;
      }

      const latestInfo: VersionInfo = await latestResponse.json();
      setLatestVersion(latestInfo);

      // Compare versions
      const isNewer = compareVersions(latestInfo.version, currentInfo.version);
      setUpdateAvailable(isNewer);
    } catch (error) {
      console.debug('Could not check for updates:', error);
    }
  };

  const compareVersions = (latest: string, current: string): boolean => {
    const latestParts = latest.split('.').map(Number);
    const currentParts = current.split('.').map(Number);

    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
      const latestPart = latestParts[i] || 0;
      const currentPart = currentParts[i] || 0;

      if (latestPart > currentPart) return true;
      if (latestPart < currentPart) return false;
    }

    return false;
  };

  const handleDismiss = () => {
    setConfirming(false);
    setDismissed(true);
  };

  const handleUpdateClick = () => {
    setConfirming(true);
  };

  const handleConfirmUpdate = async () => {
    setConfirming(false);
    setUpdateError(null);
    try {
      const response = await fetch('/api/system-update/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setUpdateError(data.error || `Failed to start update (${response.status})`);
        return;
      }
    } catch (_e) {
      // Network error — service may be starting the update; navigate anyway
    }
    navigate('/about?autoUpdate=true');
  };

  if (!updateAvailable || dismissed) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md">
      <div className="bg-gradient-to-br from-blue-600 to-purple-600 text-white rounded-lg shadow-2xl p-4 border-2 border-white/20">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-white/20 rounded-lg">
            <Download className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h3 className="font-bold text-lg">Update Available</h3>
              <button
                onClick={handleDismiss}
                className="p-1 hover:bg-white/20 rounded transition-colors"
                title="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-white/90 mb-3">
              Version <span className="font-semibold">{latestVersion?.version}</span> is now available
              {currentVersion && (
                <span className="text-white/70"> (current: {currentVersion})</span>
              )}
            </p>

            {latestVersion?.changelog && latestVersion.changelog.length > 0 && (
              <div className="mb-3 text-xs text-white/80">
                <p className="font-semibold mb-1">What's new:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {latestVersion.changelog.slice(0, 3).map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                  {latestVersion.changelog.length > 3 && (
                    <li>And {latestVersion.changelog.length - 3} more...</li>
                  )}
                </ul>
              </div>
            )}

            {updateError && (
              <div className="flex items-center gap-2 mb-2 text-xs text-red-200 bg-red-900/40 rounded px-2 py-1">
                <AlertCircle className="h-3 w-3 flex-shrink-0" />
                {updateError}
              </div>
            )}

            {confirming ? (
              <div className="bg-white/10 rounded-lg p-3 mb-2">
                <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
                  <AlertTriangle className="h-4 w-4 text-yellow-300" />
                  Service will restart — confirm update?
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleConfirmUpdate}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-white text-blue-600 font-semibold rounded-lg hover:bg-white/90 transition-colors"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Yes, Update
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={handleUpdateClick}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-white text-blue-600 font-semibold rounded-lg hover:bg-white/90 transition-colors"
                >
                  <RefreshCw className="h-4 w-4" />
                  Update Now
                </button>
                <button
                  onClick={handleDismiss}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors font-medium"
                >
                  Later
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
