import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  HardDrive,
  Activity as ActivityIcon,
  AlertCircle,
  CheckCircle,
  Clock,
  TrendingUp,
  Play,
  Server as ServerIcon
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, AreaChart, Area } from 'recharts';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import { api } from '../services/api';
import type { Client, Activity } from '../types';
import { formatBytes, formatTimeAgo } from '../utils/format';

export function Dashboard() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [diskUsage, setDiskUsage] = useState<{ used: number; available: number } | null>(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [clientsData, activitiesData, storageData] = await Promise.all([
        api.getClients(),
        api.getCurrentActivities(),
        api.getTotalStorage().catch(() => ({ used: 0, available: 0, servers: [] }))
      ]);
      setClients(clientsData);

      // Handle activities response
      if (Array.isArray(activitiesData)) {
        setActivities(activitiesData);
      } else if (activitiesData && typeof activitiesData === 'object') {
        const objData = activitiesData as any;
        setActivities(objData.activities || objData.data || []);
      } else {
        setActivities([]);
      }

      // Set disk usage from new storage endpoint
      setDiskUsage({
        used: storageData.used,
        available: storageData.available
      });

      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <Loading />
      </Layout>
    );
  }

  const onlineClients = clients.filter((c) => c.online).length;
  const offlineClients = clients.filter((c) => !c.online).length;
  const failedClients = clients.filter((c) => c.status === 'failed').length;
  const okClients = clients.filter((c) => c.status === 'ok').length;

  // Chart data
  const statusData = [
    { name: 'Online', value: onlineClients, color: '#10b981' },
    { name: 'Offline', value: offlineClients, color: '#6b7280' },
  ];

  const backupStatusData = [
    { name: 'OK', value: okClients, color: '#10b981' },
    { name: 'Failed', value: failedClients, color: '#ef4444' },
  ];

  const backupTypeData = [
    {
      name: 'File Backups',
      successful: clients.filter(c => c.file_ok).length,
      failed: clients.filter(c => !c.file_ok).length,
    },
    {
      name: 'Image Backups',
      successful: clients.filter(c => c.image_ok).length,
      failed: clients.filter(c => !c.image_ok).length,
    },
  ];

  const COLORS = ['#10b981', '#ef4444', '#3b82f6', '#f59e0b'];

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-600">
            Overview of your backup infrastructure
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle className="h-5 w-5" />
            {error}
          </div>
        )}

        {/* Stats grid */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Clients</p>
                <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-gray-100">
                  {clients.length}
                </p>
              </div>
              <div className="rounded-full bg-blue-100 dark:bg-blue-900 p-3">
                <HardDrive className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
            <div className="mt-4 flex items-center text-sm">
              <span className="text-green-600 dark:text-green-400">{onlineClients} online</span>
              <span className="mx-2 text-gray-400">•</span>
              <span className="text-gray-600 dark:text-gray-400">{offlineClients} offline</span>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Online Clients</p>
                <p className="mt-2 text-3xl font-bold text-green-600 dark:text-green-400">
                  {onlineClients}
                </p>
              </div>
              <div className="rounded-full bg-green-100 dark:bg-green-900 p-3">
                <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
              {Math.round((onlineClients / clients.length) * 100) || 0}% of total
            </p>
          </div>

          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Failed Backups</p>
                <p className="mt-2 text-3xl font-bold text-red-600 dark:text-red-400">{failedClients}</p>
              </div>
              <div className="rounded-full bg-red-100 dark:bg-red-900 p-3">
                <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
              </div>
            </div>
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">Require attention</p>
          </div>

          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Active Tasks</p>
                <p className="mt-2 text-3xl font-bold text-orange-600 dark:text-orange-400">
                  {activities.length}
                </p>
              </div>
              <div className="rounded-full bg-orange-100 dark:bg-orange-900 p-3">
                <ActivityIcon className="h-6 w-6 text-orange-600 dark:text-orange-400" />
              </div>
            </div>
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">Running backups</p>
          </div>
        </div>

        {/* Disk Usage */}
        <div className="card bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20">
          <div className="flex items-start gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <div className="rounded-full bg-purple-600 p-3">
                  <HardDrive className="h-6 w-6 text-white" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Backup Storage</h2>
              </div>
              {diskUsage && diskUsage.available ? (
                <>
                  <p className="text-3xl font-bold text-purple-600 dark:text-purple-400 mb-2">
                    {formatBytes(diskUsage.available)}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    available of {formatBytes(diskUsage.used + diskUsage.available)} total
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-purple-600"></div>
                        <span className="text-gray-600 dark:text-gray-400">Used</span>
                      </div>
                      <span className="font-medium text-gray-900 dark:text-gray-100">{formatBytes(diskUsage.used)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-purple-300"></div>
                        <span className="text-gray-600 dark:text-gray-400">Available</span>
                      </div>
                      <span className="font-medium text-gray-900 dark:text-gray-100">{formatBytes(diskUsage.available)}</span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-lg text-gray-500 dark:text-gray-400 mt-1">
                    No storage data available
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                    Storage data will appear after connecting to server
                  </p>
                </>
              )}
            </div>
            {diskUsage && diskUsage.available && (
              <div className="flex-shrink-0">
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Used', value: diskUsage.used },
                        { name: 'Available', value: diskUsage.available }
                      ]}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey="value"
                      paddingAngle={3}
                      label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      <Cell fill="#7c3aed" />
                      <Cell fill="#c4b5fd" />
                    </Pie>
                    <Tooltip
                      formatter={(value: any) => formatBytes(value)}
                      contentStyle={{
                        backgroundColor: '#1f2937',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#fff',
                        fontSize: '12px'
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        {/* Charts Section */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Client Status Chart */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Client Status
            </h2>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Backup Status Chart */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Backup Health
            </h2>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={backupStatusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {backupStatusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Backup Type Comparison */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Backup Types
            </h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={backupTypeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: '#6b7280' }}
                  angle={-15}
                  textAnchor="end"
                  height={60}
                />
                <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1f2937',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff'
                  }}
                />
                <Legend />
                <Bar dataKey="successful" fill="#10b981" name="Successful" />
                <Bar dataKey="failed" fill="#ef4444" name="Failed" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Recent activities */}
          <div className="card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Current Activities
              </h2>
              <Link to="/activities" className="text-sm text-primary-600 hover:text-primary-700">
                View all
              </Link>
            </div>
            {activities.length === 0 ? (
              <p className="text-center text-sm text-gray-500 py-8">
                No active tasks
              </p>
            ) : (
              <div className="space-y-3">
                {activities.slice(0, 5).map((activity) => (
                  <div
                    key={activity.id}
                    className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-3"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {activity.client}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">{activity.action}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {activity.pcdone}%
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        {formatBytes(activity.done_bytes)} / {formatBytes(activity.total_bytes)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Failed clients */}
          <div className="card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Clients Needing Attention
              </h2>
              <Link to="/clients" className="text-sm text-primary-600 hover:text-primary-700">
                View all
              </Link>
            </div>
            {failedClients === 0 ? (
              <p className="text-center text-sm text-gray-500 py-8">
                All backups are healthy
              </p>
            ) : (
              <div className="space-y-3">
                {clients
                  .filter((c) => !c.file_ok || !c.image_ok)
                  .slice(0, 5)
                  .map((client) => (
                    <div
                      key={client.id}
                      className="flex items-center justify-between rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20 p-3 cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => navigate(`/clients/${encodeURIComponent(client.name)}`)}
                    >
                      <div className="flex items-center gap-3">
                        <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {client.name}
                          </p>
                          <p className="text-xs text-gray-600 dark:text-gray-400">
                            Last seen: {formatTimeAgo(client.lastseen || 0)}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {!client.file_ok && (
                          <span className="rounded bg-red-100 dark:bg-red-900 px-2 py-1 text-xs font-medium text-red-700 dark:text-red-300">
                            File
                          </span>
                        )}
                        {!client.image_ok && (
                          <span className="rounded bg-red-100 dark:bg-red-900 px-2 py-1 text-xs font-medium text-red-700 dark:text-red-300">
                            Image
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
