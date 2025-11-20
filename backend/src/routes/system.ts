import { Router } from 'express';
import { triggerUpdate, getUpdateLog } from '../controllers/system.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Trigger system update
router.post('/update', triggerUpdate);

// Get update log (for live progress)
router.get('/update-log', getUpdateLog);

export default router;
