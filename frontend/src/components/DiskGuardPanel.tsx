import { useState, useEffect } from 'react';
import { HardDrive, ShieldAlert, ShieldCheck, PlayCircle, Trash2, RefreshCw, Loader2 } from 'lucide-react';

interface DiskUsage {
  path: string;
  total: number;
  used: number;
  free: number;
  usedPct: number;
}

interface DiskGuardStatus {
  enabled: boolean;
  level: 'ok' | 'warning' | 'critical' | 'emergency';
  usage: DiskUsage | null;
  thresholds: {
    warnPct: number;
    criticalPct: number;
    emergencyPct: number;
    resumePct: number;
  };
  backupsPaused: boolean;
  autoReclaim: boolean;
  lastCheck: string | null;
  intervalMs: number;
}

interface GuardEvent {
  id: number;
  level: string;
  used_pct: string | number;
  free_bytes: number;
  total_bytes: number;
  action: string;
  detail: string | null;
  created_at: string;
}

function authHeaders(json = false): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
  };
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

const LEVEL_STYLES: Record<string, { bar: string; text: string; label: string }> = {
  ok: { bar: 'bg-green-500', text: 'text-green-700 dark:text-green-300', label: 'Healthy' },
  warning: { bar: 'bg-yellow-500', text: 'text-yellow-700 dark:text-yellow-300', label: 'Warning' },
  critical: { bar: 'bg-orange-500', text: 'text-orange-700 dark:text-orange-300', label: 'Critical' },
  emergency: { bar: 'bg-red-600', text: 'text-red-700 dark:text-red-300', label: 'Emergency' },
};

