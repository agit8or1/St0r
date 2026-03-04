import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import {
  getSettings, updateSettings,
  getTargets, createTarget, getTarget, updateTarget, deleteTarget,
  testTarget, triggerRun,
  getStatus, getRuns, getRun,
  getAlertChannels, updateAlertChannels, deleteAlertChannel,
  getEvents, getSetupInstructions,
} from '../controllers/replication.js';

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/settings', getSettings);
router.put('/settings', updateSettings);

router.get('/targets', getTargets);
router.post('/targets', createTarget);
router.get('/targets/setup-instructions', getSetupInstructions);
router.get('/targets/:id', getTarget);
router.put('/targets/:id', updateTarget);
router.delete('/targets/:id', deleteTarget);
router.post('/targets/:id/test', testTarget);
router.post('/targets/:id/run', triggerRun);

router.get('/status', getStatus);

router.get('/runs', getRuns);
router.get('/runs/:id', getRun);

router.get('/alerts/channels', getAlertChannels);
router.put('/alerts/channels', updateAlertChannels);
router.delete('/alerts/channels/:id', deleteAlertChannel);

router.get('/events', getEvents);

export default router;
