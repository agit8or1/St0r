import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GitBranch, RefreshCw, Plus, Play, Settings2, Trash2, CheckCircle,
  AlertCircle, Clock, Loader2, ChevronRight, Bell, Info
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { ReplicationTargetModal } from '../components/ReplicationTargetModal';
import { api } from '../services/api';
import type {
  ReplicationSettings, ReplicationTarget, ReplicationRun,
  ReplicationEvent, ReplicationAlertChannel, ReplicationTargetStatus
} from '../types';
import { formatBytes } from '../utils/format';

type Tab = 'overview' | 'targets' | 'settings' | 'alerts';

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
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.icon} {status}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const cls = severity === 'critical' ? 'text-red-600 dark:text-red-400' :
    severity === 'warn' ? 'text-yellow-600 dark:text-yellow-400' : 'text-blue-600 dark:text-blue-400';
  return <span className={`text-xs font-medium ${cls}`}>{severity}</span>;
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

  const tabs: { id: Tab; label: string; icon: JSX.Element }[] = [
    { id: 'overview', label: 'Overview', icon: <GitBranch className="h-4 w-4" /> },
    { id: 'targets', label: 'Targets', icon: <Settings2 className="h-4 w-4" /> },
    { id: 'settings', label: 'Settings', icon: <Settings2 className="h-4 w-4" /> },
    { id: 'alerts', label: 'Alerts', icon: <Bell className="h-4 w-4" /> },
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
          <button onClick={loadData} className="btn-secondary flex items-center gap-2 text-sm">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
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
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-primary-600 text-primary-700 dark:text-primary-400'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}>
                {t.icon} {t.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Overview Tab */}
        {tab === 'overview' && (
          <div className="space-y-4">
            {/* Health summary */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="card py-3 px-4">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Overall Health</p>
                <div className="mt-1">
                  <StatusBadge status={overallHealth === 'Healthy' ? 'success' : overallHealth === 'Degraded' ? 'failed' : 'queued'} />
                  <span className="ml-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{overallHealth}</span>
                </div>
              </div>
              <div className="card py-3 px-4">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Targets Healthy</p>
                <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {healthyCount} / {statuses.length}
                </p>
              </div>
              <div className="card py-3 px-4">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Worst Lag</p>
                <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{formatLag(worstLag)}</p>
              </div>
            </div>

            {/* Per-target cards */}
            {statuses.length === 0 ? (
              <div className="card py-8 text-center">
                <GitBranch className="h-10 w-10 mx-auto text-gray-400 mb-3" />
                <p className="text-gray-500 dark:text-gray-400 text-sm">No replication targets configured.</p>
                <button onClick={() => setTab('targets')} className="mt-3 btn-primary text-sm">Configure Targets</button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {statuses.map(({ target, lastRun, isRunning }) => (
                  <div key={target.id} className="card py-3 px-4 space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{target.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{target.host}:{target.port}</p>
                      </div>
                      <StatusBadge status={isRunning ? 'running' : lastRun?.status || 'queued'} />
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                      <p>Lag: {formatLag(lastRun?.lag_seconds ?? null)}</p>
                      {lastRun?.started_at && <p>Last run: {new Date(lastRun.started_at).toLocaleString()}</p>}
                      {lastRun?.bytes_sent ? <p>Sent: {formatBytes(lastRun.bytes_sent)}</p> : null}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => handleRunNow(target.id)} disabled={runningId === target.id || isRunning}
                        className="btn-primary text-xs flex items-center gap-1 py-1 px-2">
                        {(runningId === target.id || isRunning) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                        Run Now
                      </button>
                      <button onClick={() => navigate(`/replication/targets/${target.id}`)}
                        className="btn-secondary text-xs flex items-center gap-1 py-1 px-2">
                        <ChevronRight className="h-3 w-3" /> View
                      </button>
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
                        {['Target', 'Status', 'Trigger', 'Started', 'Duration', 'Bytes'].map(h => (
                          <th key={h} className="pb-2 text-left font-medium text-gray-500 dark:text-gray-400">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y dark:divide-gray-700">
                      {runs.map(run => {
                        const targetName = statuses.find(s => s.target.id === run.target_id)?.target.name || run.target_id.slice(0, 8);
                        return (
                          <tr key={run.id} className="hover:bg-gray-50 dark:hover:bg-gray-750 cursor-pointer"
                            onClick={() => navigate(`/replication/targets/${run.target_id}`)}>
                            <td className="py-2 pr-3">{targetName}</td>
                            <td className="py-2 pr-3"><StatusBadge status={run.status} /></td>
                            <td className="py-2 pr-3 text-gray-500 dark:text-gray-400">{run.trigger_type}</td>
                            <td className="py-2 pr-3 text-gray-500 dark:text-gray-400">{new Date(run.started_at).toLocaleString()}</td>
                            <td className="py-2 pr-3 text-gray-500 dark:text-gray-400">{formatDuration(run.started_at, run.finished_at)}</td>
                            <td className="py-2 text-gray-500 dark:text-gray-400">{run.bytes_sent ? formatBytes(run.bytes_sent) : '—'}</td>
                          </tr>
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
                      <span className="text-gray-400 whitespace-nowrap">{new Date(ev.created_at).toLocaleString()}</span>
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
              <button onClick={() => { setEditTarget(null); setShowTargetModal(true); }}
                className="btn-primary text-sm flex items-center gap-2">
                <Plus className="h-4 w-4" /> Add Target
              </button>
            </div>

            {statuses.length === 0 ? (
              <div className="card py-8 text-center">
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-3">No targets configured yet.</p>
                <button onClick={() => { setEditTarget(null); setShowTargetModal(true); }} className="btn-primary text-sm">
                  Add First Target
                </button>
              </div>
            ) : (
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-750">
                    <tr>
                      {['Name', 'Host', 'Status', 'Lag', 'Last Success', 'Enabled', 'Actions'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">{h}</th>
                      ))}
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
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{formatLag(lastRun?.lag_seconds ?? null)}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                          {lastRun?.status === 'success' && lastRun.finished_at
                            ? new Date(lastRun.finished_at).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${target.enabled ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                            {target.enabled ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button onClick={() => handleRunNow(target.id)} disabled={runningId === target.id || isRunning}
                              title="Run Now" className="rounded p-1.5 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20">
                              {(runningId === target.id || isRunning) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                            </button>
                            <button onClick={() => handleTest(target.id)} title="Test Connection"
                              className="rounded p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20">
                              <CheckCircle className="h-4 w-4" />
                            </button>
                            <button onClick={() => { setEditTarget(target); setShowTargetModal(true); }} title="Edit"
                              className="rounded p-1.5 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700">
                              <Settings2 className="h-4 w-4" />
                            </button>
                            <button onClick={() => navigate(`/replication/targets/${target.id}`)} title="View Detail"
                              className="rounded p-1.5 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700">
                              <ChevronRight className="h-4 w-4" />
                            </button>
                            <button onClick={() => handleDelete(target.id)} disabled={deletingId === target.id} title="Delete"
                              className="rounded p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                              {deletingId === target.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </button>
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
                  <button onClick={() => setTestResult(null)} className="text-xs text-gray-500 hover:text-gray-700">Dismiss</button>
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
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={!!settingsForm.enabled}
                  onChange={e => setSettingsForm({ ...settingsForm, enabled: e.target.checked })} className="sr-only peer" />
                <div className="w-10 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-primary-500 rounded-full peer dark:bg-gray-700 peer-checked:bg-primary-600 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
              </label>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Enable Replication</span>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Trigger Mode</label>
              <div className="space-y-2">
                {([
                  { v: 'hook_and_schedule', l: 'Hook + Schedule' },
                  { v: 'hook_only', l: 'Hook Only (backup completion)' },
                  { v: 'schedule_only', l: 'Schedule Only' },
                ] as const).map(({ v, l }) => (
                  <label key={v} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="trigger_mode" value={v}
                      checked={settingsForm.trigger_mode === v}
                      onChange={() => setSettingsForm({ ...settingsForm, trigger_mode: v })}
                      className="text-primary-600" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{l}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Schedule Type</label>
              <div className="flex gap-4">
                {(['interval', 'cron'] as const).map(st => (
                  <label key={st} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="schedule_type" value={st}
                      checked={settingsForm.schedule_type === st}
                      onChange={() => setSettingsForm({ ...settingsForm, schedule_type: st })}
                      className="text-primary-600" />
                    <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">{st}</span>
                  </label>
                ))}
              </div>
              {settingsForm.schedule_type === 'interval' ? (
                <div className="mt-2">
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Interval (seconds)</label>
                  <input type="number" value={settingsForm.interval_seconds || 3600}
                    onChange={e => setSettingsForm({ ...settingsForm, interval_seconds: Number(e.target.value) })}
                    min={60} className="input w-48" />
                </div>
              ) : (
                <div className="mt-2">
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Cron Expression</label>
                  <input type="text" value={settingsForm.cron_expression || '0 * * * *'}
                    onChange={e => setSettingsForm({ ...settingsForm, cron_expression: e.target.value })}
                    placeholder="0 * * * *" className="input w-48 font-mono text-xs" />
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Debounce (seconds)</label>
                <input type="number" value={settingsForm.debounce_seconds || 60}
                  onChange={e => setSettingsForm({ ...settingsForm, debounce_seconds: Number(e.target.value) })}
                  min={0} className="input w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Max Staleness (minutes)</label>
                <input type="number" value={settingsForm.max_staleness_minutes || 120}
                  onChange={e => setSettingsForm({ ...settingsForm, max_staleness_minutes: Number(e.target.value) })}
                  min={1} className="input w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Concurrency</label>
                <input type="number" value={settingsForm.concurrency || 1}
                  onChange={e => setSettingsForm({ ...settingsForm, concurrency: Number(e.target.value) })}
                  min={1} max={4} className="input w-full" />
              </div>
            </div>

            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!settingsForm.pause_during_active_backup}
                  onChange={e => setSettingsForm({ ...settingsForm, pause_during_active_backup: e.target.checked })}
                  className="rounded text-primary-600" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Pause during active backup</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!settingsForm.default_verify_after_sync}
                  onChange={e => setSettingsForm({ ...settingsForm, default_verify_after_sync: e.target.checked })}
                  className="rounded text-primary-600" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Default: verify after sync</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!settingsForm.default_checksum_verify}
                  onChange={e => setSettingsForm({ ...settingsForm, default_checksum_verify: e.target.checked })}
                  className="rounded text-primary-600" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Default: checksum verify</span>
              </label>
            </div>

            {/* State Set Editor */}
            <div className="border-t dark:border-gray-700 pt-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">State Set (What to Replicate)</h3>

              <PathListEditor label="Include Paths" paths={includePaths} onChange={setIncludePaths} />
              <PathListEditor label="Repo Paths" paths={repoPaths} onChange={setRepoPaths} />
              <PathListEditor label="Exclude Patterns" paths={excludePatterns} onChange={setExcludePatterns} />

              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">SQLite DB Path</label>
                <input type="text" value={dbSqlitePath} onChange={e => setDbSqlitePath(e.target.value)}
                  placeholder="/var/urbackup/backup_server.db" className="input w-full font-mono text-xs" />
              </div>
            </div>

            <div className="flex justify-end">
              <button onClick={handleSaveSettings} disabled={savingSettings} className="btn-primary">
                {savingSettings ? 'Saving...' : 'Save Settings'}
              </button>
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
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
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
                <button onClick={handleAddChannel} disabled={savingChannel || !newChannelConfig.trim()}
                  className="btn-primary flex items-center gap-2">
                  <Plus className="h-4 w-4" /> Add
                </button>
              </div>
            </div>

            {channels.length > 0 && (
              <div className="card py-3 px-4">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Channels</h2>
                <div className="space-y-2">
                  {channels.map(ch => (
                    <div key={ch.id} className="flex items-center justify-between rounded-lg border dark:border-gray-700 px-3 py-2">
                      <div className="flex items-center gap-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ch.type === 'email' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'}`}>
                          {ch.type}
                        </span>
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          {ch.config_json?.to || ch.config_json?.url || '—'}
                        </span>
                        {!ch.enabled && <span className="text-xs text-gray-400">(disabled)</span>}
                      </div>
                      <button onClick={() => handleDeleteChannel(ch.id)}
                        className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                        <Trash2 className="h-4 w-4" />
                      </button>
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

function PathListEditor({ label, paths, onChange }: { label: string; paths: string[]; onChange: (p: string[]) => void }) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-gray-700 dark:text-gray-300">{label}</label>
        <button type="button" onClick={() => onChange([...paths, ''])}
          className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700">
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
      {paths.map((p, i) => (
        <div key={i} className="flex gap-2 mb-1">
          <input type="text" value={p} onChange={e => { const n = [...paths]; n[i] = e.target.value; onChange(n); }}
            className="input flex-1 text-xs font-mono" />
          <button type="button" onClick={() => onChange(paths.filter((_, j) => j !== i))}
            className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
