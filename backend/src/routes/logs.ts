import { Router } from 'express';
import { getLogs, getLiveLog } from '../controllers/logs.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All log routes require authentication
router.use(authenticate);

router.get('/', getLogs);
router.get('/live', getLiveLog);

export default router;
