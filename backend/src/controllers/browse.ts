import { Request, Response } from 'express';
import { logger } from '../utils/logger.js';
import { UrBackupDbService } from '../services/urbackupDb.js';
import { realpathSync } from 'fs';

const dbService = new UrBackupDbService();

/**
 * Get available backups for browsing
 */
export async function getBackupsForBrowsing(req: Request, res: Response): Promise<void> {
  try {
    const { clientName } = req.query;

    if (!clientName || typeof clientName !== 'string') {
      res.status(400).json({ error: 'Client name is required' });
      return;
    }

    // Get all clients to find the client ID
    const clients = await dbService.getClients();
    const client = clients.find(c => c.name === clientName);

    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    // Get file backups for this client
    const fileBackups = await dbService.getFileBackups(client.id);

    // Format for frontend
    const backups = fileBackups
      .filter(b => b.complete)
      .map(backup => ({
        id: backup.id,
        clientid: client.id,
        backuptime: backup.backuptime,
        size_bytes: backup.size_bytes || 0,
        incremental: backup.incremental,
        path: backup.path,
        archived: backup.archived,
      }))
      .sort((a, b) => b.backuptime - a.backuptime);

    res.json({
      backups,
      clientId: client.id,
      clientName: client.name,
    });
  } catch (error) {
    logger.error('Failed to get backups for browsing:', error);
    res.status(500).json({ error: 'Failed to get backups' });
  }
}

/**
 * Get files in a backup at a specific path
 */
export async function getFilesInBackup(req: Request, res: Response): Promise<void> {
  try {
    const { clientId, backupId, path } = req.query;

    if (!clientId || !backupId) {
      res.status(400).json({ error: 'Client ID and backup ID are required' });
      return;
    }

    const backupPath = path && typeof path === 'string' ? path : '/';

    // Get the backup details to find the path on disk
    const fileBackups = await dbService.getFileBackups(Number(clientId));
    const backup = fileBackups.find(b => b.id === Number(backupId));

    if (!backup) {
      res.status(404).json({ error: 'Backup not found' });
      return;
    }

    // Parse the backup path and list files
    const fs = await import('fs/promises');
    const pathModule = await import('path');

    // Read backup folder location from /var/urbackup/backupfolder
    let backupFolder = '/media/BACKUP/urbackup'; // default
    try {
      const backupFolderContent = await fs.readFile('/var/urbackup/backupfolder', 'utf-8');
      backupFolder = backupFolderContent.trim();
    } catch (err) {
      logger.warn('Could not read /var/urbackup/backupfolder, using default');
    }

    // Get client info to get client name
    const clients = await dbService.getClients();
    const client = clients.find(c => c.id === Number(clientId));

    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    // Construct full path: /backupfolder/clientname/backuppath/requestedpath
    const backupBasePath = pathModule.normalize(pathModule.join(backupFolder, client.name, backup.path));
    let fullPath = backupBasePath;

    // If a subdirectory is requested, append it
    if (backupPath !== '/') {
      fullPath = pathModule.normalize(pathModule.join(backupBasePath, backupPath));
    }

    // Security check: use realpathSync to resolve symlinks before comparing
    let resolvedBase: string;
    let resolvedFull: string;
    try {
      resolvedBase = realpathSync(backupBasePath);
    } catch {
      res.status(404).json({ error: 'Backup path not found' });
      return;
    }
    try {
      resolvedFull = realpathSync(fullPath);
    } catch {
      res.status(404).json({ error: 'Path not found in backup' });
      return;
    }
    if (!resolvedFull.startsWith(resolvedBase + '/') && resolvedFull !== resolvedBase) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    try {
      // Read the directory
      const entries = await fs.readdir(fullPath, { withFileTypes: true });

      const files = await Promise.all(
        entries.map(async (entry) => {
          const entryPath = pathModule.join(fullPath, entry.name);
          const relativePath = backupPath === '/'
            ? `/${entry.name}`
            : `${backupPath}/${entry.name}`;

          try {
            const stats = await fs.stat(entryPath);

            return {
              name: entry.name,
              path: relativePath,
              isDir: entry.isDirectory(),
              size: entry.isFile() ? stats.size : undefined,
              modifiedTime: stats.mtime.toISOString(),
            };
          } catch (err) {
            logger.error(`Failed to stat ${entryPath}:`, err);
            return {
              name: entry.name,
              path: relativePath,
              isDir: entry.isDirectory(),
            };
          }
        })
      );

      // Sort: directories first, then files
      files.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      });

      res.json({ files });
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        res.status(404).json({ error: 'Path not found in backup' });
        return;
      }
      if (error.code === 'EACCES') {
        res.status(403).json({ error: 'Permission denied' });
        return;
      }
      throw error;
    }
  } catch (error) {
    logger.error('Failed to get files in backup:', error);
    res.status(500).json({ error: 'Failed to get files' });
  }
}

