import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getTotalStorage, getServerStorage } from '../controllers/storage.js';

const router = Router();

router.get('/total', authenticate, getTotalStorage);
router.get('/server/:serverId?', authenticate, getServerStorage);

export default router;
