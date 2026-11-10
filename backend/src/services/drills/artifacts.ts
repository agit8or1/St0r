import { randomBytes } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import { Request, Response } from 'express';

/**
 * Disk images a boot drill hands to the hypervisor. The hypervisor pulls the
 * file over HTTP(S) from St0r (Proxmox "download from URL"), so each one is
 * published under a random 256-bit token for as long as the import runs, and
 * nothing else is reachable through this route. Proxmox also checks the
 * file's SHA-256, which it is given separately.
 */
interface Entry { file: string; size: number; expires: number; filename: string }

const entries = new Map<string, Entry>();

export function registerArtifact(file: string, size: number, filename: string, ttlMs: number): string {
  const token = randomBytes(32).toString('hex');
  entries.set(token, { file, size, filename, expires: Date.now() + ttlMs });
  return token;
}

export function revokeArtifact(token: string): void {
  entries.delete(token);
}

export function artifactCount(): number {
  return entries.size;
}

/** GET /api/recovery/artifacts/:token/:filename — no session; the token is the credential. */
export async function serveArtifact(req: Request, res: Response): Promise<void> {
  const token = String(req.params.token || '');
  const e = /^[0-9a-f]{64}$/.test(token) ? entries.get(token) : undefined;
  if (!e || e.expires < Date.now() || req.params.filename !== e.filename) {
    if (e && e.expires < Date.now()) entries.delete(token);
    res.status(404).json({ error: 'Not found' });
    return;
  }
  try {
    const st = await fs.stat(e.file);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(st.size));
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(e.file).on('error', () => res.destroy()).pipe(res);
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
}
