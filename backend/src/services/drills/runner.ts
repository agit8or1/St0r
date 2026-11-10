import { randomUUID } from 'crypto';
import { DrillContext } from './context.js';
import { DrillError, asDrillError, statusFor } from './errors.js';
import { ResourceLedger, RemoverRegistry, cleanupResources, MAX_CLEANUP_ATTEMPTS } from './ledger.js';
import { DrillStore, RunRecord, ResourceRecord } from './store.js';
import { DrillConfigSource, DrillDef } from './sources.js';
import { AlertChannel, ReplicationEvent } from '../replicationAlerts.js';

export type AttemptFn = (ctx: DrillContext, drill: DrillDef) => Promise<{ evidence?: 'actual' | 'simulated' } | void>;

export interface RunnerDeps {
  store: DrillStore;
  config: DrillConfigSource;
  attempt: { file: AttemptFn; boot: AttemptFn };
  removers: RemoverRegistry;
  sendAlert: (event: ReplicationEvent, channels: AlertChannel[]) => Promise<void>;
  /** Evidence class known before the run (e.g. a simulator hypervisor). */
  evidenceFor?: (drill: DrillDef) => Promise<'actual' | 'simulated'>;
  retryDelayMs?: number;
  /** How long to wait for a timed-out attempt to stop before cleaning up. */
  settleMs?: number;
  /** How long cleanup may take after the drill itself has finished or timed out. */
  cleanupTimeoutMs?: number;
  log?: { info: (m: string) => void; warn: (m: string) => void; error: (m: string, e?: unknown) => void };
}

const noLog = { info() {}, warn() {}, error() {} };

/**
 * Runs drills: one run at a time per drill, every attempt bounded by the
 * drill's timeout, retryable failures retried with backoff, everything the
 * attempts created removed afterwards, the run recorded and alerts sent.
 */
export class DrillRunner {
  private active = new Map<string, Promise<RunRecord>>();
  private activeBoot: string | null = null;
  constructor(private deps: RunnerDeps) {}

  isRunning(drillId: string): boolean { return this.active.has(drillId); }

  /** One drill per drill id; boot drills one at a time (they share the scratch and hypervisor quota). */
  private claim(drill: DrillDef): void {
    if (this.active.has(drill.id)) throw new DrillError('config', 'This drill is already running');
    if (drill.kind === 'boot' && this.activeBoot) throw new DrillError('config', 'Another boot drill is running; try again when it has finished');
    if (drill.kind === 'boot') this.activeBoot = drill.id;
  }

  private release(drill: DrillDef): void {
    this.active.delete(drill.id);
    if (this.activeBoot === drill.id) this.activeBoot = null;
  }

  /** Start a run and return its id at once; the run continues in the background. */
  async start(drill: DrillDef, trigger: 'schedule' | 'manual'): Promise<string> {
    this.claim(drill);
    let run: RunRecord;
    try { run = await this.createRun(drill, trigger); } catch (e) { this.release(drill); throw e; }
    const p = this.execute(drill, run).finally(() => this.release(drill));
    this.active.set(drill.id, p);
    p.catch(() => undefined);
    return run.id;
  }

  /** Run to completion (tests, and the scheduler's sequential mode). */
  async runToCompletion(drill: DrillDef, trigger: 'schedule' | 'manual' = 'manual'): Promise<RunRecord> {
    this.claim(drill);
    let run: RunRecord;
    try { run = await this.createRun(drill, trigger); } catch (e) { this.release(drill); throw e; }
    const p = this.execute(drill, run).finally(() => this.release(drill));
    this.active.set(drill.id, p);
    return p;
  }

  private async createRun(drill: DrillDef, trigger: 'schedule' | 'manual'): Promise<RunRecord> {
    const evidence = this.deps.evidenceFor ? await this.deps.evidenceFor(drill).catch(() => 'actual' as const) : 'actual';
    const run: RunRecord = {
      id: randomUUID(), drill_id: drill.id, kind: drill.kind, client_name: drill.client_name, evidence,
      status: 'running', trigger_type: trigger, attempts: 0, started_at: new Date(), cleanup_status: 'none', steps_json: [],
    };
    await this.deps.store.createRun(run);
    return run;
  }

