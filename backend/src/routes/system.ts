import { Router } from 'express';
import { triggerUpdate, getUpdateLog, getSystemMetrics } from '../controllers/system.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// update-log is unauthenticated — needed during restarts when the session cookie may be invalid
router.get('/update-log', getUpdateLog);

// All other routes require authentication
router.use(authenticate);

// System resource metrics (CPU, memory, network)
router.get('/metrics', getSystemMetrics);

// Trigger system update
router.post('/update', triggerUpdate);

export default router;
