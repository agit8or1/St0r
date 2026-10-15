/**
 * agentClient.ts
 * HTTP client that talks to a remote stor-agent instance.
 * All requests include the API key header.
 *
 * Transport, in order:
 * - a pinned fingerprint: TLS, accepting only that certificate (the agent's
 *   self-signed one). It is checked before the API key is sent.
 * - loopback, or STOR_AGENT_ALLOW_INSECURE_HTTP=true: plain HTTP.
 * - otherwise: TLS with normal CA and hostname verification.
 * Redirects are never followed, so the key cannot be forwarded.
 */
import { request as httpRequest, ClientRequest, IncomingMessage } from 'http';
import { request as httpsRequest } from 'https';
import { connect as tlsConnect } from 'tls';
import { isIP } from 'net';
import { logger } from '../utils/logger.js';

export interface AgentServer {
  id: string;
  host: string;
  agent_port: number;
  agent_api_key_encrypted?: string;
  decryptedKey?: string; // populated by caller after decrypt()
  tls_fingerprint?: string | null; // SHA-256 of the agent's certificate, lower-case hex
}

/**
 * Lower-case hex SHA-256 fingerprint, or null if `value` is not one.
 * Accepts "AB:CD:…", openssl's "sha256 Fingerprint=AB:CD:…" and bare hex.
 */
export function normalizeFingerprint(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hex = value.replace(/^[^=]*=/, '').replace(/[\s:]/g, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

type Transport = 'pinned' | 'http' | 'https';

export function agentTransport(server: AgentServer): Transport {
  if (normalizeFingerprint(server.tls_fingerprint)) return 'pinned';
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(server.host);
  return loopback || process.env.STOR_AGENT_ALLOW_INSECURE_HTTP === 'true' ? 'http' : 'https';
}

function agentHeaders(server: AgentServer, body?: string): Record<string, string | number> {
  const headers: Record<string, string | number> = {
    'x-stor-agent-key': server.decryptedKey || '',
    'Content-Type': 'application/json',
  };
  if (body !== undefined) headers['Content-Length'] = Buffer.byteLength(body);
  return headers;
}

function describeTlsError(e: any): string {
  if (e?.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || e?.code === 'SELF_SIGNED_CERT_IN_CHAIN') {
    return 'agent certificate is self-signed and no fingerprint is pinned; register the agent with the fingerprint its installer printed';
  }
  return e?.message || String(e);
}

function agentRequest(server: AgentServer, method: 'GET' | 'POST', path: string, body: any, timeoutMs: number): Promise<any> {
  const payload = method === 'POST' ? JSON.stringify(body ?? {}) : undefined;
  const transport = agentTransport(server);
  const options = {
    host: server.host,
    port: server.agent_port,
    method,
    path,
    headers: agentHeaders(server, payload),
  };
  // SNI must be a name, never an IP address.
  const servername = isIP(server.host) ? undefined : server.host;

  return new Promise((resolve, reject) => {
    let req: ClientRequest | undefined;
    let settled = false;
    const finish = (err: Error | null, value?: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err); else resolve(value);
    };
    const timer = setTimeout(() => {
      finish(new Error(`Agent ${path} timed out after ${timeoutMs} ms`));
      req?.destroy();
      socket?.destroy();
    }, timeoutMs);

    const onResponse = (resp: IncomingMessage) => {
      let text = '';
      resp.setEncoding('utf8');
      resp.on('data', chunk => { text += chunk; });
      resp.on('error', e => finish(e));
      resp.on('end', () => {
        const status = resp.statusCode || 0;
        if (status < 200 || status >= 300) {
          finish(new Error(`Agent ${path} → HTTP ${status}: ${text}`));
          return;
        }
        try { finish(null, JSON.parse(text)); } catch { finish(new Error(`Agent ${path} returned invalid JSON`)); }
      });
    };
    const send = (make: () => ClientRequest) => {
      req = make();
      req.on('response', onResponse);
      req.on('error', e => finish(new Error(describeTlsError(e))));
      req.end(payload);
    };

    let socket: ReturnType<typeof tlsConnect> | undefined;
    if (transport === 'http') {
      send(() => httpRequest(options));
    } else if (transport === 'https') {
      send(() => httpsRequest({ ...options, servername, agent: false }));
    } else {
      // The certificate is self-signed, so CA verification cannot apply and
      // Node only calls checkServerIdentity for certificates that pass it.
      // Finish the handshake, compare the fingerprint, and only then send
      // the request (and the API key) over that same socket.
      const pin = normalizeFingerprint(server.tls_fingerprint)!;
      socket = tlsConnect({ host: server.host, port: server.agent_port, servername, rejectUnauthorized: false });
      socket.once('error', e => finish(e));
      socket.once('secureConnect', () => {
        const presented = normalizeFingerprint(socket!.getPeerCertificate()?.fingerprint256);
        if (presented !== pin) {
          socket!.destroy();
          finish(new Error(`Agent certificate does not match the pinned fingerprint (presented ${presented || 'none'})`));
          return;
        }
        send(() => httpRequest({ ...options, createConnection: () => socket! }));
      });
    }
  });
}

export async function agentGet<T = any>(server: AgentServer, path: string, timeoutMs = 8000): Promise<T> {
  return agentRequest(server, 'GET', path, undefined, timeoutMs) as Promise<T>;
}

export async function agentPost<T = any>(server: AgentServer, path: string, body: any = {}, timeoutMs = 8000): Promise<T> {
  return agentRequest(server, 'POST', path, body, timeoutMs) as Promise<T>;
}

/**
 * Ping the agent health endpoint.
 * Returns { ok, latencyMs } or { ok: false, error }.
 */
export async function pingAgent(server: AgentServer): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const data = await agentGet<{ ok: boolean }>(server, '/health', 5000);
    return { ok: data.ok === true, latencyMs: Date.now() - start };
  } catch (e: any) {
    logger.warn(`[agentClient] ping ${server.host}:${server.agent_port} failed: ${e.message}`);
    return { ok: false, latencyMs: Date.now() - start, error: e.message };
  }
}
