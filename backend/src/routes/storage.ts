import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { getTotalStorage, getServerStorage } from '../controllers/storage.js';

const router = Router();

router.get('/total', authenticate, requireAdmin, getTotalStorage);
router.get('/server/:serverId?', authenticate, requireAdmin, getServerStorage);

export default router;
