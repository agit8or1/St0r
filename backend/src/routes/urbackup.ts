import { Router } from 'express';
import {
  getStatus,
  getClients,
  getOnlineClients,
  getOfflineClients,
  getFailedClients,
  getActivities,
  getCurrentActivities,
  getBackups,
  startBackup,
  stopActivity,
  clearStaleJobs,
  getUsage,
  addClient,
  removeClient,
  getClientAuthkey,
  updateClientName,
  regenerateClientKey,
  deleteBackup,
  getJobLogs,
  getJobLog,
  browseClientFilesystem,
  getFailedPaths,
  convertAndDownloadImageBackup,
} from '../controllers/urbackup.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All UrBackup routes require authentication
router.use(authenticate);

router.get('/status', getStatus);
router.get('/clients', getClients);
router.get('/clients/online', getOnlineClients);
router.get('/clients/offline', getOfflineClients);
router.get('/clients/failed', getFailedClients);
router.get('/clients/:clientId/backups', getBackups);
router.get('/clients/:clientId/authkey', getClientAuthkey);
router.post('/clients', addClient);
router.delete('/clients/:clientId', removeClient);
router.patch('/clients/:clientId/name', updateClientName);
router.post('/clients/:clientId/regenerate-key', regenerateClientKey);
router.get('/activities', getActivities);
router.get('/activities/current', getCurrentActivities);
router.post('/backups/start', startBackup);
router.post('/activities/:activityId/stop', stopActivity);
router.post('/activities/clear-stale', clearStaleJobs);
router.get('/usage', getUsage);
router.get('/clients/:clientId/browse', browseClientFilesystem);
router.get('/clients/:clientId/failed-paths', getFailedPaths);
router.delete('/clients/:clientId/backups/:backupId', deleteBackup);
router.get('/clients/:clientId/image-backups/:backupId/convert-download', convertAndDownloadImageBackup);
router.get('/job-logs', getJobLogs);
router.get('/job-logs/:logId', getJobLog);

// Proxy endpoint to UrBackup progress API (bypasses our auth issues)
router.get('/proxy/progress', async (req, res) => {
  try {
    const response = await fetch('http://localhost:55414/x?a=progress', {
      method: 'POST',
      headers: {
        'User-Agent': 'st0r-proxy',
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const data = await response.text();
    res.setHeader('Content-Type', 'application/json');
    res.send(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch progress from UrBackup' });
  }
});

export default router;
