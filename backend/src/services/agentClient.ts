/**
 * agentClient.ts
 * HTTP client that talks to a remote stor-agent instance.
 * All requests include the API key header.
 */
import { logger } from '../utils/logger.js';

export interface AgentServer {
  id: string;
  host: string;
  agent_port: number;
  agent_api_key_encrypted: string;
  decryptedKey?: string; // populated by caller after decrypt()
}

function agentUrl(server: AgentServer, path: string): string {
  return `http://${server.host}:${server.agent_port}${path}`;
}

function agentHeaders(server: AgentServer): Record<string, string> {
  return {
    'x-stor-agent-key': server.decryptedKey || '',
    'Content-Type': 'application/json',
  };
}

export async function agentGet<T = any>(server: AgentServer, path: string, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(agentUrl(server, path), {
      headers: agentHeaders(server),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Agent ${path} → HTTP ${resp.status}: ${body}`);
    }
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function agentPost<T = any>(server: AgentServer, path: string, body: any = {}, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(agentUrl(server, path), {
      method: 'POST',
      headers: agentHeaders(server),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Agent ${path} → HTTP ${resp.status}: ${text}`);
    }
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
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
