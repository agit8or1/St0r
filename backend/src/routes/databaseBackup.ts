import { Router, Request, Response, NextFunction } from 'express';
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

// Multer errors carry no HTTP status, so the global handler would answer 500.
// Limits and malformed multipart are the client's fault; disk errors (with a
// syscall, e.g. ENOSPC) stay 500.
const uploadBackup = (req: Request, res: Response, next: NextFunction) => {
  upload.single('backup')(req, res, (err: any) => {
    if (err instanceof multer.MulterError) (err as any).status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    else if (err && !err.syscall) err.status = 400;
    next(err);
  });
};

// All database backup routes require authentication; writes/restores require admin
// (uploading a crafted dump would let any user overwrite app_users and self-promote).
router.use(authenticate);

router.post('/create', requireAdmin, createBackup);
router.get('/list', requireAdmin, listBackups);
router.get('/:filename/download', requireAdmin, downloadBackup);
router.post('/:filename/restore', requireAdmin, restoreBackup);
router.post('/upload-restore', requireAdmin, uploadBackup, uploadAndRestore);
router.delete('/:filename', requireAdmin, deleteBackup);
router.get('/stats', requireAdmin, getBackupStats);
router.post('/cleanup', requireAdmin, cleanupOldBackups);

export default router;
