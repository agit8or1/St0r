import { DrillError } from './errors.js';
import { PveClient, PveHttpError, isMissing } from './proxmox.js';
import { RemoveOutcome } from './ledger.js';
import { ResourceRecord } from './store.js';

/** What a boot drill needs from a hypervisor. */
export interface VmSpec {
  vmid: number;
  name: string;
  tags: string[];
  memoryMb: number;
  cores: number;
  /** Import source volume (as the hypervisor lists it). */
  importVolid: string;
  /** null: no network device at all. */
  bridge: string | null;
  description: string;
}

export interface GuestExecResult { exitcode: number; out: string; err: string }

export interface Hypervisor {
  readonly evidence: 'actual' | 'simulated';
  readonly label: string;
  ping(): Promise<void>;
  storageAvail(storage: string): Promise<number>;
  /** Throws an 'isolation' error unless `bridge` has no uplink, address or gateway. */
  checkIsolation(bridge: string): Promise<{ detail: string }>;
  nextVmid(): Promise<number>;
  /** Have the hypervisor download a disk image into its import storage. Returns the volume id. */
  importDisk(url: string, filename: string, sha256: string, timeoutMs: number, signal: AbortSignal): Promise<string>;
  createVm(spec: VmSpec, timeoutMs: number, signal: AbortSignal): Promise<void>;
  startVm(vmid: number, timeoutMs: number, signal: AbortSignal): Promise<void>;
  /** Resolves when the guest agent answers. */
  agentPing(vmid: number): Promise<boolean>;
  guestExec(vmid: number, command: string[], timeoutMs: number): Promise<GuestExecResult>;
  /** name and tags of a VM, or null when there is none with that id. */
  vmInfo(vmid: number): Promise<{ name: string; tags: string[] } | null>;
  /** Stop (hard) and destroy a VM with its disks. */
  destroyVm(vmid: number, timeoutMs: number): Promise<void>;
  volumeExists(volid: string): Promise<boolean>;
  deleteVolume(volid: string, timeoutMs: number): Promise<void>;
}

export const DRILL_TAG = 'st0r-drill';
export function runTag(runId: string): string { return `st0r-run-${runId.replace(/-/g, '').slice(0, 12)}`; }

const node = (n: string) => `/nodes/${encodeURIComponent(n)}`;

export class ProxmoxHypervisor implements Hypervisor {
  readonly evidence = 'actual' as const;
  constructor(
    private api: PveClient,
    private cfg: { node: string; disk_storage: string; import_storage: string; name: string },
    private pollMs = 2000,
  ) {}
  get label() { return `Proxmox ${this.cfg.name} (node ${this.cfg.node})`; }

  async ping() {
    try { await this.api.get('/version'); } catch (e) {
      throw new DrillError('connect', `Proxmox ${this.cfg.name} is unreachable: ${(e as Error).message}`, true);
    }
  }

  async storageAvail(storage: string) {
    const st = await this.api.get(`${node(this.cfg.node)}/storage/${encodeURIComponent(storage)}/status`);
    if (!st || st.active === 0 || st.enabled === 0) throw new DrillError('config', `Proxmox storage ${storage} is not active on ${this.cfg.node}`);
    return Number(st.avail) || 0;
  }

  async checkIsolation(bridge: string) {
    let iface: any;
    try { iface = await this.api.get(`${node(this.cfg.node)}/network/${encodeURIComponent(bridge)}`); } catch (e) {
      if (e instanceof PveHttpError && e.status >= 400 && e.status < 600 && e.status !== 0) {
        throw new DrillError('isolation', `Bridge ${bridge} does not exist on ${this.cfg.node}`);
      }
      throw e;
    }
    const problems: string[] = [];
    if (iface?.type !== 'bridge' && iface?.type !== 'OVSBridge') problems.push(`it is a ${iface?.type || 'unknown'} interface, not a bridge`);
    const ports = String(iface?.bridge_ports ?? iface?.ovs_ports ?? '').trim();
    if (ports && ports !== 'none') problems.push(`it has uplink ports (${ports})`);
    for (const k of ['address', 'cidr', 'gateway', 'address6', 'cidr6', 'gateway6']) {
      if (iface?.[k]) problems.push(`the host has ${k} ${iface[k]} on it`);
    }
    if (problems.length) {
      throw new DrillError('isolation', `Bridge ${bridge} is not isolated: ${problems.join('; ')}. ` +
        'A drill clone must not reach production networks; use a bridge with no ports and no host address, or none.');
    }
    return { detail: `bridge ${bridge}: no uplink ports, no host address or gateway` };
  }

