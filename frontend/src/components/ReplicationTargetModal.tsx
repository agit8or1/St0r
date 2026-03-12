import { useState, useEffect } from 'react';
import { X, ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { api } from '../services/api';
import type { ReplicationTarget } from '../types';

interface Props {
  target: ReplicationTarget | null;
  onClose: () => void;
  onSaved: () => void;
}

const REDACTED = '***REDACTED***';

export function ReplicationTargetModal({ target, onClose, onSaved }: Props) {
  const isEdit = !!target;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [sshUser, setSshUser] = useState('root');
  const [authType, setAuthType] = useState<'ssh_key' | 'password'>('ssh_key');
  const [privateKey, setPrivateKey] = useState('');
  const [password, setPassword] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [targetRootPath, setTargetRootPath] = useState('/opt/urbackup-replica');
  const [repoPaths, setRepoPaths] = useState<Array<{ src: string; dst: string }>>([]);
  const [dbType, setDbType] = useState<'sqlite' | 'mysql'>('sqlite');
  const [dbDsn, setDbDsn] = useState('');
  const [bwLimit, setBwLimit] = useState(0);
  const [verifyAfterSync, setVerifyAfterSync] = useState(false);
  const [checksumVerify, setChecksumVerify] = useState(false);
  const [standbyMode, setStandbyMode] = useState<'running_readonly' | 'stopped'>('stopped');
  const [stopCmd, setStopCmd] = useState('systemctl stop urbackupsrv');
  const [startCmd, setStartCmd] = useState('systemctl start urbackupsrv');
  const [btrfsMode, setBtrfsMode] = useState<'auto' | 'btrfs_send' | 'rsync'>('auto');

  useEffect(() => {
    if (target) {
      setName(target.name);
      setEnabled(target.enabled);
      setHost(target.host);
      setPort(target.port);
      setSshUser(target.ssh_user);
      setAuthType(target.auth_type);
      setPrivateKey(target.ssh_private_key_encrypted ? REDACTED : '');
      setPassword(target.ssh_password_encrypted ? REDACTED : '');
      setFingerprint(target.ssh_known_host_fingerprint || '');
      setTargetRootPath(target.target_root_path);
      const map = target.target_repo_paths_map;
      setRepoPaths(map ? Object.entries(map).map(([src, dst]) => ({ src, dst })) : []);
      setDbType(target.target_db_type);
      setDbDsn(target.target_db_dsn_encrypted ? REDACTED : '');
      setBwLimit(target.bandwidth_limit_mbps);
      setVerifyAfterSync(target.verify_after_sync);
      setChecksumVerify(target.checksum_verify);
      setStandbyMode(target.standby_service_mode);
      setStopCmd(target.service_stop_cmd || 'systemctl stop urbackupsrv');
      setStartCmd(target.service_start_cmd || 'systemctl start urbackupsrv');
      setBtrfsMode(target.btrfs_mode || 'auto');
    }
  }, [target]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!host.trim()) { setError('Host is required'); return; }

    setSaving(true);
    setError('');
    try {
      const repoMap = repoPaths.length > 0
        ? Object.fromEntries(repoPaths.filter(r => r.src && r.dst).map(r => [r.src, r.dst]))
        : null;

      const payload: any = {
        name: name.trim() || `Target ${host}`,
        enabled,
        host: host.trim(),
        port,
        ssh_user: sshUser,
        auth_type: authType,
        ssh_known_host_fingerprint: fingerprint.trim() || null,
        target_root_path: targetRootPath,
        target_repo_paths_map: repoMap,
        target_db_type: dbType,
        bandwidth_limit_mbps: bwLimit,
        verify_after_sync: verifyAfterSync,
        checksum_verify: checksumVerify,
        standby_service_mode: standbyMode,
        service_stop_cmd: stopCmd,
        service_start_cmd: startCmd,
        btrfs_mode: btrfsMode,
      };

      // Only include secret fields if changed
      if (authType === 'ssh_key' && privateKey && privateKey !== REDACTED) {
        payload.ssh_private_key = privateKey;
      }
      if (authType === 'password' && password && password !== REDACTED) {
        payload.ssh_password = password;
      }
      if (dbType === 'mysql' && dbDsn && dbDsn !== REDACTED) {
        payload.target_db_dsn = dbDsn;
      }

      if (isEdit) {
        await api.updateReplicationTarget(target.id, payload);
      } else {
        await api.createReplicationTarget(payload);
      }
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b dark:border-gray-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {isEdit ? 'Edit Replication Target' : 'Add Replication Target'}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Basic */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Basic</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                <input
                  type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="e.g. DR Site"
                  className="input w-full"
                />
              </div>
              <div className="flex items-center gap-3 pt-5">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="sr-only peer" />
                  <div className="w-10 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-primary-500 rounded-full peer dark:bg-gray-700 peer-checked:bg-primary-600 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
                </label>
                <span className="text-sm text-gray-700 dark:text-gray-300">Enabled</span>
              </div>
            </div>
          </section>

          {/* Connection */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Connection</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Host *</label>
                <input type="text" value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.1.100" className="input w-full" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">SSH Port</label>
                <input type="number" value={port} onChange={e => setPort(Number(e.target.value))} min={1} max={65535} className="input w-full" />
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">SSH User</label>
              <input type="text" value={sshUser} onChange={e => setSshUser(e.target.value)} className="input w-full" />
            </div>
            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Authentication</label>
              <div className="flex gap-4">
                {(['ssh_key', 'password'] as const).map(at => (
                  <label key={at} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="auth_type" value={at} checked={authType === at} onChange={() => setAuthType(at)} className="text-primary-600" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{at === 'ssh_key' ? 'SSH Key' : 'Password'}</span>
                  </label>
                ))}
              </div>
            </div>
            {authType === 'ssh_key' ? (
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Private Key (PEM)</label>
                <textarea
                  value={privateKey} onChange={e => setPrivateKey(e.target.value)}
                  rows={4} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  className="input w-full font-mono text-xs"
                />
              </div>
            ) : (
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">SSH Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="input w-full" />
              </div>
            )}
            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Known Host Fingerprint (optional)</label>
              <input type="text" value={fingerprint} onChange={e => setFingerprint(e.target.value)} placeholder="ssh-ed25519 AAAA..." className="input w-full font-mono text-xs" />
            </div>
          </section>

          {/* Target Paths */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Target Paths</h3>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Target Root Path</label>
              <input type="text" value={targetRootPath} onChange={e => setTargetRootPath(e.target.value)} className="input w-full" />
            </div>
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Repo Path Overrides (Source → Target)</label>
                <button type="button" onClick={() => setRepoPaths([...repoPaths, { src: '', dst: '' }])}
                  className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700">
                  <Plus className="h-3 w-3" /> Add
                </button>
              </div>
              {repoPaths.map((rp, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input type="text" value={rp.src} onChange={e => { const n = [...repoPaths]; n[i].src = e.target.value; setRepoPaths(n); }}
                    placeholder="Source path" className="input flex-1 text-xs" />
                  <input type="text" value={rp.dst} onChange={e => { const n = [...repoPaths]; n[i].dst = e.target.value; setRepoPaths(n); }}
                    placeholder="Target path" className="input flex-1 text-xs" />
                  <button type="button" onClick={() => setRepoPaths(repoPaths.filter((_, j) => j !== i))}
                    className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {repoPaths.length === 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">Using defaults from Settings → State Set</p>
              )}
            </div>
          </section>

          {/* Database */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Database</h3>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Target DB Type</label>
              <select value={dbType} onChange={e => setDbType(e.target.value as any)} className="input w-full">
                <option value="sqlite">SQLite (default UrBackup)</option>
                <option value="mysql">MySQL/MariaDB</option>
              </select>
            </div>
            {dbType === 'mysql' && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">MySQL DSN</label>
                <input type="text" value={dbDsn} onChange={e => setDbDsn(e.target.value)} placeholder="mysql://user:pass@host:3306/db" className="input w-full" />
              </div>
            )}
          </section>

          {/* Options */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Options</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Bandwidth Limit (MB/s, 0 = unlimited)</label>
                <input type="number" value={bwLimit} onChange={e => setBwLimit(Number(e.target.value))} min={0} className="input w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Standby Service Mode</label>
                <select value={standbyMode} onChange={e => setStandbyMode(e.target.value as any)} className="input w-full">
                  <option value="stopped">Stop during sync</option>
                  <option value="running_readonly">Keep running (read-only)</option>
                </select>
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Storage Transfer Mode</label>
              <select value={btrfsMode} onChange={e => setBtrfsMode(e.target.value as any)} className="input w-full">
                <option value="auto">Auto-detect (use btrfs send/receive if source is btrfs, otherwise rsync)</option>
                <option value="btrfs_send">Force btrfs send/receive</option>
                <option value="rsync">Force rsync</option>
              </select>
              {btrfsMode !== 'rsync' && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  btrfs send/receive preserves snapshot relationships and deduplication — target storage must also be btrfs.
                  Requires <code className="font-mono">btrfs-progs</code> on both servers.
                </p>
              )}
            </div>
            <div className="mt-3 flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={verifyAfterSync} onChange={e => setVerifyAfterSync(e.target.checked)} className="rounded text-primary-600" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Verify after sync</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={checksumVerify} onChange={e => setChecksumVerify(e.target.checked)} className="rounded text-primary-600" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Checksum verify</span>
              </label>
            </div>
          </section>

          {/* Advanced (collapsible) */}
          <section>
            <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
              {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Advanced
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Service Stop Command</label>
                  <input type="text" value={stopCmd} onChange={e => setStopCmd(e.target.value)} className="input w-full font-mono text-xs" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Service Start Command</label>
                  <input type="text" value={startCmd} onChange={e => setStartCmd(e.target.value)} className="input w-full font-mono text-xs" />
                </div>
              </div>
            )}
          </section>

          <div className="flex justify-end gap-3 pt-2 border-t dark:border-gray-700">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Target'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
