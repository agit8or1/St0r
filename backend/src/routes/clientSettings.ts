import { Router } from 'express';
import { getClientSettings, setClientSettings } from '../controllers/clientSettings.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get client settings
router.get('/:clientId', getClientSettings);

// Update client settings — admin only (settings writes can disable backups,
// change paths, etc. across any client)
router.put('/:clientId', requireAdmin, setClientSettings);

export default router;
