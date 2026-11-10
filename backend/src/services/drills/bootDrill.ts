import { promises as fs } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import { DrillContext } from './context.js';
import { DrillError } from './errors.js';
import { BootConfig, DrillConfigSource, DrillDef, HypervisorDef, ImageRestorePoint, RestorePointSource } from './sources.js';
import { Hypervisor, DRILL_TAG, runTag } from './hypervisor.js';
import { parseUrbackupMbr, diskLayout, volumeOffsetInImage, MbrDataError, UrbackupMbr } from './mbrData.js';
import { openImageChain, ImageFormatError, DiskImage } from './vhd.js';
import { assembleDisk, VolumeSource } from './diskAssembler.js';
import { assertFits, createScratchDir, fmtBytes } from './scratch.js';
import { sha256File } from './fileDrill.js';
import { registerArtifact, revokeArtifact } from './artifacts.js';

/**
 * The optional boot drill, for exactly one documented combination
 * (docs/recovery-verification.md): a Windows x64 machine booting with UEFI
 * from a GPT disk, imaged by UrBackup as C: plus the EFI system partition
 * from the same backup run, with the QEMU guest agent installed, booted on
 * Proxmox VE 8.4 or later (OVMF, q35, SATA) with no network device or only an
 * isolated bridge. Anything else is refused at the start of the run.
 */
export interface BootDrillDeps {
  config: DrillConfigSource;
  points: RestorePointSource;
  hypervisor: (def: HypervisorDef, drill: DrillDef) => Hypervisor;
  scratchRoot: string;
  /** Decompress a .vhdz into /tmp/st0r-vhd-<tag> (the root helper); returns the result's path. */
  decompress: (file: string, tag: string) => Promise<string>;
  /** Convert raw → qcow2, or null to hand the hypervisor the raw disk. */
  convert: ((raw: string, out: string, signal: AbortSignal) => Promise<void>) | null;
  /** Poll interval while waiting for the guest. */
  pollMs: number;
}

export const SERVICE_NAME = /^[A-Za-z0-9_.@-]{1,128}$/;
const RUNNING = /STATE\s*:\s*4\s+RUNNING/;

export function validateBootConfig(c: unknown): BootConfig {
  const b = (c ?? {}) as Record<string, any>;
  if (b.profile !== 'windows-uefi') throw new DrillError('config', 'Boot drills support only the windows-uefi profile');
  if (!SERVICE_NAME.test(String(b.service ?? ''))) throw new DrillError('config', 'Name the Windows service the clone must run (letters, digits, _ . @ -)');
  const int = (v: unknown, def: number, lo: number, hi: number, what: string) => {
    const n = v === undefined || v === null || v === '' ? def : Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new DrillError('config', `${what} must be between ${lo} and ${hi}`);
    return n;
  };
  const out: BootConfig = {
    profile: 'windows-uefi',
    service: String(b.service),
    memory_mb: int(b.memory_mb, 4096, 1024, 65536, 'Memory (MB)'),
    cores: int(b.cores, 2, 1, 32, 'Cores'),
    boot_timeout_seconds: int(b.boot_timeout_seconds, 600, 5, 7200, 'Boot timeout'),
    service_timeout_seconds: int(b.service_timeout_seconds, 300, 5, 3600, 'Service timeout'),
  };
  if (b.simulate && typeof b.simulate === 'object') {
    out.simulate = {
      boot: b.simulate.boot === 'fail' ? 'fail' : 'ok',
      service: b.simulate.service === 'fail' ? 'fail' : 'ok',
    };
  }
  return out;
}

interface ChosenVolume { letter: string; head: ImageRestorePoint; chain: ImageRestorePoint[]; mbr: UrbackupMbr }

async function exists(p: string): Promise<boolean> {
  try { return (await fs.stat(p)).isFile(); } catch { return false; }
}

