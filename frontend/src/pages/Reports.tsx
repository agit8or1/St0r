import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { FileText, Download, Calendar, TrendingUp, HardDrive, Clock, Filter } from 'lucide-react';
import { api } from '../services/api';
import type { Client } from '../types';

interface ReportData {
  totalClients: number;
  activeClients: number;
  totalBackups: number;
  successfulBackups: number;
  failedBackups: number;
  totalStorage: number;
  averageBackupSize: number;
  oldestBackup: string | null;
  newestBackup: string | null;
}

export function Reports() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [dateRange, setDateRange] = useState({
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [reportType, setReportType] = useState<'summary' | 'detailed' | 'client'>('summary');

  useEffect(() => {
    loadReportData();
  }, [dateRange]);

  const loadReportData = async () => {
    try {
      setLoading(true);
      const clientsData = await api.getClients();
      setClients(clientsData);

      const totalClients = clientsData.length;
      const activeClients = clientsData.filter(c => c.online).length;
      const successfulBackups = clientsData.filter(c => c.file_ok || c.image_ok).length;
      const failedBackups = totalClients - successfulBackups;

      // Fetch storage data from our storage API
      let totalStorage = 0;
      let totalBackupSize = 0;
      let backupCount = 0;
      let allBackupTimes: number[] = [];

      try {
        const storageData = await api.getTotalStorage();
        totalStorage = storageData.used || 0;
      } catch (err) {
        console.debug('Could not fetch storage data:', err);
      }

      // Fetch backup data for size averages and timestamps
      for (const client of clientsData) {
        if (client.id) {
          try {
            const backups = await api.getBackups(client.id.toString());

            // Handle the {file: [], image: []} structure
            const allBackups = [];
            if (backups && typeof backups === 'object') {
              const backupsObj = backups as any;
              if (Array.isArray(backupsObj.file)) {
                allBackups.push(...backupsObj.file);
              }
              if (Array.isArray(backupsObj.image)) {
                allBackups.push(...backupsObj.image);
              }
            }

            for (const backup of allBackups) {
              if (backup.size_bytes && backup.size_bytes > 0) {
                totalBackupSize += backup.size_bytes;
                backupCount++;
              }

              // Collect backup times in seconds
              if (backup.backuptime) {
                allBackupTimes.push(backup.backuptime);
              }
            }
          } catch (err) {
            // Skip clients with no backup data or errors
            console.debug(`Could not fetch backups for client ${client.name}:`, err);
          }
        }
      }

      const averageBackupSize = backupCount > 0 ? totalBackupSize / backupCount : 0;

      // Find oldest and newest backups from actual backup data
      let oldestBackup: string | null = null;
      let newestBackup: string | null = null;

      if (allBackupTimes.length > 0) {
        oldestBackup = new Date(Math.min(...allBackupTimes) * 1000).toISOString();
        newestBackup = new Date(Math.max(...allBackupTimes) * 1000).toISOString();
      }

      setReportData({
        totalClients,
        activeClients,
        totalBackups: successfulBackups + failedBackups,
        successfulBackups,
        failedBackups,
        totalStorage,
        averageBackupSize,
        oldestBackup,
        newestBackup
      });
    } catch (err) {
      console.error('Failed to load report data:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatDate = (date: string | null) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString();
  };

  const exportToCSV = async () => {
    try {
      const clients = await api.getClients();

      const csvContent = [
        ['Client Name', 'Status', 'Last Backup', 'File Backup OK', 'Image Backup OK', 'IP Address', 'UID'],
        ...clients.map(c => [
          c.name,
          c.online ? 'Online' : 'Offline',
          c.lastbackup ? new Date(c.lastbackup * 1000).toLocaleString() : 'Never',
          c.file_ok ? 'Yes' : 'No',
          c.image_ok ? 'Yes' : 'No',
          c.ip || 'N/A',
          c.uid || 'N/A'
        ])
      ].map(row => row.join(',')).join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `urbackup-report-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export CSV:', err);
    }
  };

  const exportToPDF = async () => {
    // For PDF export, we'll create an HTML version that can be printed to PDF
    try {
      const clients = await api.getClients();

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>UrBackup Report - ${new Date().toLocaleDateString()}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            h1 { color: #2563eb; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #2563eb; color: white; }
            tr:nth-child(even) { background-color: #f9fafb; }
            .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin: 30px 0; }
            .summary-card { border: 1px solid #e5e7eb; padding: 15px; border-radius: 8px; }
            .summary-card h3 { margin: 0 0 10px 0; color: #6b7280; font-size: 14px; }
            .summary-card p { margin: 0; font-size: 24px; font-weight: bold; color: #111827; }
          </style>
        </head>
        <body>
          <h1>UrBackup Backup Report</h1>
          <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
          <p><strong>Date Range:</strong> ${dateRange.start} to ${dateRange.end}</p>

          <div class="summary">
            <div class="summary-card">
              <h3>Total Clients</h3>
              <p>${reportData?.totalClients || 0}</p>
            </div>
            <div class="summary-card">
              <h3>Successful Backups</h3>
              <p>${reportData?.successfulBackups || 0}</p>
            </div>
            <div class="summary-card">
              <h3>Failed Backups</h3>
              <p>${reportData?.failedBackups || 0}</p>
            </div>
            <div class="summary-card">
              <h3>Total Storage Used</h3>
              <p>${formatBytes(reportData?.totalStorage || 0)}</p>
            </div>
            <div class="summary-card">
              <h3>Average Backup Size</h3>
              <p>${formatBytes(reportData?.averageBackupSize || 0)}</p>
            </div>
            <div class="summary-card">
              <h3>Active Clients</h3>
              <p>${reportData?.activeClients || 0}</p>
            </div>
          </div>

          <h2>Client Details</h2>
          <table>
            <tr>
              <th>Client Name</th>
              <th>Status</th>
              <th>Last Backup</th>
              <th>File Backup</th>
              <th>Image Backup</th>
              <th>IP Address</th>
              <th>UID</th>
            </tr>
            ${clients.map(c => `
              <tr>
                <td>${c.name}</td>
                <td>${c.online ? 'Online' : 'Offline'}</td>
                <td>${c.lastbackup ? new Date(c.lastbackup * 1000).toLocaleString() : 'Never'}</td>
                <td>${c.file_ok ? 'OK' : 'Failed'}</td>
                <td>${c.image_ok ? 'OK' : 'Failed'}</td>
                <td>${c.ip || 'N/A'}</td>
                <td>${c.uid || 'N/A'}</td>
              </tr>
            `).join('')}
          </table>
        </body>
        </html>
      `;

      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        printWindow.print();
      }
    } catch (err) {
      console.error('Failed to export PDF:', err);
    }
  };

  if (loading || !reportData) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-600 dark:text-gray-400">Loading report data...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
              <FileText className="h-8 w-8" />
              Backup Reports
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Generate and export comprehensive backup reports
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={exportToCSV}
              className="btn btn-secondary flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
            <button
              onClick={exportToPDF}
              className="btn btn-primary flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Export PDF
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Report Filters</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <label className="label">Report Type</label>
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value as any)}
                className="input"
              >
                <option value="summary">Summary</option>
                <option value="detailed">Detailed</option>
                <option value="client">Per Client</option>
              </select>
            </div>
            <div>
              <label className="label">Start Date</label>
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                className="input"
              />
            </div>
            <div>
              <label className="label">End Date</label>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                className="input"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={loadReportData}
                className="btn btn-primary w-full"
              >
                Generate Report
              </button>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div
            className="card cursor-pointer hover:shadow-lg hover:border-blue-500 dark:hover:border-blue-400 transition-all"
            onClick={() => navigate('/clients')}
          >
            <div className="flex items-center gap-3">
              <HardDrive className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Total Clients</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{reportData.totalClients}</p>
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Click to view →</p>
              </div>
            </div>
          </div>

          <div
            className="card cursor-pointer hover:shadow-lg hover:border-green-500 dark:hover:border-green-400 transition-all"
            onClick={() => navigate('/clients')}
          >
            <div className="flex items-center gap-3">
              <TrendingUp className="h-8 w-8 text-green-600 dark:text-green-400" />
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Successful Backups</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{reportData.successfulBackups}</p>
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">Click to view →</p>
              </div>
            </div>
          </div>

          <div
            className="card cursor-pointer hover:shadow-lg hover:border-red-500 dark:hover:border-red-400 transition-all"
            onClick={() => navigate('/clients')}
          >
            <div className="flex items-center gap-3">
              <TrendingUp className="h-8 w-8 text-red-600 dark:text-red-400" />
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Failed Backups</p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">{reportData.failedBackups}</p>
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">Click to view →</p>
              </div>
            </div>
          </div>

          <div
            className="card cursor-pointer hover:shadow-lg hover:border-purple-500 dark:hover:border-purple-400 transition-all"
            onClick={() => navigate('/servers')}
          >
            <div className="flex items-center gap-3">
              <HardDrive className="h-8 w-8 text-purple-600 dark:text-purple-400" />
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Total Storage Used</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {formatBytes(reportData.totalStorage)}
                </p>
                <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">Click to view servers →</p>
              </div>
            </div>
          </div>

          <div
            className="card cursor-pointer hover:shadow-lg hover:border-orange-500 dark:hover:border-orange-400 transition-all"
            onClick={() => navigate('/dashboard')}
          >
            <div className="flex items-center gap-3">
              <HardDrive className="h-8 w-8 text-orange-600 dark:text-orange-400" />
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Average Backup Size</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {formatBytes(reportData.averageBackupSize)}
                </p>
                <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">Click to view dashboard →</p>
              </div>
            </div>
          </div>

          <div
            className="card cursor-pointer hover:shadow-lg hover:border-gray-500 dark:hover:border-gray-400 transition-all"
            onClick={() => navigate('/clients')}
          >
            <div className="flex items-center gap-3">
              <Clock className="h-8 w-8 text-gray-600 dark:text-gray-400" />
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Active Clients</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{reportData.activeClients}</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Click to view →</p>
              </div>
            </div>
          </div>
        </div>

        {/* Backup Timeline */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Backup Timeline</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <p className="text-sm text-gray-600 dark:text-gray-400">Oldest Backup</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">
                {formatDate(reportData.oldestBackup)}
              </p>
            </div>
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <p className="text-sm text-gray-600 dark:text-gray-400">Newest Backup</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">
                {formatDate(reportData.newestBackup)}
              </p>
            </div>
          </div>
        </div>

        {/* Success Rate */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Backup Success Rate</h2>
          <div className="relative pt-1">
            <div className="flex mb-2 items-center justify-between">
              <div>
                <span className="text-xs font-semibold inline-block text-primary-600 dark:text-primary-400">
                  Success Rate
                </span>
              </div>
              <div className="text-right">
                <span className="text-xs font-semibold inline-block text-primary-600 dark:text-primary-400">
                  {reportData.totalBackups > 0
                    ? Math.round((reportData.successfulBackups / reportData.totalBackups) * 100)
                    : 0}%
                </span>
              </div>
            </div>
            <div className="overflow-hidden h-4 mb-4 text-xs flex rounded bg-gray-200 dark:bg-gray-700">
              <div
                style={{
                  width: `${reportData.totalBackups > 0
                    ? (reportData.successfulBackups / reportData.totalBackups) * 100
                    : 0}%`
                }}
                className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-primary-600 dark:bg-primary-500 transition-all duration-500"
              ></div>
            </div>
          </div>
        </div>

        {/* Recent Backup History */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Recent Backup History</h2>
            <Link
              to="/clients"
              className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
            >
              View All Clients →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Client
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Last File Backup
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Last Image Backup
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    File Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Image Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                {clients.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                      {client.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                      {client.lastbackup ? new Date(client.lastbackup * 1000).toLocaleString() : 'Never'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                      {client.lastbackup_image ? new Date(client.lastbackup_image * 1000).toLocaleString() : 'Never'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-semibold rounded ${
                        client.file_ok
                          ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                          : 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                      }`}>
                        {client.file_ok ? 'OK' : 'Failed'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-semibold rounded ${
                        client.image_ok
                          ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                          : 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                      }`}>
                        {client.image_ok ? 'OK' : 'Failed'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <Link
                        to={`/clients/${encodeURIComponent(client.name)}`}
                        className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
                      >
                        View Details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
