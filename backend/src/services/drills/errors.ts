/** Where a drill stopped. Shown to customers, so the stages have plain names. */
export type DrillStage =
  | 'config'        // the drill cannot run as configured
  | 'connect'       // the standby / hypervisor could not be reached
  | 'restore-point' // no usable restore point
  | 'quota'         // not enough scratch or hypervisor storage, or over a size limit
  | 'restore'       // copying the data failed
  | 'verify'        // the restored data is not what it should be
  | 'isolation'     // the drill network is not isolated
  | 'import'        // the hypervisor could not take the disk
  | 'boot'          // the clone did not boot
  | 'service'       // the configured service did not pass
  | 'timeout'
  | 'cleanup'
  | 'internal';

export class DrillError extends Error {
  constructor(readonly stage: DrillStage, message: string, readonly retryable = false) {
    super(message);
    this.name = 'DrillError';
  }
}

export function asDrillError(err: unknown): DrillError {
  if (err instanceof DrillError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  return new DrillError('internal', msg, false);
}

/**
 * "failed": the drill ran and the recovery did not work (or could not be
 * shown to work from the copy it was pointed at).
 * "error": the drill itself could not run — its configuration, St0r's scratch
 * space or the test infrastructure — which says nothing about the backup.
 */
const INFRASTRUCTURE: DrillStage[] = ['config', 'quota', 'isolation', 'internal', 'cleanup'];

export function statusFor(err: DrillError): 'failed' | 'error' {
  return INFRASTRUCTURE.includes(err.stage) ? 'error' : 'failed';
}
