import { Request, Response } from 'express';
import { findUserById, updateUser } from '../models/user.js';
import { comparePassword, hashPassword } from '../utils/auth.js';
import { logger } from '../utils/logger.js';

export async function changePassword(req: Request, res: Response) {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = (req as any).user.userId;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current password and new password are required' });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters long' });
      return;
    }

    // Get current user
    const user = await findUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Verify current password
    const isValidPassword = await comparePassword(currentPassword, user.password_hash);
    if (!isValidPassword) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    // Check that new password is different
    if (currentPassword === newPassword) {
      res.status(400).json({ error: 'New password must be different from current password' });
      return;
    }

    // Hash new password
    const newPasswordHash = await hashPassword(newPassword);

    // Update user password
    await updateUser(userId, { password_hash: newPasswordHash });

    logger.info(`User ${user.username} (ID: ${userId}) changed their password`);

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error: any) {
    logger.error('Failed to change password:', error);
    res.status(500).json({
      error: 'Failed to change password',
      message: error.message
    });
  }
}