/**
 * Download a file from a backup
 */
export async function downloadFile(req: Request, res: Response): Promise<void> {
  try {
    const { clientId, backupId, path } = req.query;

    if (!clientId || !backupId || !path || typeof path !== 'string') {
      res.status(400).json({ error: 'Client ID, backup ID, and file path are required' });
      return;
    }

    // Get the backup details
    const fileBackups = await dbService.getFileBackups(Number(clientId));
    const backup = fileBackups.find(b => b.id === Number(backupId));

    if (!backup) {
      res.status(404).json({ error: 'Backup not found' });
      return;
    }

    // Construct the full file path
    const pathModule = await import('path');
    const fs = await import('fs');

    // Read backup folder location
    let backupFolder = '/media/BACKUP/urbackup';
    try {
      const backupFolderContent = await fs.promises.readFile('/var/urbackup/backupfolder', 'utf-8');
      backupFolder = backupFolderContent.trim();
    } catch (err) {
      logger.warn('Could not read /var/urbackup/backupfolder, using default');
    }

    // Get client info
    const clients = await dbService.getClients();
    const client = clients.find(c => c.id === Number(clientId));

    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    const fullPath = pathModule.join(backupFolder, client.name, backup.path, path);

    // Security check: use realpathSync to resolve symlinks before comparing
    const backupBasePath = pathModule.join(backupFolder, client.name, backup.path);
    let resolvedDlBase: string;
    let resolvedDlFull: string;
    try {
      resolvedDlBase = realpathSync(backupBasePath);
    } catch {
      res.status(404).json({ error: 'Backup path not found' });
      return;
    }
    try {
      resolvedDlFull = realpathSync(fullPath);
    } catch {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    if (!resolvedDlFull.startsWith(resolvedDlBase + '/') && resolvedDlFull !== resolvedDlBase) {
      logger.error(`Security check failed: ${resolvedDlFull} does not start with ${resolvedDlBase}`);
      res.status(403).json({ error: 'Invalid file path' });
      return;
    }

    // Check if file exists
    try {
      await fs.promises.access(fullPath, fs.constants.R_OK);
    } catch (err) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    // Get file stats
    const stats = await fs.promises.stat(fullPath);

    if (stats.isDirectory()) {
      res.status(400).json({ error: 'Cannot download a directory' });
      return;
    }

    // Reject files over 2 GB to prevent excessive memory/bandwidth usage
    if (stats.size > 2 * 1024 * 1024 * 1024) {
      res.status(400).json({ error: 'File too large to download directly (> 2 GB)' });
      return;
    }

    // Send file
    const fileName = pathModule.basename(fullPath);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);

    const readStream = fs.createReadStream(fullPath);
    readStream.pipe(res);

    readStream.on('error', (error) => {
      logger.error('Error streaming file:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to download file' });
      }
    });
  } catch (error) {
    logger.error('Failed to download file:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download file' });
    }
  }
}

/**
 * Download a folder from a backup as a ZIP archive
 */
