import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck, RefreshCw, Play, Plus, Trash2, Pencil, CheckCircle, AlertCircle, Loader2, Clock,
  FileCheck, Server, HardDrive, GitBranch, FlaskConical, Download, ChevronDown, ChevronRight, X,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { recoveryApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { formatBytes } from '../utils/format';
import { fmtMs, fmtAge } from '../utils/recovery';
import type { ClientRecoveryStatus, Drill, DrillRun, Canary, Hypervisor, BootConfig } from '../types/recovery';

type Tab = 'status' | 'drills' | 'runs' | 'canaries' | 'hypervisors';
type Msg = { type: 'success' | 'error'; text: string } | null;

const errText = (e: any, fallback: string) => e?.response?.data?.error || e?.message || fallback;

const fmtTime = (t: string | number | null | undefined) => (t ? new Date(t).toLocaleString() : '—');

const TONE: Record<string, string> = {
  good: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  bad: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  none: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  sim: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
};

export function Badge({ tone, children, title }: { tone: keyof typeof TONE; children: React.ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}>{children}</span>;
}

export function RunStatusBadge({ run }: { run: Pick<DrillRun, 'status' | 'evidence'> | null }) {
  if (!run) return <Badge tone="none">never run</Badge>;
  const icon = run.status === 'passed' ? <CheckCircle className="h-3 w-3" /> : run.status === 'running' ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlertCircle className="h-3 w-3" />;
  const tone = run.status === 'passed' ? 'good' : run.status === 'running' ? 'info' : run.status === 'error' || run.status === 'interrupted' ? 'warn' : 'bad';
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={tone}>{icon}{run.status}</Badge>
      {run.evidence === 'simulated' && <Badge tone="sim" title="Simulated: not evidence that anything can be recovered"><FlaskConical className="h-3 w-3" />simulated</Badge>}
    </span>
  );
}

function StateBadge({ kind, state }: { kind: 'backup' | 'replication' | 'recovery'; state: string }) {
  const map: Record<string, [keyof typeof TONE, string]> = {
    ok: ['good', kind === 'backup' ? 'backups OK' : 'replicated'],
    verified: ['good', 'verified'],
    stale: ['warn', 'verified, old point'],
    failed: ['bad', 'failed'],
    running: ['info', 'running'],
    none: ['none', 'no backups'],
    unknown: ['none', 'unknown'],
    never_run: ['warn', 'not yet run'],
    not_configured: ['none', 'not set up'],
  };
  const [tone, label] = map[state] || ['none', state];
  return <Badge tone={tone}>{label}</Badge>;
}

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white shadow dark:bg-gray-800">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        <div className="flex gap-2">{actions}</div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

const input = 'w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100';
const btn = 'inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50';
const btnPrimary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const btnGhost = `${btn} border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700`;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-700 dark:text-gray-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{hint}</span>}
    </label>
  );
}

// ── Status ────────────────────────────────────────────────────────────────

