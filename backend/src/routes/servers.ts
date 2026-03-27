import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import {
  listServers, getServer, addServer, updateServer, deleteServer,
  getMetrics, testSsh, installAgent, registerAgentKey, pingAgentEndpoint,
  getOsUpdates, triggerOsUpdate, getOsUpdateLog,
  rebootServer, getStorVersion, triggerStorUpdate, getStorUpdateLog,
  getUrBackupVersion,
} from '../controllers/servers.js';

const router = Router();
router.use(authenticate);

// CRUD
router.get('/', listServers);
router.post('/', requireAdmin, addServer);
router.get('/:id', getServer);
router.put('/:id', requireAdmin, updateServer);
router.delete('/:id', requireAdmin, deleteServer);

// Connectivity
router.get('/:id/ping', pingAgentEndpoint);
router.post('/:id/test-ssh', requireAdmin, testSsh);

// Agent management
router.post('/:id/install-agent', requireAdmin, installAgent);
router.post('/:id/register-agent-key', requireAdmin, registerAgentKey);

// Metrics
router.get('/:id/metrics', getMetrics);

// OS updates
router.get('/:id/os-updates', getOsUpdates);
router.post('/:id/os-update', requireAdmin, triggerOsUpdate);
router.get('/:id/os-update-log', getOsUpdateLog);

// St0r update (remote only)
router.get('/:id/stor-version', getStorVersion);
router.post('/:id/stor-update', requireAdmin, triggerStorUpdate);
router.get('/:id/stor-update-log', getStorUpdateLog);

// UrBackup version (remote)
router.get('/:id/urbackup-version', getUrBackupVersion);

// Reboot
router.post('/:id/reboot', requireAdmin, rebootServer);

export default router;
