import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import {
  getDiskGuardStatus,
  getDiskGuardEvents,
  reclaimSpace,
  pruneOrphans,
  resumeBackups,
} from '../controllers/diskGuard.js';

const router = Router();
router.use(authenticate);

router.get('/', getDiskGuardStatus);
router.get('/events', getDiskGuardEvents);

// Destructive or state-changing maintenance is admin-only.
router.post('/reclaim', requireAdmin, reclaimSpace);
router.post('/prune-orphans', requireAdmin, pruneOrphans);
router.post('/resume', requireAdmin, resumeBackups);

export default router;
