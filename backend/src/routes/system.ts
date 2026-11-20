import { Router } from 'express';
import { triggerUpdate, getUpdateLog, getSystemMetrics, getUrBackupServerVersion, triggerUrBackupServerUpdate, getUrBackupUpdateLog, getUrBackupClientVersions } from '../controllers/system.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import {
  getConfig as getAutoUpdateConfig, getState as getAutoUpdateState, setConfig as setAutoUpdateConfig,
  validateConfig as validateAutoUpdateConfig, installedVersion,
} from '../services/urbackupAutoUpdate.js';

const router = Router();

// All routes require authentication
// Note: JWT is stateless — the cookie remains valid through service restarts.
// If the cookie has expired, the user will need to log in again.
router.use(authenticate);

// System resource metrics (CPU, memory, network)
router.get('/metrics', getSystemMetrics);

// Trigger system update
router.post('/update', requireAdmin, triggerUpdate);

// Get update progress log
router.get('/update-log', requireAdmin, getUpdateLog);

// UrBackup server version check and update
router.get('/urbackup-version', getUrBackupServerVersion);
router.post('/urbackup-update', requireAdmin, triggerUrBackupServerUpdate);
router.get('/urbackup-update-log', requireAdmin, getUrBackupUpdateLog);

// Daily automatic UrBackup server update
router.get('/urbackup-auto-update', requireAdmin, async (_req, res) => {
  try {
    const [config, state, version] = await Promise.all([getAutoUpdateConfig(), getAutoUpdateState(), installedVersion()]);
    res.json({ ...config, ...state, installedVersion: version, windowHours: 3 });
  } catch (err) {
    logger.error('Failed to read UrBackup auto-update settings:', err);
    res.status(500).json({ error: 'Failed to read UrBackup auto-update settings' });
  }
});
router.put('/urbackup-auto-update', requireAdmin, async (req: AuthRequest, res) => {
  const error = validateAutoUpdateConfig(req.body || {});
  if (error) { res.status(400).json({ error }); return; }
  try {
    const config = await setAutoUpdateConfig({ enabled: req.body.enabled, hour: req.body.hour });
    logger.info(`UrBackup auto-update set to ${JSON.stringify(config)} by ${req.user?.username || 'unknown'}`);
    res.json(config);
  } catch (err) {
    logger.error('Failed to save UrBackup auto-update settings:', err);
    res.status(500).json({ error: 'Failed to save UrBackup auto-update settings' });
  }
});

// UrBackup client versions
router.get('/client-versions', getUrBackupClientVersions);

export default router;
