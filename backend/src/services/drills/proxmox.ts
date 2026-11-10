import { connect as tlsConnect } from 'tls';
import { request as httpRequest, IncomingMessage } from 'http';
import { request as httpsRequest } from 'https';
import { normalizeFingerprint } from '../agentClient.js';
import { DrillError } from './errors.js';

/**
 * A minimal Proxmox VE API client (the API Depl0y drives): API-token auth,
 * TLS either verified normally or pinned to the node's certificate
 * fingerprint, retries for idempotent reads, and task polling.
 */
export interface PveConfig {
  api_url: string;        // https://pve.example:8006
  token_id: string;       // user@realm!tokenid
  token_secret: string;
  tls_fingerprint: string | null;
}

export class PveHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'PveHttpError'; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function encodeForm(params: Record<string, unknown>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const vals = Array.isArray(v) ? v : [v];
    for (const one of vals) out.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(one))}`);
  }
  return out.join('&');
}

export class PveClient {
  private url: URL;
  constructor(private cfg: PveConfig, private opts: { retries?: number; retryDelayMs?: number; timeoutMs?: number } = {}) {
    this.url = new URL(cfg.api_url);
    if (this.url.protocol !== 'https:') throw new DrillError('config', 'The Proxmox API URL must use https');
    if (!/^[^\s!@]+@[^\s!@]+![A-Za-z0-9_.-]+$/.test(cfg.token_id)) throw new DrillError('config', 'The Proxmox token id must look like user@realm!tokenid');
    if (cfg.tls_fingerprint && !normalizeFingerprint(cfg.tls_fingerprint)) throw new DrillError('config', 'The Proxmox TLS fingerprint is not a SHA-256 fingerprint');
  }

  /** One request. `path` is below /api2/json. */
  private once(method: string, path: string, params?: Record<string, unknown>): Promise<any> {
    const form = params ? encodeForm(params) : '';
    const isBody = method === 'POST' || method === 'PUT';
    const fullPath = `/api2/json${path}${!isBody && form ? `?${form}` : ''}`;
    const headers: Record<string, string | number> = {
      Authorization: `PVEAPIToken=${this.cfg.token_id}=${this.cfg.token_secret}`,
      Accept: 'application/json',
    };
    if (isBody) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; headers['Content-Length'] = Buffer.byteLength(form); }
    const host = this.url.hostname.replace(/^\[|\]$/g, '');
    const port = Number(this.url.port) || 443;
    const timeoutMs = this.opts.timeoutMs ?? 30_000;
    const options = { host, port, method, path: fullPath, headers };

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err: Error | null, v?: any) => { if (settled) return; settled = true; clearTimeout(timer); if (err) reject(err); else resolve(v); };
      const timer = setTimeout(() => { finish(new PveHttpError(0, `Proxmox ${method} ${path} timed out after ${timeoutMs} ms`)); conn.socket?.destroy(); }, timeoutMs);
      const onResponse = (res: IncomingMessage) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { text += d; if (text.length > 8_000_000) res.destroy(); });
        res.on('end', () => {
          const status = res.statusCode || 0;
          let body: any = null;
          try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
          if (status < 200 || status >= 300) {
            const reason = (res.statusMessage || '').trim();
            const errs = body?.errors ? ` ${JSON.stringify(body.errors)}` : '';
            finish(new PveHttpError(status, `Proxmox ${method} ${path} → HTTP ${status}${reason ? ` ${reason}` : ''}${errs}`));
            return;
          }
          finish(null, body?.data ?? null);
        });
        res.on('error', (e) => finish(e));
      };
      const conn: { socket?: ReturnType<typeof tlsConnect> } = {};
      const pin = normalizeFingerprint(this.cfg.tls_fingerprint);
      const send = (make: () => ReturnType<typeof httpRequest>) => {
        const req = make();
        req.on('response', onResponse);
        req.on('error', (e) => finish(new PveHttpError(0, `Proxmox ${method} ${path}: ${e.message}`)));
        req.end(isBody ? form : undefined);
      };
      if (!pin) {
        send(() => httpsRequest({ ...options, agent: false }));
        return;
      }
      // Self-signed node certificate: complete the handshake, compare the
      // fingerprint, and only then send the token over that socket.
      const socket = tlsConnect({ host, port, servername: /^[\d.:]+$/.test(host) ? undefined : host, rejectUnauthorized: false });
      conn.socket = socket;
      socket.once('error', (e) => finish(new PveHttpError(0, `Proxmox ${method} ${path}: ${e.message}`)));
      socket.once('secureConnect', () => {
        const presented = normalizeFingerprint(socket.getPeerCertificate()?.fingerprint256);
        if (presented !== pin) {
          socket.destroy();
          finish(new DrillError('connect', `The Proxmox certificate does not match the pinned fingerprint (presented ${presented || 'none'})`));
          return;
        }
        send(() => httpRequest({ ...options, createConnection: () => socket } as any));
      });
    });
  }

  /**
   * A request, retried on connection errors and 5xx — for reads always, for
   * writes only when `idempotent` (a repeated stop or delete is harmless).
   */
  async call(method: string, path: string, params?: Record<string, unknown>, idempotent = method === 'GET'): Promise<any> {
    const retries = idempotent ? (this.opts.retries ?? 3) : 0;
    let last: unknown;
    for (let i = 0; i <= retries; i++) {
      try {
        return await this.once(method, path, params);
      } catch (e) {
        last = e;
        const transient = e instanceof PveHttpError && (e.status === 0 || e.status >= 500);
        if (!transient || i === retries) break;
        await sleep((this.opts.retryDelayMs ?? 1000) * (i + 1));
      }
    }
    throw last;
  }

  get(path: string, params?: Record<string, unknown>) { return this.call('GET', path, params); }
  post(path: string, params?: Record<string, unknown>, idempotent = false) { return this.call('POST', path, params, idempotent); }
  del(path: string, params?: Record<string, unknown>) { return this.call('DELETE', path, params, true); }

  /** Wait for a task (UPID) to stop; throws with its exit status unless it ended OK. */
  async waitTask(node: string, upid: string, timeoutMs: number, signal?: AbortSignal, pollMs = 2000): Promise<void> {
    if (typeof upid !== 'string' || !upid.startsWith('UPID:')) return; // some calls finish synchronously
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (signal?.aborted) throw signal.reason;
      const st = await this.get(`/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`);
      if (st?.status === 'stopped') {
        if (st.exitstatus === 'OK' || /^WARNINGS: /.test(st.exitstatus || '')) return;
        throw new PveHttpError(500, `Proxmox task ${st.type || ''} failed: ${st.exitstatus || 'unknown error'}`);
      }
      if (Date.now() > deadline) throw new DrillError('timeout', `Proxmox task ${upid} did not finish within ${Math.round(timeoutMs / 1000)} s`, true);
      await sleep(pollMs);
    }
  }
}

/** Proxmox reports a missing VM as HTTP 500 "Configuration file ... does not exist". */
export function isMissing(e: unknown): boolean {
  return e instanceof PveHttpError && (e.status === 404 || (e.status === 500 && /does not exist|no such/i.test(e.message)));
}
