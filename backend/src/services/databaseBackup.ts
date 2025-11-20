import { exec } from 'child_process';
import { promisify } from 'util';
import { readdir, stat, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

export class DatabaseBackupService {
  private backupDir = '/opt/urbackup-gui/backups';
  private retentionDays = 30;

  constructor() {
    this.ensureBackupDirectory();
  }

  private async ensureBackupDirectory() {
    try {
      if (!existsSync(this.backupDir)) {
        await mkdir(this.backupDir, { recursive: true });
        logger.info(`Created backup directory: ${this.backupDir}`);
      }
    } catch (error) {
      logger.error('Failed to create backup directory:', error);
    }
  }

  /**
   * Get MySQL database credentials from environment
   */
  private getMySQLConfig(): { host: string; user: string; password: string; database: string } {
    return {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'urbackup',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'urbackup_gui'
    };
  }

  /**
   * Create a backup of the GUI's MySQL database
   */
  async createBackup(): Promise<{ success: boolean; backupPath?: string; error?: string }> {
    try {
      await this.ensureBackupDirectory();

      const config = this.getMySQLConfig();

      // Create timestamp for backup filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' +
                       new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
      const backupFileName = `urbackup_gui_db_backup_${timestamp}.sql`;
      const backupPath = join(this.backupDir, backupFileName);

      logger.info(`Creating MySQL database backup: ${backupFileName}`);

      // Use mysqldump for backup
      const passwordArg = config.password ? `-p${config.password}` : '';
      const backupCommand = `mysqldump -h ${config.host} -u ${config.user} ${passwordArg} ${config.database} > "${backupPath}"`;

      try {
        await execAsync(backupCommand);
        logger.info(`Database backup created successfully: ${backupPath}`);

        // Verify backup file was created and has content
        const stats = await stat(backupPath);
        if (stats.size === 0) {
          throw new Error('Backup file is empty');
        }

        // Compress the backup
        const gzipCommand = `gzip -f "${backupPath}"`;
        await execAsync(gzipCommand);
        const compressedPath = `${backupPath}.gz`;

        logger.info(`Database backup compressed: ${compressedPath}`);

        // Clean up old backups
        await this.cleanupOldBackups();

        return {
          success: true,
          backupPath: compressedPath
        };
      } catch (execError: any) {
        logger.error('Backup command failed:', execError);
        return {
          success: false,
          error: `Backup command failed: ${execError.message}`
        };
      }
    } catch (error: any) {
      logger.error('Failed to create database backup:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Clean up backups older than retention period
   */
  async cleanupOldBackups(): Promise<number> {
    try {
      const files = await readdir(this.backupDir);
      const now = Date.now();
      const retentionMs = this.retentionDays * 24 * 60 * 60 * 1000;
      let deletedCount = 0;

      for (const file of files) {
        if (file.startsWith('urbackup_gui_db_backup_') && file.endsWith('.gz')) {
          const filePath = join(this.backupDir, file);
          const stats = await stat(filePath);
          const fileAge = now - stats.mtimeMs;

          if (fileAge > retentionMs) {
            await unlink(filePath);
            deletedCount++;
            logger.info(`Deleted old backup: ${file} (age: ${Math.floor(fileAge / (24 * 60 * 60 * 1000))} days)`);
          }
        }
      }

      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} old backup(s)`);
      }

      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup old backups:', error);
      return 0;
    }
  }

  /**
   * List all available backups
   */
  async listBackups(): Promise<Array<{ name: string; size: number; created: Date; age: string }>> {
    try {
      const files = await readdir(this.backupDir);
      const backups: Array<{ name: string; size: number; created: Date; age: string }> = [];

      for (const file of files) {
        if (file.startsWith('urbackup_gui_db_backup_') && file.endsWith('.gz')) {
          const filePath = join(this.backupDir, file);
          const stats = await stat(filePath);
          const ageMs = Date.now() - stats.mtimeMs;
          const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

          backups.push({
            name: file,
            size: stats.size,
            created: stats.mtime,
            age: ageDays === 0 ? 'Today' :
                 ageDays === 1 ? '1 day ago' :
                 `${ageDays} days ago`
          });
        }
      }

      // Sort by creation date, newest first
      backups.sort((a, b) => b.created.getTime() - a.created.getTime());

      return backups;
    } catch (error) {
      logger.error('Failed to list backups:', error);
      return [];
    }
  }

  /**
   * Get backup statistics
   */
  async getBackupStats(): Promise<{
    totalBackups: number;
    totalSize: number;
    oldestBackup: Date | null;
    newestBackup: Date | null;
  }> {
    try {
      const backups = await this.listBackups();

      if (backups.length === 0) {
        return {
          totalBackups: 0,
          totalSize: 0,
          oldestBackup: null,
          newestBackup: null
        };
      }

      const totalSize = backups.reduce((sum, backup) => sum + backup.size, 0);

      return {
        totalBackups: backups.length,
        totalSize,
        oldestBackup: backups[backups.length - 1].created,
        newestBackup: backups[0].created
      };
    } catch (error) {
      logger.error('Failed to get backup stats:', error);
      return {
        totalBackups: 0,
        totalSize: 0,
        oldestBackup: null,
        newestBackup: null
      };
    }
  }
}

// Create singleton instance
export const databaseBackupService = new DatabaseBackupService();