export async function downloadFolder(req: Request, res: Response): Promise<void> {
  try {
    const { clientId, backupId, path } = req.query;

    if (!clientId || !backupId || !path || typeof path !== 'string') {
      res.status(400).json({ error: 'clientId, backupId, and path are required' });
      return;
    }

    const fileBackups = await dbService.getFileBackups(Number(clientId));
    const backup = fileBackups.find(b => b.id === Number(backupId));
    if (!backup) { res.status(404).json({ error: 'Backup not found' }); return; }

    const pathModule = await import('path');
    const fs = await import('fs');

    let backupFolder = '/media/BACKUP/urbackup';
    try {
      const bf = await fs.promises.readFile('/var/urbackup/backupfolder', 'utf-8');
      backupFolder = bf.trim();
    } catch { /* use default */ }

    const clients = await dbService.getClients();
    const client = clients.find(c => c.id === Number(clientId));
    if (!client) { res.status(404).json({ error: 'Client not found' }); return; }

    const fullPath = pathModule.join(backupFolder, client.name, backup.path, path);
    const backupBasePath = pathModule.join(backupFolder, client.name, backup.path);

    // Resolve symlinks for security check
    let resolvedBase: string;
    let resolvedFull: string;
    try { resolvedBase = realpathSync(backupBasePath); } catch { res.status(404).json({ error: 'Backup path not found' }); return; }
    try { resolvedFull = realpathSync(fullPath); } catch { res.status(404).json({ error: 'Folder not found' }); return; }
    if (!resolvedFull.startsWith(resolvedBase + '/') && resolvedFull !== resolvedBase) {
      res.status(403).json({ error: 'Invalid path' }); return;
    }

    // Must be a directory
    const stat = await fs.promises.stat(resolvedFull);
    if (!stat.isDirectory()) { res.status(400).json({ error: 'Path is not a directory' }); return; }

    const folderName = pathModule.basename(resolvedFull) || 'backup';
    const zipName = `${folderName}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);

    const { spawn } = await import('child_process');
    // zip -r - . streams a zip of the current directory to stdout
    const zip = spawn('zip', ['-r', '-', '.'], { cwd: resolvedFull, stdio: ['ignore', 'pipe', 'ignore'] });
    zip.stdout.pipe(res);
    zip.on('error', (e) => {
      logger.error('[browse] zip error:', e);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to create zip' });
      else res.destroy();
    });
  } catch (error) {
    logger.error('Failed to download folder:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to download folder' });
  }
}

/**
 * Restore files to the client
 */
export async function restoreFiles(req: Request, res: Response): Promise<void> {
  try {
    const { clientId, backupId, paths, restorePath } = req.body;

    if (!clientId || !backupId || !paths || !Array.isArray(paths)) {
      res.status(400).json({ error: 'Client ID, backup ID, and file paths are required' });
      return;
    }

    // Get client info
    const clients = await dbService.getClients();
    const client = clients.find(c => c.id === Number(clientId));

    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    // Get the backup details
    const fileBackups = await dbService.getFileBackups(Number(clientId));
    const backup = fileBackups.find(b => b.id === Number(backupId));

    if (!backup) {
      res.status(404).json({ error: 'Backup not found' });
      return;
    }

    // Initiate restore via UrBackup API
    const urbackupUrl = process.env.URBACKUP_URL || 'http://localhost:55414';
    const response = await fetch(`${urbackupUrl}/x`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        a: 'restore',
        clientid: clientId.toString(),
        backupid: backupId.toString(),
        paths: JSON.stringify(paths),
        restore_path: restorePath || '',
      }),
    });

    const data: any = await response.json();

    if (!response.ok || !data.success) {
      logger.error('UrBackup restore failed:', data);
      res.status(500).json({
        error: 'Failed to initiate restore',
        details: data.error || 'Unknown error',
      });
      return;
    }

    res.json({
      success: true,
      message: 'Restore initiated successfully',
      data,
    });
  } catch (error) {
    logger.error('Failed to restore files:', error);
    res.status(500).json({ error: 'Failed to initiate restore' });
  }
}
