import { Router, Request, Response } from 'express';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const router = Router();

// Get version info
router.get('/', async (req: Request, res: Response) => {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const versionPath = join(__dirname, '../../../version.json');
    const versionData = JSON.parse(readFileSync(versionPath, 'utf-8'));

    // Track installation anonymously
    const installId = req.query.installId as string;
    if (installId && installId.length > 10) {
      try {
        // Check if installation exists
        const existing = await query(
          'SELECT id, version FROM installations WHERE install_id = ?',
          [installId]
        );

        if (existing.length > 0) {
          // Update existing installation
          await query(
            'UPDATE installations SET version = ?, check_count = check_count + 1, last_seen = NOW() WHERE install_id = ?',
            [versionData.version, installId]
          );
        } else {
          // Insert new installation
          await query(
            'INSERT INTO installations (install_id, version) VALUES (?, ?)',
            [installId, versionData.version]
          );
          logger.info(`New installation registered: ${installId.substring(0, 8)}...`);
        }
      } catch (dbError) {
        // Don't fail the version check if tracking fails
        logger.error('Failed to track installation:', dbError);
      }
    }

    res.json(versionData);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read version information' });
  }
});

// Get active installation count (installations seen in last 30 days)
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT COUNT(*) as active_installs FROM installations WHERE last_seen >= DATE_SUB(NOW(), INTERVAL 30 DAY)'
    );

    const totalResult = await query(
      'SELECT COUNT(*) as total_installs FROM installations'
    );

    res.json({
      activeInstalls: result[0].active_installs,
      totalInstalls: totalResult[0].total_installs
    });
  } catch (error) {
    logger.error('Failed to get installation stats:', error);
    res.status(500).json({ error: 'Failed to get installation stats' });
  }
});

// Get latest available version from update package
router.get('/latest', async (req: Request, res: Response): Promise<void> => {
  try {
    const updatePackage = '/opt/urbackup-gui/frontend/dist/downloads/urbackup-gui.tar.gz';

    // Check if update package exists
    if (!existsSync(updatePackage)) {
      res.status(404).json({ error: 'No update package available' });
      return;
    }

    // Extract version.json from tarball
    const { stdout } = await execAsync(`tar -xzOf "${updatePackage}" urbackup-gui/version.json`);
    const latestVersion = JSON.parse(stdout);

    res.json(latestVersion);
  } catch (error) {
    logger.error('Failed to read latest version from update package:', error);
    res.status(500).json({ error: 'Failed to read latest version' });
  }
});

export default router;