/** The image and its incremental parents, oldest first. */
function chainOf(img: ImageRestorePoint, byId: Map<number, ImageRestorePoint>): ImageRestorePoint[] {
  const chain = [img];
  let cur = img;
  while (cur.incremental > 0) {
    const parent = byId.get(cur.incremental_ref);
    if (!parent) throw new DrillError('restore-point', `Image ${img.id} (${img.letter}) needs image ${cur.incremental_ref}, which is not a complete backup`);
    if (parent.letter !== img.letter) throw new DrillError('restore-point', `Image ${cur.id} is chained to a ${parent.letter} image`);
    chain.unshift(parent);
    cur = parent;
    if (chain.length > 256) throw new DrillError('restore-point', `Image ${img.id} has an incremental chain longer than 256`);
  }
  return chain;
}

async function loadVolume(letter: string, head: ImageRestorePoint, byId: Map<number, ImageRestorePoint>): Promise<ChosenVolume> {
  const chain = chainOf(head, byId);
  for (const img of chain) {
    if (!(await exists(img.path))) {
      throw new DrillError('restore-point', `${letter} image ${img.id} from ${img.backup_time.toISOString()} is missing its data file (${img.path})`);
    }
  }
  let mbr: UrbackupMbr;
  try {
    mbr = parseUrbackupMbr(await fs.readFile(`${head.path}.mbr`));
  } catch (e) {
    throw new DrillError('restore-point', `${letter} image ${head.id}: cannot read its partition data (${(e as Error).message})`);
  }
  return { letter, head, chain, mbr };
}

/**
 * The newest C: image that can be restored, with the EFI system partition
 * imaged in the same run (UrBackup's association, or else the ESP image taken
 * within ten minutes before it).
 */
export async function chooseImageRestorePoint(points: RestorePointSource, client: string): Promise<ChosenVolume[]> {
  const all = await points.imageBackups(client);
  const byId = new Map(all.map((i) => [i.id, i]));
  const sys = all.filter((i) => i.letter === 'C:' || i.letter === 'C');
  if (!sys.length) throw new DrillError('restore-point', `${client} has no complete C: image backups`);
  const reasons: string[] = [];
  for (const c of sys.slice(0, 5)) {
    try {
      const assoc = (await points.associatedImages(c.id)).map((id) => byId.get(id)).filter(Boolean) as ImageRestorePoint[];
      const esp = assoc.find((i) => i.letter === 'ESP')
        ?? all.find((i) => i.letter === 'ESP' && i.backup_time <= c.backup_time && c.backup_time.getTime() - i.backup_time.getTime() <= 10 * 60_000);
      if (!esp) throw new DrillError('restore-point', `C: image ${c.id} has no EFI system partition image from the same backup`);
      const vols = [await loadVolume('ESP', esp, byId), await loadVolume('C:', c, byId)];
      if (!vols[1].mbr.gpt) throw new DrillError('config', `C: image ${c.id} is from an MBR disk; boot drills support only UEFI/GPT`);
      return vols;
    } catch (e) {
      if (!(e instanceof DrillError) || e.stage !== 'restore-point') throw e;
      reasons.push(e.message);
    }
  }
  throw new DrillError('restore-point', `No restorable C: image for ${client}: ${reasons.join('; ')}`);
}

function runQemuImg(raw: string, out: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('qemu-img', ['convert', '-q', '-f', 'raw', '-O', 'qcow2', raw, out], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    const onAbort = () => p.kill('SIGKILL');
    signal.addEventListener('abort', onAbort, { once: true });
    p.on('error', (e) => { signal.removeEventListener('abort', onAbort); reject(e); });
    p.on('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      if (code === 0) resolve();
      else reject(new DrillError('restore', `qemu-img convert failed: ${err.trim() || `exit ${code}`}`));
    });
  });
}

export async function qemuImgConverter(): Promise<BootDrillDeps['convert']> {
  return new Promise((resolve) => {
    const p = spawn('qemu-img', ['--version'], { stdio: 'ignore' });
    p.on('error', () => resolve(null));
    p.on('close', (code) => resolve(code === 0 ? runQemuImg : null));
  });
}

