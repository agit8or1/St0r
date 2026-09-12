import { Router } from 'express';
import { getServerSettings, setServerSettings } from '../controllers/serverSettings.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get server settings (admin only — server-wide configuration)
router.get('/', requireAdmin, getServerSettings);

// Update server settings (admin only)
router.put('/', requireAdmin, setServerSettings);

export default router;
