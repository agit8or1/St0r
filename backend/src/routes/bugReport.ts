import { Router } from 'express';
import { submitBugReport } from '../controllers/bugReport.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Bug report submission - requires authentication
router.post('/submit', authenticate, submitBugReport);

export default router;
