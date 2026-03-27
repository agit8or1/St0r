import { Router } from 'express';
import { triggerUpdate, getUpdateLog, getSystemMetrics, getUrBackupServerVersion, triggerUrBackupServerUpdate, getUrBackupUpdateLog, getUrBackupClientVersions } from '../controllers/system.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
// Note: JWT is stateless — the cookie remains valid through service restarts.
// If the cookie has expired, the user will need to log in again.
router.use(authenticate);

// System resource metrics (CPU, memory, network)
router.get('/metrics', getSystemMetrics);

// Trigger system update
router.post('/update', triggerUpdate);

// Get update progress log
router.get('/update-log', getUpdateLog);

// UrBackup server version check and update
router.get('/urbackup-version', getUrBackupServerVersion);
router.post('/urbackup-update', triggerUrBackupServerUpdate);
router.get('/urbackup-update-log', getUrBackupUpdateLog);

// UrBackup client versions
router.get('/client-versions', getUrBackupClientVersions);

export default router;