export function DiskGuardPanel({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<DiskGuardStatus | null>(null);
  const [events, setEvents] = useState<GuardEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [reclaimAmount, setReclaimAmount] = useState('5%');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = async () => {
    try {
      const [statusRes, eventsRes] = await Promise.all([
        fetch('/api/disk-guard', { headers: authHeaders() }),
        fetch('/api/disk-guard/events?limit=25', { headers: authHeaders() }),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json());
      if (eventsRes.ok) setEvents(await eventsRes.json());
    } catch (err) {
      console.error('Failed to load disk guard status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, []);

  const post = async (path: string, body: unknown, action: string, successText: string) => {
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || 'Request failed' });
      } else {
        setMessage({ type: 'success', text: successText });
        await load();
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Request failed' });
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading storage protection status...
      </div>
    );
  }

  if (!status) {
    return <p className="text-sm text-red-600 dark:text-red-400 py-4">Could not load storage protection status.</p>;
  }

  const style = LEVEL_STYLES[status.level] ?? LEVEL_STYLES.ok;
  const usage = status.usage;
  const pct = usage ? Math.min(usage.usedPct, 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <HardDrive className="h-5 w-5" />
          Storage Protection
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Continuously watches free space on the backup volume and pauses new backups
          before it can fill. UrBackup's nightly cleanup then reclaims space and backups
          resume automatically.
        </p>
      </div>

      {message && (
        <div
          className={`rounded-lg p-4 text-sm ${
            message.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      {!status.enabled && (
        <div className="rounded-lg p-4 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
          The disk guard is disabled (<code>ST0R_DISK_GUARD_ENABLED=0</code>). Nothing is
          watching free space.
        </div>
      )}

      {status.backupsPaused && (
        <div className="rounded-lg p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                New backups are paused to protect the storage volume
              </p>
              <p className="text-xs text-red-700 dark:text-red-300 mt-1">
                They resume automatically once usage falls below {status.thresholds.resumePct}%.
              </p>
            </div>
            {isAdmin && (
              <button
                onClick={() => post('/api/disk-guard/resume', {}, 'resume', 'Backups resumed')}
                disabled={busy !== null}
                className="btn btn-secondary flex items-center gap-2 text-sm shrink-0"
              >
                <PlayCircle className="h-4 w-4" />
                {busy === 'resume' ? 'Resuming...' : 'Resume now'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Usage */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <span className={`text-sm font-medium flex items-center gap-2 ${style.text}`}>
            {status.level === 'ok' ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
            {style.label}
          </span>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {usage ? `${formatBytes(usage.used)} of ${formatBytes(usage.total)} used — ${formatBytes(usage.free)} free` : 'No data'}
          </span>
        </div>

        <div className="relative h-3 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div className={`h-full ${style.bar} transition-all`} style={{ width: `${pct}%` }} />
          {/* Threshold ticks */}
          {[status.thresholds.warnPct, status.thresholds.criticalPct, status.thresholds.emergencyPct].map(t => (
            <div
              key={t}
              className="absolute top-0 h-full w-px bg-gray-500 dark:bg-gray-400 opacity-70"
              style={{ left: `${t}%` }}
              title={`${t}%`}
            />
          ))}
        </div>

        <div className="mt-3 grid gap-2 text-xs text-gray-600 dark:text-gray-400 sm:grid-cols-2">
          <div>Volume: <code className="text-gray-800 dark:text-gray-200">{usage?.path ?? 'unknown'}</code></div>
          <div className="sm:text-right">
            Warn {status.thresholds.warnPct}% · Critical {status.thresholds.criticalPct}% · Pause {status.thresholds.emergencyPct}%
          </div>
          <div>
            Checked every {Math.round(status.intervalMs / 60000)} min
            {status.lastCheck && ` — last ${new Date(status.lastCheck).toLocaleString()}`}
          </div>
          <div className="sm:text-right">Automatic reclaim: {status.autoReclaim ? 'on' : 'off'}</div>
        </div>
      </div>

      {/* Maintenance */}
      {isAdmin && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Manual maintenance</h3>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">
                Reclaim space (deletes oldest backups down to the retention floors)
              </label>
              <input
                type="text"
                value={reclaimAmount}
                onChange={e => setReclaimAmount(e.target.value)}
                placeholder="5% or 100G"
                className="input w-40"
              />
            </div>
            <button
              onClick={() =>
                post('/api/disk-guard/reclaim', { amount: reclaimAmount }, 'reclaim', 'Space reclamation finished')
              }
              disabled={busy !== null}
              className="btn btn-secondary flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${busy === 'reclaim' ? 'animate-spin' : ''}`} />
              {busy === 'reclaim' ? 'Reclaiming...' : 'Reclaim now'}
            </button>
          </div>

          <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
              Prune orphaned files — removes data in the backup store that the UrBackup
              database no longer references (left behind by interrupted backups and
              deletions). <strong>Requires the UrBackup server to be stopped</strong> and can
              run for a long time.
            </p>
            <button
              onClick={() =>
                post('/api/disk-guard/prune-orphans', { confirm: true }, 'prune', 'Orphan prune finished')
              }
              disabled={busy !== null}
              className="btn btn-secondary flex items-center gap-2"
            >
              <Trash2 className="h-4 w-4" />
              {busy === 'prune' ? 'Pruning...' : 'Prune orphaned files'}
            </button>
          </div>
        </div>
      )}

      {/* History */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Recent guard activity</h3>
        {events.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No events recorded — the volume has stayed below the warning threshold.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">Level</th>
                  <th className="py-2 pr-4 font-medium">Used</th>
                  <th className="py-2 pr-4 font-medium">Free</th>
                  <th className="py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {events.map(ev => (
                  <tr key={ev.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 pr-4 whitespace-nowrap text-gray-600 dark:text-gray-400">
                      {new Date(ev.created_at).toLocaleString()}
                    </td>
                    <td className={`py-2 pr-4 ${(LEVEL_STYLES[ev.level] ?? LEVEL_STYLES.ok).text}`}>
                      {(LEVEL_STYLES[ev.level] ?? LEVEL_STYLES.ok).label}
                    </td>
                    <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">{Number(ev.used_pct).toFixed(1)}%</td>
                    <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">{formatBytes(ev.free_bytes)}</td>
                    <td className="py-2 text-gray-800 dark:text-gray-200">{ev.action.replace(/_/g, ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
