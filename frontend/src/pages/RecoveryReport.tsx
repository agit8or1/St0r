import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer, ShieldCheck, FlaskConical, Loader2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { recoveryApi } from '../services/api';
import { formatBytes } from '../utils/format';
import { RunStatusBadge, Badge } from './RecoveryVerification';
import { fmtAge, fmtMs } from '../utils/recovery';
import type { RecoveryReport as Report, ReportRun } from '../types/recovery';

function whatWasRestored(r: ReportRun): string {
  if (r.kind === 'file') return r.restored_item ? `File ${r.restored_item}` : 'File';
  const imgs = (r.restore_point?.images || []) as Array<{ letter: string; image_id: number }>;
  return imgs.length ? `System image (${imgs.map((i) => i.letter).join(' + ')}) booted as a disposable clone` : 'System image';
}

function where(r: ReportRun): string {
  if (!r.copy) return '—';
  if (r.copy.kind === 'offsite') return `Offsite copy${r.copy.target_name ? ` (${r.copy.target_name})` : ''}`;
  return `Primary backup storage → ${r.copy.hypervisor || 'test hypervisor'}${r.copy.network ? `, ${r.copy.network}` : ''}`;
}

function RunsTable({ runs, simulated }: { runs: ReportRun[]; simulated?: boolean }) {
  if (!runs.length) return <p className="text-sm text-gray-500">{simulated ? 'No simulations in this period.' : 'No restore drills ran in this period.'}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm print:text-xs">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500 dark:border-gray-700">
            <th className="py-2 pr-3">When</th><th className="py-2 pr-3">Result</th><th className="py-2 pr-3">What was restored</th>
            <th className="py-2 pr-3">From</th><th className="py-2 pr-3">Recovery point</th><th className="py-2 pr-3">Took</th><th className="py-2">Checks</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {runs.map((r) => (
            <tr key={r.id} className="align-top text-gray-800 dark:text-gray-200">
              <td className="py-2 pr-3 whitespace-nowrap">{new Date(r.started_at).toLocaleString()}<div className="text-xs text-gray-500">{r.drill}</div></td>
              <td className="py-2 pr-3"><RunStatusBadge run={{ status: r.status, evidence: simulated ? 'simulated' : 'actual' }} />
                {r.failure_reason && <div className="mt-1 max-w-xs text-xs text-red-600">{r.failure_stage}: {r.failure_reason}</div>}</td>
              <td className="py-2 pr-3">{whatWasRestored(r)}{r.bytes_restored ? <div className="text-xs text-gray-500">{formatBytes(r.bytes_restored)}</div> : null}</td>
              <td className="py-2 pr-3 text-xs">{where(r)}</td>
              <td className="py-2 pr-3 text-xs">{r.recovery_point_time ? new Date(r.recovery_point_time).toLocaleString() : '—'}<div className="text-gray-500">{fmtAge(r.recovery_point_age_seconds)} old at the time</div></td>
              <td className="py-2 pr-3 text-xs whitespace-nowrap">{fmtMs(r.elapsed_ms)}{r.rto_ms ? <div className="text-gray-500">service up after {fmtMs(r.rto_ms)}</div> : null}</td>
              <td className="py-2 text-xs">
                {r.kind === 'file' && r.expected_sha256 && (
                  <div>{r.actual_sha256 === r.expected_sha256 ? 'Checksum matches' : r.actual_sha256 ? 'Checksum does NOT match' : 'Not compared'}
                    <div className="font-mono text-[10px] text-gray-500">{r.expected_sha256.slice(0, 16)}…</div></div>
                )}
                {r.kind === 'boot' && <div>{r.status === 'passed' || r.boot_ms !== null ? `Booted in ${fmtMs(r.boot_ms)}` : 'Did not boot'}</div>}
                {r.services.map((s) => <div key={s.name}>Service {s.name}: {s.passed ? 'passed' : 'failed'}</div>)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RecoveryReport() {
  const { clientName = '' } = useParams();
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setReport(null);
    recoveryApi.report(clientName, days).then(setReport).catch((e) => setError(e?.response?.data?.error || 'Could not load the report'));
  }, [clientName, days]);

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between print:hidden">
          <Link to="/recovery" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"><ArrowLeft className="h-4 w-4" />Recovery Verification</Link>
          <div className="flex items-center gap-2">
            <select className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[7, 30, 90, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}
            </select>
            <button onClick={() => window.print()} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:text-gray-200"><Printer className="h-4 w-4" />Print / PDF</button>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!report && !error && <Loader2 className="h-6 w-6 animate-spin text-gray-400" />}
        {report && (
          <>
            <div className="rounded-lg bg-white p-6 shadow print:shadow-none dark:bg-gray-800">
              <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-gray-100"><ShieldCheck className="h-5 w-5 text-green-600" />Recovery verification report — {report.client_name}</h1>
              <p className="text-sm text-gray-500">Last {report.period_days} days · generated {new Date(report.generated_at).toLocaleString()}</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-4">
                <div><div className="text-xs uppercase text-gray-500">Restore drills</div><div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{report.summary.actual_runs}</div></div>
                <div><div className="text-xs uppercase text-gray-500">Passed</div><div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{report.summary.actual_passed}</div></div>
                <div><div className="text-xs uppercase text-gray-500">Last verified recovery</div><div className="text-sm text-gray-900 dark:text-gray-100">{report.summary.last_verified ? new Date(report.summary.last_verified).toLocaleString() : 'none in this period'}</div></div>
                <div><div className="text-xs uppercase text-gray-500">Newest verified recovery point</div><div className="text-sm text-gray-900 dark:text-gray-100">{report.summary.newest_recovery_point ? new Date(report.summary.newest_recovery_point).toLocaleString() : '—'}</div></div>
              </div>
              <p className="mt-4 text-xs text-gray-500">
                Each drill below really restored data from a backup copy into disposable storage and checked it: a known file compared against a checksum held
                separately from the backups, or a system image booted as an isolated clone with no route to production networks and its application service checked.
                The clone and all temporary data are removed afterwards.
              </p>
            </div>
            <div className="rounded-lg bg-white p-6 shadow print:shadow-none dark:bg-gray-800">
              <h2 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">Actual restores</h2>
              <RunsTable runs={report.actual} />
            </div>
            {report.simulated.length > 0 && (
              <div className="rounded-lg border-2 border-dashed border-purple-300 bg-white p-6 print:shadow-none dark:border-purple-800 dark:bg-gray-800">
                <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100"><FlaskConical className="h-4 w-4 text-purple-600" />Simulations <Badge tone="sim">not evidence</Badge></h2>
                <p className="mb-3 text-xs text-gray-500">These runs used a simulated hypervisor to test the drill procedure and alerting. Nothing was booted; they do not show that data can be recovered.</p>
                <RunsTable runs={report.simulated} simulated />
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
