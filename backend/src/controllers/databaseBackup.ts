import { Response } from 'express';
import { createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import { AuthRequest } from '../middleware/auth.js';
import { databaseBackupService } from '../services/databaseBackup.js';
import { logger } from '../utils/logger.js';

export async function createBackup(req: AuthRequest, res: Response): Promise<void> {
  try {
    logger.info(`Manual database backup triggered by user: ${req.user?.username}`);
    const result = await databaseBackupService.createBackup();
    if (result.success) {
      res.json({ success: true, message: 'Backup created successfully', backupPath: result.backupPath });
    } else {
      res.status(500).json({ success: false, error: result.error || 'Failed to create backup' });
    }
  } catch (error: any) {
    logger.error('Failed to create database backup:', error);
    res.status(500).json({ success: false, error: 'Failed to create database backup' });
  }
}

export async function listBackups(req: AuthRequest, res: Response): Promise<void> {
  try {
    const backups = await databaseBackupService.listBackups();
    res.json({ success: true, backups });
  } catch (error) {
    logger.error('Failed to list backups:', error);
    res.status(500).json({ success: false, error: 'Failed to list backups' });
  }
}

export async function deleteBackup(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { filename } = req.params;
    logger.info(`Backup delete triggered by user: ${req.user?.username}, file: ${filename}`);
    const result = await databaseBackupService.deleteBackup(filename);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    logger.error('Failed to delete backup:', error);
    res.status(500).json({ success: false, error: 'Failed to delete backup' });
  }
}

export async function downloadBackup(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { filename } = req.params;
    const filePath = databaseBackupService.getBackupPath(filename);
    if (!filePath) { res.status(404).json({ error: 'Backup not found' }); return; }
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/gzip');
    createReadStream(filePath).pipe(res);
  } catch (error: any) {
    logger.error('Failed to download backup:', error);
    res.status(500).json({ error: 'Failed to download backup' });
  }
}

export async function restoreBackup(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { filename } = req.params;
    const filePath = databaseBackupService.getBackupPath(filename);
    if (!filePath) { res.status(404).json({ error: 'Backup not found' }); return; }
    logger.info(`Restore triggered by ${req.user?.username} from file: ${filename}`);
    const result = await databaseBackupService.restoreBackup(filePath);
    if (result.success) {
      res.json({ success: true, message: 'Database restored successfully' });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    logger.error('Failed to restore backup:', error);
    res.status(500).json({ error: 'Failed to restore backup' });
  }
}

export async function uploadAndRestore(req: AuthRequest, res: Response): Promise<void> {
  try {
    const file = (req as any).file;
    if (!file) { res.status(400).json({ error: 'No file uploaded' }); return; }
    logger.info(`Upload-restore triggered by ${req.user?.username}, file: ${file.originalname}`);
    const result = await databaseBackupService.restoreFromUpload(file.path, file.originalname);
    if (result.success) {
      res.json({ success: true, message: 'Backup uploaded and restored successfully', savedAs: result.savedAs });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    logger.error('Failed to upload and restore backup:', error);
    res.status(500).json({ error: 'Failed to upload and restore backup' });
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
    res.json({ success: true, message: `Deleted ${deletedCount} old backup(s)`, deletedCount });
  } catch (error) {
    logger.error('Failed to cleanup backups:', error);
    res.status(500).json({ error: 'Failed to cleanup backups' });
  }
}
