import { createReadStream } from 'fs';
import { mkdir } from 'fs/promises';
import { createHash } from 'crypto';
import path from 'path';
import { DrillContext } from './context.js';
import { DrillError } from './errors.js';
import { StandbyCopy } from './standby.js';
import { DrillConfigSource, DrillDef, RestorePointSource, ReplicaTarget, remotePathFor, validCanaryPath } from './sources.js';
import { assertFits, createScratchDir, fmtBytes } from './scratch.js';

export interface FileDrillDeps {
  config: DrillConfigSource;
  points: RestorePointSource;
  standby: (target: ReplicaTarget, timeoutMs: number) => StandbyCopy;
  scratchRoot: string;
  /** Largest canary a drill will copy. */
  maxCanaryBytes: number;
}

/** How many of the newest backups to look through for one that reached the standby. */
const SEARCH_BACKUPS = 20;

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

/**
 * One attempt of a file-restore drill: restore the drill's canary file from
 * the offsite copy (a replication target — the second UrBackup server) into
 * this run's scratch directory, and compare it with the checksum St0r stored
 * when the canary was registered. The local backup is never read.
 */
export async function fileDrillAttempt(ctx: DrillContext, drill: DrillDef, deps: FileDrillDeps): Promise<void> {
  if (!drill.canary_id) throw new DrillError('config', 'No canary file is selected for this drill');
  if (!drill.replication_target_id) throw new DrillError('config', 'No offsite copy (replication target) is selected for this drill');
  const canary = await deps.config.getCanary(drill.canary_id);
  if (!canary) throw new DrillError('config', 'The canary file for this drill no longer exists');
  if (canary.client_name !== drill.client_name) throw new DrillError('config', `The canary belongs to ${canary.client_name}, not ${drill.client_name}`);
  if (!validCanaryPath(canary.path)) throw new DrillError('config', `The canary path "${canary.path}" is not a plain relative path`);
  if (!/^[0-9a-f]{64}$/.test(canary.sha256)) throw new DrillError('config', 'The canary has no valid expected checksum');
  ctx.result.restored_item = canary.path;
  ctx.result.expected_sha256 = canary.sha256;

  const target = await deps.config.getTarget(drill.replication_target_id);
  if (!target) throw new DrillError('config', 'The offsite copy (replication target) for this drill no longer exists');
  const replication = await deps.config.lastReplication(target.id);
  const copy: Record<string, unknown> = {
    kind: 'offsite', target_id: target.id, target_name: target.name, host: target.host, port: target.port,
    last_successful_replication: replication.lastSuccess,
  };
  ctx.result.copy_json = copy;

  const storage = await deps.points.storageFolder();
  const remoteStorage = remotePathFor(target, await deps.config.replicatedRepoPaths(), storage);
  if (!remoteStorage) {
    throw new DrillError('config', `Replication target ${target.name} does not replicate the backup storage folder ${storage}`);
  }
  const backups = await deps.points.fileBackups(drill.client_name, SEARCH_BACKUPS);
  if (!backups.length) throw new DrillError('restore-point', `${drill.client_name} has no complete file backups`);

  const timeoutMs = Math.max(5_000, Math.min(60_000, drill.timeout_seconds * 1000 / 4));
  const standby = deps.standby(target, timeoutMs);
  ctx.step('connect', `Connecting to standby ${target.name} (${target.host})`);
  await ctx.bounded(standby.connect());

  const clientDir = await ctx.bounded(standby.resolveDir(`${remoteStorage}/${drill.client_name}`));
  if (!clientDir) {
    throw new DrillError('restore-point', `Standby ${target.name} holds no backups for ${drill.client_name} (looked in ${remoteStorage}/${drill.client_name})`);
  }

  // The newest backup whose canary reached the standby. Replication can lag the
  // newest local backups; a backup that is on the standby but whose canary is
  // wrong is a failure of that copy, never a reason to try an older one.
  let found: { b: typeof backups[number]; realPath: string; size: number } | null = null;
  for (const b of backups) {
    ctx.check();
    if (!/^[A-Za-z0-9_.-]+$/.test(b.path)) continue;
    const r = await ctx.bounded(standby.resolveFile(`${clientDir}/${b.path}/${canary.path}`));
    if (!r) { ctx.step('restore-point', `Backup ${b.path} (${b.backup_time.toISOString()}): canary not on the standby`); continue; }
    if (!r.realPath.startsWith(`${clientDir}/${b.path}/`)) {
      ctx.step('restore-point', `Backup ${b.path}: canary resolves outside the backup (${r.realPath}); ignored`);
      continue;
    }
    found = { b, ...r };
    break;
  }
  if (!found) {
    throw new DrillError('restore-point',
      `None of the ${backups.length} newest backups of ${drill.client_name} on standby ${target.name} contain ${canary.path}`);
  }

  const { b } = found;
  copy.path = found.realPath;
  ctx.result.restore_point_json = { kind: 'file', backup_id: b.id, backup_time: b.backup_time.toISOString(), backup_path: b.path, incremental: b.incremental };
  ctx.result.recovery_point_time = b.backup_time;
  ctx.result.recovery_point_age_seconds = Math.max(0, Math.round((Date.now() - b.backup_time.getTime()) / 1000));

  if (found.size > deps.maxCanaryBytes) {
    throw new DrillError('quota', `The canary on the standby is ${fmtBytes(found.size)}, over the ${fmtBytes(deps.maxCanaryBytes)} drill limit`);
  }
  await mkdir(deps.scratchRoot, { recursive: true, mode: 0o700 });
  await assertFits(deps.scratchRoot, found.size, 'Restoring the canary', 64 * 1024 * 1024);

  const dir = await createScratchDir(ctx.ledger, `${ctx.runId}-a${ctx.attempt}`, deps.scratchRoot);
  const dest = path.join(dir, path.basename(canary.path));
  ctx.step('restore', `Restoring ${canary.path} from backup ${b.path} on ${target.name} into scratch storage`);
  const fetched = await ctx.bounded(standby.fetch(found.realPath, dest, deps.maxCanaryBytes));
  ctx.result.bytes_restored = fetched.bytes;

  // Hash what is now on disk, not just what went past: that is what was restored.
  const onDisk = await sha256File(dest);
  ctx.result.actual_sha256 = onDisk;
  if (onDisk !== fetched.sha256) throw new DrillError('restore', 'The restored file changed while it was being written to scratch storage', true);
  if (onDisk !== canary.sha256) {
    const sizeNote = canary.size_bytes !== null && canary.size_bytes !== fetched.bytes
      ? ` (expected ${canary.size_bytes} bytes, restored ${fetched.bytes})` : '';
    throw new DrillError('verify',
      `The restored canary does not match its expected checksum${sizeNote}: expected ${canary.sha256}, got ${onDisk}. ` +
      `The copy of backup ${b.path} on ${target.name} is damaged or was changed.`);
  }
  ctx.step('verify', `Checksum matches (${onDisk})`);
}
