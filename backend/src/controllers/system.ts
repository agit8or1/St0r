import { Request, Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';

const execFileAsync = promisify(execFile);

export async function triggerUpdate(req: Request, res: Response) {
  try {
    const user = (req as any).user;

    // Only admins can trigger updates
    if (!user.isAdmin) {
      res.status(403).json({ error: 'Only administrators can trigger updates' });
      return;
    }

    logger.info(`Update triggered by user: ${user.username}`);

    // Execute the update script in the background
    const updateScript = '/opt/urbackup-gui/auto-update.sh';

    // Check if script exists (no shell needed — use existsSync)
    if (!existsSync(updateScript)) {
      logger.error('Update script not found');
      res.status(500).json({
        error: 'Update script not found',
        message: 'The auto-update script is not installed'
      });
      return;
    }

    // Start the update in the background
    // The update script will:
    // 1. Backup current installation
    // 2. Download latest version
    // 3. Stop service
    // 4. Extract and install
    // 5. Restart service
    // 6. Restore backup if anything fails

    // Reset any previous failed update unit to avoid conflicts
    try {
      await execFileAsync('sudo', ['systemctl', 'reset-failed', 'urbackup-gui-update.service']);
    } catch (_e) {
      // Ignore errors - unit may not exist
    }

    // Run the script as root in the background via systemd-run.
    // Use --property flags to redirect output instead of a shell pipeline.
    execFile('sudo', [
      'systemd-run',
      '--unit=urbackup-gui-update',
      '--description=UrBackup GUI Update',
      '--property=StandardOutput=append:/var/log/urbackup-gui-update.log',
      '--property=StandardError=append:/var/log/urbackup-gui-update.log',
      updateScript,
    ], (error) => {
      if (error) {
        logger.error('Failed to start update script:', error);
      }
    });

    logger.info('Update process started in background');

    res.json({
      success: true,
      message: 'Update process started. The service will restart automatically. This may take a few minutes.',
      note: 'You may be disconnected during the update. Please wait 1-2 minutes and refresh the page.'
    });
  } catch (error: any) {
    logger.error('Failed to trigger update:', error);
    res.status(500).json({
      error: 'Failed to trigger update',
      message: error.message
    });
  }
}

export async function getUpdateLog(req: Request, res: Response) {
  try {
    const logFile = '/var/log/urbackup-gui-update.log';

    if (!existsSync(logFile)) {
      res.json({ log: '', inProgress: false });
      return;
    }

    const log = await readFile(logFile, 'utf-8');

    // Check if update is still in progress by checking the transient update unit
    let inProgress = false;
    try {
      const { stdout } = await execFileAsync('systemctl', ['is-active', 'urbackup-gui-update']);
      const status = stdout.trim();
      inProgress = status === 'active' || status === 'activating';
    } catch (_e) {
      // Non-zero exit means unit is inactive, failed, or not found — not running.
      inProgress = false;
    }

    res.json({
      log,
      inProgress,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    logger.error('Failed to get update log:', error);
    res.status(500).json({
      error: 'Failed to get update log',
      message: error.message
    });
  }
}
