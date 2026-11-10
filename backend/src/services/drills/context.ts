import { DrillError } from './errors.js';
import { ResourceLedger } from './ledger.js';
import { RunRecord } from './store.js';

/** What one attempt of a drill gets to work with. */
export class DrillContext {
  /** Results so far. Kept on failure too, so a failed run still says what it restored from. */
  readonly result: Partial<RunRecord> = {};
  readonly steps: Array<{ at: string; stage: string; message: string }> = [];

  constructor(
    readonly runId: string,
    readonly attempt: number,
    readonly ledger: ResourceLedger,
    readonly signal: AbortSignal,
    /** Wall-clock start of the run (not the attempt): recovery time is measured from here. */
    readonly runStartedAt: number,
    private onStep: (s: { at: string; stage: string; message: string }) => void = () => undefined,
  ) {}

  step(stage: string, message: string): void {
    const s = { at: new Date().toISOString(), stage, message };
    this.steps.push(s);
    this.onStep(s);
  }

  /** Throw the timeout error if the run's deadline has passed. */
  check(): void {
    if (this.signal.aborted) throw this.signal.reason instanceof DrillError ? this.signal.reason : new DrillError('timeout', 'The drill was stopped');
  }

  /** Sleep, but wake (and throw) as soon as the run is aborted. */
  sleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.signal.aborted) { reject(this.signal.reason); return; }
      const t = setTimeout(() => { this.signal.removeEventListener('abort', onAbort); resolve(); }, ms);
      const onAbort = () => { clearTimeout(t); reject(this.signal.reason); };
      this.signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Race a promise against the run's deadline. */
  async bounded<T>(p: Promise<T>): Promise<T> {
    this.check();
    let onAbort: () => void = () => undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(this.signal.reason);
      this.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([p, aborted]);
    } finally {
      this.signal.removeEventListener('abort', onAbort);
    }
  }
}
