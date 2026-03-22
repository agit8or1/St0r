import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Logo } from '../components/Logo';
import { Info, ExternalLink, Download, CheckCircle, AlertCircle, Loader, RefreshCw, FileText, Heart, Star, X } from 'lucide-react';

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
  const [searchParams] = useSearchParams();
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
  const [confirmingUpdate, setConfirmingUpdate] = useState(false);
  const [confirmingReinstall, setConfirmingReinstall] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  // Guard: only act on SUCCESS after we've seen inProgress=true at least once.
  // Prevents stale SUCCESS from a previous run's log from false-completing immediately.
  // Must be a ref (not state) so the setInterval closure always reads the current value.
  const hasSeenInProgressRef = useRef(false);

  const [currentVersion, setCurrentVersion] = useState('Loading...');
  const [showSupportModal, setShowSupportModal] = useState(false);

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

  // Open progress modal whenever ?autoUpdate=true is in the URL — including
  // when already on the About page (e.g. navigated from the update notification)
  useEffect(() => {
    if (searchParams.get('autoUpdate') === 'true' && !showProgressModal) {
      setShowProgressModal(true);
      setUpdateInProgress(true);
      setUpdateLog('Starting update...\n');
    }
  }, [searchParams]);

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
          credentials: 'include'
        });
        const data = await response.json();
        setReconnecting(false);

        const log = data.log || '';
        setUpdateLog(log);
        setUpdateInProgress(data.inProgress);

        if (data.inProgress) {
          hasSeenInProgressRef.current = true;
        }

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

        // Only act on SUCCESS after we've seen the update actually running (inProgress=true).
        // This prevents stale SUCCESS from a previous run's log from false-completing.
        if ((log.includes('SUCCESS') || log.includes('Update completed successfully')) && hasSeenInProgressRef.current) {
          setUpdateProgress(100);
          setUpdateStep('Update complete!');
          setUpdateInProgress(false);
          clearInterval(pollInterval);
          setTimeout(() => {
            // Reload to clean URL — strip autoUpdate param so modal doesn't reopen
            window.location.href = window.location.origin + window.location.pathname + '?_refresh=' + Date.now();
          }, 3000);
        }

        // If update failed, stop polling and surface the error
        if (!data.inProgress && log.includes('FAILED') && hasSeenInProgressRef.current) {
          setUpdateInProgress(false);
          setUpdateStep('Update failed');
          clearInterval(pollInterval);
        }
      } catch (_error) {
        // Service is restarting — show reconnecting state, keep polling
        setReconnecting(true);
        setUpdateStep('Service restarting...');
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

      // Fetch both current and latest versions atomically to avoid race condition
      const [currentResponse, latestResponse] = await Promise.all([
        fetch(`/api/version?installId=${encodeURIComponent(installId)}`),
        fetch(`/api/version/latest`),
      ]);

      const currentData = currentResponse.ok ? await currentResponse.json() : null;
      if (currentData?.version) setCurrentVersion(currentData.version);
      const installedVer = currentData?.version || currentVersion;

      if (!latestResponse.ok) {
        setUpdateAvailable(false);
        if (latestResponse.status !== 404) throw new Error('Failed to check for updates');
        return;
      }

      const data = await latestResponse.json();
      setLatestVersion(data.version);
      setLastChecked(new Date());

      if (data.changelog && Array.isArray(data.changelog)) {
        setChangelog(data.changelog);
      }

      if (data.version && installedVer && installedVer !== 'Loading...' && installedVer !== 'Unknown') {
        setUpdateAvailable(compareVersions(data.version, installedVer));
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

  const triggerUpdate = async (force = false) => {
    setUpdating(true);
    setUpdateError('');
    setUpdateMessage('');
    setShowProgressModal(true);
    setUpdateInProgress(true);
    setReconnecting(false);
    hasSeenInProgressRef.current = false; // Reset for this new run
    setUpdateLog(force ? 'Starting reinstall (repair mode)...\n' : 'Starting update...\n');

    try {
      const url = force ? '/api/system-update/update?force=true' : '/api/system-update/update';
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Server returned ${response.status}`);
      }
    } catch (error: any) {
      setUpdateError(error.message || 'Failed to trigger update');
      setUpdating(false);
      setShowProgressModal(false);
      setUpdateInProgress(false);
    }
  };

  const handleUpdate = () => setConfirmingUpdate(true);
  const handleForceReinstall = () => setConfirmingReinstall(true);

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
                    ) : compareVersions(currentVersion, latestVersion) ? (
                      <>Development build · latest release: {latestVersion}</>
                    ) : (
                      <>You're running the latest version</>
                    )}
                  </p>
                )}
                {lastChecked && (
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                    Last checked: {lastChecked.toLocaleTimeString()}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={checkForUpdates}
                  disabled={checking}
                  className="btn btn-secondary flex items-center gap-2"
                >
                  {checking ? (
                    <><Loader className="h-4 w-4 animate-spin" />Checking...</>
                  ) : (
                    <><RefreshCw className="h-4 w-4" />Check for Updates</>
                  )}
                </button>

                {updateAvailable && (
                  confirmingUpdate ? (
                    <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-300 dark:border-blue-700 rounded-lg px-3 py-1.5">
                      <span className="text-sm text-blue-800 dark:text-blue-200 font-medium">Service will restart — confirm?</span>
                      <button onClick={() => { setConfirmingUpdate(false); triggerUpdate(false); }} className="btn btn-primary btn-sm flex items-center gap-1">
                        <Download className="h-3 w-3" /> Yes, Update
                      </button>
                      <button onClick={() => setConfirmingUpdate(false)} className="btn btn-secondary btn-sm">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={handleUpdate} disabled={updating} className="btn btn-primary flex items-center gap-2">
                      {updating ? <><Loader className="h-4 w-4 animate-spin" />Updating...</> : <><Download className="h-4 w-4" />Update Now</>}
                    </button>
                  )
                )}

                {confirmingReinstall ? (
                  <div className="flex items-center gap-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-700 rounded-lg px-3 py-1.5">
                    <span className="text-sm text-orange-800 dark:text-orange-200 font-medium">Reinstall current version?</span>
                    <button onClick={() => { setConfirmingReinstall(false); triggerUpdate(true); }} className="btn btn-sm flex items-center gap-1 bg-orange-500 text-white hover:bg-orange-600 border-orange-500">
                      <Download className="h-3 w-3" /> Yes, Reinstall
                    </button>
                    <button onClick={() => setConfirmingReinstall(false)} className="btn btn-secondary btn-sm">Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={handleForceReinstall}
                    disabled={updating || checking}
                    className="btn btn-secondary flex items-center gap-2 border-orange-500 text-orange-600 hover:bg-orange-50 dark:border-orange-400 dark:text-orange-400 dark:hover:bg-orange-900/20"
                    title="Force reinstall current version (repair mode)"
                  >
                    <Download className="h-4 w-4" />Force Reinstall
                  </button>
                )}
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

        {/* Support Button */}
        <div className="flex justify-center pb-2">
          <button
            onClick={() => setShowSupportModal(true)}
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-pink-500 to-rose-500 text-white font-semibold shadow-lg hover:from-pink-600 hover:to-rose-600 transition-all hover:shadow-xl hover:scale-105 active:scale-95"
          >
            <Heart className="h-5 w-5 fill-current" />
            Support This Project
          </button>
        </div>
      </div>

      {/* Support Modal */}
      {showSupportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm" onClick={() => setShowSupportModal(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="bg-gradient-to-r from-pink-500 to-rose-500 p-6 relative">
              <button onClick={() => setShowSupportModal(false)} className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors">
                <X className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-3">
                <Heart className="h-8 w-8 text-white fill-current" />
                <div>
                  <h2 className="text-xl font-bold text-white">Support St0r</h2>
                  <p className="text-pink-100 text-sm">Help keep this project alive and growing</p>
                </div>
              </div>
            </div>

            {/* Links */}
            <div className="p-6 space-y-3">
              <a
                href="https://github.com/sponsors/agit8or1"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 p-4 rounded-xl border-2 border-pink-200 dark:border-pink-800 hover:border-pink-400 dark:hover:border-pink-600 hover:bg-pink-50 dark:hover:bg-pink-900/20 transition-all group"
              >
                <div className="w-10 h-10 rounded-full bg-pink-100 dark:bg-pink-900/40 flex items-center justify-center flex-shrink-0 group-hover:bg-pink-200 dark:group-hover:bg-pink-900/60 transition-colors">
                  <Heart className="h-5 w-5 text-pink-600 dark:text-pink-400 fill-current" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-gray-900 dark:text-gray-100">Sponsor on GitHub</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Support development with a monthly contribution</p>
                </div>
                <ExternalLink className="h-4 w-4 text-gray-400 group-hover:text-pink-500 transition-colors flex-shrink-0" />
              </a>

              <a
                href="https://github.com/agit8or1/St0r"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 p-4 rounded-xl border-2 border-yellow-200 dark:border-yellow-800 hover:border-yellow-400 dark:hover:border-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 transition-all group"
              >
                <div className="w-10 h-10 rounded-full bg-yellow-100 dark:bg-yellow-900/40 flex items-center justify-center flex-shrink-0 group-hover:bg-yellow-200 dark:group-hover:bg-yellow-900/60 transition-colors">
                  <Star className="h-5 w-5 text-yellow-500 fill-current" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-gray-900 dark:text-gray-100">Star on GitHub</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Give the project a star — it really helps!</p>
                </div>
                <ExternalLink className="h-4 w-4 text-gray-400 group-hover:text-yellow-500 transition-colors flex-shrink-0" />
              </a>

              <a
                href="https://mspreboot.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 p-4 rounded-xl border-2 border-blue-200 dark:border-blue-800 hover:border-blue-400 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all group"
              >
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200 dark:group-hover:bg-blue-900/60 transition-colors">
                  <ExternalLink className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-gray-900 dark:text-gray-100">MSP Reboot</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Support the business behind St0r</p>
                </div>
                <ExternalLink className="h-4 w-4 text-gray-400 group-hover:text-blue-500 transition-colors flex-shrink-0" />
              </a>
            </div>

            <div className="px-6 pb-6 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Thank you for using St0r! Your support means everything.
              </p>
            </div>
          </div>
        </div>
      )}

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
                    {reconnecting ? 'Service Restarting...' : updateInProgress ? 'Updating St0r...' : 'Update Complete!'}
                  </h2>
                  <p className="text-blue-100 text-sm flex items-center gap-2">
                    {reconnecting && <Loader className="h-3 w-3 animate-spin" />}
                    {updateStep || 'Initializing update process...'}
                    {reconnecting && <span className="text-yellow-200"> — waiting for service to come back online</span>}
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

              {!updateInProgress && updateLog.includes('FAILED') && (
                <div className="mt-4 p-4 bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-900/20 dark:to-orange-900/20 border-2 border-red-400 dark:border-red-600 rounded-lg shadow-lg">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400 flex-shrink-0" />
                    <div>
                      <p className="text-red-900 dark:text-red-100 font-bold text-lg">
                        Update Failed
                      </p>
                      <p className="text-red-700 dark:text-red-300 text-sm mt-1">
                        The previous version has been automatically restored. Check the log above for details.
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
                  onClick={() => { window.location.href = window.location.origin + window.location.pathname + '?_refresh=' + Date.now(); }}
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
