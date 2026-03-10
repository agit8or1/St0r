import { Router } from 'express';
import multer from 'multer';
import { tmpdir } from 'os';
import {
  createBackup,
  listBackups,
  deleteBackup,
  downloadBackup,
  restoreBackup,
  uploadAndRestore,
  getBackupStats,
  cleanupOldBackups,
} from '../controllers/databaseBackup.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
const upload = multer({ dest: tmpdir(), limits: { fileSize: 100 * 1024 * 1024 } }); // 100 MB max

// All database backup routes require authentication
router.use(authenticate);

router.post('/create', createBackup);
router.get('/list', listBackups);
router.get('/:filename/download', downloadBackup);
router.post('/:filename/restore', restoreBackup);
router.post('/upload-restore', upload.single('backup'), uploadAndRestore);
router.delete('/:filename', deleteBackup);
router.get('/stats', getBackupStats);
router.post('/cleanup', cleanupOldBackups);

export default router;
