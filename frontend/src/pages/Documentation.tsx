import { useState } from 'react';
import {
  BookOpen,
  Download,
  Server,
  Users,
  Activity,
  Settings,
  Shield,
  Terminal,
  CheckCircle,
  AlertCircle,
  HardDrive,
  Database,
  Globe,
  Search,
  Copy,
  Check
} from 'lucide-react';
import { Layout } from '../components/Layout';

export function Documentation() {
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCommand(id);
    setTimeout(() => setCopiedCommand(null), 2000);
  };

  const downloadFile = async (filename: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/documentation/download/${filename}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download error:', error);
      alert('Failed to download file. Please try again.');
    }
  };

  // Use dynamic URLs based on current server
  const baseUrl = window.location.origin;
  const installCommand = `curl -fsSL ${baseUrl}/downloads/install.sh | sudo bash`;
  const wgetCommand = `wget -qO- ${baseUrl}/downloads/install.sh | sudo bash`;

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl">
            <BookOpen className="h-8 w-8 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Documentation</h1>
            <p className="text-gray-600 dark:text-gray-400">Complete guide to using St0r</p>
          </div>
        </div>

        {/* Table of Contents */}
        <div className="card">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">Table of Contents</h2>
          <div className="grid md:grid-cols-2 gap-3">
            <a href="#installation" className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline">
              <Download className="h-4 w-4" />
              Installation
            </a>
            <a href="#features" className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline">
              <CheckCircle className="h-4 w-4" />
              Features Overview
            </a>
            <a href="#dashboard" className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline">
              <HardDrive className="h-4 w-4" />
              Dashboard
            </a>
            <a href="#clients" className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline">
              <Users className="h-4 w-4" />
              Managing Clients
            </a>
            <a href="#activities" className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline">
              <Activity className="h-4 w-4" />
              Activities & Backups
            </a>
            <a href="#settings" className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline">
              <Settings className="h-4 w-4" />
              Settings & Configuration
            </a>
            <a href="#troubleshooting" className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline">
              <AlertCircle className="h-4 w-4" />
              Troubleshooting
            </a>
          </div>
        </div>

        {/* Installation Section */}
        <div id="installation" className="card">
          <div className="flex items-center gap-3 mb-4">
            <Download className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Installation</h2>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Quick Install (Recommended)</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-3">
                Run this single command to download and install St0r automatically:
              </p>

              <div className="bg-gray-900 dark:bg-gray-950 rounded-lg p-4 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-400">Using curl:</span>
                  <button
                    onClick={() => copyToClipboard(installCommand, 'curl')}
                    className="p-1 hover:bg-gray-800 rounded"
                  >
                    {copiedCommand === 'curl' ? (
                      <Check className="h-4 w-4 text-green-400" />
                    ) : (
                      <Copy className="h-4 w-4 text-gray-400" />
                    )}
                  </button>
                </div>
                <code className="text-sm text-green-400 font-mono break-all">
                  {installCommand}
                </code>
              </div>

              <div className="bg-gray-900 dark:bg-gray-950 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-400">Or using wget:</span>
                  <button
                    onClick={() => copyToClipboard(wgetCommand, 'wget')}
                    className="p-1 hover:bg-gray-800 rounded"
                  >
                    {copiedCommand === 'wget' ? (
                      <Check className="h-4 w-4 text-green-400" />
                    ) : (
                      <Copy className="h-4 w-4 text-gray-400" />
                    )}
                  </button>
                </div>
                <code className="text-sm text-green-400 font-mono break-all">
                  {wgetCommand}
                </code>
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Upgrade Detection</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    The installer automatically detects existing installations and will safely upgrade your system while preserving all data and settings.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">What Gets Installed</h3>
              <ul className="space-y-2">
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-600 dark:text-gray-400">Node.js 20.x (if not already installed)</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-600 dark:text-gray-400">MariaDB database server</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-600 dark:text-gray-400">Nginx web server</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-600 dark:text-gray-400">St0r application (frontend & backend)</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-600 dark:text-gray-400">systemd service for automatic startup</span>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Default Credentials</h3>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">After installation, login with:</p>
                <div className="font-mono text-sm">
                  <p className="text-gray-900 dark:text-gray-100">Username: <span className="text-blue-600 dark:text-blue-400">admin</span></p>
                  <p className="text-gray-900 dark:text-gray-100">Password: <span className="text-blue-600 dark:text-blue-400">admin</span></p>
                </div>
                <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">⚠️ Change the default password after first login!</p>
              </div>
            </div>
          </div>
        </div>

        {/* Features Section */}
        <div id="features" className="card">
          <div className="flex items-center gap-3 mb-4">
            <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Features Overview</h2>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="border dark:border-gray-700 rounded-lg p-4">
              <HardDrive className="h-8 w-8 text-blue-600 dark:text-blue-400 mb-3" />
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Direct Database Access</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Fast, reliable access to your UrBackup server through direct SQLite database reads for optimal performance.
              </p>
            </div>

            <div className="border dark:border-gray-700 rounded-lg p-4">
              <Activity className="h-8 w-8 text-purple-600 dark:text-purple-400 mb-3" />
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Real-Time Activities</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Monitor backup progress in real-time with live speed calculations, ETA estimates, and beautiful progress indicators.
              </p>
            </div>

            <div className="border dark:border-gray-700 rounded-lg p-4">
              <Database className="h-8 w-8 text-green-600 dark:text-green-400 mb-3" />
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Storage Analytics</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Track storage usage across all clients with detailed breakdowns of file and image backups.
              </p>
            </div>

            <div className="border dark:border-gray-700 rounded-lg p-4">
              <Users className="h-8 w-8 text-orange-600 dark:text-orange-400 mb-3" />
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Client Management</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                View all clients, their status, backup history, and trigger manual backups (full or incremental, file or image).
              </p>
            </div>

            <div className="border dark:border-gray-700 rounded-lg p-4">
              <Settings className="h-8 w-8 text-gray-600 dark:text-gray-400 mb-3" />
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Advanced Settings</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Configure server and client settings including backup intervals, windows, retention policies, and more.
              </p>
            </div>

            <div className="border dark:border-gray-700 rounded-lg p-4">
              <Globe className="h-8 w-8 text-indigo-600 dark:text-indigo-400 mb-3" />
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Modern UI</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Beautiful, responsive interface with dark mode support, gradient animations, and an intuitive user experience.
              </p>
            </div>
          </div>
        </div>

        {/* Dashboard Section */}
        <div id="dashboard" className="card">
          <div className="flex items-center gap-3 mb-4">
            <HardDrive className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h2>
          </div>

          <div className="space-y-4">
            <p className="text-gray-600 dark:text-gray-400">
              The Dashboard provides an at-a-glance view of your entire backup infrastructure:
            </p>

            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-blue-600 dark:text-blue-400">1</span>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100">Key Metrics</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    View total clients, active backups, storage usage, and success rate at the top of the dashboard.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-blue-600 dark:text-blue-400">2</span>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100">Client Status Distribution</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Interactive pie chart showing online, offline, failed, and OK clients. Click segments to filter.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-blue-600 dark:text-blue-400">3</span>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100">Recent Activities</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    See the latest backup jobs with progress bars, client names, and backup types.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-blue-600 dark:text-blue-400">4</span>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100">Storage Trends</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Area chart showing storage usage growth over time with file and image backup breakdown.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Clients Section */}
        <div id="clients" className="card">
          <div className="flex items-center gap-3 mb-4">
            <Users className="h-6 w-6 text-orange-600 dark:text-orange-400" />
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Managing Clients</h2>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Client List</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-3">
                The Clients page shows all backup clients with:
              </p>
              <ul className="space-y-2 ml-4">
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 dark:text-blue-400">•</span>
                  <span className="text-gray-600 dark:text-gray-400">Status indicators (Online/Offline)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 dark:text-blue-400">•</span>
                  <span className="text-gray-600 dark:text-gray-400">Last backup timestamps</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 dark:text-blue-400">•</span>
                  <span className="text-gray-600 dark:text-gray-400">Storage usage per client</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 dark:text-blue-400">•</span>
                  <span className="text-gray-600 dark:text-gray-400">Backup success/failure status</span>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Starting Manual Backups</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-3">
                Click on any client to view details and start backups:
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-1 text-sm">Full File Backup</h4>
                  <p className="text-xs text-gray-600 dark:text-gray-400">Complete backup of all configured files and folders</p>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-1 text-sm">Incremental File Backup</h4>
                  <p className="text-xs text-gray-600 dark:text-gray-400">Only backs up files changed since last backup</p>
                </div>
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-3">
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-1 text-sm">Full Image Backup</h4>
                  <p className="text-xs text-gray-600 dark:text-gray-400">Complete disk/partition image backup</p>
                </div>
                <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-3">
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-1 text-sm">Incremental Image Backup</h4>
                  <p className="text-xs text-gray-600 dark:text-gray-400">Only changed blocks since last image backup</p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Client Details</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Click any client card to view detailed information including backup history, settings, and available actions.
              </p>
            </div>
          </div>
        </div>

        {/* Activities Section */}
        <div id="activities" className="card">
          <div className="flex items-center gap-3 mb-4">
            <Activity className="h-6 w-6 text-purple-600 dark:text-purple-400" />
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Activities & Backups</h2>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Real-Time Monitoring</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-3">
                The Activities page provides live monitoring of all backup operations:
              </p>
              <ul className="space-y-2 ml-4">
                <li className="flex items-start gap-2">
                  <span className="text-purple-600 dark:text-purple-400">•</span>
                  <span className="text-gray-600 dark:text-gray-400">Live progress bars with shimmer animations</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-purple-600 dark:text-purple-400">•</span>
                  <span className="text-gray-600 dark:text-gray-400">Real-time speed calculations (MB/s)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-purple-600 dark:text-purple-400">•</span>
                  <span className="text-gray-600 dark:text-gray-400">Estimated time remaining (ETA)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-purple-600 dark:text-purple-400">•</span>
                  <span className="text-gray-600 dark:text-gray-400">Data transferred vs. total size</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-purple-600 dark:text-purple-400">•</span>
                  <span className="text-gray-600 dark:text-gray-400">Paused backup detection</span>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Auto-Refresh</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Toggle the auto-refresh button to enable automatic updates every 3 seconds. The spinning icon indicates active refresh.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Filtering</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-3">
                Use the filter buttons to view:
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full text-sm">All Activities</span>
                <span className="px-3 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-full text-sm">Running Only</span>
                <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-full text-sm">Completed</span>
                <span className="px-3 py-1 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded-full text-sm">Files</span>
                <span className="px-3 py-1 bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 rounded-full text-sm">Images</span>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Completed Activities</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Scroll down to see recently completed backups. Failed backups are grouped separately and can be expanded/collapsed for a cleaner view.
              </p>
            </div>
          </div>
        </div>

        {/* Settings Section */}
        <div id="settings" className="card">
          <div className="flex items-center gap-3 mb-4">
            <Settings className="h-6 w-6 text-gray-600 dark:text-gray-400" />
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings & Configuration</h2>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Server Settings</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-3">
                Access server-level configuration from the Settings page:
              </p>
              <ul className="space-y-2 ml-4">
                <li className="flex items-start gap-2">
                  <span className="text-gray-600 dark:text-gray-400">•</span>
                  <span className="text-gray-600 dark:text-gray-400">Backup retention policies</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gray-600 dark:text-gray-400">•</span>
                  <span className="text-gray-600 dark:text-gray-400">Default backup intervals</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gray-600 dark:text-gray-400">•</span>
                  <span className="text-gray-600 dark:text-gray-400">Global backup windows</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gray-600 dark:text-gray-400">•</span>
                  <span className="text-gray-600 dark:text-gray-400">Email notifications</span>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Client-Specific Settings</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-3">
                Click on a client and navigate to its settings tab to configure:
              </p>
              <ul className="space-y-2 ml-4">
                <li className="flex items-start gap-2">
                  <span className="text-gray-600 dark:text-gray-400">•</span>
                  <span className="text-gray-600 dark:text-gray-400">Backup intervals (full and incremental)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gray-600 dark:text-gray-400">•</span>
                  <span className="text-gray-600 dark:text-gray-400">Backup windows (time restrictions)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gray-600 dark:text-gray-400">•</span>
                  <span className="text-gray-600 dark:text-gray-400">Retention counts and durations</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gray-600 dark:text-gray-400">•</span>
                  <span className="text-gray-600 dark:text-gray-400">Excluded paths and file types</span>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">User Management</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Create additional users, assign permissions, and manage passwords from the Users page.
              </p>
            </div>
          </div>
        </div>

        {/* Troubleshooting Section */}
        <div id="troubleshooting" className="card">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Troubleshooting</h2>
          </div>

          <div className="space-y-4">
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Connection Issues</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">If you experience connection problems:</p>
              <ul className="space-y-1 ml-4 text-sm text-gray-600 dark:text-gray-400">
                <li>1. Verify the UrBackup server is running</li>
                <li>2. Check that the database is accessible at /var/urbackup/backup_server.db</li>
                <li>3. Confirm UrBackup API credentials in .env file</li>
                <li>4. Test local API: <code className="bg-gray-900 text-green-400 px-2 py-0.5 rounded">curl http://localhost:55414</code></li>
              </ul>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Backup Not Starting</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">If manual backups don't start:</p>
              <ul className="space-y-1 ml-4 text-sm text-gray-600 dark:text-gray-400">
                <li>1. Check if client is online</li>
                <li>2. Verify backup windows allow backups now</li>
                <li>3. Check UrBackup server logs for errors</li>
                <li>4. Ensure client has UrBackup agent installed</li>
              </ul>
            </div>

            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Storage Not Showing</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">If storage statistics show 0:</p>
              <ul className="space-y-1 ml-4 text-sm text-gray-600 dark:text-gray-400">
                <li>1. Wait a few minutes for data collection</li>
                <li>2. Check server logs: <code className="bg-gray-900 text-green-400 px-2 py-0.5 rounded">sudo journalctl -u urbackup-gui -n 50</code></li>
                <li>3. Verify UrBackup server API is accessible</li>
                <li>4. Check user permissions on UrBackup server</li>
              </ul>
            </div>

            <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Service Management</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Useful commands:</p>
              <div className="space-y-2">
                <div className="bg-gray-900 dark:bg-gray-950 rounded p-2">
                  <code className="text-xs text-green-400">sudo systemctl status urbackup-gui</code>
                  <p className="text-xs text-gray-400 mt-1">Check service status</p>
                </div>
                <div className="bg-gray-900 dark:bg-gray-950 rounded p-2">
                  <code className="text-xs text-green-400">sudo systemctl restart urbackup-gui</code>
                  <p className="text-xs text-gray-400 mt-1">Restart the backend service</p>
                </div>
                <div className="bg-gray-900 dark:bg-gray-950 rounded p-2">
                  <code className="text-xs text-green-400">sudo systemctl restart nginx</code>
                  <p className="text-xs text-gray-400 mt-1">Restart the web server</p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Getting Help</h3>
              <p className="text-gray-600 dark:text-gray-400">
                For additional support, check the application logs or contact your system administrator.
              </p>
            </div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-2 border-blue-200 dark:border-blue-800">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-600 rounded-lg">
              <Terminal className="h-6 w-6 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Quick Reference</h2>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Installation Files</h3>
              <div className="space-y-1 text-sm">
                <p className="text-gray-600 dark:text-gray-400">
                  <a href={`${baseUrl}/downloads/install.sh`} className="text-blue-600 dark:text-blue-400 hover:underline">
                    {baseUrl}/downloads/install.sh
                  </a>
                </p>
                <p className="text-gray-600 dark:text-gray-400">
                  <a href={`${baseUrl}/downloads/urbackup-gui.tar.gz`} className="text-blue-600 dark:text-blue-400 hover:underline">
                    {baseUrl}/downloads/urbackup-gui.tar.gz
                  </a>
                </p>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Default Ports</h3>
              <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                <p>St0r Web Interface: <span className="font-mono text-blue-600 dark:text-blue-400">80</span></p>
                <p>St0r Backend API: <span className="font-mono text-blue-600 dark:text-blue-400">3000</span></p>
                <p>UrBackup Server: <span className="font-mono text-blue-600 dark:text-blue-400">55414</span></p>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Service Names</h3>
              <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                <p>Backend: <span className="font-mono text-blue-600 dark:text-blue-400">urbackup-gui</span></p>
                <p>Web Server: <span className="font-mono text-blue-600 dark:text-blue-400">nginx</span></p>
                <p>Database: <span className="font-mono text-blue-600 dark:text-blue-400">mariadb</span></p>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Installation Directory</h3>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                <p className="font-mono text-blue-600 dark:text-blue-400">/opt/urbackup-gui</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
