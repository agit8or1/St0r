import { Router } from 'express';
import {
  createBackup,
  listBackups,
  getBackupStats,
  cleanupOldBackups,
} from '../controllers/databaseBackup.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All database backup routes require authentication
router.use(authenticate);

router.post('/create', createBackup);
router.get('/list', listBackups);
router.get('/stats', getBackupStats);
router.post('/cleanup', cleanupOldBackups);

export default router;
