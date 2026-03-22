import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { getStorageLimits, upsertStorageLimit, deleteStorageLimit, getStorageLimitStatuses } from '../controllers/storageLimits.js';

const router = Router();
router.use(authenticate);

router.get('/', getStorageLimits);
router.put('/:clientName', requireAdmin, upsertStorageLimit);
router.delete('/:clientName', requireAdmin, deleteStorageLimit);
router.post('/status', getStorageLimitStatuses);

export default router;
