import { useEffect, useState } from 'react';
import {
  Activity as ActivityIcon,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
  TrendingUp,
  Server,
  HardDrive,
  Pause,
  Play,
  Filter,
  RefreshCw,
  ChevronDown,
  StopCircle,
  FileText,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import { api } from '../services/api';
import type { Activity } from '../types';
import { formatBytes } from '../utils/format';

type FilterType = 'all' | 'running' | 'completed';
type ActivityType = 'file' | 'image' | 'all';
type DateRangeFilter = 'all' | 'today' | 'week' | 'month';

export function Activities() {
  const [currentActivities, setCurrentActivities] = useState<Activity[]>([]);
  const [lastActivities, setLastActivities] = useState<Activity[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [activityType, setActivityType] = useState<ActivityType>('all');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showFailedDetails, setShowFailedDetails] = useState(false);
  const [selectedClient, setSelectedClient] = useState<string>('all');
  const [dateRange, setDateRange] = useState<DateRangeFilter>('all');
  const [clearingStaleJobs, setClearingStaleJobs] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelNotify, setCancelNotify] = useState<{ id: string; msg: string; ok: boolean } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearStaleResult, setClearStaleResult] = useState<{ found: number; stopped: number } | null>(null);
  const [jobLogs, setJobLogs] = useState<any[]>([]);
  const [jobLogsLoading, setJobLogsLoading] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [logDetail, setLogDetail] = useState<Record<number, { clientname: string; entries: { severity: number; time: number; message: string }[] }>>({});
  const [logDetailLoading, setLogDetailLoading] = useState<number | null>(null);
  const [showErrorsOnly, setShowErrorsOnly] = useState(true);

  useEffect(() => {
    loadActivities();
    loadClients();
    loadJobLogs();
    if (autoRefresh) {
      const interval = setInterval(() => {
        loadActivities();
        loadClients();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const loadActivities = async () => {
    try {
      const data = await api.getActivities();
      if (Array.isArray(data)) {
        setCurrentActivities(data);
        setLastActivities([]);
      } else if (data && typeof data === 'object') {
        const objData = data as any;
        setCurrentActivities(objData.current || []);
        setLastActivities(objData.last || []);
      }
    } catch (err) {
      console.error('Failed to load activities:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadClients = async () => {
    try {
      const data = await api.getClients();
      setClients(data || []);
    } catch (err) {
      console.error('Failed to load clients:', err);
    }
  };

  const loadJobLogs = async () => {
    setJobLogsLoading(true);
    try {
      const result = await api.getJobLogs(undefined, 50);
      setJobLogs(result.logs || []);
    } catch (err) {
      console.error('Failed to load job logs:', err);
    } finally {
      setJobLogsLoading(false);
    }
  };

  const loadLogDetail = async (logId: number) => {
    if (logDetail[logId]) {
      setExpandedLogId(expandedLogId === logId ? null : logId);
      return;
    }
    setLogDetailLoading(logId);
    setExpandedLogId(logId);
    try {
      const detail = await api.getJobLog(logId);
      setLogDetail(prev => ({ ...prev, [logId]: detail }));
    } catch (err) {
      console.error('Failed to load log detail:', err);
    } finally {
      setLogDetailLoading(null);
    }
  };

  const handleCancelActivity = async (activityId: string, clientName: string, clientId?: string | number) => {
    setCancellingId(activityId);
    setCancelNotify(null);
    try {
      await api.stopActivity(activityId, clientId);
      setCancelNotify({ id: activityId, msg: `Cancelled backup for ${clientName}`, ok: true });
      setTimeout(() => setCancelNotify(null), 4000);
      // Give UrBackup a moment to remove the job from its progress list before refreshing
      await new Promise(r => setTimeout(r, 1500));
      await loadActivities();
    } catch (err: any) {
      setCancelNotify({ id: activityId, msg: err?.response?.data?.error || 'Failed to cancel backup', ok: false });
      setTimeout(() => setCancelNotify(null), 5000);
    } finally {
      setCancellingId(null);
    }
  };

  const handleClearStaleJobs = async () => {
    setShowClearConfirm(false);
    setClearingStaleJobs(true);
    setClearStaleResult(null);
    try {
      const result = await api.clearStaleJobs();
      setClearStaleResult({ found: result.staleJobsFound, stopped: result.staleJobsStopped });
      setTimeout(() => setClearStaleResult(null), 6000);
      // Reload activities to show updated list
      await loadActivities();
    } catch (err) {
      console.error('Failed to clear stale jobs:', err);
      setCancelNotify({ id: 'stale', msg: 'Failed to clear stale jobs', ok: false });
      setTimeout(() => setCancelNotify(null), 5000);
    } finally {
      setClearingStaleJobs(false);
    }
  };

  const getActivityType = (action: string | undefined | null): 'file' | 'image' => {
    if (!action || typeof action !== 'string') return 'file';
    return action.toLowerCase().includes('image') ? 'image' : 'file';
  };

  const calculateSpeed = (doneBytes: number, totalBytes: number, speedBpms?: number): string => {
    if (speedBpms && speedBpms > 0) {
      return `${formatBytes(speedBpms * 1000)}/s`;
    }
    return '--';
  };

  // Format ETA from UrBackup's own eta_ms field — matches what UrBackup server calculates
  const formatEta = (ms: number): string => {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  // Fallback ETA calculation when eta_ms is not available
  const estimateTimeRemaining = (doneBytes: number, totalBytes: number, speedBpms?: number): string => {
    if (!speedBpms || speedBpms <= 0 || doneBytes >= totalBytes) return '--';
    const remaining = totalBytes - doneBytes;
    const seconds = remaining / (speedBpms * 1000);

    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  // Get unique client names from activities
  const uniqueClients = Array.from(new Set([
    ...currentActivities.map((a: any) => a.name || a.client || ''),
    ...lastActivities.map((a: any) => a.name || a.client || '')
  ].filter(name => name !== ''))).sort();

  const filterByDateRange = (activity: any): boolean => {
    if (dateRange === 'all') return true;

    const backuptime = activity.backuptime || activity.time || 0;
    if (!backuptime) return false;

    const activityDate = new Date(backuptime * 1000);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - activityDate.getTime()) / (1000 * 60 * 60 * 24));

    if (dateRange === 'today') return diffDays === 0;
    if (dateRange === 'week') return diffDays <= 7;
    if (dateRange === 'month') return diffDays <= 30;
    return true;
  };

  const filteredCurrentActivities = currentActivities.filter(activity => {
    const activityData = activity as any;
    const action = activityData.action || activity.action || '';
    const type = getActivityType(action);
    const clientName = activityData.name || activityData.client || activity.client || '';

    if (activityType !== 'all' && type !== activityType) return false;
    if (selectedClient !== 'all' && clientName !== selectedClient) return false;
    return true;
  });

  const filteredLastActivities = lastActivities.filter(activity => {
    const activityData = activity as any;
    const action = activityData.action || activity.action || '';
    const type = getActivityType(action);
    const clientName = activityData.name || activityData.client || activity.client || '';

    if (activityType !== 'all' && type !== activityType) return false;
    if (selectedClient !== 'all' && clientName !== selectedClient) return false;
    if (!filterByDateRange(activityData)) return false;
    return true;
  });

  // Separate successful and failed activities
  // Last activities are completed backups from history - they have different fields
  const successfulActivities = filteredLastActivities.filter(activity => {
    const activityData = activity as any;

    // For completed backups (from lastActivities), they have: backuptime, duration, size_bytes, incremental
    // If it has backuptime, it's a completed historical backup
    if (activityData.backuptime !== undefined) {
      // Check if details field contains error indicators
      const details = (activityData.details || '').toLowerCase();
      const hasError = details.includes('error') || details.includes('failed');
      // Completed backups in history are successful unless details indicate error
      return !hasError;
    }

    // For current/running activities, check progress fields
    const pcdone = activityData.pcdone || activity.pcdone || 0;
    const errors = activityData.errors || activity.errors || 0;
    const success = activityData.success;

    // If success field exists, use it explicitly
    if (success !== undefined && success !== null) {
      // UrBackup uses 0 for success, other values for failure
      return success === 0 || success === true || success === 1 || success === '1';
    }

    // Otherwise: pcdone >= 99% and no errors means success
    return pcdone >= 99 && errors === 0;
  });

  const failedActivities = filteredLastActivities.filter(activity => {
    const activityData = activity as any;

    // For completed backups (from lastActivities)
    if (activityData.backuptime !== undefined) {
      // Check if details field contains error indicators
      const details = (activityData.details || '').toLowerCase();
      return details.includes('error') || details.includes('failed');
    }

    // For current/running activities
    const pcdone = activityData.pcdone || activity.pcdone || 0;
    const errors = activityData.errors || activity.errors || 0;
    const success = activityData.success;

    // If success field exists, use it explicitly
    if (success !== undefined && success !== null) {
      return success !== 0 && success !== true && success !== 1 && success !== '1';
    }

    // Otherwise: less than 99% complete or has errors means failure
    return pcdone < 99 || errors > 0;
  });

  // Calculate total backup storage from all clients
  const totalBackupStorage = clients.reduce((sum, client) => {
    const filesBytes = client.bytes_used_files || 0;
    const imagesBytes = client.bytes_used_images || 0;
    return sum + filesBytes + imagesBytes;
  }, 0);

  // Calculate avg speed from currently running backups
  const totalSpeed = currentActivities.reduce((sum, activity) => {
    const activityData = activity as any;
    return sum + (activityData.speed_bpms || 0);
  }, 0);
  const avgSpeed = currentActivities.length > 0 ? totalSpeed / currentActivities.length : 0;

  // Calculate total data being transferred in current activities
  const currentDataTransferred = currentActivities.reduce((sum, activity) => {
    const activityData = activity as any;
    return sum + (activityData.done_bytes || activity.done_bytes || 0);
  }, 0);

  // Show loading spinner while initial data loads
  if (loading) {
    return (
      <Layout>
        <Loading />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header with Stats */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              Backup Activities
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Real-time monitoring of backup operations
            </p>
          </div>
          <div className="flex items-center gap-3">
            {showClearConfirm ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-50 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-600">
                <span className="text-sm text-orange-800 dark:text-orange-200">Stop stuck jobs?</span>
                <button onClick={handleClearStaleJobs} className="px-2 py-1 text-xs rounded bg-orange-600 text-white hover:bg-orange-700">Yes</button>
                <button onClick={() => setShowClearConfirm(false)} className="px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300">No</button>
              </div>
            ) : clearStaleResult ? (
              <span className="text-sm text-green-700 dark:text-green-300 px-3 py-2">
                {clearStaleResult.found === 0 ? 'No stuck jobs found' : `Cleared ${clearStaleResult.stopped}/${clearStaleResult.found} stuck jobs`}
              </span>
            ) : (
              <button
                onClick={() => setShowClearConfirm(true)}
                disabled={clearingStaleJobs}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-800 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Stop and remove stale/stuck jobs"
              >
                <XCircle className={`h-4 w-4 ${clearingStaleJobs ? 'animate-spin' : ''}`} />
                {clearingStaleJobs ? 'Clearing...' : 'Clear Stale Jobs'}
              </button>
            )}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                autoRefresh
                  ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                  : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
              }`}
            >
              <RefreshCw className={`h-4 w-4 ${autoRefresh ? 'animate-spin' : ''}`} />
              {autoRefresh ? 'Auto Refresh' : 'Paused'}
            </button>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="card bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-600 rounded-xl">
                <ActivityIcon className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-xs text-gray-600 dark:text-gray-400">Active Jobs</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {currentActivities.length}
                </p>
              </div>
            </div>
          </div>

          <div className="card bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-600 rounded-xl">
                <HardDrive className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {currentActivities.length > 0 ? 'Data Transferred' : 'Total Backup Storage'}
                </p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {currentActivities.length > 0
                    ? formatBytes(currentDataTransferred)
                    : formatBytes(totalBackupStorage)}
                </p>
              </div>
            </div>
          </div>

          <div className="card bg-gradient-to-br from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/20">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-orange-600 rounded-xl">
                <Zap className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-xs text-gray-600 dark:text-gray-400">Avg Speed</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {currentActivities.length > 0 && avgSpeed > 0
                    ? `${formatBytes(avgSpeed * 1000)}/s`
                    : currentActivities.length > 0
                    ? 'Calculating...'
                    : 'Idle'}
                </p>
              </div>
            </div>
          </div>

          <div className="card bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-green-600 rounded-xl">
                <CheckCircle className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-xs text-gray-600 dark:text-gray-400">Completed</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {filteredLastActivities.length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="card">
          <div className="flex flex-col gap-4">
            {/* Status and Type Filters */}
            <div className="flex items-center gap-4">
              <Filter className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              <div className="flex gap-2">
                <button
                  onClick={() => setFilter('all')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filter === 'all'
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setFilter('running')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filter === 'running'
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  Running
                </button>
                <button
                  onClick={() => setFilter('completed')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filter === 'completed'
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  Completed
                </button>
              </div>
              <div className="h-6 w-px bg-gray-300 dark:bg-gray-600"></div>
              <div className="flex gap-2">
                <button
                  onClick={() => setActivityType('all')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activityType === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  All Types
                </button>
                <button
                  onClick={() => setActivityType('file')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activityType === 'file'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  Files
                </button>
                <button
                  onClick={() => setActivityType('image')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activityType === 'image'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  Images
                </button>
              </div>
            </div>

            {/* Client and Date Range Filters */}
            <div className="flex items-center gap-4 pl-9">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Client:
                </label>
                <select
                  value={selectedClient}
                  onChange={(e) => setSelectedClient(e.target.value)}
                  className="px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="all">All Clients</option>
                  {uniqueClients.map(client => (
                    <option key={client} value={client}>{client}</option>
                  ))}
                </select>
              </div>

              <div className="h-6 w-px bg-gray-300 dark:bg-gray-600"></div>

              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Time Range:
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDateRange('all')}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      dateRange === 'all'
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    All Time
                  </button>
                  <button
                    onClick={() => setDateRange('today')}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      dateRange === 'today'
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    Today
                  </button>
                  <button
                    onClick={() => setDateRange('week')}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      dateRange === 'week'
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    Last 7 Days
                  </button>
                  <button
                    onClick={() => setDateRange('month')}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      dateRange === 'month'
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    Last 30 Days
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Current Activities */}
        {(filter === 'all' || filter === 'running') && filteredCurrentActivities.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-lg">
                <Play className="h-5 w-5 text-white" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Running Backups
              </h2>
              <span className="px-2 py-1 text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded-full">
                {filteredCurrentActivities.length}
              </span>
            </div>

            {cancelNotify && (
              <div className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
                cancelNotify.ok
                  ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                  : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
              }`}>
                {cancelNotify.ok ? <CheckCircle className="h-4 w-4 flex-shrink-0" /> : <XCircle className="h-4 w-4 flex-shrink-0" />}
                {cancelNotify.msg}
              </div>
            )}

            <div className="grid gap-4">
              {filteredCurrentActivities.map((activity, index) => {
                const activityData = activity as any;
                const clientName = activityData.name || activityData.client || activity.client;
                const action = activityData.action || activity.action;
                const pcdone = activityData.pcdone || activity.pcdone || 0;
                const doneBytes = activityData.done_bytes || activity.done_bytes || 0;
                const totalBytes = activityData.total_bytes || activity.total_bytes || 0;
                const speed = activityData.speed_bpms || 0;
                const etaMs: number | null = activityData.eta_ms || null;
                const isPaused = activityData.paused || false;
                const type = getActivityType(action);

                return (
                  <div
                    key={activityData.id || index}
                    className="card hover:shadow-lg transition-shadow border-l-4 border-blue-500"
                  >
                    <div className="space-y-3">
                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${
                            type === 'image'
                              ? 'bg-purple-100 dark:bg-purple-900'
                              : 'bg-blue-100 dark:bg-blue-900'
                          }`}>
                            <Server className={`h-5 w-5 ${
                              type === 'image'
                                ? 'text-purple-600 dark:text-purple-400'
                                : 'text-blue-600 dark:text-blue-400'
                            }`} />
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                              {clientName}
                            </h3>
                            <p className="text-xs text-gray-600 dark:text-gray-400">
                              {action || 'Backup in progress'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {isPaused && (
                            <span className="flex items-center gap-1 px-2 py-1 text-xs font-semibold bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 rounded">
                              <Pause className="h-3 w-3" />
                              Paused
                            </span>
                          )}
                          <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                            {pcdone.toFixed(0)}%
                          </span>
                          {activityData.process_id && <button
                            onClick={() => handleCancelActivity(String(activityData.process_id), clientName, activityData.clientid)}
                            disabled={cancellingId === String(activityData.process_id)}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/70 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title="Cancel this backup"
                          >
                            <StopCircle className="h-3.5 w-3.5" />
                            {cancellingId === String(activityData.process_id) ? 'Cancelling…' : 'Cancel'}
                          </button>}
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="relative">
                        <div className="h-3 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                          <div
                            className="h-3 rounded-full bg-gradient-to-r from-blue-500 to-blue-600 dark:from-blue-600 dark:to-blue-700 transition-all duration-500 ease-out relative overflow-hidden"
                            style={{ width: `${Math.min(pcdone, 100)}%` }}
                          >
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"></div>
                          </div>
                        </div>
                      </div>

                      {/* Stats Grid */}
                      <div className="grid grid-cols-3 gap-4 pt-2">
                        <div className="flex items-center gap-2">
                          <HardDrive className="h-4 w-4 text-gray-400" />
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-500">Data</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                              {totalBytes > 0
                                ? `${formatBytes(doneBytes)} / ${formatBytes(totalBytes)}`
                                : formatBytes(doneBytes) || 'Calculating...'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Zap className="h-4 w-4 text-orange-500" />
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-500">Speed</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                              {calculateSpeed(doneBytes, totalBytes, speed)}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-purple-500" />
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-500">ETA</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                              {etaMs && etaMs > 0 ? formatEta(etaMs) : estimateTimeRemaining(doneBytes, totalBytes, speed)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Failed Activities - Grouped and Collapsible */}
        {(filter === 'all' || filter === 'completed') && failedActivities.length > 0 && (
          <div className="space-y-4">
            <div
              className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setShowFailedDetails(!showFailedDetails)}
            >
              <div className="p-2 bg-red-600 rounded-lg">
                <XCircle className="h-5 w-5 text-white" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Failed Backups
              </h2>
              <span className="px-2 py-1 text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 rounded-full">
                {failedActivities.length}
              </span>
              <ChevronDown className={`h-5 w-5 text-gray-400 transition-transform ${showFailedDetails ? 'rotate-180' : ''}`} />
            </div>

            {showFailedDetails && (
              <div className="grid gap-2">
                {failedActivities.slice(0, 20).map((activity, index) => {
                  const activityData = activity as any;
                  const clientName = activityData.name || activityData.client || activity.client;
                  const action = activityData.action || activity.action;

                  // For completed backups, try size_bytes, otherwise done_bytes
                  const sizeBytes = activityData.size_bytes || 0;
                  const doneBytes = activityData.done_bytes || activity.done_bytes || 0;
                  const displayBytes = sizeBytes > 0 ? sizeBytes : doneBytes;

                  // Determine backup type
                  const isIncremental = activityData.incremental > 0;
                  const isImageBackup = activityData.type === 'image' || activityData.image === 1 || (action && typeof action === 'string' && action.toLowerCase().includes('image'));
                  const backupType = isImageBackup ? 'Image' : (isIncremental ? 'Incremental' : 'Full');

                  // Partition info for image backups
                  const letters = activityData.letters;
                  const partitionCount = activityData.partition_count;
                  const partitionStr = letters ? ` (${letters})` : (partitionCount > 1 ? ` (${partitionCount} partitions)` : '');

                  // Get error details if available
                  const details = activityData.details || '';

                  return (
                    <div
                      key={`failed-${activityData.id || index}`}
                      className="card hover:shadow-sm transition-all border-l-4 border-red-500 bg-red-50/30 dark:bg-red-900/5 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                              {clientName}
                            </p>
                            <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                              {backupType} Backup{partitionStr}{details ? ` • ${details}` : ''}{displayBytes > 0 ? ` • ${formatBytes(displayBytes)}` : ''}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Successful Activities */}
        {(filter === 'all' || filter === 'completed') && successfulActivities.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-600 rounded-lg">
                <CheckCircle className="h-5 w-5 text-white" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Successful Backups
              </h2>
              <span className="px-2 py-1 text-xs font-semibold bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 rounded-full">
                {successfulActivities.length}
              </span>
            </div>

            <div className="grid gap-2">
              {successfulActivities.slice(0, 10).map((activity, index) => {
                const activityData = activity as any;
                const clientName = activityData.name || activityData.client || activity.client;
                const action = activityData.action || activity.action;

                // For completed backups, try size_bytes, otherwise done_bytes
                const sizeBytes = activityData.size_bytes || 0;
                const doneBytes = activityData.done_bytes || activity.done_bytes || 0;
                const displayBytes = sizeBytes > 0 ? sizeBytes : doneBytes;

                // Determine backup type from activity data
                const isIncremental = activityData.incremental > 0;
                const isImageBackup = activityData.type === 'image' || activityData.image === 1 || (action && typeof action === 'string' && action.toLowerCase().includes('image'));
                const backupType = isImageBackup ? 'Image' : (isIncremental ? 'Incremental' : 'Full');

                // Partition info for image backups
                const letters = activityData.letters;
                const partitionCount = activityData.partition_count;
                const partitionStr = letters ? ` (${letters})` : (partitionCount > 1 ? ` (${partitionCount} partitions)` : '');

                // Format duration if available (for completed backups)
                const duration = activityData.duration;
                let durationStr = '';
                if (duration) {
                  if (duration < 60) durationStr = `${duration}s`;
                  else if (duration < 3600) durationStr = `${Math.round(duration / 60)}m`;
                  else durationStr = `${Math.round(duration / 3600)}h ${Math.round((duration % 3600) / 60)}m`;
                }

                return (
                  <div
                    key={`success-${activityData.id || index}`}
                    className="card hover:shadow-sm transition-all border-l-4 border-green-500 bg-green-50/30 dark:bg-green-900/5 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                            {clientName}
                          </p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                            {backupType} Backup{partitionStr}{durationStr ? ` • ${durationStr}` : ''}{displayBytes > 0 ? ` • ${formatBytes(displayBytes)}` : ''}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Job Logs */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-600 rounded-lg">
                <FileText className="h-5 w-5 text-white" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Job Logs</h2>
              {jobLogs.length > 0 && (
                <span className="px-2 py-1 text-xs font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300 rounded-full">
                  {jobLogs.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showErrorsOnly}
                  onChange={e => setShowErrorsOnly(e.target.checked)}
                  className="rounded"
                />
                Errors only
              </label>
              <button
                onClick={loadJobLogs}
                disabled={jobLogsLoading}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${jobLogsLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {jobLogsLoading && jobLogs.length === 0 ? (
            <div className="card py-8 text-center text-sm text-gray-500 dark:text-gray-400">Loading job logs...</div>
          ) : (
            <div className="space-y-1">
              {(() => {
                const filtered = showErrorsOnly ? jobLogs.filter(j => j.errors > 0) : jobLogs;
                if (filtered.length === 0) return (
                  <div className="card py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                    {showErrorsOnly ? 'No failed jobs found' : 'No job logs available'}
                  </div>
                );
                return filtered.map((job: any) => {
                  const isExpanded = expandedLogId === job.id;
                  const detail = logDetail[job.id];
                  const isLoading = logDetailLoading === job.id;
                  const hasErrors = job.errors > 0;
                  const jobTime = job.time ? new Date(job.time * 1000) : null;
                  const timeStr = jobTime ? jobTime.toLocaleString() : '';
                  const typeStr = job.image ? 'Image' : (job.incremental ? 'Incremental File' : 'Full File');

                  return (
                    <div key={job.id} className={`rounded-lg border overflow-hidden ${
                      hasErrors
                        ? 'border-red-200 dark:border-red-800'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}>
                      <button
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                          hasErrors
                            ? 'bg-red-50 dark:bg-red-900/10 hover:bg-red-100 dark:hover:bg-red-900/20'
                            : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750'
                        }`}
                        onClick={() => loadLogDetail(job.id)}
                      >
                        <div className="flex-shrink-0">
                          {hasErrors
                            ? <XCircle className="h-4 w-4 text-red-500" />
                            : job.warnings > 0
                              ? <AlertTriangle className="h-4 w-4 text-yellow-500" />
                              : <CheckCircle className="h-4 w-4 text-green-500" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-gray-900 dark:text-gray-100">{job.name}</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">{typeStr}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-xs text-gray-500 dark:text-gray-400">{timeStr}</span>
                            {hasErrors && <span className="text-xs font-medium text-red-600 dark:text-red-400">{job.errors} error{job.errors !== 1 ? 's' : ''}</span>}
                            {job.warnings > 0 && <span className="text-xs font-medium text-yellow-600 dark:text-yellow-400">{job.warnings} warning{job.warnings !== 1 ? 's' : ''}</span>}
                          </div>
                        </div>
                        <ChevronDown className={`h-4 w-4 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </button>

                      {isExpanded && (
                        <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3 max-h-96 overflow-y-auto">
                          {isLoading ? (
                            <p className="text-sm text-gray-500 dark:text-gray-400 py-2">Loading log...</p>
                          ) : detail ? (
                            <div className="space-y-0.5 font-mono text-xs">
                              {detail.entries.map((entry, i) => (
                                <div key={i} className={`flex gap-2 py-0.5 ${
                                  entry.severity === 2 ? 'text-red-700 dark:text-red-400' :
                                  entry.severity === 1 ? 'text-yellow-700 dark:text-yellow-400' :
                                  'text-gray-700 dark:text-gray-400'
                                }`}>
                                  <span className="flex-shrink-0 w-4">
                                    {entry.severity === 2 ? <XCircle className="h-3 w-3 mt-0.5" /> :
                                     entry.severity === 1 ? <AlertTriangle className="h-3 w-3 mt-0.5" /> :
                                     <Info className="h-3 w-3 mt-0.5" />}
                                  </span>
                                  <span className="break-words whitespace-pre-wrap">{entry.message}</span>
                                </div>
                              ))}
                              {detail.entries.length === 0 && (
                                <p className="text-gray-500 dark:text-gray-400 py-2">No log entries found.</p>
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-500 dark:text-gray-400 py-2">Failed to load log.</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>

        {/* Empty State */}
        {currentActivities.length === 0 && lastActivities.length === 0 && !loading && (
          <div className="card text-center py-16">
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-full">
                <ActivityIcon className="h-12 w-12 text-gray-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  No Active Backups
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Start a backup from the Clients page to see activity here
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
      `}</style>
    </Layout>
  );
}
