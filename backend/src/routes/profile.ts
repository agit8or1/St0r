import { Router } from 'express';
import { changePassword } from '../controllers/profile.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Change password
router.post('/change-password', changePassword);

export default router;
