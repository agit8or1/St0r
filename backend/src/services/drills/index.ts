import { logger } from '../../utils/logger.js';
import { decrypt } from '../secrets.js';
import { sendAlert } from '../replicationAlerts.js';
import { runHelper } from '../../utils/privileged.js';
import { DrillRunner } from './runner.js';
import { SqlDrillStore, ResourceRecord } from './store.js';
import { SqlDrillConfig, UrBackupRestorePoints, DrillDef, HypervisorDef } from './sources.js';
import { SshStandby } from './standby.js';
import { fileDrillAttempt } from './fileDrill.js';
import { bootDrillAttempt, qemuImgConverter, validateBootConfig } from './bootDrill.js';
import { Hypervisor, ProxmoxHypervisor, SimulatorHypervisor, VmRemover, VolumeRemover } from './hypervisor.js';
import { PveClient } from './proxmox.js';
import { ScratchRemover, VhdWorkdirRemover, scratchRoot } from './scratch.js';
import { Remover } from './ledger.js';
import { DrillError } from './errors.js';
import { isDue } from './schedule.js';

/** St0r's recovery-verification service: the runner wired to the real databases, SSH, Proxmox and helper. */
export const drillStore = new SqlDrillStore();
export const drillConfig = new SqlDrillConfig();
const points = new UrBackupRestorePoints();

export const MAX_CANARY_BYTES = 64 * 1024 * 1024;

export function hypervisorFor(def: HypervisorDef, drill?: DrillDef | null): Hypervisor {
  if (def.type === 'simulator') {
    let behaviour = {};
    try { behaviour = drill?.boot_config ? validateBootConfig(drill.boot_config).simulate ?? {} : {}; } catch { /* run reports the config error */ }
    return new SimulatorHypervisor(behaviour, `Simulator ${def.name}`);
  }
  if (!def.token_secret_encrypted) throw new DrillError('config', `Hypervisor ${def.name} has no API token secret`);
  const api = new PveClient({ api_url: def.api_url, token_id: def.token_id, token_secret: decrypt(def.token_secret_encrypted), tls_fingerprint: def.tls_fingerprint });
  return new ProxmoxHypervisor(api, def);
}

async function removerFor(r: ResourceRecord): Promise<Remover> {
  switch (r.kind) {
    case 'scratch_dir': return new ScratchRemover(scratchRoot());
    case 'vhd_workdir': return new VhdWorkdirRemover();
    case 'pve_vm':
    case 'pve_volume': {
      const def = r.hypervisor_id ? await drillConfig.getHypervisor(r.hypervisor_id) : null;
      if (!def) throw new Error('its hypervisor is no longer configured; remove it by hand');
      // A simulator's resources only ever existed in memory.
      if (def.type === 'simulator') return { remove: async () => 'gone' as const };
      const hv = hypervisorFor(def);
      return r.kind === 'pve_vm' ? new VmRemover(hv) : new VolumeRemover(hv);
    }
  }
}

let converter: Awaited<ReturnType<typeof qemuImgConverter>> | undefined;

export const drillRunner = new DrillRunner({
  store: drillStore,
  config: drillConfig,
  removers: removerFor,
  sendAlert,
  log: { info: (m) => logger.info(m), warn: (m) => logger.warn(m), error: (m, e) => logger.error(m, e) },
  evidenceFor: async (drill) => {
    if (drill.kind !== 'boot' || !drill.hypervisor_id) return 'actual';
    const def = await drillConfig.getHypervisor(drill.hypervisor_id);
    return def?.type === 'simulator' ? 'simulated' : 'actual';
  },
  attempt: {
    file: (ctx, drill) => fileDrillAttempt(ctx, drill, {
      config: drillConfig, points, scratchRoot: scratchRoot(), maxCanaryBytes: MAX_CANARY_BYTES,
      standby: (target, timeoutMs) => new SshStandby(target, timeoutMs),
    }),
    boot: async (ctx, drill) => {
      if (converter === undefined) converter = await qemuImgConverter();
      return bootDrillAttempt(ctx, drill, {
        config: drillConfig, points, scratchRoot: scratchRoot(), convert: converter, pollMs: 5000,
        hypervisor: hypervisorFor,
        decompress: async (file, tag) => (await runHelper('vhd-decompress', [file, tag], { timeout: 6 * 3600_000 })).stdout.trim(),
      });
    },
  },
});

let tick: ReturnType<typeof setInterval> | null = null;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** Start the schedule (checked each minute) and the cleanup sweeper (every 10 minutes). */
export async function startRecoveryDrills(): Promise<void> {
  try {
    const n = await drillRunner.recoverInterrupted();
    if (n) logger.warn(`[RecoveryDrills] ${n} drill run(s) were interrupted by a restart; cleaning up what they created`);
  } catch (e) {
    logger.error('[RecoveryDrills] Could not check for interrupted runs (is migration 009 applied?)', e);
  }
  tick = setInterval(async () => {
    try {
      const now = new Date();
      for (const d of await drillConfig.listDrills()) {
        if (isDue(d, now) && !drillRunner.isRunning(d.id)) {
          drillRunner.start(d, 'schedule').catch((e) => logger.warn(`[RecoveryDrills] ${d.name} not started: ${e.message}`));
        }
      }
    } catch (e) {
      logger.error('[RecoveryDrills] Schedule check failed', e);
    }
  }, 60_000);
  sweepTimer = setInterval(() => {
    drillRunner.sweep().catch((e) => logger.error('[RecoveryDrills] Cleanup sweep failed', e));
  }, 10 * 60_000);
}

export function stopRecoveryDrills(): void {
  if (tick) clearInterval(tick);
  if (sweepTimer) clearInterval(sweepTimer);
  tick = sweepTimer = null;
}
