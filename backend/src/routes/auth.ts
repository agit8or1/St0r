import { Router } from 'express';
import { login, logout, validateToken } from '../controllers/auth.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/login', login);
router.post('/logout', logout);
router.get('/validate', authenticate, validateToken);

export default router;
