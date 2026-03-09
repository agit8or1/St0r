import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  HardDrive,
  Activity as ActivityIcon,
  AlertCircle,
  CheckCircle,
  GitBranch,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as ChartTooltip } from 'recharts';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import { Tooltip } from '../components/Tooltip';
import { api } from '../services/api';
import type { Client, Activity, ReplicationTargetStatus, SystemMetrics } from '../types';
import { formatBytes, formatTimeAgo } from '../utils/format';

function Gauge({ pct, label, sublabel, color }: { pct: number; label: string; sublabel: string; color: string }) {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  const offset = circ * (1 - clamped / 100);
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={r} fill="none" stroke="currentColor" strokeWidth="7"
          className="text-gray-200 dark:text-gray-700" />
        <circle cx="44" cy="44" r={r} fill="none" stroke={color} strokeWidth="7"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 44 44)"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
        <text x="44" y="40" textAnchor="middle" fontSize="15" fontWeight="bold" fill="currentColor"
          className="fill-gray-900 dark:fill-gray-100">{clamped}%</text>
        <text x="44" y="55" textAnchor="middle" fontSize="9" fill="#6b7280">{label}</text>
      </svg>
      <p className="text-xs text-gray-500 dark:text-gray-400 text-center leading-tight">{sublabel}</p>
    </div>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [diskUsage, setDiskUsage] = useState<{ used: number; available: number } | null>(null);
  const [replStatuses, setReplStatuses] = useState<ReplicationTargetStatus[]>([]);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [backupStats, setBackupStats] = useState<{ successful: number; failed: number; total: number; days: number } | null>(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    // Load fast data first so the dashboard renders immediately
    try {
      const [clientsData, activitiesData, statsData] = await Promise.all([
        api.getClients().catch(() => [] as Client[]),
        api.getCurrentActivities().catch(() => [] as Activity[]),
        api.getBackupStats(7).catch(() => null),
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
      if (statsData) setBackupStats(statsData);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load data');
    } finally {
      setLoading(false);
    }

    // Load slow data in background — updates cards when ready
    api.getTotalStorage().then(s => setDiskUsage({ used: s.used, available: s.available })).catch(() => {});
    api.getReplicationStatus().then(setReplStatuses).catch(() => {});
    api.getSystemMetrics().then(setMetrics).catch(() => {});
  };

  if (loading) {
    return <Layout><Loading /></Layout>;
  }

  const onlineClients = clients.filter((c) => c.online).length;
  const offlineClients = clients.filter((c) => !c.online).length;
  // A client needs attention if: file backup failed, OR never backed up (UrBackup defaults file_ok=1 for new clients),
  // OR had image backups that failed
  const hasFileProblem = (c: Client) => !c.file_ok || !(c as any).lastbackup;
  const hasImageProblem = (c: Client) => !(c as any).lastbackup_image || !c.image_ok;
  const failedClients = clients.filter((c) => hasFileProblem(c) || hasImageProblem(c)).length;

  const statusData = [
    { name: 'Online', value: onlineClients, color: '#10b981' },
    { name: 'Offline', value: offlineClients, color: '#6b7280' },
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
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
          <Tooltip text="View all backup clients" position="bottom">
          <div className="card py-3 px-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/clients')}>
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
          </Tooltip>

          <Tooltip text="Filter to online clients only" position="bottom">
          <div className="card py-3 px-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/clients?filter=online')}>
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
          </Tooltip>

          <Tooltip text="Backup jobs completed successfully in the last 7 days" position="bottom">
          <div className="card py-3 px-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/activities?status=successful')}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Successful Backups</p>
                <p className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">{backupStats?.successful ?? '—'}</p>
              </div>
              <div className="rounded-full bg-green-100 dark:bg-green-900/40 p-2">
                <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Last 7 days</p>
          </div>
          </Tooltip>

          <Tooltip text="Backup jobs with errors in the last 7 days" position="bottom">
          <div className="card py-3 px-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/activities?status=errors')}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Failed Backups</p>
                <p className="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">{backupStats?.failed ?? '—'}</p>
              </div>
              <div className="rounded-full bg-red-100 dark:bg-red-900/40 p-2">
                <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Last 7 days</p>
          </div>
          </Tooltip>

          <Tooltip text="View currently running backup jobs" position="bottom">
          <div className="card py-3 px-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/activities')}>
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
          </Tooltip>
        </div>

        {/* Replication health card */}
        <div>{(() => {
          const replHealthy = replStatuses.filter(s => s.lastRun?.status === 'success').length;
          const replTotal = replStatuses.length;
          const replDegraded = replStatuses.some(s => s.lastRun?.status === 'failed');
          const replHealth = replTotal === 0 ? 'No targets' : replDegraded ? 'Degraded' : 'Healthy';
          const worstLag = replStatuses.reduce((max, s) => {
            const lag = s.lastRun?.lag_seconds ?? null;
            return lag !== null ? (max === null ? lag : Math.max(max, lag)) : max;
          }, null as number | null);
          const lagStr = worstLag === null ? '—' : worstLag < 60 ? `${worstLag}s` : worstLag < 3600 ? `${Math.floor(worstLag / 60)}m` : `${Math.floor(worstLag / 3600)}h`;
          return (
            <Tooltip text="View replication targets and sync status" position="bottom">
            <div className="card py-3 px-4 cursor-pointer hover:shadow-md transition-shadow flex items-center gap-4"
              onClick={() => navigate('/replication')}>
              <div className="rounded-full bg-indigo-100 dark:bg-indigo-900/40 p-2 flex-shrink-0">
                <GitBranch className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Replication</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className={`text-sm font-semibold ${replHealth === 'Healthy' ? 'text-green-600 dark:text-green-400' : replHealth === 'Degraded' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                    {replHealth}
                  </span>
                  {replTotal > 0 && <span className="text-xs text-gray-500 dark:text-gray-400">{replHealthy}/{replTotal} healthy · lag {lagStr}</span>}
                </div>
              </div>
            </div>
            </Tooltip>
          );
        })()}</div>

        {/* Server resource gauges */}
        {metrics && (
          <div className="card py-3 px-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Server Resources</h2>
            <div className="grid grid-cols-3 gap-2">
              <Tooltip text="Server processor usage across all cores">
                <Gauge
                  pct={metrics.cpu.usage}
                  label="CPU"
                  sublabel={`${metrics.cpu.cores} cores`}
                  color="#3b82f6"
                />
              </Tooltip>
              <Tooltip text="RAM used vs total available on the server">
                <Gauge
                  pct={metrics.memory.usagePercent}
                  label="Memory"
                  sublabel={`${formatBytes(metrics.memory.used)} / ${formatBytes(metrics.memory.total)}`}
                  color="#10b981"
                />
              </Tooltip>
              {(() => {
                const linkBytesPerSec = (metrics.network.linkSpeedMbps * 1_000_000) / 8;
                const totalRate = metrics.network.rxBytesPerSec + metrics.network.txBytesPerSec;
                const netPct = Math.min(100, Math.round((totalRate / linkBytesPerSec) * 100));
                return (
                  <Tooltip text="Current network bandwidth usage vs link speed">
                    <Gauge
                      pct={netPct}
                      label="Network"
                      sublabel={`↓${formatBytes(metrics.network.rxBytesPerSec)}/s ↑${formatBytes(metrics.network.txBytesPerSec)}/s`}
                      color="#f59e0b"
                    />
                  </Tooltip>
                );
              })()}
            </div>
          </div>
        )}

        {/* Storage + Charts row */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Disk Usage */}
          <Tooltip text="Go to server settings and storage configuration" position="top">
          <div className="card py-3 px-4 bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/server-settings')}>
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
                  <ChartTooltip formatter={(v: any) => formatBytes(v)} contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '11px' }} />
                </PieChart>
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">No storage data available</p>
            )}
          </div>
          </Tooltip>

          {/* Client Status Pie */}
          <div className="card py-3 px-4">
            <Tooltip text="Proportion of endpoints that are currently online vs offline">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2 cursor-default inline-block">Endpoint Status</h2>
            </Tooltip>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={statusData} cx="50%" cy="50%" labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={65} dataKey="value">
                  {statusData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <ChartTooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Backup Job Stats */}
          <Tooltip text="Backup jobs completed in the last 7 days" position="top">
          <div className="card py-3 px-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/activities')}>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Backup Jobs (7d)</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600 dark:text-gray-400">Successful</span>
                <span className="text-lg font-bold text-green-600 dark:text-green-400">{backupStats?.successful ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600 dark:text-gray-400">Failed / Errors</span>
                <span className="text-lg font-bold text-red-600 dark:text-red-400">{backupStats?.failed ?? '—'}</span>
              </div>
              <div className="border-t border-gray-200 dark:border-gray-700 pt-2 flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">Total</span>
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{backupStats?.total ?? '—'}</span>
              </div>
            </div>
          </div>
          </Tooltip>
        </div>

        {/* Activities + Attention */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card py-3 px-4">
            <div className="mb-3 flex items-center justify-between">
              <Tooltip text="Backup and restore jobs currently in progress on connected endpoints">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-default">Current Activities</h2>
              </Tooltip>
              <Tooltip text="Go to Activities page"><Link to="/activities" className="text-xs text-primary-600 hover:text-primary-700">View all</Link></Tooltip>
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
              <Tooltip text="Endpoints with failed, missing, or overdue backups that require review">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-default">Endpoints Needing Attention</h2>
              </Tooltip>
              <Tooltip text="Go to Clients page"><Link to="/clients" className="text-xs text-primary-600 hover:text-primary-700">View all</Link></Tooltip>
            </div>
            {failedClients === 0 ? (
              <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-6">All backups are healthy</p>
            ) : (
              <div className="space-y-2">
                {clients.filter((c) => hasFileProblem(c) || hasImageProblem(c)).slice(0, 5).map((client) => (
                  <Tooltip key={client.id} text="Click to view client details and trigger a backup" position="top">
                    <div
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
                        {hasFileProblem(client) && (
                          <Tooltip text={!(client as any).lastbackup ? 'No file backup has ever been completed for this endpoint' : 'The most recent file backup job failed'}>
                            <span className="rounded bg-red-100 dark:bg-red-900 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
                              {!(client as any).lastbackup ? 'No File Backup' : 'File Failed'}
                            </span>
                          </Tooltip>
                        )}
                        {hasImageProblem(client) && (
                          <Tooltip text={!(client as any).lastbackup_image ? 'No image (bare-metal) backup has ever been completed for this endpoint' : 'The most recent image backup job failed'}>
                            <span className="rounded bg-red-100 dark:bg-red-900 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
                              {!(client as any).lastbackup_image ? 'No Image Backup' : 'Image Failed'}
                            </span>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  </Tooltip>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
