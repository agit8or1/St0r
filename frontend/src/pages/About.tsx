import { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { Logo } from '../components/Logo';
import { Info, ExternalLink, Download, CheckCircle, AlertCircle, Loader, RefreshCw, FileText } from 'lucide-react';

/**
 * Compare two semantic version strings
 * Returns true if version1 is newer than version2
 */
function compareVersions(version1: string, version2: string): boolean {
  const v1Parts = version1.split('.').map(Number);
  const v2Parts = version2.split('.').map(Number);

  for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
    const v1 = v1Parts[i] || 0;
    const v2 = v2Parts[i] || 0;

    if (v1 > v2) return true;
    if (v1 < v2) return false;
  }

  return false; // Versions are equal
}

export function About() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState('');
  const [updating, setUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');
  const [updateError, setUpdateError] = useState('');
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [changelog, setChangelog] = useState<string[]>([]);
  const [activeInstalls, setActiveInstalls] = useState<number | null>(null);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [updateLog, setUpdateLog] = useState('');
  const [updateInProgress, setUpdateInProgress] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateStep, setUpdateStep] = useState('');

  const [currentVersion, setCurrentVersion] = useState('Loading...');

  // Generate or retrieve installation ID
  const getInstallId = () => {
    let installId = localStorage.getItem('installId');
    if (!installId) {
      // Generate a unique anonymous ID
      installId = `stor-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      localStorage.setItem('installId', installId);
    }
    return installId;
  };

  useEffect(() => {
    fetchCurrentVersion();
    checkForUpdates();
    fetchInstallStats();
  }, []);

  const fetchCurrentVersion = async () => {
    try {
      const installId = getInstallId();
      const response = await fetch(`/api/version?installId=${encodeURIComponent(installId)}`);
      if (response.ok) {
        const data = await response.json();
        setCurrentVersion(data.version);
      }
    } catch (error) {
      console.error('Failed to fetch current version:', error);
      setCurrentVersion('Unknown');
    }
  };

  // Poll for update progress
  useEffect(() => {
    if (!showProgressModal) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch('/api/system-update/update-log', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        const data = await response.json();

        const log = data.log || '';
        setUpdateLog(log);
        setUpdateInProgress(data.inProgress);

        // Calculate progress based on log content
        const steps = [
          { text: 'Creating backup', progress: 10 },
          { text: 'Downloading latest version', progress: 20 },
          { text: 'Extracting update', progress: 35 },
          { text: 'Installing new version', progress: 45 },
          { text: 'Installing backend dependencies', progress: 60 },
          { text: 'Dependencies installed successfully', progress: 80 },
          { text: 'Starting urbackup-gui service', progress: 90 },
          { text: 'Update completed successfully', progress: 100 }
        ];

        for (let i = steps.length - 1; i >= 0; i--) {
          if (log.includes(steps[i].text)) {
            setUpdateProgress(steps[i].progress);
            setUpdateStep(steps[i].text);
            break;
          }
        }

        // If update is complete, wait a bit then reload
        if (log.includes('SUCCESS') || log.includes('Update completed successfully')) {
          setUpdateProgress(100);
          setUpdateStep('Update complete!');
          setUpdateInProgress(false);
          clearInterval(pollInterval); // Stop polling
          setTimeout(() => {
            // Force a hard reload with cache busting
            const url = new URL(window.location.href);
            url.searchParams.set('_refresh', Date.now().toString());
            window.location.href = url.toString();
          }, 3000);
        }
      } catch (error) {
        console.error('Failed to fetch update log:', error);
      }
    }, 1000); // Poll every second

    return () => clearInterval(pollInterval);
  }, [showProgressModal]);

  const fetchInstallStats = async () => {
    try {
      const response = await fetch('/api/version/stats');
      const data = await response.json();
      setActiveInstalls(data.activeInstalls);
    } catch (error) {
      console.error('Failed to fetch install stats:', error);
    }
  };

  const checkForUpdates = async () => {
    setChecking(true);
    setUpdateError('');
    try {
      const installId = getInstallId();

      // Track current version
      await fetch(`/api/version?installId=${encodeURIComponent(installId)}`);

      // Check for latest version in update package
      const response = await fetch(`/api/version/latest`);
      if (!response.ok) {
        if (response.status === 404) {
          setUpdateError('No update package available');
        } else {
          throw new Error('Failed to check for updates');
        }
        return;
      }

      const data = await response.json();
      setLatestVersion(data.version);
      setLastChecked(new Date());

      // Set changelog if available
      if (data.changelog && Array.isArray(data.changelog)) {
        setChangelog(data.changelog);
      }

      // Semantic version comparison
      if (data.version && currentVersion && currentVersion !== 'Loading...' && currentVersion !== 'Unknown') {
        const isNewer = compareVersions(data.version, currentVersion);
        setUpdateAvailable(isNewer);
      } else {
        setUpdateAvailable(false);
      }
    } catch (error) {
      console.error('Failed to check for updates:', error);
      setUpdateError('Failed to check for updates');
    } finally {
      setChecking(false);
    }
  };

  const handleUpdate = async () => {
    if (!window.confirm('This will update St0r to the latest version. The service will restart automatically. Continue?')) {
      return;
    }

    setUpdating(true);
    setUpdateError('');
    setUpdateMessage('');
    setShowProgressModal(true);
    setUpdateInProgress(true);
    setUpdateLog('Starting update...\n');

    try {
      const response = await fetch('/api/system-update/update', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to trigger update');
      }

      // Progress modal will show live updates via polling
    } catch (error: any) {
      setUpdateError(error.response?.data?.error || 'Failed to trigger update');
      setUpdating(false);
      setShowProgressModal(false);
      setUpdateInProgress(false);
    }
  };

  const handleForceReinstall = async () => {
    if (!window.confirm('This will REINSTALL the current version (repair mode). This is useful if something is broken. The service will restart automatically. Continue?')) {
      return;
    }

    setUpdating(true);
    setUpdateError('');
    setUpdateMessage('');
    setShowProgressModal(true);
    setUpdateInProgress(true);
    setUpdateLog('Starting reinstall (repair mode)...\n');

    try {
      const response = await fetch('/api/system-update/update?force=true', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to trigger reinstall');
      }

      // Progress modal will show live updates via polling
    } catch (error: any) {
      setUpdateError(error.response?.data?.error || 'Failed to trigger reinstall');
      setUpdating(false);
      setShowProgressModal(false);
      setUpdateInProgress(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Info className="h-8 w-8 text-primary-600 dark:text-primary-400" />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            About St0r
          </h1>
        </div>

        {/* Main About Card */}
        <div className="card">
          <div className="p-8 bg-gradient-to-br from-primary-50 to-blue-50 dark:from-primary-900/20 dark:to-blue-900/20 rounded-lg border border-primary-200 dark:border-primary-800">
            <div className="flex items-start gap-6">
              <div className="flex-1">
                <div className="mb-3">
                  <Logo size="lg" showText={true} />
                </div>
                <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
                  A modern, feature-rich web interface for UrBackup Server with enhanced functionality, beautiful design, and intuitive user experience. St0r brings powerful backup management to your fingertips with an elegant, user-friendly interface.
                </p>
                <div className="space-y-3">
                  <p className="text-lg font-semibold text-primary-700 dark:text-primary-300">
                    Version {currentVersion}
                  </p>
                  <div className="pt-4 border-t border-primary-200 dark:border-primary-700">
                    <p className="text-base text-gray-700 dark:text-gray-300 font-medium mb-2">
                      Created by Agit8or
                    </p>
                    <a
                      href="https://www.agit8or.net"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-base text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 hover:underline inline-flex items-center gap-2"
                    >
                      <ExternalLink className="w-4 h-4" />
                      www.agit8or.net
                    </a>
                  </div>
                  {activeInstalls !== null && activeInstalls !== undefined && (
                    <div className="pt-4 border-t border-primary-200 dark:border-primary-700 mt-4">
                      <p className="text-base text-gray-700 dark:text-gray-300 mb-1">
                        <span className="font-semibold text-primary-600 dark:text-primary-400">
                          {typeof activeInstalls === 'number' ? activeInstalls.toLocaleString() : '0'}
                        </span> active St0r installations
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        (active in last 30 days)
                      </p>
                    </div>
                  )}
                  <div className="pt-4 border-t border-primary-200 dark:border-primary-700 mt-4">
                    <p className="text-base text-gray-700 dark:text-gray-300 mb-2">
                      Thanks to <span className="font-semibold">Martin Raiber</span> for creating an amazing backup product!
                    </p>
                    <a
                      href="https://www.urbackup.org"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-base text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 hover:underline inline-flex items-center gap-2"
                    >
                      <ExternalLink className="w-4 h-4" />
                      urbackup.org
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Key Features */}
          <div className="card">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Key Features
            </h3>
            <ul className="space-y-3 text-gray-700 dark:text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-primary-600 dark:text-primary-400 mt-1">●</span>
                <span>Real-time dashboard with server status and statistics</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary-600 dark:text-primary-400 mt-1">●</span>
                <span>Client management with detailed backup history</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary-600 dark:text-primary-400 mt-1">●</span>
                <span>Activity monitoring and log viewing</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary-600 dark:text-primary-400 mt-1">●</span>
                <span>File browsing and backup restoration</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary-600 dark:text-primary-400 mt-1">●</span>
                <span>Custom backup scheduling and reports</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary-600 dark:text-primary-400 mt-1">●</span>
                <span>Email alerts and notifications</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary-600 dark:text-primary-400 mt-1">●</span>
                <span>Multi-tenant customer management</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary-600 dark:text-primary-400 mt-1">●</span>
                <span>Role-based access control (RBAC)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary-600 dark:text-primary-400 mt-1">●</span>
                <span>Dark mode support</span>
              </li>
            </ul>
          </div>

          {/* Technology Stack */}
          <div className="card">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Technology Stack
            </h3>
            <div className="space-y-4">
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100 mb-2">Frontend</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  React 18, TypeScript, Vite, TailwindCSS, React Router
                </p>
              </div>
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100 mb-2">Backend</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Node.js, Express, TypeScript, JWT Authentication
                </p>
              </div>
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100 mb-2">Database</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  MariaDB 11
                </p>
              </div>
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100 mb-2">Server</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  nginx, systemd
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* System Information */}
        <div className="card">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
            System Information
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">License</p>
              <p className="text-base font-medium text-gray-900 dark:text-gray-100">MIT</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Platform</p>
              <p className="text-base font-medium text-gray-900 dark:text-gray-100">Linux, Node.js 20+</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">UrBackup Server</p>
              <p className="text-base font-medium text-gray-900 dark:text-gray-100">Compatible with UrBackup 2.x+</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Browser Support</p>
              <p className="text-base font-medium text-gray-900 dark:text-gray-100">Modern browsers (Chrome, Firefox, Safari, Edge)</p>
            </div>
          </div>
        </div>

        {/* Update Section */}
        <div className={`card bg-gradient-to-br ${
          updateAvailable
            ? 'from-green-50 to-teal-50 dark:from-green-900/20 dark:to-teal-900/20 border-2 border-green-200 dark:border-green-800'
            : 'from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-2 border-blue-200 dark:border-blue-800'
        }`}>
          <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <Download className="h-5 w-5" />
            {updateAvailable ? 'Update Available' : 'Software Updates'}
          </h3>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                  Current version: <span className="text-blue-600 dark:text-blue-400">{currentVersion}</span>
                </p>
                {latestVersion && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {updateAvailable ? (
                      <>Latest version: <span className="text-green-600 dark:text-green-400 font-semibold">{latestVersion}</span></>
                    ) : (
                      <>You're running the latest version ({latestVersion})</>
                    )}
                  </p>
                )}
                {lastChecked && (
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                    Last checked: {lastChecked.toLocaleTimeString()}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={checkForUpdates}
                  disabled={checking}
                  className="btn btn-secondary flex items-center gap-2"
                >
                  {checking ? (
                    <>
                      <Loader className="h-4 w-4 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4" />
                      Check for Updates
                    </>
                  )}
                </button>
                {updateAvailable && (
                  <button
                    onClick={handleUpdate}
                    disabled={updating}
                    className="btn btn-primary flex items-center gap-2"
                  >
                    {updating ? (
                      <>
                        <Loader className="h-4 w-4 animate-spin" />
                        Updating...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4" />
                        Update Now
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={handleForceReinstall}
                  disabled={updating || checking}
                  className="btn btn-secondary flex items-center gap-2 border-orange-500 text-orange-600 hover:bg-orange-50 dark:border-orange-400 dark:text-orange-400 dark:hover:bg-orange-900/20"
                  title="Force reinstall current version (repair mode)"
                >
                  {updating ? (
                    <>
                      <Loader className="h-4 w-4 animate-spin" />
                      Reinstalling...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      Force Reinstall
                    </>
                  )}
                </button>
              </div>
            </div>

            {updateMessage && (
              <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <CheckCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-blue-800 dark:text-blue-200">{updateMessage}</p>
              </div>
            )}

            {updateError && (
              <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-800 dark:text-red-200">{updateError}</p>
              </div>
            )}

            <div className={`border-t pt-4 ${
              updateAvailable
                ? 'border-green-200 dark:border-green-700'
                : 'border-blue-200 dark:border-blue-700'
            }`}>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                <strong>Note:</strong> The one-click update feature automatically backs up your current installation, downloads the latest version, and restarts the service. Your data and settings are preserved.
              </p>
            </div>
          </div>
        </div>

        {/* Changelog Section */}
        {changelog.length > 0 && (
          <div className="card">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Changelog
            </h3>
            <div className="space-y-2">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Recent updates and improvements to St0r:
              </p>
              <ul className="space-y-2">
                {changelog.map((item, index) => (
                  <li key={index} className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-300">
                    <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Installation Section */}
        <div className="card bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-2 border-blue-200 dark:border-blue-800">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <ExternalLink className="h-5 w-5" />
            Installation
          </h3>

          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Quick Install</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Run this single command to install or upgrade St0r:
              </p>
              <div className="bg-gray-900 dark:bg-gray-950 rounded-lg p-4">
                <code className="text-sm text-green-400 font-mono break-all">
                  curl -fsSL http://{typeof window !== 'undefined' ? window.location.hostname : 'YOUR_SERVER_IP'}/downloads/install.sh | sudo bash
                </code>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                Replace YOUR_SERVER_IP with your server's IP address (e.g., http://192.168.22.228/downloads/install.sh)
              </p>
            </div>

            <div className="border-t border-blue-200 dark:border-blue-700 pt-4">
              <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Download Links</h4>
              <div className="space-y-2">
                <a
                  href="/downloads/install.sh"
                  download
                  className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline"
                >
                  <Download className="w-4 h-4" />
                  <span>Install Script (install.sh)</span>
                </a>
                <a
                  href="/downloads/urbackup-gui.tar.gz"
                  download
                  className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline"
                >
                  <Download className="w-4 h-4" />
                  <span>Application Package (urbackup-gui.tar.gz - 28MB)</span>
                </a>
              </div>
            </div>

            <div className="border-t border-blue-200 dark:border-blue-700 pt-4">
              <p className="text-xs text-gray-600 dark:text-gray-400">
                <strong>Note:</strong> The installer automatically detects existing installations and safely upgrades while preserving all data and settings.
              </p>
            </div>
          </div>
        </div>

        {/* Footer Note */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
            For detailed documentation, visit the <a href="/docs" className="text-blue-600 dark:text-blue-400 hover:underline">Documentation</a> page
          </p>
        </div>
      </div>

      {/* Enhanced Update Progress Modal */}
      {showProgressModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col mx-4 border border-gray-200 dark:border-gray-700">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-6">
              <div className="flex items-center gap-4">
                {updateInProgress ? (
                  <div className="relative">
                    <Loader className="h-8 w-8 text-white animate-spin" />
                    <div className="absolute inset-0 animate-ping">
                      <Loader className="h-8 w-8 text-white opacity-30" />
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <CheckCircle className="h-8 w-8 text-white" />
                    <div className="absolute inset-0 animate-pulse">
                      <CheckCircle className="h-8 w-8 text-white opacity-30" />
                    </div>
                  </div>
                )}
                <div className="flex-1">
                  <h2 className="text-2xl font-bold text-white mb-1">
                    {updateInProgress ? 'Updating St0r...' : 'Update Complete!'}
                  </h2>
                  <p className="text-blue-100 text-sm">
                    {updateStep || 'Initializing update process...'}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-white">{updateProgress}%</div>
                  <div className="text-xs text-blue-100">Progress</div>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="mt-4">
                <div className="h-3 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white transition-all duration-500 ease-out rounded-full shadow-lg"
                    style={{ width: `${updateProgress}%` }}
                  >
                    <div className="h-full w-full bg-gradient-to-r from-white to-blue-100 animate-pulse"></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Log Output */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="bg-gray-950 rounded-lg p-4 font-mono text-xs text-green-400 whitespace-pre-wrap max-h-96 overflow-y-auto border border-gray-700 shadow-inner">
                {updateLog || 'Waiting for update to start...\nThis may take 30-60 seconds...'}
              </div>

              {!updateInProgress && updateLog.includes('SUCCESS') && (
                <div className="mt-4 p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-2 border-green-400 dark:border-green-600 rounded-lg shadow-lg">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400 flex-shrink-0" />
                    <div>
                      <p className="text-green-900 dark:text-green-100 font-bold text-lg">
                        Update Successful!
                      </p>
                      <p className="text-green-700 dark:text-green-300 text-sm mt-1">
                        St0r has been updated. The page will reload automatically...
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            {!updateInProgress && (
              <div className="flex justify-between items-center p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Update completed in {Math.floor((Date.now() - (lastChecked?.getTime() || Date.now())) / 1000)}s
                </p>
                <button
                  onClick={() => window.location.href = window.location.href}
                  className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl transform hover:scale-105"
                >
                  <RefreshCw className="h-4 w-4" />
                  Reload Now
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
