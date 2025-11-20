import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { UrBackupDbService } from '../services/urbackupDb.js';
import { logger } from '../utils/logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const dbService = new UrBackupDbService();

/**
 * Get storage information from the local UrBackup server
 */
export async function getTotalStorage(req: AuthRequest, res: Response): Promise<void> {
  try {
    // Get UrBackup backup path from environment or use default
    const backupPath = process.env.URBACKUP_BACKUP_PATH || '/var/urbackup';

    // Get disk usage for the backup path
    const { stdout } = await execAsync(`df -B1 ${backupPath} | tail -1`);
    const parts = stdout.trim().split(/\s+/);

    const totalSize = parseInt(parts[1]) || 0;
    const usedSize = parseInt(parts[2]) || 0;
    const availableSize = parseInt(parts[3]) || 0;

    // Get storage used by clients from database
    const stats = await dbService.getServerStats();
    const fileBytes = stats.total_file_bytes || 0;
    const imageBytes = stats.total_image_bytes || 0;
    const totalUsedByBackups = fileBytes + imageBytes;

    logger.info(`Storage: ${usedSize} bytes used, ${availableSize} bytes available on ${backupPath}`);

    res.json({
      used: usedSize,
      available: availableSize,
      total: totalSize,
      backupPath: backupPath,
      fileBackups: fileBytes,
      imageBackups: imageBytes,
      totalBackups: totalUsedByBackups,
      servers: [{
        serverId: 1,
        serverName: 'Local UrBackup Server',
        used: usedSize,
        available: availableSize
      }]
    });
  } catch (error) {
    logger.error('Failed to get storage information:', error);
    res.status(500).json({ error: 'Failed to get storage information' });
  }
}

/**
 * Get storage for a specific server (kept for compatibility, but returns local server)
 */
export async function getServerStorage(req: AuthRequest, res: Response): Promise<void> {
  // Since we only have one local server now, this is the same as getTotalStorage
  return getTotalStorage(req, res);
}