  async nextVmid() { return Number(await this.api.get('/cluster/nextid')); }

  async importDisk(url: string, filename: string, sha256: string, timeoutMs: number, signal: AbortSignal) {
    const base = `${node(this.cfg.node)}/storage/${encodeURIComponent(this.cfg.import_storage)}`;
    const upid = await this.api.post(`${base}/download-url`, {
      content: 'import', filename, url, checksum: sha256, 'checksum-algorithm': 'sha256', 'verify-certificates': 0,
    });
    await this.api.waitTask(this.cfg.node, upid, timeoutMs, signal, this.pollMs);
    const list: any[] = (await this.api.get(`${base}/content`, { content: 'import' })) || [];
    const vol = list.find((v) => typeof v?.volid === 'string' && v.volid.endsWith(`/${filename}`));
    if (!vol) throw new DrillError('import', `Proxmox finished the download but ${filename} is not in ${this.cfg.import_storage}`);
    return vol.volid as string;
  }

  async createVm(spec: VmSpec, timeoutMs: number, signal: AbortSignal) {
    const s = this.cfg.disk_storage;
    const params: Record<string, unknown> = {
      vmid: spec.vmid, name: spec.name, tags: spec.tags.join(';'), description: spec.description,
      ostype: 'win11', machine: 'q35', bios: 'ovmf', cpu: 'host', cores: spec.cores, memory: spec.memoryMb,
      efidisk0: `${s}:1,efitype=4m,pre-enrolled-keys=0`,
      sata0: `${s}:0,import-from=${spec.importVolid}`,
      boot: 'order=sata0', agent: 'enabled=1', onboot: 0, protection: 0,
    };
    if (spec.bridge) params.net0 = `e1000,bridge=${spec.bridge},firewall=0`;
    const upid = await this.api.post(`${node(this.cfg.node)}/qemu`, params);
    await this.api.waitTask(this.cfg.node, upid, timeoutMs, signal, this.pollMs);
  }

  async startVm(vmid: number, timeoutMs: number, signal: AbortSignal) {
    const upid = await this.api.post(`${node(this.cfg.node)}/qemu/${vmid}/status/start`);
    await this.api.waitTask(this.cfg.node, upid, timeoutMs, signal, this.pollMs);
  }

  async agentPing(vmid: number) {
    try { await this.api.post(`${node(this.cfg.node)}/qemu/${vmid}/agent/ping`, {}, true); return true; } catch (e) {
      if (e instanceof PveHttpError && e.status !== 0 && e.status !== 401 && e.status !== 403) return false;
      throw e;
    }
  }

  async guestExec(vmid: number, command: string[], timeoutMs: number) {
    const started = await this.api.post(`${node(this.cfg.node)}/qemu/${vmid}/agent/exec`, { command });
    const pid = started?.pid;
    if (typeof pid !== 'number') throw new DrillError('service', 'The guest agent did not start the command');
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const st = await this.api.get(`${node(this.cfg.node)}/qemu/${vmid}/agent/exec-status`, { pid });
      if (st?.exited) return { exitcode: Number(st.exitcode ?? -1), out: String(st['out-data'] ?? ''), err: String(st['err-data'] ?? '') };
      if (Date.now() > deadline) throw new DrillError('service', `The command in the guest did not finish within ${Math.round(timeoutMs / 1000)} s`);
      await new Promise((r) => setTimeout(r, Math.min(this.pollMs, 1000)));
    }
  }

  async vmInfo(vmid: number) {
    try {
      const c = await this.api.get(`${node(this.cfg.node)}/qemu/${vmid}/config`);
      return { name: String(c?.name ?? ''), tags: String(c?.tags ?? '').split(/[;,\s]+/).filter(Boolean) };
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  }

  async destroyVm(vmid: number, timeoutMs: number) {
    const base = `${node(this.cfg.node)}/qemu/${vmid}`;
    try {
      const upid = await this.api.post(`${base}/status/stop`, { skiplock: 0 }, true);
      await this.api.waitTask(this.cfg.node, upid, timeoutMs, undefined, this.pollMs);
    } catch (e) {
      if (isMissing(e)) return;
      // A VM that is already stopped makes stop fail on some versions; destroy decides.
    }
    try {
      const upid = await this.api.del(base, { purge: 1, 'destroy-unreferenced-disks': 1 });
      await this.api.waitTask(this.cfg.node, upid, timeoutMs, undefined, this.pollMs);
    } catch (e) {
      if (isMissing(e)) return;
      throw e;
    }
  }

  async volumeExists(volid: string) {
    const storage = volid.split(':')[0];
    const list: any[] = (await this.api.get(`${node(this.cfg.node)}/storage/${encodeURIComponent(storage)}/content`, { content: 'import' })) || [];
    return list.some((v) => v?.volid === volid);
  }

  async deleteVolume(volid: string, timeoutMs: number) {
    const storage = volid.split(':')[0];
    try {
      const upid = await this.api.del(`${node(this.cfg.node)}/storage/${encodeURIComponent(storage)}/content/${encodeURIComponent(volid)}`);
      await this.api.waitTask(this.cfg.node, upid, timeoutMs, undefined, this.pollMs);
    } catch (e) {
      if (isMissing(e)) return;
      throw e;
    }
  }
}

