import { Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';

const execAsync = promisify(exec);

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

    // First check if script exists
    try {
      await execAsync(`test -f ${updateScript}`);
    } catch (error) {
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
      await execAsync('sudo systemctl reset-failed urbackup-gui-update.service 2>/dev/null || true');
    } catch (e) {
      // Ignore errors - unit may not exist
    }

    // Run the script as root in the background
    // Use systemd-run to create a completely independent transient service
    exec(`sudo systemd-run --unit=urbackup-gui-update --description="UrBackup GUI Update" bash -c "${updateScript} > /var/log/urbackup-gui-update.log 2>&1"`, (error) => {
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

    // Check if update is still in progress by checking if the transient update unit is running
    // The update runs as systemd unit "urbackup-gui-update"
    let inProgress = false;
    try {
      const { stdout } = await execAsync('systemctl is-active urbackup-gui-update 2>/dev/null || echo inactive');
      inProgress = stdout.trim() === 'active' || stdout.trim() === 'activating';
    } catch (error) {
      // If unit doesn't exist, check if log indicates completion
      inProgress = !log.includes('SUCCESS') && !log.includes('Update completed successfully');
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
