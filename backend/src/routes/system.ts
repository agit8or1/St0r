import { Router } from 'express';
import { triggerUpdate, getUpdateLog, getSystemMetrics } from '../controllers/system.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// System resource metrics (CPU, memory, network)
router.get('/metrics', getSystemMetrics);

// Trigger system update
router.post('/update', triggerUpdate);

// Get update log (for live progress)
router.get('/update-log', getUpdateLog);

export default router;
