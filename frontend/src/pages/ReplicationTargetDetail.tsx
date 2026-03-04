import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Play, Settings2, CheckCircle, AlertCircle, Clock,
  Loader2, ChevronDown, ChevronUp, GitBranch
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { ReplicationTargetModal } from '../components/ReplicationTargetModal';
import { api } from '../services/api';
import type { ReplicationTarget, ReplicationRun } from '../types';
import { formatBytes } from '../utils/format';

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { cls: string; icon: JSX.Element }> = {
    success: { cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300', icon: <CheckCircle className="h-3 w-3" /> },
    running: { cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    failed: { cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300', icon: <AlertCircle className="h-3 w-3" /> },
    queued: { cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300', icon: <Clock className="h-3 w-3" /> },
    canceled: { cls: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300', icon: <AlertCircle className="h-3 w-3" /> },
  };
  const s = cfg[status] || cfg.queued;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.icon} {status}
    </span>
  );
}

function formatDuration(started: string, finished: string | null): string {
  if (!finished) return 'running…';
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

export function ReplicationTargetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [target, setTarget] = useState<ReplicationTarget | null>(null);
  const [runs, setRuns] = useState<ReplicationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [runningId, setRunningId] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<Record<string, ReplicationRun>>({});
  const [showEditModal, setShowEditModal] = useState(false);

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [t, r] = await Promise.all([
        api.getReplicationTargets().then(ts => ts.find(t => t.id === id) || null),
        api.getReplicationRuns(id, 20),
      ]);
      setTarget(t);
      setRuns(r);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleRunNow = async () => {
    if (!id) return;
    setRunningId(id);
    try {
      await api.runReplicationTarget(id);
      await loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setRunningId(null);
    }
  };

  const toggleRunExpand = async (runId: string) => {
    if (expandedRun === runId) {
      setExpandedRun(null);
      return;
    }
    setExpandedRun(runId);
    if (!runDetails[runId]) {
      try {
        const detail = await api.getReplicationRun(runId);
        setRunDetails(prev => ({ ...prev, [runId]: detail }));
      } catch {}
    }
  };

  const latestRun = runs[0] || null;
  const isRunning = runs.some(r => r.status === 'running' || r.status === 'queued');

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      </Layout>
    );
  }

  if (error || !target) {
    return (
      <Layout>
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-4 text-red-700 dark:text-red-300">
          {error || 'Target not found'}
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/replication')}
            className="rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <GitBranch className="h-6 w-6" /> {target.name}
              </h1>
              <StatusBadge status={isRunning ? 'running' : latestRun?.status || 'queued'} />
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {target.ssh_user}@{target.host}:{target.port} · {target.target_root_path}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={handleRunNow} disabled={!!runningId || isRunning}
              className="btn-primary flex items-center gap-2 text-sm">
              {runningId || isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Run Now
            </button>
            <button onClick={() => setShowEditModal(true)}
              className="btn-secondary flex items-center gap-2 text-sm">
              <Settings2 className="h-4 w-4" /> Edit
            </button>
          </div>
        </div>

        {/* Stats */}
        {latestRun && (
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="card py-3 px-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">Last Status</p>
              <div className="mt-1"><StatusBadge status={latestRun.status} /></div>
            </div>
            <div className="card py-3 px-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">Lag</p>
              <p className="mt-1 text-lg font-bold text-gray-900 dark:text-gray-100">{formatLag(latestRun.lag_seconds)}</p>
            </div>
            <div className="card py-3 px-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">Last Sync</p>
              <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                {latestRun.finished_at ? new Date(latestRun.finished_at).toLocaleString() : '—'}
              </p>
            </div>
            <div className="card py-3 px-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">Last Bytes Sent</p>
              <p className="mt-1 text-lg font-bold text-gray-900 dark:text-gray-100">
                {latestRun.bytes_sent ? formatBytes(latestRun.bytes_sent) : '—'}
              </p>
            </div>
          </div>
        )}

        {/* Runs list */}
        <div className="card py-3 px-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Run History</h2>
          {runs.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">No runs yet. Click "Run Now" to start.</p>
          ) : (
            <div className="space-y-1">
              {runs.map(run => (
                <div key={run.id} className="rounded-lg border dark:border-gray-700 overflow-hidden">
                  <button
                    onClick={() => toggleRunExpand(run.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-750/50 text-left">
                    <StatusBadge status={run.status} />
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium capitalize">{run.trigger_type}</span>
                    <span className="flex-1 text-xs text-gray-700 dark:text-gray-300">{new Date(run.started_at).toLocaleString()}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{formatDuration(run.started_at, run.finished_at)}</span>
                    {run.bytes_sent > 0 && <span className="text-xs text-gray-500 dark:text-gray-400">{formatBytes(run.bytes_sent)}</span>}
                    {expandedRun === run.id ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                  </button>

                  {expandedRun === run.id && (
                    <div className="border-t dark:border-gray-700 px-3 py-3 bg-gray-50 dark:bg-gray-900/40">
                      {run.error_message && (
                        <div className="mb-2 rounded bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                          Error: {run.error_message}
                        </div>
                      )}
                      {run.step && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                          Last step: <span className="font-medium text-gray-700 dark:text-gray-300">{run.step}</span>
                          {run.status === 'running' && ` (${run.progress.toFixed(0)}%)`}
                        </p>
                      )}
                      {/* Log from details_json */}
                      {(() => {
                        const detail = runDetails[run.id];
                        const log = detail?.details_json?.log || run.details_json?.log;
                        if (!log) return <p className="text-xs text-gray-400">No log available</p>;
                        return (
                          <pre className="text-xs font-mono text-gray-700 dark:text-gray-300 bg-gray-900/5 dark:bg-gray-900/60 rounded p-2 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
                            {log}
                          </pre>
                        );
                      })()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showEditModal && (
        <ReplicationTargetModal
          target={target}
          onClose={() => setShowEditModal(false)}
          onSaved={async () => {
            setShowEditModal(false);
            await loadData();
          }}
        />
      )}
    </Layout>
  );
}
