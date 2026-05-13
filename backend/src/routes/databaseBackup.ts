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
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
const upload = multer({ dest: tmpdir(), limits: { fileSize: 100 * 1024 * 1024 } }); // 100 MB max

// All database backup routes require authentication; writes/restores require admin
// (uploading a crafted dump would let any user overwrite app_users and self-promote).
router.use(authenticate);

router.post('/create', requireAdmin, createBackup);
router.get('/list', requireAdmin, listBackups);
router.get('/:filename/download', requireAdmin, downloadBackup);
router.post('/:filename/restore', requireAdmin, restoreBackup);
router.post('/upload-restore', requireAdmin, upload.single('backup'), uploadAndRestore);
router.delete('/:filename', requireAdmin, deleteBackup);
router.get('/stats', requireAdmin, getBackupStats);
router.post('/cleanup', requireAdmin, cleanupOldBackups);

export default router;
