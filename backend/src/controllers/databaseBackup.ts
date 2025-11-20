import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { databaseBackupService } from '../services/databaseBackup.js';
import { logger } from '../utils/logger.js';

export async function createBackup(req: AuthRequest, res: Response): Promise<void> {
  try {
    logger.info(`Manual database backup triggered by user: ${req.user?.username}`);

    const result = await databaseBackupService.createBackup();

    if (result.success) {
      res.json({
        success: true,
        message: 'Database backup created successfully',
        backupPath: result.backupPath
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to create backup'
      });
    }
  } catch (error: any) {
    logger.error('Failed to create database backup:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create database backup'
    });
  }
}

export async function listBackups(req: AuthRequest, res: Response): Promise<void> {
  try {
    const backups = await databaseBackupService.listBackups();
    res.json(backups);
  } catch (error) {
    logger.error('Failed to list backups:', error);
    res.status(500).json({ error: 'Failed to list backups' });
  }
}

export async function getBackupStats(req: AuthRequest, res: Response): Promise<void> {
  try {
    const stats = await databaseBackupService.getBackupStats();
    res.json(stats);
  } catch (error) {
    logger.error('Failed to get backup stats:', error);
    res.status(500).json({ error: 'Failed to get backup stats' });
  }
}

export async function cleanupOldBackups(req: AuthRequest, res: Response): Promise<void> {
  try {
    logger.info(`Manual backup cleanup triggered by user: ${req.user?.username}`);

    const deletedCount = await databaseBackupService.cleanupOldBackups();

    res.json({
      success: true,
      message: `Deleted ${deletedCount} old backup(s)`,
      deletedCount
    });
  } catch (error) {
    logger.error('Failed to cleanup backups:', error);
    res.status(500).json({ error: 'Failed to cleanup backups' });
  }
}
