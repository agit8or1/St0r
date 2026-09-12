import { Router } from 'express';
import { getLogs, getLiveLog } from '../controllers/logs.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();

// All log routes require authentication
router.use(authenticate);

router.get('/', requireAdmin, getLogs);
router.get('/live', requireAdmin, getLiveLog);

export default router;
