import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

interface AutoUpdateStatus {
  enabled: boolean;
  hour: number;
  windowHours: number;
  lastRunAt: string | null;
  lastResult: string | null;
  installedVersion: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Daily automatic UrBackup server update (backend: services/urbackupAutoUpdate.ts).
 * Admin-only: renders nothing for users without access.
 */
export function UrBackupAutoUpdatePanel() {
  const [status, setStatus] = useState<AutoUpdateStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/system-update/urbackup-auto-update', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  if (!status) return null;

  const save = async (changes: Partial<Pick<AutoUpdateStatus, 'enabled' | 'hour'>>) => {
    setSaving(true);
    setError('');
    try {
      const resp = await fetch('/api/system-update/urbackup-auto-update', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Failed to save');
      setStatus({ ...status, ...data });
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const end = (status.hour + status.windowHours) % 24;
  const resultOk = status.lastResult?.startsWith('SUCCESS');

  return (
    <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/40 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
          <input
            type="checkbox"
            checked={status.enabled}
            disabled={saving}
            onChange={(e) => save({ enabled: e.target.checked })}
            className="h-4 w-4 rounded-sm border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <RefreshCw className="h-4 w-4" />
          Install UrBackup server updates automatically
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          daily from
          <select
            value={status.hour}
            disabled={saving || !status.enabled}
            onChange={(e) => save({ hour: Number(e.target.value) })}
            className="input py-1 w-auto"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{pad(h)}:00</option>
            ))}
          </select>
          to {pad(end)}:00
        </label>
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400">
        Checks the UrBackup package repository once a day and installs a newer <code>urbackup-server</code> if there is
        one. UrBackup is restarted only when it was actually updated, and never while a backup is running: the update
        waits, and is skipped for the day if backups run for the whole window.
      </p>
      {status.lastRunAt && (
        <p className={`text-xs ${resultOk ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}`}>
          Last check {new Date(status.lastRunAt).toLocaleString()}: {status.lastResult}
        </p>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
