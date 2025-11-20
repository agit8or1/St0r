import { Request, Response } from 'express';
import { findUserByUsername, updateLastLogin } from '../models/user.js';
import { comparePassword, generateToken } from '../utils/auth.js';
import { logger } from '../utils/logger.js';
import { pool } from '../config/database.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const speakeasy = require('speakeasy');

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { username, password, totpToken } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const user = await findUserByUsername(username);

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const isValidPassword = await comparePassword(password, user.password_hash);

    if (!isValidPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Check if 2FA is enabled for this user
    const [rows] = await pool.query(
      'SELECT totp_enabled, totp_secret FROM app_users WHERE id = ?',
      [user.id]
    );
    const users = rows as any[];
    const twoFAEnabled = users.length > 0 && (users[0].totp_enabled === 1 || users[0].totp_enabled === true);

    // If 2FA is enabled, verify the token
    if (twoFAEnabled) {
      if (!totpToken) {
        // Return response indicating 2FA is required
        res.json({
          requires2FA: true,
          message: '2FA code required'
        });
        return;
      }

      // Verify the TOTP token
      const verified = speakeasy.totp.verify({
        secret: users[0].totp_secret,
        encoding: 'base32',
        token: totpToken,
        window: 2
      });

      if (!verified) {
        res.status(401).json({ error: 'Invalid 2FA code' });
        return;
      }
    }

    await updateLastLogin(user.id);

    const token = generateToken({
      userId: user.id,
      username: user.username,
      isAdmin: user.is_admin,
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        isAdmin: user.is_admin,
      },
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function validateToken(req: Request, res: Response): Promise<void> {
  // If we reach here, the token is valid (middleware already validated it)
  res.json({ valid: true });
}
