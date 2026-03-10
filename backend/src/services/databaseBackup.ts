import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { readdir, stat, unlink, mkdir, writeFile, copyFile } from 'fs/promises';
import { existsSync, createWriteStream, createReadStream } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

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

      // Write credentials to a temp config file (mode 0600) so the password
      // never appears in process arguments or the shell command string.
      const tmpConfig = join(tmpdir(), `mysqldump-${Date.now()}.cnf`);
      await writeFile(
        tmpConfig,
        `[mysqldump]\npassword=${config.password}\n`,
        { mode: 0o600 }
      );

      try {
        // Use spawn (no shell) — each argument is a discrete value, not
        // interpreted by a shell, so injection is not possible.
        await new Promise<void>((resolve, reject) => {
          const child = spawn(
            'mysqldump',
            [
              `--defaults-extra-file=${tmpConfig}`,
              '-h', config.host,
              '-u', config.user,
              config.database,
            ],
            { stdio: ['ignore', 'pipe', 'pipe'] }
          );

          const out = createWriteStream(backupPath);
          child.stdout.pipe(out);

          const stderrChunks: Buffer[] = [];
          child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

          child.on('error', reject);
          child.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else {
              const msg = Buffer.concat(stderrChunks).toString().trim();
              reject(new Error(`mysqldump exited ${code}: ${msg}`));
            }
          });
        });

        logger.info(`Database backup created successfully: ${backupPath}`);

        // Verify backup file was created and has content
        const stats = await stat(backupPath);
        if (stats.size === 0) {
          throw new Error('Backup file is empty');
        }

        // Compress the backup — execFile, no shell
        await execFileAsync('gzip', ['-f', backupPath]);
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
      } finally {
        // Always remove the temp credentials file
        await unlink(tmpConfig).catch(() => {});
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
   * Delete a specific backup file by filename
   */
  async deleteBackup(filename: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Validate filename to prevent path traversal — must match expected pattern exactly
      if (!/^urbackup_gui_db_backup_[\d\-_]+\.sql\.gz$/.test(filename)) {
        return { success: false, error: 'Invalid backup filename' };
      }
      const filePath = join(this.backupDir, filename);
      await unlink(filePath);
      logger.info(`Backup deleted: ${filename}`);
      return { success: true };
    } catch (error: any) {
      logger.error('Failed to delete backup:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get full path for a validated backup filename (for download streaming)
   */
  getBackupPath(filename: string): string | null {
    if (!/^urbackup_gui_db_backup_[\d\-_]+\.sql\.gz$/.test(filename)) return null;
    const filePath = join(this.backupDir, filename);
    return existsSync(filePath) ? filePath : null;
  }

  /**
   * Restore database from a backup file (by filename in backupDir, or a temp path)
   */
  async restoreBackup(sourcePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const config = this.getMySQLConfig();
      const tmpConfig = join(tmpdir(), `mysqlrestore-${Date.now()}.cnf`);
      await writeFile(tmpConfig, `[client]\npassword=${config.password}\n`, { mode: 0o600 });

      try {
        await new Promise<void>((resolve, reject) => {
          // Decompress with gunzip piped into mysql
          const gunzip = spawn('gunzip', ['-c', sourcePath], { stdio: ['ignore', 'pipe', 'pipe'] });
          const mysql = spawn(
            'mysql',
            [`--defaults-extra-file=${tmpConfig}`, '-h', config.host, '-u', config.user, config.database],
            { stdio: ['pipe', 'pipe', 'pipe'] }
          );

          gunzip.stdout.pipe(mysql.stdin);

          const errChunks: Buffer[] = [];
          mysql.stderr.on('data', (c: Buffer) => errChunks.push(c));
          gunzip.stderr.on('data', (c: Buffer) => errChunks.push(c));

          gunzip.on('error', reject);
          mysql.on('error', reject);
          mysql.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`mysql restore exited ${code}: ${Buffer.concat(errChunks).toString().trim()}`));
          });
        });

        logger.info(`Database restored from: ${sourcePath}`);
        return { success: true };
      } finally {
        await unlink(tmpConfig).catch(() => {});
      }
    } catch (error: any) {
      logger.error('Failed to restore database:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Accept an uploaded file (already saved to uploadPath), validate, move to backupDir, restore
   */
  async restoreFromUpload(uploadPath: string, originalName: string): Promise<{ success: boolean; savedAs?: string; error?: string }> {
    try {
      // Accept .sql.gz or .sql files
      const isGz = originalName.endsWith('.sql.gz') || originalName.endsWith('.gz');
      const isSql = originalName.endsWith('.sql');
      if (!isGz && !isSql) {
        return { success: false, error: 'File must be a .sql or .sql.gz backup' };
      }

      let restorePath = uploadPath;
      let savedPath: string | undefined;

      // If it's plain SQL, gzip it before storing
      if (isSql) {
        const gzPath = `${uploadPath}.gz`;
        await new Promise<void>((resolve, reject) => {
          const gz = spawn('gzip', ['-c', uploadPath], { stdio: ['ignore', 'pipe', 'pipe'] });
          const out = createWriteStream(gzPath);
          gz.stdout.pipe(out);
          gz.on('error', reject);
          gz.on('close', (code) => code === 0 ? resolve() : reject(new Error(`gzip failed: ${code}`)));
        });
        await unlink(uploadPath).catch(() => {});
        restorePath = gzPath;
      }

      // Restore
      const result = await this.restoreBackup(restorePath);
      if (!result.success) {
        await unlink(restorePath).catch(() => {});
        return result;
      }

      // Save to backupDir with auto-name
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').substring(0, 19);
      const savedFilename = `urbackup_gui_db_backup_${timestamp}_restored.sql.gz`;
      savedPath = join(this.backupDir, savedFilename);
      await copyFile(restorePath, savedPath);
      await unlink(restorePath).catch(() => {});

      logger.info(`Uploaded backup restored and saved as: ${savedFilename}`);
      return { success: true, savedAs: savedFilename };
    } catch (error: any) {
      logger.error('Failed to restore from upload:', error);
      return { success: false, error: error.message };
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