export async function bootDrillAttempt(ctx: DrillContext, drill: DrillDef, deps: BootDrillDeps): Promise<{ evidence: 'actual' | 'simulated' }> {
  const cfg = validateBootConfig(drill.boot_config);
  if (!drill.hypervisor_id) throw new DrillError('config', 'No hypervisor is selected for this boot drill');
  const def = await deps.config.getHypervisor(drill.hypervisor_id);
  if (!def) throw new DrillError('config', 'The hypervisor for this drill no longer exists');
  const hv = deps.hypervisor(def, drill);
  const evidence = hv.evidence;
  const copy: Record<string, unknown> = { kind: 'primary', description: 'local UrBackup storage', hypervisor: hv.label, hypervisor_id: def.id };
  ctx.result.copy_json = copy;

  // Restore point and its files, before anything is created.
  const vols = await chooseImageRestorePoint(deps.points, drill.client_name);
  const c = vols.find((v) => v.letter === 'C:')!;
  ctx.result.restore_point_json = {
    kind: 'image',
    images: vols.map((v) => ({ letter: v.letter, image_id: v.head.id, backup_time: v.head.backup_time.toISOString(), chain: v.chain.map((i) => i.id), path: v.head.path })),
  };
  ctx.result.recovery_point_time = c.head.backup_time;
  ctx.result.recovery_point_age_seconds = Math.max(0, Math.round((Date.now() - c.head.backup_time.getTime()) / 1000));
  ctx.result.restored_item = `Image of ${drill.client_name} (C: + ESP) from ${c.head.backup_time.toISOString()}`;
  ctx.step('restore-point', `Using C: image ${c.head.id} (${c.chain.length} in chain) and ESP image ${vols[0].head.id}`);

  let diskSize: number;
  try { diskSize = diskLayout(c.mbr).size; } catch (e) { throw new DrillError('restore-point', (e as Error).message); }
  if (diskSize > def.max_disk_gb * 1024 ** 3) {
    throw new DrillError('quota', `The disk is ${fmtBytes(diskSize)}, over this hypervisor's ${def.max_disk_gb} GiB drill limit`);
  }
  // Worst case on St0r: every image decompressed, the assembled disk and its qcow2 copy.
  const dataBytes = vols.reduce((n, v) => n + v.chain.reduce((m, i) => m + Math.max(i.size_bytes, 0), 0), 0) || diskSize;
  const scratchNeed = Math.min(dataBytes, diskSize) * 3;
  if (scratchNeed > def.scratch_quota_gb * 1024 ** 3) {
    throw new DrillError('quota', `This drill needs about ${fmtBytes(scratchNeed)} of scratch space, over the ${def.scratch_quota_gb} GiB quota`);
  }
  await fs.mkdir(deps.scratchRoot, { recursive: true, mode: 0o700 });
  await assertFits(deps.scratchRoot, scratchNeed, 'The boot drill');
  // Compressed images are decompressed by the root helper into /tmp.
  const compressed = vols.flatMap((v) => v.chain).filter((i) => /\.vhdz$/i.test(i.path));
  if (compressed.length) {
    await assertFits('/tmp', compressed.reduce((n, i) => n + Math.max(i.size_bytes, 0), 0) || diskSize, 'Decompressing the images');
  }

  ctx.step('connect', `Checking ${hv.label}`);
  await ctx.bounded(hv.ping());
  const importAvail = await ctx.bounded(hv.storageAvail(def.import_storage));
  const diskAvail = def.disk_storage === def.import_storage ? importAvail : await ctx.bounded(hv.storageAvail(def.disk_storage));
  const pveNeed = Math.min(dataBytes, diskSize);
  if (importAvail < pveNeed || diskAvail < pveNeed * (def.disk_storage === def.import_storage ? 2 : 1)) {
    throw new DrillError('quota', `Proxmox storage is too small for this drill: it needs ${fmtBytes(pveNeed)} in ${def.import_storage} and in ${def.disk_storage}` +
      ` (free: ${fmtBytes(importAvail)} and ${fmtBytes(diskAvail)})`);
  }
  if (def.isolated_bridge) {
    const iso = await ctx.bounded(hv.checkIsolation(def.isolated_bridge));
    copy.network = iso.detail;
  } else {
    copy.network = 'no network device';
  }
  ctx.step('isolation', String(copy.network));

  // Decompress (through the root helper) and open each volume's chain.
  const images: DiskImage[] = [];
  try {
    const sources: VolumeSource[] = [];
    for (const v of vols) {
      const files: string[] = [];
      for (const img of v.chain) {
        ctx.check();
        if (/\.vhdz$/i.test(img.path)) {
          const tag = randomBytes(8).toString('base64').replace(/[^A-Za-z0-9]/g, '').padEnd(10, 'x').slice(0, 10);
          const work = `/tmp/st0r-vhd-${tag}`;
          ctx.step('restore', `Decompressing ${v.letter} image ${img.id}`);
          const out = await ctx.ledger.track('vhd_workdir', work, tag, null, () => ctx.bounded(deps.decompress(img.path, tag)));
          if (path.dirname(out) !== work) throw new DrillError('internal', `The helper wrote ${out}, not into ${work}`);
          files.push(out);
        } else {
          files.push(img.path);
        }
      }
      let image: DiskImage;
      try { image = await openImageChain(files); } catch (e) {
        if (e instanceof ImageFormatError) throw new DrillError('restore', `${v.letter} image ${v.head.id} is damaged: ${e.message}`);
        throw e;
      }
      images.push(image);
      const isRaw = /\.raw$/i.test(v.head.path);
      sources.push({ letter: v.letter, mbr: v.mbr, image, skip: volumeOffsetInImage(v.mbr, v.head.version, isRaw) });
    }

    const dir = await createScratchDir(ctx.ledger, `${ctx.runId}-a${ctx.attempt}`, deps.scratchRoot);
    const raw = path.join(dir, 'disk.raw');
    ctx.step('restore', `Rebuilding the ${fmtBytes(diskSize)} disk`);
    try {
      const r = await assembleDisk(raw, sources, { maxSize: def.max_disk_gb * 1024 ** 3, signal: ctx.signal });
      ctx.result.bytes_restored = r.bytesWritten;
    } catch (e) {
      if (ctx.signal.aborted) throw ctx.signal.reason;
      if (e instanceof MbrDataError || e instanceof ImageFormatError) throw new DrillError('restore', `Rebuilding the disk failed: ${e.message}`);
      throw e;
    }
    for (const img of images.splice(0)) await img.close().catch(() => undefined);

    const short = ctx.runId.replace(/-/g, '').slice(0, 12);
    let artifact = raw;
    let filename = `st0r-drill-${short}-a${ctx.attempt}.raw`;
    if (deps.convert) {
      const q = path.join(dir, 'disk.qcow2');
      ctx.step('restore', 'Converting to qcow2');
      await ctx.bounded(deps.convert(raw, q, ctx.signal));
      await fs.rm(raw, { force: true });
      artifact = q;
      filename = `st0r-drill-${short}-a${ctx.attempt}.qcow2`;
    }
    const st = await fs.stat(artifact);
    const sha = await sha256File(artifact);

    // Import into the hypervisor.
    if (!def.artifact_base_url && evidence === 'actual') {
      throw new DrillError('config', 'Set the address Proxmox should download drill disks from (St0r URL as the hypervisor sees it)');
    }
    const ttl = Math.max(60_000, drill.timeout_seconds * 1000);
    const token = registerArtifact(artifact, st.size, filename, ttl);
    const url = `${(def.artifact_base_url || 'http://simulator.invalid').replace(/\/+$/, '')}/api/recovery/artifacts/${token}/${filename}`;
    let volid: string;
    try {
      ctx.step('import', `Importing ${fmtBytes(st.size)} into ${def.import_storage}`);
      volid = await ctx.ledger.track('pve_volume', `${def.import_storage}:import/${filename}`, filename, def.id, async (id) => {
        const v = await ctx.bounded(hv.importDisk(url, filename, sha, ttl, ctx.signal));
        await ctx.ledger.relocate(id, v);
        return v;
      });
    } catch (e) {
      if (e instanceof DrillError) throw e;
      throw new DrillError('import', `Proxmox could not import the disk: ${(e as Error).message}`, true);
    } finally {
      revokeArtifact(token);
    }
    await fs.rm(artifact, { force: true });

    // The clone.
    const vmid = await ctx.bounded(hv.nextVmid());
    const name = `st0r-drill-${short}`;
    const tag = runTag(ctx.runId);
    ctx.step('import', `Creating VM ${vmid} (${name})`);
    try {
      await ctx.ledger.track('pve_vm', `${def.node}/${vmid}`, `${name}|${tag}`, def.id, () => ctx.bounded(hv.createVm({
        vmid, name, tags: [DRILL_TAG, tag], memoryMb: cfg.memory_mb, cores: cfg.cores, importVolid: volid,
        bridge: def.isolated_bridge, description: `St0r recovery drill ${ctx.runId} for ${drill.client_name}. Disposable: removed by St0r when the drill ends.`,
      }, ttl, ctx.signal)));
    } catch (e) {
      if (e instanceof DrillError) throw e;
      throw new DrillError('import', `Proxmox could not create the drill VM: ${(e as Error).message}`, true);
    }
    copy.vmid = vmid;

    const bootStart = Date.now();
    ctx.step('boot', `Starting VM ${vmid}`);
    try { await ctx.bounded(hv.startVm(vmid, 120_000, ctx.signal)); } catch (e) {
      if (e instanceof DrillError) throw e;
      throw new DrillError('boot', `The clone did not start: ${(e as Error).message}`);
    }
    const bootDeadline = bootStart + cfg.boot_timeout_seconds * 1000;
    for (;;) {
      if (await ctx.bounded(hv.agentPing(vmid))) break;
      if (Date.now() >= bootDeadline) {
        throw new DrillError('boot', `The clone did not boot: its guest agent did not answer within ${cfg.boot_timeout_seconds} s`);
      }
      await ctx.sleep(deps.pollMs);
    }
    ctx.result.boot_ms = Date.now() - bootStart;
    ctx.step('boot', `Guest agent answered after ${Math.round(ctx.result.boot_ms / 1000)} s`);

    const svcDeadline = Date.now() + cfg.service_timeout_seconds * 1000;
    let detail = '';
    for (;;) {
      try {
        const r = await ctx.bounded(hv.guestExec(vmid, ['sc.exe', 'query', cfg.service], 60_000));
        detail = (r.out || r.err).trim().split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6).join(' | ').slice(0, 500);
        if (r.exitcode === 0 && RUNNING.test(r.out)) break;
      } catch (e) {
        if (e instanceof DrillError && e.stage === 'timeout') throw e;
        detail = (e as Error).message;
      }
      if (Date.now() >= svcDeadline) {
        ctx.result.services_json = [{ name: cfg.service, passed: false, detail }];
        throw new DrillError('service', `Service ${cfg.service} was not running in the clone within ${cfg.service_timeout_seconds} s: ${detail || 'no answer'}`);
      }
      await ctx.sleep(deps.pollMs);
    }
    ctx.result.services_json = [{ name: cfg.service, passed: true, detail }];
    ctx.result.rto_ms = Date.now() - ctx.runStartedAt;
    ctx.step('service', `Service ${cfg.service} is running`);
    return { evidence };
  } finally {
    for (const img of images) await img.close().catch(() => undefined);
  }
}
