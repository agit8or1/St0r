import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getBackupsForBrowsing,
  getFilesInBackup,
  downloadFile,
  restoreFiles,
} from '../controllers/browse.js';

const router = Router();

// All browse routes require authentication
router.use(authenticate);

// Get available backups for a client
router.get('/backups', getBackupsForBrowsing);

// Get files in a backup at a specific path
router.get('/files', getFilesInBackup);

// Download a file from a backup
router.get('/download', downloadFile);

// Restore files to the client
router.post('/restore', restoreFiles);

export default router;
