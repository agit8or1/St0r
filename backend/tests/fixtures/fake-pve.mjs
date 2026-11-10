// A disposable stand-in for the Proxmox VE API (the endpoints a boot drill
// uses), over HTTPS with a throwaway self-signed certificate. It really
// downloads the drill disk from St0r's artifact URL, checks the SHA-256 it was
// given, and keeps VMs and volumes in memory so tests can see exactly what a
// drill created and removed.
import { createServer } from 'node:https';
import { get as httpGet } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function makeCert(dir) {
  const key = join(dir, 'pve.key'); const crt = join(dir, 'pve.crt');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '1', '-subj', '/CN=pve.test'], { stdio: 'ignore' });
  const fp = execFileSync('openssl', ['x509', '-in', crt, '-noout', '-fingerprint', '-sha256'], { encoding: 'utf-8' });
  return { key: readFileSync(key), cert: readFileSync(crt), fingerprint: fp.trim() };
}

function download(url) {
  return new Promise((resolve, reject) => {
    httpGet(url, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`download HTTP ${res.statusCode}`)); res.resume(); return; }
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

export class FakePve {
  constructor({ key, cert, token, dir }) {
    Object.assign(this, { key, cert, token, dir });
    this.vms = new Map();           // vmid -> { name, tags, params, running }
    this.volumes = new Map();       // volid -> Buffer
    this.tasks = new Map();
    this.networks = { vmbr9: { type: 'bridge', bridge_ports: '', active: 1 } };
    this.storage = { local: 1e12, 'local-lvm': 1e12 };
    this.behaviour = { boot: 'ok', service: 'ok', failDelete: false, failStart: false };
    this.nextVmid = 100;
    this.calls = [];
    this.seq = 0;
  }

  async listen() {
    this.server = createServer({ key: this.key, cert: this.cert }, (req, res) => this.handle(req, res));
    await new Promise((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `https://127.0.0.1:${this.server.address().port}`;
    return this.url;
  }
  close() { this.server?.close(); }

  task(ok = true, exitstatus = 'OK') {
    const upid = `UPID:pve:0000${++this.seq}:00000000:00000000:qmtask:${this.seq}:root@pam:`;
    this.tasks.set(upid, { status: 'stopped', exitstatus: ok ? 'OK' : exitstatus });
    return upid;
  }

  async handle(req, res) {
    const u = new URL(req.url, 'https://x');
    let body = '';
    for await (const c of req) body += c;
    const form = new URLSearchParams(req.method === 'GET' || req.method === 'DELETE' ? u.search : body);
    const send = (status, data, message) => { res.statusMessage = message || ''; res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: data ?? null })); };
    if (req.headers.authorization !== `PVEAPIToken=${this.token}`) return send(401, null, 'authentication failure');
    const p = u.pathname.replace(/^\/api2\/json/, '');
    this.calls.push(`${req.method} ${p}`);
    let m;
    try {
      if (req.method === 'GET' && p === '/version') return send(200, { version: '8.4.1' });
      if (req.method === 'GET' && p === '/cluster/nextid') return send(200, String(this.nextVmid++));
      if (req.method === 'GET' && (m = p.match(/^\/nodes\/pve\/storage\/([^/]+)\/status$/))) return send(200, { avail: this.storage[m[1]] ?? 0, active: 1, enabled: 1 });
      if (req.method === 'GET' && (m = p.match(/^\/nodes\/pve\/network\/([^/]+)$/))) {
        return this.networks[m[1]] ? send(200, this.networks[m[1]]) : send(400, null, `interface does not exist`);
      }
      if (req.method === 'GET' && (m = p.match(/^\/nodes\/pve\/tasks\/([^/]+)\/status$/))) return send(200, this.tasks.get(decodeURIComponent(m[1])));
      if (req.method === 'POST' && (m = p.match(/^\/nodes\/pve\/storage\/([^/]+)\/download-url$/))) {
        if (form.get('content') !== 'import') return send(400, null, 'content must be import');
        const data = await download(form.get('url'));
        const sha = createHash('sha256').update(data).digest('hex');
        if (form.get('checksum-algorithm') !== 'sha256' || form.get('checksum') !== sha) return send(200, this.task(false, 'checksum mismatch'));
        const volid = `${m[1]}:import/${form.get('filename')}`;
        this.volumes.set(volid, data);
        writeFileSync(join(this.dir, form.get('filename')), data);
        return send(200, this.task());
      }
      if (req.method === 'GET' && (m = p.match(/^\/nodes\/pve\/storage\/([^/]+)\/content$/))) {
        return send(200, [...this.volumes.keys()].filter((v) => v.startsWith(`${m[1]}:`)).map((volid) => ({ volid, content: 'import' })));
      }
      if (req.method === 'DELETE' && (m = p.match(/^\/nodes\/pve\/storage\/([^/]+)\/content\/(.+)$/))) {
        const volid = decodeURIComponent(m[2]);
        if (!this.volumes.delete(volid)) return send(500, null, `volume '${volid}' does not exist`);
        return send(200, this.task());
      }
      if (req.method === 'POST' && p === '/nodes/pve/qemu') {
        const vmid = Number(form.get('vmid'));
        if (this.vms.has(vmid)) return send(500, null, `VM ${vmid} already exists`);
        const imp = /import-from=([^,]+)/.exec(form.get('sata0') || '')?.[1];
        if (!imp || !this.volumes.has(imp)) return send(500, null, 'import source does not exist');
        this.vms.set(vmid, { name: form.get('name'), tags: form.get('tags'), params: Object.fromEntries(form), running: false });
        return send(200, this.task());
      }
      if ((m = p.match(/^\/nodes\/pve\/qemu\/(\d+)(\/.*)?$/))) {
        const vmid = Number(m[1]); const rest = m[2] || ''; const vm = this.vms.get(vmid);
        if (!vm) return send(500, null, `Configuration file 'nodes/pve/qemu-server/${vmid}.conf' does not exist`);
        if (req.method === 'GET' && rest === '/config') return send(200, { name: vm.name, tags: vm.tags });
        if (req.method === 'POST' && rest === '/status/start') {
          if (this.behaviour.failStart) return send(200, this.task(false, 'start failed: QEMU exited with code 1'));
          vm.running = true; return send(200, this.task());
        }
        if (req.method === 'POST' && rest === '/status/stop') { vm.running = false; return send(200, this.task()); }
        if (req.method === 'POST' && rest === '/agent/ping') {
          return vm.running && this.behaviour.boot === 'ok' ? send(200, {}) : send(500, null, 'QEMU guest agent is not running');
        }
        if (req.method === 'POST' && rest === '/agent/exec') {
          vm.lastExec = form.getAll('command');
          return send(200, { pid: 4242 });
        }
        if (req.method === 'GET' && rest === '/agent/exec-status') {
          const state = this.behaviour.service === 'ok' ? '4  RUNNING' : '1  STOPPED';
          return send(200, { exited: 1, exitcode: this.behaviour.service === 'ok' ? 0 : 0, 'out-data': `\r\nSERVICE_NAME: ${vm.lastExec?.at(-1)}\r\n        TYPE               : 10  WIN32_OWN_PROCESS\r\n        STATE              : ${state}\r\n` });
        }
        if (req.method === 'DELETE' && rest === '') {
          if (this.behaviour.failDelete) return send(500, null, 'unable to remove VM: storage is busy');
          this.vms.delete(vmid); return send(200, this.task());
        }
      }
      return send(501, null, `not implemented: ${req.method} ${p}`);
    } catch (e) {
      return send(500, null, e.message);
    }
  }
}
