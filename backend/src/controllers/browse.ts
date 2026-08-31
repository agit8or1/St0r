import { Request, Response } from 'express';
import { logger } from '../utils/logger.js';
import { UrBackupDbService } from '../services/urbackupDb.js';
import { realpathSync } from 'fs';
import { userInfo } from 'os';
import { openUrBackupSettingsDbReadOnly } from '../config/urbackupDb.js';

const dbService = new UrBackupDbService();

// UrBackup writes this file at install time. It is NOT authoritative: changing the
// storage path in UrBackup's own UI updates the settings database and leaves this
// file pointing at the original location (issue #20).
const BACKUP_FOLDER_FILE = '/var/urbackup/backupfolder';
const BACKUP_FOLDER_FILE_ALT = '/etc/urbackup/backupfolder';

/**
 * A storage problem that already knows how it should be reported over HTTP.
 * Lets the helpers below distinguish "this genuinely is not there" (404) from
 * "we are not allowed to look" (503) instead of collapsing both into 404.
 */
class StorageAccessError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error: string; detail?: string; hint?: string }
  ) {
    super(body.error);
    this.name = 'StorageAccessError';
  }
}

/**
 * The backup data is owned by the `urbackup` user and its per-client folders are
 * mode 0750, so St0r can only read them if its service user is in the `urbackup`
 * group. When that is missing every path lookup fails with EACCES — which used to
 * surface as a bare 404 that looked exactly like a missing backup. Say what is
 * actually wrong and how to fix it.
 */
function permissionError(target: string): StorageAccessError {
  let serviceUser = 'the St0r service user';
  try {
    serviceUser = userInfo().username;
  } catch {
    // userInfo can throw if the uid has no passwd entry; the generic wording is fine
  }
  return new StorageAccessError(503, {
    error: 'Cannot read the backup storage folder',
    detail: `Permission denied reading ${target}`,
    hint: `St0r runs as "${serviceUser}", which needs to be in the "urbackup" group to read backups. ` +
          `Run: sudo usermod -a -G urbackup ${serviceUser} && sudo systemctl restart urbackup-gui`,
  });
}

function isPermissionDenied(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === 'EACCES' || code === 'EPERM';
}

/**
 * Read UrBackup's configured storage root.
 *
 * The settings database is the authoritative source: it is what UrBackup's own UI
 * writes and what the server uses to place backups. The /var/urbackup/backupfolder
 * file is only written at install time, so on any server whose storage path was
 * changed later it still names the original directory — backups keep working while
 * St0r looks in a folder that may not even exist, and reports every backup as
 * missing (issue #20). The file is kept only as a fallback for installs whose
 * settings database cannot be read.
 */
async function resolveBackupFolder(): Promise<string> {
  const tried: string[] = [];

  // 1. UrBackup's settings database — authoritative.
  try {
    const settingsDb = await openUrBackupSettingsDbReadOnly();
    try {
      const row = await settingsDb.get<{ value?: string }>(
        "SELECT value FROM settings WHERE key = 'backupfolder' AND clientid = 0 LIMIT 1"
      );
      const folder = row?.value?.trim();
      if (folder) return folder;
      tried.push(`${BACKUP_FOLDER_FILE.replace('backupfolder', 'backup_server_settings.db')} (no backupfolder row)`);
    } finally {
      await settingsDb.close().catch(() => undefined);
    }
  } catch (err) {
    tried.push(`settings database (${(err as Error).message})`);
  }

  // 2. The install-time files, in case the settings database is unreadable.
  const fs = await import('fs/promises');
  for (const file of [BACKUP_FOLDER_FILE, BACKUP_FOLDER_FILE_ALT]) {
    try {
      const folder = (await fs.readFile(file, 'utf-8')).trim();
      if (folder) {
        logger.warn(`Falling back to ${file} for the backup storage folder; UrBackup's settings database could not be read`);
        return folder;
      }
      tried.push(`${file} (empty)`);
    } catch (err) {
      if (isPermissionDenied(err)) throw permissionError(file);
      tried.push(`${file} (${(err as NodeJS.ErrnoException).code ?? 'unreadable'})`);
    }
  }

  throw new StorageAccessError(503, {
    error: 'Backup storage folder is not configured',
    detail: `Could not determine the backup storage folder. Tried: ${tried.join('; ')}`,
    hint: 'Check that UrBackup Server is installed and that its storage path is set in UrBackup > Settings.',
  });
}

/**
 * realpath a backup path, distinguishing "missing" from "not allowed to look".
 */
function resolveStoragePath(target: string, notFoundMessage: string): string {
  try {
    return realpathSync(target);
  } catch (err) {
    if (isPermissionDenied(err)) throw permissionError(target);
    // Name the path that was actually checked. When the configured storage folder
    // is wrong this is the difference between a bare 404 and an obvious answer.
    throw new StorageAccessError(404, {
      error: notFoundMessage,
      detail: `No such path on disk: ${target}`,
      hint: 'If this path looks wrong, check the backup storage folder in UrBackup > Settings.',
    });
  }
}

/**
 * Translate a StorageAccessError into its response. Returns false if the error
 * was something else and the caller should handle it.
 */
function sendStorageError(error: unknown, res: Response): boolean {
  if (!(error instanceof StorageAccessError)) return false;
  logger.error(`Backup storage access failed: ${error.body.detail ?? error.body.error}`);
  if (!res.headersSent) res.status(error.status).json(error.body);
  return true;
}

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
      // Distinguishable from the storage errors above: the id is genuinely not in
      // this client's completed backups (commonly pruned since the list loaded).
      res.status(404).json({
        error: 'Backup not found',
        detail: `No completed backup with id ${backupId} for client ${clientId}`,
        hint: 'It may have been deleted or pruned — reload the backup list.',
      });
      return;
    }

    // Parse the backup path and list files
    const fs = await import('fs/promises');
    const pathModule = await import('path');

    const backupFolder = await resolveBackupFolder();

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
    const resolvedBase = resolveStoragePath(backupBasePath, 'Backup path not found');
    const resolvedFull = resolveStoragePath(fullPath, 'Path not found in backup');
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
      if (isPermissionDenied(error)) {
        sendStorageError(permissionError(fullPath), res);
        return;
      }
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
    if (sendStorageError(error, res)) return;
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
    const backupFolder = await resolveBackupFolder();

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
    resolvedDlBase = resolveStoragePath(backupBasePath, 'Backup path not found');
    resolvedDlFull = resolveStoragePath(fullPath, 'File not found');
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
    if (sendStorageError(error, res)) return;
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

    const backupFolder = await resolveBackupFolder();

    const clients = await dbService.getClients();
    const client = clients.find(c => c.id === Number(clientId));
    if (!client) { res.status(404).json({ error: 'Client not found' }); return; }

    const fullPath = pathModule.join(backupFolder, client.name, backup.path, path);
    const backupBasePath = pathModule.join(backupFolder, client.name, backup.path);

    // Resolve symlinks for security check
    let resolvedBase: string;
    let resolvedFull: string;
    resolvedBase = resolveStoragePath(backupBasePath, 'Backup path not found');
    resolvedFull = resolveStoragePath(fullPath, 'Folder not found');
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
    if (sendStorageError(error, res)) return;
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
