import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const FALLBACK_SECRET = 'change-this-secret-in-production';
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === FALLBACK_SECRET) {
  // eslint-disable-next-line no-console
  console.error('CRITICAL: JWT_SECRET is not set or is the insecure default. Set a strong random value in .env before running in production.');
}
const JWT_SECRET = process.env.JWT_SECRET || FALLBACK_SECRET;
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
}

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '24h',
  });
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET) as JWTPayload;
}