/**
 * A hypervisor that only pretends. Lets an operator try the boot-drill flow,
 * alerts and reports without a Proxmox host. Every run on it is recorded as
 * simulated evidence and is never shown as a verified recovery.
 */
export class SimulatorHypervisor implements Hypervisor {
  readonly evidence = 'simulated' as const;
  readonly vms = new Map<number, { name: string; tags: string[]; running: boolean; bootAt: number }>();
  readonly volumes = new Set<string>();
  private nextId = 9000;
  constructor(private behaviour: { boot?: 'ok' | 'fail'; service?: 'ok' | 'fail' } = {}, readonly label = 'Simulator') {}

  async ping() {}
  async storageAvail() { return 10 * 1024 ** 4; }
  async checkIsolation(bridge: string) { return { detail: `simulated bridge ${bridge}` }; }
  async nextVmid() { return this.nextId++; }
  async importDisk(_url: string, filename: string) { const v = `sim:import/${filename}`; this.volumes.add(v); return v; }
  async createVm(spec: VmSpec) { this.vms.set(spec.vmid, { name: spec.name, tags: spec.tags, running: false, bootAt: 0 }); }
  async startVm(vmid: number) { const vm = this.vms.get(vmid); if (vm) { vm.running = true; vm.bootAt = Date.now(); } }
  async agentPing(vmid: number) { return this.behaviour.boot !== 'fail' && !!this.vms.get(vmid)?.running; }
  async guestExec(_vmid: number, command: string[]) {
    const ok = this.behaviour.service !== 'fail';
    const svc = command[command.length - 1];
    return ok
      ? { exitcode: 0, out: `SERVICE_NAME: ${svc}\n        STATE              : 4  RUNNING\n`, err: '' }
      : { exitcode: 0, out: `SERVICE_NAME: ${svc}\n        STATE              : 1  STOPPED\n`, err: '' };
  }
  async vmInfo(vmid: number) { const vm = this.vms.get(vmid); return vm ? { name: vm.name, tags: vm.tags } : null; }
  async destroyVm(vmid: number) { this.vms.delete(vmid); }
  async volumeExists(volid: string) { return this.volumes.has(volid); }
  async deleteVolume(volid: string) { this.volumes.delete(volid); }
}

/** Removes a drill VM — only if it still carries the run's name and tags. */
export class VmRemover {
  constructor(private hv: Hypervisor, private timeoutMs = 300_000) {}
  async remove(r: ResourceRecord): Promise<RemoveOutcome> {
    const vmid = Number(r.locator.split('/').pop());
    if (!Number.isInteger(vmid) || vmid < 100) return 'not_ours';
    const info = await this.hv.vmInfo(vmid);
    if (!info) return 'gone';
    const [name, tag] = r.marker.split('|');
    if (info.name !== name || !info.tags.includes(DRILL_TAG) || !info.tags.includes(tag)) return 'not_ours';
    await this.hv.destroyVm(vmid, this.timeoutMs);
    if (await this.hv.vmInfo(vmid)) throw new Error(`VM ${vmid} still exists after it was destroyed`);
    return 'deleted';
  }
}

/** Removes an imported disk image — only one whose file name is the run's. */
export class VolumeRemover {
  constructor(private hv: Hypervisor, private timeoutMs = 300_000) {}
  async remove(r: ResourceRecord): Promise<RemoveOutcome> {
    if (!/^st0r-drill-[0-9a-f]{12}-a\d{1,3}\.(qcow2|raw)$/.test(r.marker) || !r.locator.endsWith(`/${r.marker}`)) return 'not_ours';
    if (!(await this.hv.volumeExists(r.locator))) return 'gone';
    await this.hv.deleteVolume(r.locator, this.timeoutMs);
    return 'deleted';
  }
}
