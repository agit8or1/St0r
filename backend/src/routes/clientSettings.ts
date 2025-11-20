import { Router } from 'express';
import { getClientSettings, setClientSettings } from '../controllers/clientSettings.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get client settings
router.get('/:clientId', getClientSettings);

// Update client settings
router.put('/:clientId', setClientSettings);

export default router;
