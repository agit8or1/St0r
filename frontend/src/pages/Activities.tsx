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
  ChevronDown
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

  const estimateTimeRemaining = (doneBytes: number, totalBytes: number, speedBpms?: number): string => {
    if (!speedBpms || speedBpms <= 0 || doneBytes >= totalBytes) return '--';
    const remaining = totalBytes - doneBytes;
    const seconds = remaining / (speedBpms * 1000);

    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
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
                  {lastActivities.length}
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

            <div className="grid gap-4">
              {filteredCurrentActivities.map((activity, index) => {
                const activityData = activity as any;
                const clientName = activityData.name || activityData.client || activity.client;
                const action = activityData.action || activity.action;
                const pcdone = activityData.pcdone || activity.pcdone || 0;
                const doneBytes = activityData.done_bytes || activity.done_bytes || 0;
                const totalBytes = activityData.total_bytes || activity.total_bytes || 0;
                const speed = activityData.speed_bpms || 0;
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
                        <div className="flex items-center gap-2">
                          {isPaused && (
                            <span className="flex items-center gap-1 px-2 py-1 text-xs font-semibold bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 rounded">
                              <Pause className="h-3 w-3" />
                              Paused
                            </span>
                          )}
                          <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                            {pcdone.toFixed(0)}%
                          </span>
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
                              {formatBytes(doneBytes)} / {formatBytes(totalBytes)}
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
                              {estimateTimeRemaining(doneBytes, totalBytes, speed)}
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
                  const isImageBackup = activityData.image === 1 || (action && typeof action === 'string' && action.toLowerCase().includes('image'));
                  const backupType = isImageBackup ? 'Image' : (isIncremental ? 'Incremental' : 'Full');

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
                              {backupType} Backup{details ? ` • ${details}` : ''}{displayBytes > 0 ? ` • ${formatBytes(displayBytes)}` : ''}
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
                const isImageBackup = activityData.image === 1 || (action && typeof action === 'string' && action.toLowerCase().includes('image'));
                const backupType = isImageBackup ? 'Image' : (isIncremental ? 'Incremental' : 'Full');

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
                            {backupType} Backup{durationStr ? ` • ${durationStr}` : ''}{displayBytes > 0 ? ` • ${formatBytes(displayBytes)}` : ''}
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
