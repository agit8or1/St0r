import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { pool } from '../config/database.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

export async function check2FAStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = (req.user as any)?.id;

    if (!userId) {
      logger.warn('check2FAStatus: No user ID found');
      res.json({ enabled: false });
      return;
    }

    logger.info(`Checking 2FA status for user ID: ${userId}`);

    const [rows] = await pool.query(
      'SELECT totp_enabled FROM app_users WHERE id = ?',
      [userId]
    );

    const users = rows as any[];
    if (users.length === 0) {
      logger.warn(`check2FAStatus: User ${userId} not found`);
      res.json({ enabled: false });
      return;
    }

    const enabled = users[0].totp_enabled === 1 || users[0].totp_enabled === true;
    logger.info(`2FA status for user ${userId}: ${enabled}`);
    res.json({ enabled });
  } catch (error: any) {
    logger.error('Failed to check 2FA status:', error);
    res.status(500).json({ error: 'Failed to check 2FA status' });
  }
}

export async function setup2FA(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = (req.user as any)?.id;
    const username = (req.user as any)?.username;

    // Generate a new secret
    const secret = speakeasy.generateSecret({
      name: `UrBackup GUI (${username})`,
      issuer: 'UrBackup GUI'
    });

    // Store the temp secret (not enabled yet)
    await pool.query(
      'UPDATE app_users SET totp_secret = ? WHERE id = ?',
      [secret.base32, userId]
    );

    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url || '');

    res.json({
      secret: secret.base32,
      qrCode: qrCodeUrl
    });
  } catch (error: any) {
    logger.error('Failed to setup 2FA:', error);
    res.status(500).json({ error: 'Failed to setup 2FA' });
  }
}

export async function verify2FA(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = (req.user as any)?.id;
    const { token } = req.body;

    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    // Get the secret
    const [rows] = await pool.query(
      'SELECT totp_secret FROM app_users WHERE id = ?',
      [userId]
    );

    const users = rows as any[];
    if (users.length === 0 || !users[0].totp_secret) {
      res.status(400).json({ error: '2FA not set up' });
      return;
    }

    // Verify the token
    const verified = speakeasy.totp.verify({
      secret: users[0].totp_secret,
      encoding: 'base32',
      token: token,
      window: 2 // Allow 2 time steps before and after
    });

    if (!verified) {
      res.status(400).json({ error: 'Invalid token' });
      return;
    }

    // Generate backup codes
    const backupCodes: string[] = [];
    for (let i = 0; i < 8; i++) {
      const code = Math.random().toString(36).substring(2, 10).toUpperCase();
      backupCodes.push(code);
    }

    // Enable 2FA
    await pool.query(
      'UPDATE app_users SET totp_enabled = TRUE WHERE id = ?',
      [userId]
    );

    res.json({
      success: true,
      message: '2FA enabled successfully',
      backupCodes
    });
  } catch (error: any) {
    logger.error('Failed to verify 2FA:', error);
    res.status(500).json({ error: 'Failed to verify 2FA' });
  }
}

export async function enable2FA(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = (req.user as any)?.id;
    const { token } = req.body;

    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    // Get the secret
    const [rows] = await pool.query(
      'SELECT totp_secret FROM app_users WHERE id = ?',
      [userId]
    );

    const users = rows as any[];
    if (users.length === 0 || !users[0].totp_secret) {
      res.status(400).json({ error: '2FA not set up. Please setup 2FA first.' });
      return;
    }

    // Verify the token
    const verified = speakeasy.totp.verify({
      secret: users[0].totp_secret,
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (!verified) {
      res.status(400).json({ error: 'Invalid token' });
      return;
    }

    // Enable 2FA
    await pool.query(
      'UPDATE app_users SET totp_enabled = TRUE WHERE id = ?',
      [userId]
    );

    res.json({ success: true, message: '2FA enabled successfully' });
  } catch (error: any) {
    logger.error('Failed to enable 2FA:', error);
    res.status(500).json({ error: 'Failed to enable 2FA' });
  }
}

export async function disable2FA(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = (req.user as any)?.id;
    const { token } = req.body;

    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    // Get the secret
    const [rows] = await pool.query(
      'SELECT totp_secret FROM app_users WHERE id = ?',
      [userId]
    );

    const users = rows as any[];
    if (users.length === 0 || !users[0].totp_secret) {
      res.status(400).json({ error: '2FA not set up' });
      return;
    }

    // Verify the token
    const verified = speakeasy.totp.verify({
      secret: users[0].totp_secret,
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (!verified) {
      res.status(400).json({ error: 'Invalid token' });
      return;
    }

    // Disable 2FA and remove secret
    await pool.query(
      'UPDATE app_users SET totp_enabled = FALSE, totp_secret = NULL WHERE id = ?',
      [userId]
    );

    res.json({ success: true, message: '2FA disabled successfully' });
  } catch (error: any) {
    logger.error('Failed to disable 2FA:', error);
    res.status(500).json({ error: 'Failed to disable 2FA' });
  }
}
