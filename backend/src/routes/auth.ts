import { Router } from 'express';
import { login, validateToken } from '../controllers/auth.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/login', login);
router.get('/validate', authenticate, validateToken);

export default router;
