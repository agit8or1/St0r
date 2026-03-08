import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GitBranch, RefreshCw, Plus, Play, Settings2, Trash2, CheckCircle,
  AlertCircle, Clock, Loader2, ChevronRight, Bell, Info
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Tooltip } from '../components/Tooltip';
import { ReplicationTargetModal } from '../components/ReplicationTargetModal';
import { api } from '../services/api';
import type {
  ReplicationSettings, ReplicationTarget, ReplicationRun,
  ReplicationEvent, ReplicationAlertChannel, ReplicationTargetStatus
} from '../types';
import { formatBytes } from '../utils/format';

type Tab = 'overview' | 'targets' | 'settings' | 'alerts';

const STATUS_DESCRIPTIONS: Record<string, string> = {
  success: 'Last run completed without errors',
  running: 'Replication is actively syncing right now',
  failed: 'Last run encountered an error',
  queued: 'Waiting to be picked up by the scheduler',
  canceled: 'Run was manually stopped before completion',
  stale: 'No successful run within the staleness window',
};

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { cls: string; icon: JSX.Element }> = {
    success: { cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300', icon: <CheckCircle className="h-3 w-3" /> },
    running: { cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    failed: { cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300', icon: <AlertCircle className="h-3 w-3" /> },
    queued: { cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300', icon: <Clock className="h-3 w-3" /> },
    canceled: { cls: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300', icon: <AlertCircle className="h-3 w-3" /> },
    stale: { cls: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300', icon: <Clock className="h-3 w-3" /> },
  };
  const s = cfg[status] || cfg.stale;
  const desc = STATUS_DESCRIPTIONS[status] || status;
  return (
    <Tooltip text={desc}>
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
        {s.icon} {status}
      </span>
    </Tooltip>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const cls = severity === 'critical' ? 'text-red-600 dark:text-red-400' :
    severity === 'warn' ? 'text-yellow-600 dark:text-yellow-400' : 'text-blue-600 dark:text-blue-400';
  const desc = severity === 'critical' ? 'Critical — immediate attention required' :
    severity === 'warn' ? 'Warning — degraded but not failed' : 'Informational event';
  return (
    <Tooltip text={desc}>
      <span className={`text-xs font-medium ${cls}`}>{severity}</span>
    </Tooltip>
  );
}

function formatDuration(started: string, finished: string | null): string {
  if (!finished) return '—';
  const s = Math.round((new Date(finished).getTime() - new Date(started).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function formatLag(sec: number | null): string {
  if (sec === null || sec === undefined) return '—';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}

export function Replication() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');

  // Data
  const [statuses, setStatuses] = useState<ReplicationTargetStatus[]>([]);
  const [runs, setRuns] = useState<ReplicationRun[]>([]);
  const [events, setEvents] = useState<ReplicationEvent[]>([]);
  const [settings, setSettings] = useState<ReplicationSettings | null>(null);
  const [channels, setChannels] = useState<ReplicationAlertChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modals / actions
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [editTarget, setEditTarget] = useState<ReplicationTarget | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; checks: Record<string, any> } | null>(null);

  // Settings form
  const [settingsForm, setSettingsForm] = useState<Partial<ReplicationSettings>>({});
  const [savingSettings, setSavingSettings] = useState(false);

  // Alerts form
  const [newChannelType, setNewChannelType] = useState<'email' | 'webhook'>('email');
  const [newChannelConfig, setNewChannelConfig] = useState('');
  const [savingChannel, setSavingChannel] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // State set editor
  const [includePaths, setIncludePaths] = useState<string[]>([]);
  const [repoPaths, setRepoPaths] = useState<string[]>([]);
  const [excludePatterns, setExcludePatterns] = useState<string[]>([]);
  const [dbSqlitePath, setDbSqlitePath] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [s, r, e] = await Promise.all([
        api.getReplicationStatus(),
        api.getReplicationRuns(undefined, 20),
        api.getReplicationEvents(undefined, 20),
      ]);
      setStatuses(s);
      setRuns(r);
      setEvents(e);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const s = await api.getReplicationSettings();
      setSettings(s);
      setSettingsForm({
        enabled: s.enabled,
        concurrency: s.concurrency,
        trigger_mode: s.trigger_mode,
        schedule_type: s.schedule_type,
        interval_seconds: s.interval_seconds,
        cron_expression: s.cron_expression,
        debounce_seconds: s.debounce_seconds,
        max_staleness_minutes: s.max_staleness_minutes,
        default_bandwidth_limit_mbps: s.default_bandwidth_limit_mbps,
        default_verify_after_sync: s.default_verify_after_sync,
        default_checksum_verify: s.default_checksum_verify,
        pause_during_active_backup: s.pause_during_active_backup,
      });
      if (s.state_set_json) {
        setIncludePaths(s.state_set_json.include_paths || []);
        setRepoPaths(s.state_set_json.repo_paths || []);
        setExcludePatterns(s.state_set_json.exclude_patterns || []);
        setDbSqlitePath(s.state_set_json.db?.sqlite_path || '');
      }
    } catch {}
  }, []);

  const loadChannels = useCallback(async () => {
    try {
      const c = await api.getReplicationAlertChannels();
      setChannels(c);
    } catch {}
  }, []);

  useEffect(() => {
    loadData();
    loadSettings();
    loadChannels();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [loadData, loadSettings, loadChannels]);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setActionMessage({ type, text });
    if (type === 'success') setTimeout(() => setActionMessage(null), 4000);
  };

  const handleRunNow = async (id: string) => {
    setRunningId(id);
    try {
      await api.runReplicationTarget(id);
      await loadData();
      showMsg('success', 'Replication run queued');
    } catch (err: any) {
      showMsg('error', err.response?.data?.error || err.message);
    } finally {
      setRunningId(null);
    }
  };

  const handleTest = async (id: string) => {
    try {
      const result = await api.testReplicationTarget(id);
      setTestResult({ id, ...result });
    } catch (err: any) {
      showMsg('error', err.response?.data?.error || err.message);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await api.deleteReplicationTarget(id);
      await loadData();
    } catch (err: any) {
      showMsg('error', err.response?.data?.error || err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const stateSet = {
        include_paths: includePaths.filter(Boolean),
        repo_paths: repoPaths.filter(Boolean),
        exclude_patterns: excludePatterns.filter(Boolean),
        db: { type: 'sqlite' as const, sqlite_path: dbSqlitePath },
      };
      await api.updateReplicationSettings({ ...settingsForm, state_set_json: stateSet as any });
      await loadSettings();
      showMsg('success', 'Settings saved');
    } catch (err: any) {
      showMsg('error', err.response?.data?.error || err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddChannel = async () => {
    if (!newChannelConfig.trim()) return;
    setSavingChannel(true);
    try {
      let config: Record<string, any> = {};
      if (newChannelType === 'email') {
        config = { to: newChannelConfig.trim() };
      } else {
        config = { url: newChannelConfig.trim() };
      }
      await api.updateReplicationAlertChannels([{ type: newChannelType, enabled: true, config_json: config }]);
      setNewChannelConfig('');
      await loadChannels();
      showMsg('success', 'Alert channel added');
    } catch (err: any) {
      showMsg('error', err.response?.data?.error || err.message);
    } finally {
      setSavingChannel(false);
    }
  };

  const handleDeleteChannel = async (id: string) => {
    try {
      await api.deleteReplicationAlertChannel(id);
      await loadChannels();
    } catch (err: any) {
      showMsg('error', err.response?.data?.error || err.message);
    }
  };

  const overallHealth = statuses.length === 0 ? 'No targets'
    : statuses.every(s => s.lastRun?.status === 'success' || s.isRunning) ? 'Healthy'
    : statuses.some(s => s.lastRun?.status === 'failed') ? 'Degraded'
    : 'Unknown';

  const healthyCount = statuses.filter(s => s.lastRun?.status === 'success').length;
  const worstLag = statuses.reduce((max, s) => {
    const lag = s.lastRun?.lag_seconds ?? null;
    if (lag === null) return max;
    return max === null ? lag : Math.max(max, lag);
  }, null as number | null);

  const tabs: { id: Tab; label: string; icon: JSX.Element; tip: string }[] = [
    { id: 'overview', label: 'Overview', icon: <GitBranch className="h-4 w-4" />, tip: 'Health summary and recent run history' },
    { id: 'targets', label: 'Targets', icon: <Settings2 className="h-4 w-4" />, tip: 'Manage DR destination servers' },
    { id: 'settings', label: 'Settings', icon: <Settings2 className="h-4 w-4" />, tip: 'Global replication schedule and options' },
    { id: 'alerts', label: 'Alerts', icon: <Bell className="h-4 w-4" />, tip: 'Email/webhook notification channels' },
  ];

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <GitBranch className="h-6 w-6" /> Replication
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Full standby replication to disaster recovery targets</p>
          </div>
          <Tooltip text="Reload all replication status and run data">
            <button onClick={loadData} className="btn-secondary flex items-center gap-2 text-sm">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </Tooltip>
        </div>

        {actionMessage && (
          <div className={`rounded-lg p-3 text-sm ${
            actionMessage.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'
          }`}>
            {actionMessage.text}
            <button onClick={() => setActionMessage(null)} className="ml-2 underline">Dismiss</button>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
          </div>
        )}

        {/* Tabs */}
        <div className="border-b dark:border-gray-700">
          <nav className="flex gap-1">
            {tabs.map(t => (
              <Tooltip key={t.id} text={t.tip} position="bottom">
                <button onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    tab === t.id
                      ? 'border-primary-600 text-primary-700 dark:text-primary-400'
                      : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}>
                  {t.icon} {t.label}
                </button>
              </Tooltip>
            ))}
          </nav>
        </div>

        {/* Overview Tab */}
        {tab === 'overview' && (
          <div className="space-y-4">
            {/* Health summary */}
            <div className="grid gap-3 sm:grid-cols-3">
              <Tooltip text="Aggregate health across all replication targets">
                <div className="card py-3 px-4 w-full">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Overall Health</p>
                  <div className="mt-1">
                    <StatusBadge status={overallHealth === 'Healthy' ? 'success' : overallHealth === 'Degraded' ? 'failed' : 'queued'} />
                    <span className="ml-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{overallHealth}</span>
                  </div>
                </div>
              </Tooltip>
              <Tooltip text="Targets whose last run finished successfully">
                <div className="card py-3 px-4 w-full">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Targets Healthy</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {healthyCount} / {statuses.length}
                  </p>
                </div>
              </Tooltip>
              <Tooltip text="Time since last successful sync on the slowest target. High lag means the DR copy is out of date.">
                <div className="card py-3 px-4 w-full">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Worst Lag</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{formatLag(worstLag)}</p>
                </div>
              </Tooltip>
            </div>

            {/* Per-target cards */}
            {statuses.length === 0 ? (
              <div className="card py-8 text-center">
                <GitBranch className="h-10 w-10 mx-auto text-gray-400 mb-3" />
                <p className="text-gray-500 dark:text-gray-400 text-sm">No replication targets configured.</p>
                <Tooltip text="Go to Targets tab to add a DR destination">
                  <button onClick={() => setTab('targets')} className="mt-3 btn-primary text-sm">Configure Targets</button>
                </Tooltip>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {statuses.map(({ target, lastRun, isRunning }) => (
                  <div key={target.id} className="card py-3 px-4 space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <Tooltip text={`Target: ${target.host}:${target.port}`}>
                          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{target.name}</p>
                        </Tooltip>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{target.host}:{target.port}</p>
                      </div>
                      <StatusBadge status={isRunning ? 'running' : lastRun?.status || 'queued'} />
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                      <Tooltip text="How far behind this target is from the source. Lower is better.">
                        <p className="cursor-default">Lag: {formatLag(lastRun?.lag_seconds ?? null)}</p>
                      </Tooltip>
                      {lastRun?.started_at && (
                        <Tooltip text="When the most recent replication run began">
                          <p className="cursor-default">Last run: {new Date(lastRun.started_at).toLocaleString()}</p>
                        </Tooltip>
                      )}
                      {lastRun?.bytes_sent ? (
                        <Tooltip text="Data transferred to this target in the last run">
                          <p className="cursor-default">Sent: {formatBytes(lastRun.bytes_sent)}</p>
                        </Tooltip>
                      ) : null}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Tooltip text="Trigger an immediate replication run to this target">
                        <button onClick={() => handleRunNow(target.id)} disabled={runningId === target.id || isRunning}
                          className="btn-primary text-xs flex items-center gap-1 py-1 px-2">
                          {(runningId === target.id || isRunning) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          Run Now
                        </button>
                      </Tooltip>
                      <Tooltip text="View full run history and details for this target">
                        <button onClick={() => navigate(`/replication/targets/${target.id}`)}
                          className="btn-secondary text-xs flex items-center gap-1 py-1 px-2">
                          <ChevronRight className="h-3 w-3" /> View
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Recent runs */}
            <div className="card py-3 px-4">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Recent Runs</h2>
              {runs.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">No runs yet</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b dark:border-gray-700">
                        <Tooltip text="The DR target this run synced to" position="bottom">
                          <th className="pb-2 text-left font-medium text-gray-500 dark:text-gray-400 cursor-default">Target</th>
                        </Tooltip>
                        <Tooltip text="Outcome of the run" position="bottom">
                          <th className="pb-2 text-left font-medium text-gray-500 dark:text-gray-400 cursor-default">Status</th>
                        </Tooltip>
                        <Tooltip text="What initiated this run (schedule, hook, or manual)" position="bottom">
                          <th className="pb-2 text-left font-medium text-gray-500 dark:text-gray-400 cursor-default">Trigger</th>
                        </Tooltip>
                        <Tooltip text="When the run began" position="bottom">
                          <th className="pb-2 text-left font-medium text-gray-500 dark:text-gray-400 cursor-default">Started</th>
                        </Tooltip>
                        <Tooltip text="How long the run took from start to finish" position="bottom">
                          <th className="pb-2 text-left font-medium text-gray-500 dark:text-gray-400 cursor-default">Duration</th>
                        </Tooltip>
                        <Tooltip text="Total data transferred to the target" position="bottom">
                          <th className="pb-2 text-left font-medium text-gray-500 dark:text-gray-400 cursor-default">Bytes</th>
                        </Tooltip>
                      </tr>
                    </thead>
                    <tbody className="divide-y dark:divide-gray-700">
                      {runs.map(run => {
                        const targetName = statuses.find(s => s.target.id === run.target_id)?.target.name || run.target_id.slice(0, 8);
                        return (
                          <Tooltip key={run.id} text="Click to open detailed run history for this target" position="bottom">
                            <tr className="hover:bg-gray-50 dark:hover:bg-gray-750 cursor-pointer"
                              onClick={() => navigate(`/replication/targets/${run.target_id}`)}>
                              <td className="py-2 pr-3">{targetName}</td>
                              <td className="py-2 pr-3"><StatusBadge status={run.status} /></td>
                              <td className="py-2 pr-3 text-gray-500 dark:text-gray-400">{run.trigger_type}</td>
                              <td className="py-2 pr-3 text-gray-500 dark:text-gray-400">{new Date(run.started_at).toLocaleString()}</td>
                              <td className="py-2 pr-3 text-gray-500 dark:text-gray-400">{formatDuration(run.started_at, run.finished_at)}</td>
                              <td className="py-2 text-gray-500 dark:text-gray-400">{run.bytes_sent ? formatBytes(run.bytes_sent) : '—'}</td>
                            </tr>
                          </Tooltip>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Recent events */}
            {events.length > 0 && (
              <div className="card py-3 px-4">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Recent Events</h2>
                <div className="space-y-2">
                  {events.slice(0, 5).map(ev => (
                    <div key={ev.id} className="flex items-start gap-3 text-xs">
                      <SeverityBadge severity={ev.severity} />
                      <span className="flex-1 text-gray-700 dark:text-gray-300">{ev.message}</span>
                      <Tooltip text="When this event was recorded">
                        <span className="text-gray-400 whitespace-nowrap cursor-default">{new Date(ev.created_at).toLocaleString()}</span>
                      </Tooltip>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Targets Tab */}
        {tab === 'targets' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Replication Targets</h2>
              <Tooltip text="Add a new disaster recovery destination server">
                <button onClick={() => { setEditTarget(null); setShowTargetModal(true); }}
                  className="btn-primary text-sm flex items-center gap-2">
                  <Plus className="h-4 w-4" /> Add Target
                </button>
              </Tooltip>
            </div>

            {statuses.length === 0 ? (
              <div className="card py-8 text-center">
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-3">No targets configured yet.</p>
                <Tooltip text="Add a new disaster recovery destination server">
                  <button onClick={() => { setEditTarget(null); setShowTargetModal(true); }} className="btn-primary text-sm">
                    Add First Target
                  </button>
                </Tooltip>
              </div>
            ) : (
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-750">
                    <tr>
                      <Tooltip text="Friendly name for this DR target" position="bottom">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 cursor-default">Name</th>
                      </Tooltip>
                      <Tooltip text="Hostname and port of the destination server" position="bottom">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 cursor-default">Host</th>
                      </Tooltip>
                      <Tooltip text="Result of the most recent replication run" position="bottom">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 cursor-default">Status</th>
                      </Tooltip>
                      <Tooltip text="How far behind this target is. Lower is better." position="bottom">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 cursor-default">Lag</th>
                      </Tooltip>
                      <Tooltip text="Timestamp of the last run that completed without errors" position="bottom">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 cursor-default">Last Success</th>
                      </Tooltip>
                      <Tooltip text="Whether this target participates in scheduled runs" position="bottom">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 cursor-default">Enabled</th>
                      </Tooltip>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-gray-700">
                    {statuses.map(({ target, lastRun, isRunning }) => (
                      <tr key={target.id} className="hover:bg-gray-50 dark:hover:bg-gray-750/50">
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{target.name}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs font-mono">{target.host}:{target.port}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={isRunning ? 'running' : lastRun?.status || 'queued'} />
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                          <Tooltip text="Seconds since the last successful sync completed">
                            <span className="cursor-default">{formatLag(lastRun?.lag_seconds ?? null)}</span>
                          </Tooltip>
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                          <Tooltip text={lastRun?.status === 'success' && lastRun.finished_at ? `Completed at ${new Date(lastRun.finished_at).toLocaleString()}` : 'No successful run recorded yet'}>
                            <span className="cursor-default">
                              {lastRun?.status === 'success' && lastRun.finished_at
                                ? new Date(lastRun.finished_at).toLocaleString() : '—'}
                            </span>
                          </Tooltip>
                        </td>
                        <td className="px-4 py-3">
                          <Tooltip text={target.enabled ? 'Target is active and will run on schedule' : 'Target is disabled — skipped by scheduler'}>
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${target.enabled ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                              {target.enabled ? 'Yes' : 'No'}
                            </span>
                          </Tooltip>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Tooltip text="Trigger an immediate replication run to this target">
                              <button onClick={() => handleRunNow(target.id)} disabled={runningId === target.id || isRunning}
                                className="rounded p-1.5 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20">
                                {(runningId === target.id || isRunning) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                              </button>
                            </Tooltip>
                            <Tooltip text="Test SSH/rsync connectivity to this target">
                              <button onClick={() => handleTest(target.id)}
                                className="rounded p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20">
                                <CheckCircle className="h-4 w-4" />
                              </button>
                            </Tooltip>
                            <Tooltip text="Edit target host, credentials, and options">
                              <button onClick={() => { setEditTarget(target); setShowTargetModal(true); }}
                                className="rounded p-1.5 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700">
                                <Settings2 className="h-4 w-4" />
                              </button>
                            </Tooltip>
                            <Tooltip text="View full run history for this target">
                              <button onClick={() => navigate(`/replication/targets/${target.id}`)}
                                className="rounded p-1.5 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700">
                                <ChevronRight className="h-4 w-4" />
                              </button>
                            </Tooltip>
                            <Tooltip text="Permanently delete this target and its run history">
                              <button onClick={() => handleDelete(target.id)} disabled={deletingId === target.id}
                                className="rounded p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                                {deletingId === target.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                              </button>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Test result */}
            {testResult && (
              <div className={`card py-3 px-4 border-2 ${testResult.ok ? 'border-green-400' : 'border-red-400'}`}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Test Result: {testResult.ok ? 'Passed' : 'Issues Found'}
                  </h3>
                  <Tooltip text="Close connection test results">
                    <button onClick={() => setTestResult(null)} className="text-xs text-gray-500 hover:text-gray-700">Dismiss</button>
                  </Tooltip>
                </div>
                <div className="space-y-1">
                  {Object.entries(testResult.checks).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2 text-xs">
                      {v.ok ? <CheckCircle className="h-3 w-3 text-green-500" /> : <AlertCircle className="h-3 w-3 text-red-500" />}
                      <span className="font-medium text-gray-700 dark:text-gray-300">{k}:</span>
                      <span className="text-gray-500 dark:text-gray-400">{v.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Settings Tab */}
        {tab === 'settings' && settings && (
          <div className="card py-4 px-6 space-y-6 max-w-2xl">
            <div className="flex items-center gap-3">
              <Tooltip text="Master switch — disabling stops all scheduled and hook-triggered runs">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={!!settingsForm.enabled}
                    onChange={e => setSettingsForm({ ...settingsForm, enabled: e.target.checked })} className="sr-only peer" />
                  <div className="w-10 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-primary-500 rounded-full peer dark:bg-gray-700 peer-checked:bg-primary-600 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
                </label>
              </Tooltip>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Enable Replication</span>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Trigger Mode</label>
              <div className="space-y-2">
                {([
                  { v: 'hook_and_schedule', l: 'Hook + Schedule', tip: 'Run after each backup AND on the fixed schedule' },
                  { v: 'hook_only', l: 'Hook Only (backup completion)', tip: 'Run immediately after each backup finishes' },
                  { v: 'schedule_only', l: 'Schedule Only', tip: 'Run only at the configured interval or cron time' },
                ] as const).map(({ v, l, tip }) => (
                  <Tooltip key={v} text={tip} position="right">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="trigger_mode" value={v}
                        checked={settingsForm.trigger_mode === v}
                        onChange={() => setSettingsForm({ ...settingsForm, trigger_mode: v })}
                        className="text-primary-600" />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{l}</span>
                    </label>
                  </Tooltip>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Schedule Type</label>
              <div className="flex gap-4">
                {([
                  { st: 'interval' as const, tip: 'Repeat every N seconds' },
                  { st: 'cron' as const, tip: 'Run at a specific cron time expression' },
                ]).map(({ st, tip }) => (
                  <Tooltip key={st} text={tip} position="bottom">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="schedule_type" value={st}
                        checked={settingsForm.schedule_type === st}
                        onChange={() => setSettingsForm({ ...settingsForm, schedule_type: st })}
                        className="text-primary-600" />
                      <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">{st}</span>
                    </label>
                  </Tooltip>
                ))}
              </div>
              {settingsForm.schedule_type === 'interval' ? (
                <div className="mt-2">
                  <Tooltip text="How often to run, in seconds. Minimum 60." position="right">
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 cursor-default">Interval (seconds)</label>
                  </Tooltip>
                  <input type="number" value={settingsForm.interval_seconds || 3600}
                    onChange={e => setSettingsForm({ ...settingsForm, interval_seconds: Number(e.target.value) })}
                    min={60} className="input w-48" />
                </div>
              ) : (
                <div className="mt-2">
                  <Tooltip text="Standard 5-field cron expression, e.g. '0 * * * *' = hourly" position="right">
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 cursor-default">Cron Expression</label>
                  </Tooltip>
                  <input type="text" value={settingsForm.cron_expression || '0 * * * *'}
                    onChange={e => setSettingsForm({ ...settingsForm, cron_expression: e.target.value })}
                    placeholder="0 * * * *" className="input w-48 font-mono text-xs" />
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Tooltip text="Wait this long after a hook fires before starting, to batch rapid backups">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 cursor-default">Debounce (seconds)</label>
                </Tooltip>
                <input type="number" value={settingsForm.debounce_seconds || 60}
                  onChange={e => setSettingsForm({ ...settingsForm, debounce_seconds: Number(e.target.value) })}
                  min={0} className="input w-full" />
              </div>
              <div>
                <Tooltip text="Alert if no successful run within this many minutes">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 cursor-default">Max Staleness (minutes)</label>
                </Tooltip>
                <input type="number" value={settingsForm.max_staleness_minutes || 120}
                  onChange={e => setSettingsForm({ ...settingsForm, max_staleness_minutes: Number(e.target.value) })}
                  min={1} className="input w-full" />
              </div>
              <div>
                <Tooltip text="How many targets can sync in parallel (1–4)">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 cursor-default">Concurrency</label>
                </Tooltip>
                <input type="number" value={settingsForm.concurrency || 1}
                  onChange={e => setSettingsForm({ ...settingsForm, concurrency: Number(e.target.value) })}
                  min={1} max={4} className="input w-full" />
              </div>
            </div>

            <div className="flex gap-6">
              <Tooltip text="Hold off replicating while a live backup is in progress">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!settingsForm.pause_during_active_backup}
                    onChange={e => setSettingsForm({ ...settingsForm, pause_during_active_backup: e.target.checked })}
                    className="rounded text-primary-600" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Pause during active backup</span>
                </label>
              </Tooltip>
              <Tooltip text="Re-read synced files after transfer to confirm integrity">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!settingsForm.default_verify_after_sync}
                    onChange={e => setSettingsForm({ ...settingsForm, default_verify_after_sync: e.target.checked })}
                    className="rounded text-primary-600" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Default: verify after sync</span>
                </label>
              </Tooltip>
              <Tooltip text="Compare file checksums (slower but catches silent corruption)">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!settingsForm.default_checksum_verify}
                    onChange={e => setSettingsForm({ ...settingsForm, default_checksum_verify: e.target.checked })}
                    className="rounded text-primary-600" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Default: checksum verify</span>
                </label>
              </Tooltip>
            </div>

            {/* State Set Editor */}
            <div className="border-t dark:border-gray-700 pt-4">
              <Tooltip text="Defines exactly which files and databases are replicated to DR targets">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 cursor-default">State Set (What to Replicate)</h3>
              </Tooltip>

              <PathListEditor label="Include Paths" paths={includePaths} onChange={setIncludePaths}
                tip="Directories that will be synced to all targets" />
              <PathListEditor label="Repo Paths" paths={repoPaths} onChange={setRepoPaths}
                tip="Git/Restic repo paths synced as atomic units" />
              <PathListEditor label="Exclude Patterns" paths={excludePatterns} onChange={setExcludePatterns}
                tip="Glob patterns to skip inside include paths" />

              <div className="mt-3">
                <Tooltip text="Path to the SQLite database file to include in replication">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 cursor-default">SQLite DB Path</label>
                </Tooltip>
                <input type="text" value={dbSqlitePath} onChange={e => setDbSqlitePath(e.target.value)}
                  placeholder="/var/urbackup/backup_server.db" className="input w-full font-mono text-xs" />
              </div>
            </div>

            <div className="flex justify-end">
              <Tooltip text="Persist all settings changes to the database">
                <button onClick={handleSaveSettings} disabled={savingSettings} className="btn-primary">
                  {savingSettings ? 'Saving...' : 'Save Settings'}
                </button>
              </Tooltip>
            </div>
          </div>
        )}

        {/* Alerts Tab */}
        {tab === 'alerts' && (
          <div className="space-y-4 max-w-2xl">
            <div className="card py-4 px-6">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Add Alert Channel</h2>
              <div className="flex gap-3 flex-wrap items-end">
                <div>
                  <Tooltip text="Email sends via SMTP; Webhook POSTs JSON to a URL">
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 cursor-default">Type</label>
                  </Tooltip>
                  <select value={newChannelType} onChange={e => setNewChannelType(e.target.value as any)} className="input">
                    <option value="email">Email</option>
                    <option value="webhook">Webhook</option>
                  </select>
                </div>
                <div className="flex-1 min-w-48">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {newChannelType === 'email' ? 'Email Address' : 'Webhook URL'}
                  </label>
                  <input type="text" value={newChannelConfig} onChange={e => setNewChannelConfig(e.target.value)}
                    placeholder={newChannelType === 'email' ? 'alerts@example.com' : 'https://hooks.example.com/...'}
                    className="input w-full" />
                </div>
                <Tooltip text="Save this notification channel">
                  <button onClick={handleAddChannel} disabled={savingChannel || !newChannelConfig.trim()}
                    className="btn-primary flex items-center gap-2">
                    <Plus className="h-4 w-4" /> Add
                  </button>
                </Tooltip>
              </div>
            </div>

            {channels.length > 0 && (
              <div className="card py-3 px-4">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Channels</h2>
                <div className="space-y-2">
                  {channels.map(ch => (
                    <div key={ch.id} className="flex items-center justify-between rounded-lg border dark:border-gray-700 px-3 py-2">
                      <div className="flex items-center gap-3">
                        <Tooltip text={ch.type === 'email' ? 'Sends alert emails via SMTP' : 'POSTs a JSON payload to this URL'}>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ch.type === 'email' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'}`}>
                            {ch.type}
                          </span>
                        </Tooltip>
                        <Tooltip text={ch.enabled ? 'Channel is active' : 'Channel is disabled — no alerts sent'}>
                          <span className="text-sm text-gray-700 dark:text-gray-300 cursor-default">
                            {ch.config_json?.to || ch.config_json?.url || '—'}
                          </span>
                        </Tooltip>
                        {!ch.enabled && <span className="text-xs text-gray-400">(disabled)</span>}
                      </div>
                      <Tooltip text="Remove this alert channel">
                        <button onClick={() => handleDeleteChannel(ch.id)}
                          className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </Tooltip>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="card py-4 px-6">
              <div className="flex items-start gap-3">
                <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                  <p>Alerts are sent on: failed runs, stale targets, and recovery events.</p>
                  <p>Rate limited to one alert per 10 minutes per target+event combination.</p>
                  <p>Email channels use the SMTP settings from your server configuration.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Target Modal */}
      {showTargetModal && (
        <ReplicationTargetModal
          target={editTarget}
          onClose={() => { setShowTargetModal(false); setEditTarget(null); }}
          onSaved={async () => {
            setShowTargetModal(false);
            setEditTarget(null);
            await loadData();
          }}
        />
      )}
    </Layout>
  );
}

function PathListEditor({
  label, paths, onChange, tip,
}: {
  label: string;
  paths: string[];
  onChange: (p: string[]) => void;
  tip?: string;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1">
        {tip ? (
          <Tooltip text={tip}>
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300 cursor-default">{label}</label>
          </Tooltip>
        ) : (
          <label className="text-xs font-medium text-gray-700 dark:text-gray-300">{label}</label>
        )}
        <Tooltip text={`Add a new entry to ${label}`}>
          <button type="button" onClick={() => onChange([...paths, ''])}
            className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700">
            <Plus className="h-3 w-3" /> Add
          </button>
        </Tooltip>
      </div>
      {paths.map((p, i) => (
        <div key={i} className="flex gap-2 mb-1">
          <input type="text" value={p} onChange={e => { const n = [...paths]; n[i] = e.target.value; onChange(n); }}
            className="input flex-1 text-xs font-mono" />
          <Tooltip text="Remove this entry">
            <button type="button" onClick={() => onChange(paths.filter((_, j) => j !== i))}
              className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
              <Trash2 className="h-3 w-3" />
            </button>
          </Tooltip>
        </div>
      ))}
    </div>
  );
}