function StatusTab({ statuses }: { statuses: ClientRecoveryStatus[] }) {
  if (!statuses.length) return <p className="text-sm text-gray-500">No endpoints yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400">
            <th className="py-2 pr-4">Endpoint</th>
            <th className="py-2 pr-4"><span className="inline-flex items-center gap-1"><HardDrive className="h-3 w-3" />Backup</span></th>
            <th className="py-2 pr-4"><span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" />Offsite replication</span></th>
            <th className="py-2 pr-4"><span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" />Verified recovery</span></th>
            <th className="py-2 pr-4">Last verified</th>
            <th className="py-2 pr-4">Recovery point age</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {statuses.map((s) => (
            <tr key={s.client_name} className="text-gray-800 dark:text-gray-200">
              <td className="py-2 pr-4 font-medium">{s.client_name}</td>
              <td className="py-2 pr-4"><StateBadge kind="backup" state={s.backup.state} /><div className="text-xs text-gray-500">{fmtTime(s.backup.last_file_backup)}</div></td>
              <td className="py-2 pr-4"><StateBadge kind="replication" state={s.replication.state} />
                <div className="text-xs text-gray-500">{s.replication.targets.map((t) => `${t.name}: ${t.last_success?.finished_at ? fmtTime(t.last_success.finished_at) : 'never'}`).join(', ')}</div></td>
              <td className="py-2 pr-4"><StateBadge kind="recovery" state={s.recovery.state} />
                {s.recovery.last_run && s.recovery.state === 'failed' && <div className="max-w-xs truncate text-xs text-red-600" title={s.recovery.last_run.failure_reason || ''}>{s.recovery.last_run.failure_stage}: {s.recovery.last_run.failure_reason}</div>}
                {s.simulation && <div className="mt-1"><Badge tone="sim" title="The newest simulation; it does not count as verification"><FlaskConical className="h-3 w-3" />sim {s.simulation.last_run.status}</Badge></div>}</td>
              <td className="py-2 pr-4 text-xs">{fmtTime(s.recovery.last_passed?.finished_at)}</td>
              <td className="py-2 pr-4 text-xs">{fmtAge(s.recovery.last_passed?.recovery_point_age_seconds)}</td>
              <td className="py-2 text-right"><Link className="text-blue-600 hover:underline dark:text-blue-400" to={`/recovery/report/${encodeURIComponent(s.client_name)}`}>Report</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        The three statuses are independent: a successful backup or replication says nothing about whether data can be restored.
        Only drills that actually restored data count as verified recovery; simulations are shown separately.
      </p>
    </div>
  );
}

// ── Drills ────────────────────────────────────────────────────────────────

const emptyDrill = (): Partial<Drill> & { boot_config: BootConfig } => ({
  kind: 'file', name: '', client_name: '', enabled: true, schedule_type: 'interval', interval_hours: 24, cron_expression: '0 3 * * *',
  max_recovery_point_age_hours: 48, timeout_seconds: 900, retry_max_attempts: 2, canary_id: '', replication_target_id: '', hypervisor_id: '',
  boot_config: { profile: 'windows-uefi', service: '', memory_mb: 4096, cores: 2, boot_timeout_seconds: 600, service_timeout_seconds: 300 },
});

function DrillForm({ initial, canaries, hypervisors, options, onSaved, onCancel }: {
  initial: Partial<Drill> & { boot_config: BootConfig }; canaries: Canary[]; hypervisors: Hypervisor[];
  options: { replication_targets: Array<{ id: string; name: string; host: string }>; clients: string[] };
  onSaved: (m: string) => void; onCancel: () => void;
}) {
  const [d, setD] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<typeof d>) => setD((x) => ({ ...x, ...patch }));
  const setBoot = (patch: Partial<BootConfig>) => setD((x) => ({ ...x, boot_config: { ...x.boot_config, ...patch } }));
  const hv = hypervisors.find((h) => h.id === d.hypervisor_id);
  const clientCanaries = canaries.filter((c) => c.client_name === d.client_name);

  const save = async () => {
    setSaving(true); setError('');
    try {
      if (d.id) await recoveryApi.updateDrill(d.id, d); else await recoveryApi.createDrill(d);
      onSaved(d.id ? 'Drill saved' : 'Drill created');
    } catch (e) { setError(errText(e, 'Could not save the drill')); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4 rounded-md border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-900 dark:bg-blue-950/20">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Type">
          <select className={input} value={d.kind} onChange={(e) => set({ kind: e.target.value as Drill['kind'], timeout_seconds: e.target.value === 'boot' ? 7200 : 900 })}>
            <option value="file">File restore (canary from the offsite copy)</option>
            <option value="boot">Isolated boot (Windows UEFI image on Proxmox)</option>
          </select>
        </Field>
        <Field label="Name"><input className={input} value={d.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Endpoint">
          <select className={input} value={d.client_name} onChange={(e) => set({ client_name: e.target.value, canary_id: '' })}>
            <option value="">Choose…</option>
            {[...new Set([...options.clients, ...(d.client_name ? [d.client_name] : [])])].sort().map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      {d.kind === 'file' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Canary file" hint="A known file whose checksum St0r holds independently of the backups (Canaries tab).">
            <select className={input} value={d.canary_id || ''} onChange={(e) => set({ canary_id: e.target.value })}>
              <option value="">Choose…</option>
              {clientCanaries.map((c) => <option key={c.id} value={c.id}>{c.path}</option>)}
            </select>
          </Field>
          <Field label="Offsite copy" hint="The replication target (second UrBackup server) the canary is restored from.">
            <select className={input} value={d.replication_target_id || ''} onChange={(e) => set({ replication_target_id: e.target.value })}>
              <option value="">Choose…</option>
              {options.replication_targets.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.host})</option>)}
            </select>
          </Field>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Hypervisor">
            <select className={input} value={d.hypervisor_id || ''} onChange={(e) => set({ hypervisor_id: e.target.value })}>
              <option value="">Choose…</option>
              {hypervisors.map((h) => <option key={h.id} value={h.id}>{h.name}{h.type === 'simulator' ? ' (simulator)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Service that must be running" hint="Windows service name, e.g. MSSQLSERVER, W3SVC.">
            <input className={input} value={d.boot_config.service} onChange={(e) => setBoot({ service: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Memory (MB)"><input type="number" className={input} value={d.boot_config.memory_mb} onChange={(e) => setBoot({ memory_mb: Number(e.target.value) })} /></Field>
            <Field label="Cores"><input type="number" className={input} value={d.boot_config.cores} onChange={(e) => setBoot({ cores: Number(e.target.value) })} /></Field>
            <Field label="Boot timeout (s)"><input type="number" className={input} value={d.boot_config.boot_timeout_seconds} onChange={(e) => setBoot({ boot_timeout_seconds: Number(e.target.value) })} /></Field>
            <Field label="Service timeout (s)"><input type="number" className={input} value={d.boot_config.service_timeout_seconds} onChange={(e) => setBoot({ service_timeout_seconds: Number(e.target.value) })} /></Field>
          </div>
          {hv?.type === 'simulator' && (
            <Field label="Simulated outcome" hint="Simulator runs are recorded as simulated and never count as verified recovery.">
              <select className={input} value={`${d.boot_config.simulate?.boot || 'ok'}/${d.boot_config.simulate?.service || 'ok'}`}
                onChange={(e) => { const [boot, service] = e.target.value.split('/') as ['ok' | 'fail', 'ok' | 'fail']; setBoot({ simulate: { boot, service } }); }}>
                <option value="ok/ok">Boots, service runs</option>
                <option value="fail/ok">Does not boot</option>
                <option value="ok/fail">Boots, service fails</option>
              </select>
            </Field>
          )}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-5">
        <Field label="Schedule">
          <select className={input} value={d.schedule_type} onChange={(e) => set({ schedule_type: e.target.value as Drill['schedule_type'] })}>
            <option value="manual">Manual only</option><option value="interval">Every N hours</option><option value="cron">Cron</option>
          </select>
        </Field>
        {d.schedule_type === 'interval' && <Field label="Every (hours)"><input type="number" className={input} value={d.interval_hours} onChange={(e) => set({ interval_hours: Number(e.target.value) })} /></Field>}
        {d.schedule_type === 'cron' && <Field label="Cron (min hour day month weekday)"><input className={input} value={d.cron_expression} onChange={(e) => set({ cron_expression: e.target.value })} /></Field>}
        <Field label="Alert if recovery point older than (h)"><input type="number" className={input} value={d.max_recovery_point_age_hours} onChange={(e) => set({ max_recovery_point_age_hours: Number(e.target.value) })} /></Field>
        <Field label="Timeout (s)"><input type="number" className={input} value={d.timeout_seconds} onChange={(e) => set({ timeout_seconds: Number(e.target.value) })} /></Field>
        <Field label="Attempts"><input type="number" className={input} value={d.retry_max_attempts} onChange={(e) => set({ retry_max_attempts: Number(e.target.value) })} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input type="checkbox" checked={d.enabled !== false} onChange={(e) => set({ enabled: e.target.checked })} /> Enabled (scheduled runs)
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={saving} onClick={save}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}Save</button>
        <button className={btnGhost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function DrillsTab({ drills, canaries, hypervisors, isAdmin, reload, setMsg }: {
  drills: Drill[]; canaries: Canary[]; hypervisors: Hypervisor[]; isAdmin: boolean; reload: () => void; setMsg: (m: Msg) => void;
}) {
  const [editing, setEditing] = useState<(Partial<Drill> & { boot_config: BootConfig }) | null>(null);
  const [options, setOptions] = useState<{ replication_targets: Array<{ id: string; name: string; host: string; enabled: number }>; clients: string[] }>({ replication_targets: [], clients: [] });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { if (isAdmin) recoveryApi.options().then(setOptions).catch(() => undefined); }, [isAdmin]);

  const run = async (d: Drill) => {
    setBusy(d.id);
    try { await recoveryApi.runDrill(d.id); setMsg({ type: 'success', text: `Started "${d.name}"` }); reload(); }
    catch (e) { setMsg({ type: 'error', text: errText(e, 'Could not start the drill') }); } finally { setBusy(null); }
  };
  const remove = async (d: Drill) => {
    try { await recoveryApi.deleteDrill(d.id); setMsg({ type: 'success', text: `Deleted "${d.name}" (its runs are kept)` }); reload(); }
    catch (e) { setMsg({ type: 'error', text: errText(e, 'Could not delete the drill') }); } finally { setConfirmDelete(null); }
  };

  return (
    <div className="space-y-4">
      {isAdmin && !editing && <button className={btnPrimary} onClick={() => setEditing(emptyDrill())}><Plus className="h-4 w-4" />New drill</button>}
      {editing && <DrillForm initial={editing} canaries={canaries} hypervisors={hypervisors} options={options}
        onCancel={() => setEditing(null)} onSaved={(m) => { setEditing(null); setMsg({ type: 'success', text: m }); reload(); }} />}
      {!drills.length && !editing && <p className="text-sm text-gray-500">No drills yet. Register a canary first, then create a file-restore drill against your replication target.</p>}
      <div className="space-y-2">
        {drills.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 p-3 dark:border-gray-700">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
                {d.kind === 'file' ? <FileCheck className="h-4 w-4 text-blue-500" /> : <Server className="h-4 w-4 text-indigo-500" />}
                {d.name} <span className="text-xs font-normal text-gray-500">— {d.client_name}</span>
                {!d.enabled && <Badge tone="none">disabled</Badge>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                {d.running ? <Badge tone="info"><Loader2 className="h-3 w-3 animate-spin" />running</Badge> : <RunStatusBadge run={d.last_run} />}
                <span><Clock className="mr-1 inline h-3 w-3" />{d.schedule_type === 'manual' ? 'manual' : d.schedule_type === 'interval' ? `every ${d.interval_hours} h` : d.cron_expression}</span>
                {d.last_run && <span>last {fmtTime(d.last_run.finished_at)} · took {fmtMs(d.last_run.elapsed_ms)} · point {fmtAge(d.last_run.recovery_point_age_seconds)} old</span>}
                {d.last_run?.failure_reason && <span className="text-red-600">{d.last_run.failure_stage}: {d.last_run.failure_reason}</span>}
              </div>
            </div>
            {isAdmin && (
              <div className="flex gap-2">
                <button className={btnGhost} disabled={d.running || busy === d.id} onClick={() => run(d)}><Play className="h-4 w-4" />Run now</button>
                <button className={btnGhost} onClick={() => setEditing({ ...emptyDrill(), ...d, boot_config: { ...emptyDrill().boot_config, ...(d.boot_config || {}) } })}><Pencil className="h-4 w-4" /></button>
                {confirmDelete === d.id
                  ? <button className={`${btn} bg-red-600 text-white`} onClick={() => remove(d)}>Confirm delete</button>
                  : <button className={btnGhost} onClick={() => setConfirmDelete(d.id)}><Trash2 className="h-4 w-4" /></button>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Runs ──────────────────────────────────────────────────────────────────

function RunDetail({ id }: { id: string }) {
  const [run, setRun] = useState<DrillRun | null>(null);
  useEffect(() => { recoveryApi.run(id).then(setRun).catch(() => undefined); }, [id]);
  if (!run) return <Loader2 className="h-4 w-4 animate-spin" />;
  const rp = run.restore_point_json || {};
  return (
    <div className="space-y-3 text-xs text-gray-700 dark:text-gray-300">
      <div className="grid gap-2 md:grid-cols-2">
        <div><b>Copy used:</b> {run.copy_json?.kind === 'offsite' ? `offsite — ${run.copy_json.target_name}${run.copy_json.host ? ` (${run.copy_json.host})` : ''}${run.copy_json.path ? `: ${run.copy_json.path}` : ''}` : run.copy_json ? `${run.copy_json.description || 'primary'} → ${run.copy_json.hypervisor || ''}` : '—'}</div>
        <div><b>Restore point:</b> {rp.kind === 'image' ? (rp.images || []).map((i: any) => `${i.letter} #${i.image_id} (${new Date(i.backup_time).toLocaleString()}, chain ${i.chain.join('→')})`).join('; ') : rp.backup_path ? `backup #${rp.backup_id} ${rp.backup_path} (${new Date(rp.backup_time).toLocaleString()})` : '—'}</div>
        {run.expected_sha256 && <div className="font-mono"><b className="font-sans">Expected:</b> {run.expected_sha256}</div>}
        {run.actual_sha256 && <div className="font-mono"><b className="font-sans">Restored:</b> {run.actual_sha256}</div>}
        {run.copy_json?.network && <div><b>Network:</b> {run.copy_json.network}</div>}
        {run.bytes_restored !== null && <div><b>Restored:</b> {formatBytes(run.bytes_restored)}</div>}
        {run.boot_ms !== null && <div><b>Boot:</b> {fmtMs(run.boot_ms)} · <b>Recovery time:</b> {fmtMs(run.rto_ms)}</div>}
        {(run.services_json || []).map((s) => <div key={s.name}><b>Service {s.name}:</b> {s.passed ? 'passed' : 'FAILED'} — {s.detail}</div>)}
      </div>
      {!!run.steps_json?.length && <div>
        <b>Steps</b>
        <ol className="mt-1 space-y-0.5 font-mono">{(run.steps_json || []).map((s, i) => <li key={i}>{new Date(s.at).toLocaleTimeString()} [{s.stage}] {s.message}</li>)}</ol>
      </div>}
      {!!run.resources?.length && (
        <div>
          <b>Created and removed (cleanup: {run.cleanup_status})</b>
          <ul className="mt-1 font-mono">{run.resources.map((r) => <li key={r.id}>{r.kind} {r.locator} — {r.state}{r.last_error ? ` (${r.last_error})` : ''}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function RunsTab({ runs }: { runs: DrillRun[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!runs.length) return <p className="text-sm text-gray-500">No runs yet.</p>;
  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-700">
      {runs.map((r) => (
        <div key={r.id} className="py-2">
          <button className="flex w-full flex-wrap items-center gap-3 text-left text-sm text-gray-800 dark:text-gray-200" onClick={() => setOpen(open === r.id ? null : r.id)}>
            {open === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span className="w-40 text-xs text-gray-500">{fmtTime(r.started_at)}</span>
            <span className="w-28">{r.client_name}</span>
            <span className="w-14 text-xs">{r.kind}</span>
            <RunStatusBadge run={r} />
            <span className="text-xs text-gray-500">{fmtMs(r.elapsed_ms)} · point {fmtAge(r.recovery_point_age_seconds)} old · {r.attempts} attempt(s){r.cleanup_status === 'pending' || r.cleanup_status === 'failed' ? ` · cleanup ${r.cleanup_status}` : ''}</span>
            {r.failure_reason && <span className="truncate text-xs text-red-600">{r.failure_stage}: {r.failure_reason}</span>}
          </button>
          {open === r.id && <div className="ml-6 mt-2"><RunDetail id={r.id} /></div>}
        </div>
      ))}
    </div>
  );
}

// ── Canaries ──────────────────────────────────────────────────────────────

function CanariesTab({ canaries, isAdmin, reload, setMsg }: { canaries: Canary[]; isAdmin: boolean; reload: () => void; setMsg: (m: Msg) => void }) {
  const [form, setForm] = useState({ mode: 'generate' as 'generate' | 'manual', client_name: '', path: 'C/Users/Public/Documents/st0r-canary.bin', sha256: '', size_bytes: '' });
  const [clients, setClients] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  useEffect(() => { if (isAdmin) recoveryApi.options().then((o) => setClients(o.clients)).catch(() => undefined); }, [isAdmin]);

  const submit = async () => {
    try {
      if (form.mode === 'generate') {
        const g = await recoveryApi.generateCanary({ client_name: form.client_name, path: form.path });
        const bytes = Uint8Array.from(atob(g.content_base64), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
        const a = document.createElement('a'); a.href = url; a.download = g.filename; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        setMsg({ type: 'success', text: `Canary generated (SHA-256 ${g.sha256.slice(0, 16)}…). Copy the downloaded ${g.filename} to ${form.path.replace(/\//g, '\\').replace(/^([A-Za-z])\\/, '$1:\\')} on ${form.client_name}; drills find it after the next backup has replicated.` });
      } else {
        await recoveryApi.createCanary({ client_name: form.client_name, path: form.path, sha256: form.sha256, size_bytes: form.size_bytes ? Number(form.size_bytes) : null });
        setMsg({ type: 'success', text: 'Canary registered' });
      }
      reload();
    } catch (e) { setMsg({ type: 'error', text: errText(e, 'Could not save the canary') }); }
  };
  const remove = async (c: Canary) => {
    try { await recoveryApi.deleteCanary(c.id); reload(); } catch (e) { setMsg({ type: 'error', text: errText(e, 'Could not delete') }); } finally { setConfirmDelete(null); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        A canary is a file on the endpoint whose SHA-256 St0r stores itself, independently of any backup. A file drill restores it from the offsite copy and compares.
        Generated canaries are random content made here, so their checksum is known before they are ever backed up.
      </p>
      {isAdmin && (
        <div className="grid gap-3 rounded-md border border-gray-200 p-3 md:grid-cols-5 dark:border-gray-700">
          <Field label="How"><select className={input} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as 'generate' | 'manual' })}><option value="generate">Generate a new file</option><option value="manual">Register an existing file</option></select></Field>
          <Field label="Endpoint"><select className={input} value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })}><option value="">Choose…</option>{clients.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Path inside the backup" hint="As in the file browser: C/Users/…"><input className={input} value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} /></Field>
          {form.mode === 'manual' && <Field label="SHA-256 of the original"><input className={`${input} font-mono`} value={form.sha256} onChange={(e) => setForm({ ...form, sha256: e.target.value.trim() })} /></Field>}
          <div className="flex items-end"><button className={btnPrimary} onClick={submit}>{form.mode === 'generate' ? <Download className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{form.mode === 'generate' ? 'Generate & download' : 'Register'}</button></div>
        </div>
      )}
      <table className="min-w-full text-sm">
        <thead><tr className="text-left text-xs uppercase text-gray-500"><th className="py-1 pr-3">Endpoint</th><th className="py-1 pr-3">Path</th><th className="py-1 pr-3">SHA-256</th><th className="py-1 pr-3">Source</th><th></th></tr></thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {canaries.map((c) => (
            <tr key={c.id} className="text-gray-800 dark:text-gray-200">
              <td className="py-1 pr-3">{c.client_name}</td><td className="py-1 pr-3 font-mono text-xs">{c.path}</td>
              <td className="py-1 pr-3 font-mono text-xs" title={c.sha256}>{c.sha256.slice(0, 16)}…</td><td className="py-1 pr-3 text-xs">{c.source}</td>
              <td className="py-1 text-right">{isAdmin && (confirmDelete === c.id
                ? <button className={`${btn} bg-red-600 text-white`} onClick={() => remove(c)}>Confirm</button>
                : <button className={btnGhost} onClick={() => setConfirmDelete(c.id)}><Trash2 className="h-4 w-4" /></button>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Hypervisors ───────────────────────────────────────────────────────────

const emptyHv = { name: '', type: 'proxmox', api_url: 'https://', token_id: '', token_secret: '', tls_fingerprint: '', node: 'pve', disk_storage: 'local-lvm', import_storage: 'local', isolated_bridge: '', artifact_base_url: '', max_disk_gb: 512, scratch_quota_gb: 600 };

function HypervisorsTab({ hypervisors, reload, setMsg }: { hypervisors: Hypervisor[]; reload: () => void; setMsg: (m: Msg) => void }) {
  const [form, setForm] = useState<(typeof emptyHv & { id?: string }) | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; checks: Array<{ check: string; ok: boolean; detail: string }> }>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const save = async () => {
    if (!form) return;
    try {
      const { id, ...body } = form;
      if (id) await recoveryApi.updateHypervisor(id, body); else await recoveryApi.createHypervisor(body);
      setForm(null); reload(); setMsg({ type: 'success', text: 'Hypervisor saved' });
    } catch (e) { setMsg({ type: 'error', text: errText(e, 'Could not save') }); }
  };
  const test = async (h: Hypervisor) => {
    try { const r = await recoveryApi.testHypervisor(h.id); setTests((t) => ({ ...t, [h.id]: r })); } catch (e) { setMsg({ type: 'error', text: errText(e, 'Test failed') }); }
  };
  const f = (k: keyof typeof emptyHv, label: string, hint?: string, type = 'text') => form && (
    <Field label={label} hint={hint}><input type={type} className={input} value={String(form[k] ?? '')} onChange={(e) => setForm({ ...form, [k]: type === 'number' ? Number(e.target.value) : e.target.value })} /></Field>
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Optional, for boot drills: a disposable Proxmox VE 8.4+ node (for example one managed with Depl0y). St0r creates one clone per drill, tagged
        <code className="mx-1">st0r-drill</code>, with no network device unless an isolated bridge (no uplink, no host address) is set, and removes only what it created.
        See the documentation for the supported image/firmware combination and the API token permissions.
      </p>
      {!form && <button className={btnPrimary} onClick={() => setForm({ ...emptyHv })}><Plus className="h-4 w-4" />Add hypervisor</button>}
      {form && (
        <div className="space-y-3 rounded-md border border-blue-200 p-4 dark:border-blue-900">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Type"><select className={input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="proxmox">Proxmox VE</option><option value="simulator">Simulator (no real VM; runs are marked simulated)</option></select></Field>
            {f('name', 'Name')}
            {form.type === 'proxmox' && f('api_url', 'API URL', 'https://pve.example:8006')}
          </div>
          {form.type === 'proxmox' && (
            <div className="grid gap-3 md:grid-cols-3">
              {f('token_id', 'API token id', 'user@realm!tokenid')}
              {f('token_secret', form.id ? 'API token secret (leave empty to keep)' : 'API token secret', undefined, 'password')}
              {f('tls_fingerprint', 'TLS fingerprint (SHA-256)', 'Pin the node certificate; leave empty if it has a CA-signed certificate')}
              {f('node', 'Node')}
              {f('disk_storage', 'VM disk storage')}
              {f('import_storage', 'Import storage', 'Must allow the "import" content type')}
              {f('isolated_bridge', 'Isolated bridge (optional)', 'Empty: the clone gets no network device')}
              {f('artifact_base_url', 'St0r address as Proxmox sees it', 'e.g. https://st0r.lan — Proxmox downloads the drill disk from here')}
              <div className="grid grid-cols-2 gap-2">{f('max_disk_gb', 'Max disk (GiB)', undefined, 'number')}{f('scratch_quota_gb', 'Scratch quota (GiB)', undefined, 'number')}</div>
            </div>
          )}
          <div className="flex gap-2"><button className={btnPrimary} onClick={save}>Save</button><button className={btnGhost} onClick={() => setForm(null)}>Cancel</button></div>
        </div>
      )}
      {hypervisors.map((h) => (
        <div key={h.id} className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-gray-800 dark:text-gray-200">
              <b>{h.name}</b> {h.type === 'simulator' ? <Badge tone="sim">simulator</Badge> : <span className="text-xs text-gray-500">{h.api_url} · node {h.node} · {h.disk_storage}/{h.import_storage} · {h.isolated_bridge ? `bridge ${h.isolated_bridge}` : 'no network'}</span>}
            </div>
            <div className="flex gap-2">
              <button className={btnGhost} onClick={() => test(h)}>Test</button>
              <button className={btnGhost} onClick={() => setForm({ ...emptyHv, ...h, token_secret: '', tls_fingerprint: h.tls_fingerprint || '', isolated_bridge: h.isolated_bridge || '', artifact_base_url: h.artifact_base_url || '' })}><Pencil className="h-4 w-4" /></button>
              {confirmDelete === h.id
                ? <button className={`${btn} bg-red-600 text-white`} onClick={async () => { try { await recoveryApi.deleteHypervisor(h.id); reload(); } catch (e) { setMsg({ type: 'error', text: errText(e, 'Could not delete') }); } setConfirmDelete(null); }}>Confirm</button>
                : <button className={btnGhost} onClick={() => setConfirmDelete(h.id)}><Trash2 className="h-4 w-4" /></button>}
            </div>
          </div>
          {tests[h.id] && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {tests[h.id].checks.map((c) => <li key={c.check} className={c.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600'}>{c.ok ? '✓' : '✗'} {c.check}: {c.detail}</li>)}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export function RecoveryVerification() {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const [tab, setTab] = useState<Tab>('status');
  const [statuses, setStatuses] = useState<ClientRecoveryStatus[]>([]);
  const [drills, setDrills] = useState<Drill[]>([]);
  const [runs, setRuns] = useState<DrillRun[]>([]);
  const [canaries, setCanaries] = useState<Canary[]>([]);
  const [hypervisors, setHypervisors] = useState<Hypervisor[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(async () => {
    try {
      const [s, d, r, c, h] = await Promise.all([
        recoveryApi.status(), recoveryApi.drills(), recoveryApi.runs({ limit: 100 }), recoveryApi.canaries(),
        isAdmin ? recoveryApi.hypervisors() : Promise.resolve([] as Hypervisor[]),
      ]);
      setStatuses(s); setDrills(d); setRuns(r); setCanaries(c); setHypervisors(h);
    } catch (e) {
      setMsg({ type: 'error', text: errText(e, 'Could not load recovery verification') });
    } finally { setLoading(false); }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);
  // Refresh while something is running.
  useEffect(() => {
    if (!drills.some((d) => d.running)) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [drills, load]);

  const tabs: Array<[Tab, string]> = [['status', 'Status'], ['drills', 'Drills'], ['runs', 'Runs'], ['canaries', 'Canaries'], ...(isAdmin ? [['hypervisors', 'Boot hypervisors'] as [Tab, string]] : [])];

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100"><ShieldCheck className="h-6 w-6 text-green-600" />Recovery Verification</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">Scheduled restore drills: proof that backups can actually be restored, from the offsite copy.</p>
          </div>
          <button className={btnGhost} onClick={() => { setLoading(true); load(); }}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
        </div>
        {msg && (
          <div className={`flex items-start justify-between rounded-md p-3 text-sm ${msg.type === 'success' ? 'bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300'}`}>
            <span>{msg.text}</span><button onClick={() => setMsg(null)}><X className="h-4 w-4" /></button>
          </div>
        )}
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 text-sm font-medium ${tab === k ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400' : 'text-gray-600 hover:text-gray-900 dark:text-gray-400'}`}>{label}</button>
          ))}
        </div>
        {loading && !statuses.length ? <Loader2 className="h-6 w-6 animate-spin text-gray-400" /> : (
          <>
            {tab === 'status' && <Section title="Per endpoint"><StatusTab statuses={statuses} /></Section>}
            {tab === 'drills' && <Section title="Drills"><DrillsTab drills={drills} canaries={canaries} hypervisors={hypervisors} isAdmin={isAdmin} reload={load} setMsg={setMsg} /></Section>}
            {tab === 'runs' && <Section title="Recent runs"><RunsTab runs={runs} /></Section>}
            {tab === 'canaries' && <Section title="Canary files"><CanariesTab canaries={canaries} isAdmin={isAdmin} reload={load} setMsg={setMsg} /></Section>}
            {tab === 'hypervisors' && isAdmin && <Section title="Boot drill hypervisors"><HypervisorsTab hypervisors={hypervisors} reload={load} setMsg={setMsg} /></Section>}
          </>
        )}
      </div>
    </Layout>
  );
}
