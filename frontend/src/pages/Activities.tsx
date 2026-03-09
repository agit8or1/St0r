import { useEffect, useState } from 'react';
import {
  Activity as ActivityIcon,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
  HardDrive,
  Pause,
  RefreshCw,
  ChevronDown,
  StopCircle,
  AlertTriangle,
  Info,
  Filter,
  Server,
  Play,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import { Tooltip } from '../components/Tooltip';
import { api } from '../services/api';
import type { Activity } from '../types';
import { formatBytes } from '../utils/format';

type StatusFilter = 'all' | 'running' | 'successful' | 'errors';
type ActivityType = 'file' | 'image' | 'all';
type DateRangeFilter = 'all' | 'today' | 'week' | 'month';

export function Activities() {
  const [currentActivities, setCurrentActivities] = useState<Activity[]>([]);
  const [lastActivities, setLastActivities] = useState<Activity[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [activityType, setActivityType] = useState<ActivityType>('all');
  const [selectedClient, setSelectedClient] = useState<string>('all');
  const [dateRange, setDateRange] = useState<DateRangeFilter>('today');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [clearingStaleJobs, setClearingStaleJobs] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelNotify, setCancelNotify] = useState<{ id: string; msg: string; ok: boolean } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearStaleResult, setClearStaleResult] = useState<{ found: number; stopped: number } | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [logDetail, setLogDetail] = useState<Record<number, { clientname: string; entries: { severity: number; time: number; message: string }[] }>>({});
  const [logDetailLoading, setLogDetailLoading] = useState<number | null>(null);

  useEffect(() => {
    loadActivities();
    loadClients();
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

  const loadLogDetail = async (logId: number) => {
    if (expandedLogId === logId) {
      setExpandedLogId(null);
      return;
    }
    setExpandedLogId(logId);
    if (logDetail[logId]) return;
    setLogDetailLoading(logId);
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
      setCancelNotify({ id: activityId, msg: `Stop signal sent for ${clientName} — backup may take a moment to stop`, ok: true });
      setTimeout(() => setCancelNotify(null), 4000);
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

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
  };

  const formatEta = (ms: number): string => {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const formatDate = (ms: number): string =>
    new Date(ms).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  // Unique client names for the dropdown
  const uniqueClients = Array.from(new Set([
    ...currentActivities.map((a: any) => a.name || a.client || ''),
    ...lastActivities.map((a: any) => a.clientName || a.name || a.client || ''),
  ].filter(Boolean))).sort();

  // Filter helpers
  const matchesType = (isImage: boolean) =>
    activityType === 'all' || (activityType === 'image' ? isImage : !isImage);

  const matchesClient = (name: string) =>
    selectedClient === 'all' || name === selectedClient;

  const matchesDate = (ms: number): boolean => {
    if (dateRange === 'all') return true;
    const diffDays = (Date.now() - ms) / 86400000;
    if (dateRange === 'today') return diffDays < 1;
    if (dateRange === 'week') return diffDays <= 7;
    if (dateRange === 'month') return diffDays <= 30;
    return true;
  };

  // Filtered current (running) activities
  const filteredRunning = currentActivities.filter(a => {
    const d = a as any;
    const clientName = d.name || d.client || a.client || '';
    const isImage = getActivityType(d.action || a.action) === 'image';
    return matchesType(isImage) && matchesClient(clientName);
  });

  // Filtered history (completed) activities
  const filteredHistory = lastActivities.filter(a => {
    const d = a as any;
    const clientName = d.clientName || d.name || d.client || a.client || '';
    const isImage = d.type === 'image';
    const errors: number = d.errors || 0;
    if (!matchesType(isImage)) return false;
    if (!matchesClient(clientName)) return false;
    if (!matchesDate(d.backuptime || 0)) return false;
    if (statusFilter === 'successful' && errors > 0) return false;
    if (statusFilter === 'errors' && errors === 0) return false;
    return true;
  });

  // Stats
  const totalStorage = clients.reduce((s, c) => s + (c.bytes_used_files || 0) + (c.bytes_used_images || 0), 0);
  const errorsToday = lastActivities.filter(a => {
    const d = a as any;
    return (d.errors || 0) > 0 && matchesDate(d.backuptime || 0);
  }).length;
  const completedToday = lastActivities.filter(a => matchesDate((a as any).backuptime || 0)).length;

  if (loading) return <Layout><Loading /></Layout>;

  const showRunning = statusFilter === 'all' || statusFilter === 'running';
  const showHistory = statusFilter !== 'running';

  return (
    <Layout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Backup Jobs</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">All backup activity — running and history</p>
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
              <Tooltip text="Stop and remove backup jobs that are stuck or not responding">
                <button
                  onClick={() => setShowClearConfirm(true)}
                  disabled={clearingStaleJobs}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-800 disabled:opacity-50"
                >
                  <XCircle className={`h-4 w-4 ${clearingStaleJobs ? 'animate-spin' : ''}`} />
                  {clearingStaleJobs ? 'Clearing...' : 'Clear Stale'}
                </button>
              </Tooltip>
            )}
            <Tooltip text={autoRefresh ? 'Auto-refresh on — click to pause' : 'Click to enable auto-refresh'}>
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  autoRefresh ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                }`}
              >
                <RefreshCw className={`h-4 w-4 ${autoRefresh ? 'animate-spin' : ''}`} />
                {autoRefresh ? 'Live' : 'Paused'}
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="card bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-600 rounded-xl"><ActivityIcon className="h-6 w-6 text-white" /></div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Running</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{currentActivities.length}</p>
              </div>
            </div>
          </div>
          <div className="card bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-green-600 rounded-xl"><CheckCircle className="h-6 w-6 text-white" /></div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Completed Today</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{completedToday}</p>
              </div>
            </div>
          </div>
          <div className="card bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-900/20 dark:to-orange-900/20">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-red-600 rounded-xl"><XCircle className="h-6 w-6 text-white" /></div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Errors Today</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{errorsToday}</p>
              </div>
            </div>
          </div>
          <div className="card bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-600 rounded-xl"><HardDrive className="h-6 w-6 text-white" /></div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Total Storage</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatBytes(totalStorage)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="card">
          <div className="flex flex-wrap items-center gap-4">
            <Filter className="h-4 w-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />

            {/* Status */}
            <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
              {([
                ['all', 'All', ''],
                ['running', 'Running', 'text-blue-600'],
                ['successful', 'Successful', 'text-green-600'],
                ['errors', 'With Errors', 'text-red-600'],
              ] as [StatusFilter, string, string][]).map(([val, label]) => (
                <button key={val} onClick={() => setStatusFilter(val)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    statusFilter === val
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}>{label}</button>
              ))}
            </div>

            <div className="h-6 w-px bg-gray-200 dark:bg-gray-700" />

            {/* Type */}
            <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
              {([['all', 'All Types'], ['file', 'Files'], ['image', 'Images']] as [ActivityType, string][]).map(([val, label]) => (
                <button key={val} onClick={() => setActivityType(val)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    activityType === val
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}>{label}</button>
              ))}
            </div>

            <div className="h-6 w-px bg-gray-200 dark:bg-gray-700" />

            {/* Client */}
            <select
              value={selectedClient}
              onChange={e => setSelectedClient(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">All Clients</option>
              {uniqueClients.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            {/* Date Range */}
            <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
              {([['all', 'All Time'], ['today', 'Today'], ['week', '7 Days'], ['month', '30 Days']] as [DateRangeFilter, string][]).map(([val, label]) => (
                <button key={val} onClick={() => setDateRange(val)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    dateRange === val
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}>{label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Cancel notification */}
        {cancelNotify && (
          <div className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
            cancelNotify.ok ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
          }`}>
            {cancelNotify.ok ? <CheckCircle className="h-4 w-4 flex-shrink-0" /> : <XCircle className="h-4 w-4 flex-shrink-0" />}
            {cancelNotify.msg}
          </div>
        )}

        {/* Running Backups */}
        {showRunning && filteredRunning.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-blue-600 rounded-lg"><Play className="h-4 w-4 text-white" /></div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Running</h2>
              <span className="px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded-full">{filteredRunning.length}</span>
            </div>
            <div className="grid gap-4">
              {filteredRunning.map((activity, index) => {
                const d = activity as any;
                const clientName = d.name || d.client || activity.client;
                const action = d.action || activity.action;
                const pcdone = d.pcdone || activity.pcdone || 0;
                const doneBytes = d.done_bytes || activity.done_bytes || 0;
                const totalBytes = d.total_bytes || activity.total_bytes || 0;
                const speed = d.speed_bpms || 0;
                const etaMs: number | null = d.eta_ms || null;
                const isPaused = d.paused || false;
                const isImage = getActivityType(action) === 'image';

                return (
                  <div key={d.id || index} className="card border-l-4 border-blue-500 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${isImage ? 'bg-purple-100 dark:bg-purple-900' : 'bg-blue-100 dark:bg-blue-900'}`}>
                          <Server className={`h-5 w-5 ${isImage ? 'text-purple-600 dark:text-purple-400' : 'text-blue-600 dark:text-blue-400'}`} />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900 dark:text-gray-100">{clientName}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{action || 'Backup in progress'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {isPaused && (
                          <span className="flex items-center gap-1 px-2 py-1 text-xs font-semibold bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 rounded">
                            <Pause className="h-3 w-3" />Paused
                          </span>
                        )}
                        <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">{pcdone.toFixed(0)}%</span>
                        {d.process_id && (
                          <Tooltip text="Stop this backup job">
                            <button
                              onClick={() => handleCancelActivity(String(d.process_id), clientName, d.clientid)}
                              disabled={cancellingId === String(d.process_id)}
                              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/70 disabled:opacity-50 transition-colors"
                            >
                              <StopCircle className="h-3.5 w-3.5" />
                              {cancellingId === String(d.process_id) ? 'Cancelling…' : 'Cancel'}
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    </div>

                    <div className="h-2.5 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                      <div
                        className="h-2.5 rounded-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-500 relative overflow-hidden"
                        style={{ width: `${Math.min(pcdone, 100)}%` }}
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 pt-1">
                      <div className="flex items-center gap-2">
                        <HardDrive className="h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-xs text-gray-500">Data</p>
                          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {totalBytes > 0 ? `${formatBytes(doneBytes)} / ${formatBytes(totalBytes)}` : formatBytes(doneBytes) || 'Calculating...'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-orange-500" />
                        <div>
                          <p className="text-xs text-gray-500">Speed</p>
                          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {speed > 0 ? `${formatBytes(speed * 1000)}/s` : '--'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-purple-500" />
                        <div>
                          <p className="text-xs text-gray-500">ETA</p>
                          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {etaMs && etaMs > 0 ? formatEta(etaMs) : '--'}
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

        {/* Backup History */}
        {showHistory && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Backup History</h2>
              <span className="px-2 py-0.5 text-xs font-semibold bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 rounded-full">{filteredHistory.length}</span>
            </div>

            {filteredHistory.length === 0 ? (
              <div className="card py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                No backup jobs match the current filters
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                {/* Table header */}
                <div className="hidden sm:grid grid-cols-[20px_1fr_1fr_170px_110px_70px_90px_90px] gap-x-4 items-center px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  <span />
                  <span>Client</span>
                  <span>Customer</span>
                  <span>Date / Time</span>
                  <span>Type</span>
                  <span className="text-right">Duration</span>
                  <span className="text-right">Size</span>
                  <span>Issues</span>
                </div>

                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredHistory.map((activity, index) => {
                    const d = activity as any;
                    const clientName = d.clientName || d.name || d.client || activity.client || 'Unknown';
                    const customerName: string | null = d.customerName || null;
                    const errors: number = d.errors || 0;
                    const warnings: number = d.warnings || 0;
                    const hasErrors = errors > 0;
                    const hasWarnings = warnings > 0 && !hasErrors;
                    const sizeBytes: number = d.size_bytes || d.done_bytes || activity.done_bytes || 0;
                    const isIncremental: boolean = d.incremental === true || d.incremental === 1;
                    const isImage: boolean = d.type === 'image';
                    const letters: string | null = d.letters || null;
                    const duration: number | null = d.duration || null;
                    const backuptime: number = d.backuptime || 0;
                    const logId: number | null = d.log_id || null;
                    const isExpanded = logId !== null && expandedLogId === logId;

                    const typeLabel = isImage
                      ? `Image${letters ? ` (${letters})` : ''}`
                      : isIncremental ? 'Incr. File' : 'Full File';

                    const statusIcon = hasErrors
                      ? <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                      : hasWarnings
                      ? <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                      : <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />;

                    const rowBg = hasErrors
                      ? 'bg-red-50/40 dark:bg-red-900/5 hover:bg-red-50 dark:hover:bg-red-900/10'
                      : hasWarnings
                      ? 'bg-yellow-50/40 dark:bg-yellow-900/5 hover:bg-yellow-50 dark:hover:bg-yellow-900/10'
                      : 'bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50';

                    const borderLeft = hasErrors ? 'border-l-2 border-red-400' : hasWarnings ? 'border-l-2 border-yellow-400' : 'border-l-2 border-green-400';

                    return (
                      <div key={`job-${d.id || index}`}>
                        {/* Job row */}
                        <div
                          className={`${rowBg} ${borderLeft} transition-colors ${logId ? 'cursor-pointer' : ''}`}
                          onClick={() => logId && loadLogDetail(logId)}
                        >
                          {/* Mobile layout */}
                          <div className="sm:hidden flex items-start gap-3 px-4 py-3">
                            <div className="mt-0.5">{statusIcon}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{clientName}</p>
                                  {customerName && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{customerName}</p>}
                                </div>
                                <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap flex-shrink-0">
                                  {backuptime ? formatDate(backuptime) : ''}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 mt-1 flex-wrap">
                                <span className="text-xs text-gray-500 dark:text-gray-400">{typeLabel}</span>
                                {duration && <span className="text-xs text-gray-500 dark:text-gray-400">{formatDuration(duration)}</span>}
                                {sizeBytes > 0 && <span className="text-xs text-gray-500 dark:text-gray-400">{formatBytes(sizeBytes)}</span>}
                                {errors > 0 && <span className="flex items-center gap-0.5 text-xs font-medium text-red-600 dark:text-red-400"><XCircle className="h-3 w-3" />{errors}</span>}
                                {warnings > 0 && <span className="flex items-center gap-0.5 text-xs font-medium text-yellow-600 dark:text-yellow-400"><AlertTriangle className="h-3 w-3" />{warnings}</span>}
                              </div>
                            </div>
                            {logId && <ChevronDown className={`h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />}
                          </div>

                          {/* Desktop layout */}
                          <div className="hidden sm:grid grid-cols-[20px_1fr_1fr_170px_110px_70px_90px_90px] gap-x-4 items-center px-4 py-3">
                            <div>{statusIcon}</div>
                            <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{clientName}</p>
                            <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                              {customerName || <span className="text-gray-300 dark:text-gray-600">—</span>}
                            </p>
                            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                              {backuptime ? formatDate(backuptime) : '—'}
                            </span>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded inline-block w-fit whitespace-nowrap ${
                              isImage ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                                      : isIncremental ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                            }`}>{typeLabel}</span>
                            <span className="text-sm text-gray-700 dark:text-gray-300 text-right">
                              {duration ? formatDuration(duration) : '—'}
                            </span>
                            <span className="text-sm text-gray-700 dark:text-gray-300 text-right">
                              {sizeBytes > 0 ? formatBytes(sizeBytes) : '—'}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {errors > 0 && (
                                <Tooltip text={`${errors} error${errors !== 1 ? 's' : ''}`}>
                                  <span className="flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300 rounded">
                                    <XCircle className="h-3 w-3" />{errors}
                                  </span>
                                </Tooltip>
                              )}
                              {warnings > 0 && (
                                <Tooltip text={`${warnings} warning${warnings !== 1 ? 's' : ''}`}>
                                  <span className="flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-semibold bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300 rounded">
                                    <AlertTriangle className="h-3 w-3" />{warnings}
                                  </span>
                                </Tooltip>
                              )}
                              {!errors && !warnings && <span className="text-xs text-gray-400">—</span>}
                              {logId && <ChevronDown className={`h-4 w-4 text-gray-400 ml-auto transition-transform ${isExpanded ? 'rotate-180' : ''}`} />}
                            </div>
                          </div>
                        </div>

                        {/* Expanded log */}
                        {isExpanded && logId && (
                          <div className="border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-6 py-3 max-h-80 overflow-y-auto">
                            {logDetailLoading === logId ? (
                              <p className="text-sm text-gray-500 py-2">Loading log...</p>
                            ) : logDetail[logId] ? (
                              <div className="space-y-0.5 font-mono text-xs">
                                {logDetail[logId].entries.map((entry, i) => (
                                  <div key={i} className={`flex gap-2 py-0.5 ${
                                    entry.severity === 2 ? 'text-red-700 dark:text-red-400' :
                                    entry.severity === 1 ? 'text-yellow-700 dark:text-yellow-400' :
                                    'text-gray-600 dark:text-gray-400'
                                  }`}>
                                    <span className="flex-shrink-0 w-4 mt-0.5">
                                      {entry.severity === 2 ? <XCircle className="h-3 w-3" /> :
                                       entry.severity === 1 ? <AlertTriangle className="h-3 w-3" /> :
                                       <Info className="h-3 w-3" />}
                                    </span>
                                    <span className="break-words whitespace-pre-wrap leading-relaxed">{entry.message}</span>
                                  </div>
                                ))}
                                {logDetail[logId].entries.length === 0 && (
                                  <p className="text-gray-400 py-2">No log entries.</p>
                                )}
                              </div>
                            ) : (
                              <p className="text-sm text-gray-500 py-2">Failed to load log.</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {currentActivities.length === 0 && lastActivities.length === 0 && (
          <div className="card text-center py-16">
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-full">
                <ActivityIcon className="h-12 w-12 text-gray-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">No Backup Jobs Yet</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Start a backup from the Clients page to see activity here</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        .animate-shimmer { animation: shimmer 2s infinite; }
      `}</style>
    </Layout>
  );
}
