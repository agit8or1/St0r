import { randomUUID } from 'crypto';
import { DrillStore, ResourceKind, ResourceRecord } from './store.js';

/**
 * What a drill creates, and how to remove it.
 *
 * Each resource is recorded (state "creating") BEFORE it is created, with a
 * marker it must carry to count as ours. Cleanup then only ever deletes what
 * the ledger names, and only after the remover has checked the marker: a VM
 * id or volume that now belongs to something else is left alone and recorded
 * as "not_ours". A cleanup that fails (or is interrupted by a restart) leaves
 * the row live, and the sweeper retries it later.
 */
export type RemoveOutcome = 'deleted' | 'gone' | 'not_ours';

export interface Remover {
  /** Remove the resource if it exists and carries its marker. */
  remove(r: ResourceRecord): Promise<RemoveOutcome>;
}

export type RemoverRegistry = (r: ResourceRecord) => Promise<Remover>;

/** Cleanup order: VMs before the volumes they were imported from, local files last. */
const ORDER: Record<ResourceKind, number> = { pve_vm: 0, pve_volume: 1, vhd_workdir: 2, scratch_dir: 3 };

export const MAX_CLEANUP_ATTEMPTS = 10;

/**
 * A VM or volume recorded but never confirmed created may still appear: the
 * hypervisor can finish a create task after the drill gave up on it. Absent
 * ones are looked for again on this many sweeps before they are written off.
 */
export const RECHECKS_FOR_UNCONFIRMED = 3;
const REMOTE: ResourceKind[] = ['pve_vm', 'pve_volume'];

export class ResourceLedger {
  constructor(private store: DrillStore, private runId: string) {}

  /**
   * Record a resource, then create it. If `create` throws, the row stays
   * "creating" (the resource may or may not exist) and cleanup will check.
   */
  async track<T>(
    kind: ResourceKind,
    locator: string,
    marker: string,
    hypervisorId: string | null,
    create: (id: string) => Promise<T>,
  ): Promise<T> {
    const id = randomUUID();
    await this.store.addResource({ id, run_id: this.runId, kind, hypervisor_id: hypervisorId, locator, marker });
    const out = await create(id);
    await this.store.updateResource(id, { state: 'created' });
    return out;
  }

  /** Correct a locator once the real one is known (e.g. the volume id Proxmox assigned). */
  async relocate(id: string, locator: string): Promise<void> {
    await this.store.updateResource(id, { locator });
  }
}

export interface CleanupReport {
  status: 'none' | 'done' | 'pending' | 'failed';
  results: Array<{ id: string; kind: ResourceKind; locator: string; outcome: RemoveOutcome | 'error' | 'recheck'; error?: string }>;
  /** Removals that failed (as opposed to resources only waiting for a re-check). */
  errors: number;
}

/** Clean up the given live resources in a safe order. */
export async function cleanupResources(
  store: DrillStore,
  resources: ResourceRecord[],
  removers: RemoverRegistry,
): Promise<CleanupReport> {
  const live = resources
    .filter((r) => r.state === 'creating' || r.state === 'created' || r.state === 'delete_failed')
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  if (!live.length) return { status: resources.length ? 'done' : 'none', results: [], errors: 0 };
  const results: CleanupReport['results'] = [];
  let failed = 0; let exhausted = 0; let rechecks = 0;
  for (const r of live) {
    const attempts = (r.attempts || 0) + 1;
    try {
      const outcome = await (await removers(r)).remove(r);
      if (outcome === 'gone' && r.state === 'creating' && REMOTE.includes(r.kind) && attempts < RECHECKS_FOR_UNCONFIRMED) {
        await store.updateResource(r.id, { attempts, last_error: 'not found yet; checking again in case its create finishes late' });
        results.push({ id: r.id, kind: r.kind, locator: r.locator, outcome: 'recheck' });
        rechecks++;
        continue;
      }
      await store.updateResource(r.id, { state: outcome === 'not_ours' ? 'not_ours' : 'deleted', attempts, last_error: null });
      results.push({ id: r.id, kind: r.kind, locator: r.locator, outcome });
    } catch (err) {
      const msg = (err as Error).message || String(err);
      await store.updateResource(r.id, { state: 'delete_failed', attempts, last_error: msg.slice(0, 2000) });
      results.push({ id: r.id, kind: r.kind, locator: r.locator, outcome: 'error', error: msg });
      failed++;
      if (attempts >= MAX_CLEANUP_ATTEMPTS) exhausted++;
    }
  }
  const status = failed === 0 ? (rechecks ? 'pending' : 'done') : exhausted === failed && !rechecks ? 'failed' : 'pending';
  return { status, results, errors: failed };
}
