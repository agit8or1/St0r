import type { Request } from 'express';
import bcrypt from 'bcrypt';
import { createHmac, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';

const FALLBACK_SECRET = 'change-this-secret-in-production';
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === FALLBACK_SECRET) {
  throw new Error('[Auth] CRITICAL: JWT_SECRET is not set or is the insecure default. Set a strong secret in backend/.env');
}
const JWT_SECRET = process.env.JWT_SECRET;
const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(
  password: string,
  hash: string
): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

export interface JWTPayload {
  userId: number;
  username: string;
  isAdmin: boolean;
  credentialVersion: string;
}

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '24h',
  });
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET) as JWTPayload;
}

/** A keyed fingerprint invalidates existing sessions after any password reset. */
export function credentialVersion(passwordHash: string): string {
  return createHmac('sha256', JWT_SECRET).update(passwordHash).digest('hex');
}

export function matchesCredentialVersion(version: unknown, passwordHash: string): boolean {
  if (typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version)) return false;
  return timingSafeEqual(Buffer.from(version, 'hex'), Buffer.from(credentialVersion(passwordHash), 'hex'));
}

/**
 * Whether the session cookie gets the Secure flag.
 *   COOKIE_SECURE=true   always
 *   COOKIE_SECURE=false  never (plain-HTTP installs that must keep working)
 *   unset / auto         when this request arrived over HTTPS
 * "auto" relies on nginx passing X-Forwarded-Proto (setup/nginx-site.conf does)
 * and on `trust proxy` being loopback, so it turns on by itself once Certbot
 * adds the 443 server block — no .env edit needed.
 */
export function cookieSecure(req: Request): boolean {
  const setting = (process.env.COOKIE_SECURE ?? 'auto').trim().toLowerCase();
  if (setting === 'true') return true;
  if (setting === 'false') return false;
  return req.secure;
}
