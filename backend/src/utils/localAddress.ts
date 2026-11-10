import { createSocket } from 'dgram';
import { lookup } from 'dns/promises';
import { isIP } from 'net';

/** Loopback, link-local, RFC 1918 and IPv6 unique-local addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254);
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]);
    return lower === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(lower) || /^fe[89ab][0-9a-f]?:/.test(lower);
  }
  return false;
}

/**
 * St0r's own address as `host` will see it — the source address the kernel
 * picks for that destination (a UDP "connect" sends nothing) — but only when
 * both ends are private addresses. On a private network there is no NAT in
 * between, so that is the address the agent sees; across the Internet St0r's
 * public address cannot be known from here, and null is returned.
 */
export async function storAddressFor(host: string, port: number): Promise<string | null> {
  let ip = host;
  if (!isIP(ip)) {
    try { ip = (await lookup(host)).address; } catch { return null; }
  }
  if (!isPrivateAddress(ip)) return null;
  const local = await new Promise<string | null>((resolve) => {
    const sock = createSocket(isIP(ip) === 6 ? 'udp6' : 'udp4');
    const done = (v: string | null) => { try { sock.close(); } catch { /* closed */ } resolve(v); };
    sock.once('error', () => done(null));
    sock.connect(port, ip, () => {
      try { done(sock.address().address); } catch { done(null); }
    });
  });
  return local && isPrivateAddress(local) && isIP(local) ? local : null;
}
