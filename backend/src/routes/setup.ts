import { Router, Request, Response } from 'express';
import { pool } from '../config/database.js';
import { comparePassword } from '../utils/auth.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Check if system needs first-time setup (default password still in use)
router.get('/status', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(
      'SELECT password_hash FROM app_users WHERE username = ? AND is_admin = TRUE LIMIT 1',
      ['admin']
    );

    const users = rows as any[];

    if (users.length === 0) {
      res.json({ needsSetup: true, reason: 'no_admin' });
      return;
    }

    // Check if password is still the default "admin123"
    const isDefaultPassword = await comparePassword('admin123', users[0].password_hash);

    res.json({
      needsSetup: isDefaultPassword,
      reason: isDefaultPassword ? 'default_password' : 'configured'
    });
  } catch (error: any) {
    logger.error('Failed to check setup status:', error);
    res.status(500).json({ error: 'Failed to check setup status' });
  }
});

export default router;
