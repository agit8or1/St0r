import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  HardDrive,
  Activity as ActivityIcon,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
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
    const interval = setInterval(loadData, 30000);
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
      if (Array.isArray(activitiesData)) {
        setActivities(activitiesData);
      } else if (activitiesData && typeof activitiesData === 'object') {
        const objData = activitiesData as any;
        setActivities(objData.activities || objData.data || []);
      } else {
        setActivities([]);
      }
      setDiskUsage({ used: storageData.used, available: storageData.available });
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <Layout><Loading /></Layout>;
  }

  const onlineClients = clients.filter((c) => c.online).length;
  const offlineClients = clients.filter((c) => !c.online).length;
  const failedClients = clients.filter((c) => !c.file_ok || !c.image_ok).length;

  const statusData = [
    { name: 'Online', value: onlineClients, color: '#10b981' },
    { name: 'Offline', value: offlineClients, color: '#6b7280' },
  ];

  const backupTypeData = [
    {
      name: 'File',
      successful: clients.filter(c => c.file_ok).length,
      failed: clients.filter(c => !c.file_ok).length,
    },
    {
      name: 'Image',
      successful: clients.filter(c => c.image_ok).length,
      failed: clients.filter(c => !c.image_ok).length,
    },
  ];

  return (
    <Layout>
      <div className="space-y-4">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Backup infrastructure overview</p>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {/* Stats row */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <div className="card py-3 px-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Endpoints</p>
                <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{clients.length}</p>
              </div>
              <div className="rounded-full bg-blue-100 dark:bg-blue-900/40 p-2">
                <HardDrive className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              <span className="text-green-600 dark:text-green-400">{onlineClients} online</span>
              {' · '}
              <span>{offlineClients} offline</span>
            </p>
          </div>

          <div className="card py-3 px-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Online</p>
                <p className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">{onlineClients}</p>
              </div>
              <div className="rounded-full bg-green-100 dark:bg-green-900/40 p-2">
                <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {Math.round((onlineClients / (clients.length || 1)) * 100)}% of total
            </p>
          </div>

          <div className="card py-3 px-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Failed Backups</p>
                <p className="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">{failedClients}</p>
              </div>
              <div className="rounded-full bg-red-100 dark:bg-red-900/40 p-2">
                <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Require attention</p>
          </div>

          <div className="card py-3 px-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Active Tasks</p>
                <p className="mt-1 text-2xl font-bold text-orange-600 dark:text-orange-400">{activities.length}</p>
              </div>
              <div className="rounded-full bg-orange-100 dark:bg-orange-900/40 p-2">
                <ActivityIcon className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Running backups</p>
          </div>
        </div>

        {/* Storage + Charts row */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Disk Usage */}
          <div className="card py-3 px-4 bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20">
            <div className="flex items-center gap-2 mb-2">
              <div className="rounded-full bg-purple-600 p-1.5">
                <HardDrive className="h-4 w-4 text-white" />
              </div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Backup Storage</h2>
            </div>
            {diskUsage && diskUsage.available ? (
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                    {formatBytes(diskUsage.available)}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    available of {formatBytes(diskUsage.used + diskUsage.available)}
                  </p>
                  <div className="mt-2 space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500 dark:text-gray-400">Used</span>
                      <span className="font-medium text-gray-900 dark:text-gray-100">{formatBytes(diskUsage.used)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500 dark:text-gray-400">Free</span>
                      <span className="font-medium text-gray-900 dark:text-gray-100">{formatBytes(diskUsage.available)}</span>
                    </div>
                  </div>
                </div>
                <PieChart width={110} height={110}>
                  <Pie data={[{ name: 'Used', value: diskUsage.used }, { name: 'Free', value: diskUsage.available }]}
                    cx="50%" cy="50%" innerRadius={30} outerRadius={50} dataKey="value" paddingAngle={3}>
                    <Cell fill="#7c3aed" />
                    <Cell fill="#c4b5fd" />
                  </Pie>
                  <Tooltip formatter={(v: any) => formatBytes(v)} contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '11px' }} />
                </PieChart>
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">No storage data available</p>
            )}
          </div>

          {/* Client Status Pie */}
          <div className="card py-3 px-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Endpoint Status</h2>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={statusData} cx="50%" cy="50%" labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={65} dataKey="value">
                  {statusData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Backup Types Bar */}
          <div className="card py-3 px-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Backup Types</h2>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={backupTypeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '11px' }} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="successful" fill="#10b981" name="OK" />
                <Bar dataKey="failed" fill="#ef4444" name="Failed" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Activities + Attention */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card py-3 px-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Current Activities</h2>
              <Link to="/activities" className="text-xs text-primary-600 hover:text-primary-700">View all</Link>
            </div>
            {activities.length === 0 ? (
              <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-6">No active tasks</p>
            ) : (
              <div className="space-y-2">
                {activities.slice(0, 5).map((activity) => (
                  <div key={activity.id} className="flex items-center justify-between rounded border border-gray-200 dark:border-gray-700 px-3 py-2">
                    <div>
                      <p className="text-xs font-medium text-gray-900 dark:text-gray-100">{activity.client}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{activity.action}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-medium text-gray-900 dark:text-gray-100">{activity.pcdone}%</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{formatBytes(activity.done_bytes)} / {formatBytes(activity.total_bytes)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card py-3 px-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Endpoints Needing Attention</h2>
              <Link to="/clients" className="text-xs text-primary-600 hover:text-primary-700">View all</Link>
            </div>
            {failedClients === 0 ? (
              <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-6">All backups are healthy</p>
            ) : (
              <div className="space-y-2">
                {clients.filter((c) => !c.file_ok || !c.image_ok).slice(0, 5).map((client) => (
                  <div key={client.id}
                    className="flex items-center justify-between rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20 px-3 py-2 cursor-pointer hover:shadow transition-shadow"
                    onClick={() => navigate(`/clients/${encodeURIComponent(client.name)}`)}>
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-gray-900 dark:text-gray-100">{client.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Last seen: {formatTimeAgo(client.lastseen || 0)}</p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {!client.file_ok && <span className="rounded bg-red-100 dark:bg-red-900 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">File</span>}
                      {!client.image_ok && <span className="rounded bg-red-100 dark:bg-red-900 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">Image</span>}
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