  private async execute(drill: DrillDef, run: RunRecord): Promise<RunRecord> {
    const log = this.deps.log ?? noLog;
    const started = run.started_at.getTime();
    const maxAttempts = Math.max(1, Math.min(10, drill.retry_max_attempts || 1));
    const timeoutMs = Math.max(1, drill.timeout_seconds) * 1000;
    const steps: NonNullable<RunRecord['steps_json']> = [];
    const ledger = new ResourceLedger(this.deps.store, run.id);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DrillError('timeout',
      `The drill did not finish within its ${drill.timeout_seconds}-second limit`)), timeoutMs);

    let result: Partial<RunRecord> = {};
    let failure: DrillError | null = null;
    let evidence = run.evidence;
    let attempt = 0;
    let inFlight: Promise<void> = Promise.resolve();
    try {
      for (attempt = 1; attempt <= maxAttempts; attempt++) {
        const ctx = new DrillContext(run.id, attempt, ledger, controller.signal, started, (s) => steps.push(s));
        ctx.step('start', `Attempt ${attempt} of ${maxAttempts}`);
        await this.deps.store.updateRun(run.id, { attempts: attempt, steps_json: steps });
        // Kept so cleanup can wait for it: after a timeout the attempt may still be finishing a step.
        const work = Promise.resolve().then(() => this.deps.attempt[drill.kind](ctx, drill));
        inFlight = work.then(() => undefined, () => undefined);
        try {
          const out = await ctx.bounded(work);
          if (out && out.evidence === 'simulated') evidence = 'simulated';
          result = ctx.result;
          failure = null;
          break;
        } catch (err) {
          failure = controller.signal.aborted && !(err instanceof DrillError && err.stage !== 'timeout')
            ? asDrillError(controller.signal.reason) : asDrillError(err);
          result = ctx.result;
          ctx.step(failure.stage, failure.message);
          log.warn(`[Drill ${drill.name}] attempt ${attempt} failed at ${failure.stage}: ${failure.message}`);
          // Clear this attempt's resources before trying again.
          if (attempt < maxAttempts && failure.retryable && !controller.signal.aborted) {
            const c = await this.cleanup(run.id);
            if (c.errors > 0) { ctx.step('cleanup', 'Cleanup before retrying did not finish; not retrying'); break; }
            await ctx.sleep((this.deps.retryDelayMs ?? 5000) * attempt).catch(() => undefined);
            if (controller.signal.aborted) { failure = asDrillError(controller.signal.reason); break; }
            continue;
          }
          break;
        }
      }
    } finally {
      clearTimeout(timer);
    }

    // Let a timed-out attempt reach a stopping point (every step checks the
    // deadline) so nothing is created behind cleanup's back.
    await Promise.race([inFlight, new Promise((r) => setTimeout(r, this.deps.settleMs ?? 30_000))]);
    // Cleanup always runs, with its own time limit, even after a timeout.
    const cleanup = await this.cleanupBounded(run.id, this.deps.cleanupTimeoutMs ?? 10 * 60_000);
    for (const r of cleanup.results) {
      steps.push({ at: new Date().toISOString(), stage: 'cleanup', message: `${r.kind} ${r.locator}: ${r.outcome}${r.error ? ` (${r.error})` : ''}` });
    }

    const finished = new Date();
    const status: RunRecord['status'] = failure ? statusFor(failure) : 'passed';
    const patch: Partial<RunRecord> = {
      ...result,
      evidence,
      status,
      attempts: Math.min(attempt, maxAttempts),
      finished_at: finished,
      elapsed_ms: finished.getTime() - started,
      failure_stage: failure?.stage ?? null,
      failure_reason: failure?.message ?? null,
      cleanup_status: cleanup.status,
      steps_json: steps,
    };
    if (!failure && result.recovery_point_age_seconds !== undefined && result.recovery_point_age_seconds !== null) {
      const rp = { ...(result.restore_point_json || {}) };
      rp.max_age_hours = drill.max_recovery_point_age_hours;
      rp.rpo_exceeded = result.recovery_point_age_seconds > drill.max_recovery_point_age_hours * 3600;
      patch.restore_point_json = rp;
    }
    await this.deps.store.updateRun(run.id, patch);
    await this.deps.config.markRun(drill.id, finished).catch(() => undefined);
    const final = { ...run, ...patch } as RunRecord;
    await this.alert(drill, final, cleanup.errors).catch((e) => log.error(`[Drill ${drill.name}] alert failed`, e));
    log.info(`[Drill ${drill.name}] ${status}${failure ? ` at ${failure.stage}` : ''} in ${patch.elapsed_ms} ms (cleanup ${cleanup.status})`);
    return final;
  }

  private async cleanup(runId: string) {
    return cleanupResources(this.deps.store, await this.deps.store.resourcesForRun(runId), this.deps.removers);
  }

  private async cleanupBounded(runId: string, ms: number) {
    let t: ReturnType<typeof setTimeout> | undefined;
    const gaveUp = { status: 'pending' as const, results: [] as [], errors: 1 };
    const timeout = new Promise<typeof gaveUp>((resolve) => { t = setTimeout(() => resolve(gaveUp), ms); });
    try {
      return await Promise.race([this.cleanup(runId).catch(() => gaveUp), timeout]);
    } finally {
      clearTimeout(t);
    }
  }

  private async alert(drill: DrillDef, run: RunRecord, cleanupErrors: number): Promise<void> {
    const channels = await this.deps.config.alertChannels();
    if (!channels.length) return;
    const sim = run.evidence === 'simulated' ? ' [SIMULATED — not recovery evidence]' : '';
    const send = (type: string, severity: string, message: string) =>
      this.deps.sendAlert({ id: randomUUID(), target_id: drill.id, type, severity, message: `${message}${sim}` }, channels);
    if (run.status !== 'passed') {
      await send('drill_failed', 'critical',
        `Recovery drill "${drill.name}" for ${drill.client_name} ${run.status === 'error' ? 'could not run' : 'FAILED'} at ${run.failure_stage}: ${run.failure_reason}`);
    } else {
      const previous = await this.deps.store.lastRun(drill.id, run.id);
      if (previous && previous.status !== 'passed') {
        await send('drill_recovered', 'info', `Recovery drill "${drill.name}" for ${drill.client_name} passed again`);
      }
      if ((run.restore_point_json as any)?.rpo_exceeded) {
        await send('drill_rpo', 'warning', `Recovery drill "${drill.name}" passed, but the newest recoverable point for ${drill.client_name} is ` +
          `${Math.round((run.recovery_point_age_seconds || 0) / 3600)} h old (limit ${drill.max_recovery_point_age_hours} h)`);
      }
    }
    if (cleanupErrors > 0) {
      await send('drill_cleanup', 'warning', `Recovery drill "${drill.name}" could not remove everything it created yet (cleanup ${run.cleanup_status}); St0r keeps retrying`);
    }
  }

  /**
   * After a restart: runs still marked running were interrupted. Mark them,
   * then let the sweeper remove whatever they had created.
   */
  async recoverInterrupted(): Promise<number> {
    const runs = await this.deps.store.runningRuns();
    let n = 0;
    for (const r of runs) {
      if (r.drill_id && this.active.has(r.drill_id)) continue;
      const finished = new Date();
      await this.deps.store.updateRun(r.id, {
        status: 'interrupted', finished_at: finished, elapsed_ms: finished.getTime() - new Date(r.started_at).getTime(),
        failure_stage: 'internal', failure_reason: 'St0r stopped while this drill was running', cleanup_status: 'pending',
      });
      n++;
    }
    await this.sweep();
    return n;
  }

  /** Retry cleanup of everything still live from runs that are no longer running. */
  async sweep(): Promise<{ attempted: number }> {
    const live = (await this.deps.store.liveResources()).filter((r) => (r.attempts || 0) < MAX_CLEANUP_ATTEMPTS);
    const byRun = new Map<string, ResourceRecord[]>();
    for (const r of live) byRun.set(r.run_id, [...(byRun.get(r.run_id) || []), r]);
    let attempted = 0;
    for (const [runId, resources] of byRun) {
      const run = await this.deps.store.getRun(runId);
      if (run?.status === 'running') continue; // its own run cleans up
      attempted += resources.length;
      const res = await cleanupResources(this.deps.store, resources, this.deps.removers);
      if (run) {
        const remaining = (await this.deps.store.resourcesForRun(runId))
          .filter((x) => x.state === 'creating' || x.state === 'created' || x.state === 'delete_failed');
        const status = remaining.length === 0 ? 'done'
          : remaining.every((x) => (x.attempts || 0) >= MAX_CLEANUP_ATTEMPTS) ? 'failed' : 'pending';
        await this.deps.store.updateRun(runId, { cleanup_status: status });
        if (res.status === 'failed' && run.drill_id) {
          const drill = await this.deps.config.getDrill(run.drill_id);
          const channels = drill ? await this.deps.config.alertChannels() : [];
          if (drill && channels.length) {
            await this.deps.sendAlert({ id: randomUUID(), target_id: drill.id, type: 'drill_cleanup', severity: 'critical',
              message: `Recovery drill "${drill.name}" left resources St0r could not remove after ${MAX_CLEANUP_ATTEMPTS} tries; remove them by hand (see the run's cleanup log)` }, channels);
          }
        }
      }
    }
    return { attempted };
  }
}
