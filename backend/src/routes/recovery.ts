import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import {
  listCanaries, createCanary, generateCanary, deleteCanary,
  listHypervisors, createHypervisor, updateHypervisor, deleteHypervisor, testHypervisor,
  listDrills, createDrill, updateDrill, deleteDrill, runDrill,
  listRuns, getRun, getStatus, getReport, getOptions,
} from '../controllers/recovery.js';

const router = Router();
router.use(authenticate);

// Everyone (scoped to their customers' clients; customer users are read-only).
router.get('/status', getStatus);
router.get('/report', getReport);
router.get('/drills', listDrills);
router.get('/runs', listRuns);
router.get('/runs/:id', getRun);
router.get('/canaries', listCanaries);

// Administrators.
router.get('/options', requireAdmin, getOptions);
router.post('/canaries', requireAdmin, createCanary);
router.post('/canaries/generate', requireAdmin, generateCanary);
router.delete('/canaries/:id', requireAdmin, deleteCanary);
router.post('/drills', requireAdmin, createDrill);
router.put('/drills/:id', requireAdmin, updateDrill);
router.delete('/drills/:id', requireAdmin, deleteDrill);
router.post('/drills/:id/run', requireAdmin, runDrill);
router.get('/hypervisors', requireAdmin, listHypervisors);
router.post('/hypervisors', requireAdmin, createHypervisor);
router.put('/hypervisors/:id', requireAdmin, updateHypervisor);
router.delete('/hypervisors/:id', requireAdmin, deleteHypervisor);
router.post('/hypervisors/:id/test', requireAdmin, testHypervisor);

export default router;
