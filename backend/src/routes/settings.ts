import { Router } from 'express';
import { getSettings, updateSettings } from '../controllers/settings.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get settings
router.get('/', getSettings);

// Update settings (admin only)
router.put('/', updateSettings);

export default router;
