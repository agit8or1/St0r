import { Router } from 'express';
import { getServerSettings, setServerSettings } from '../controllers/serverSettings.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get server settings
router.get('/', getServerSettings);

// Update server settings
router.put('/', setServerSettings);

export default router;
