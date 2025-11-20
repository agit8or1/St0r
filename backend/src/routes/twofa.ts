import { Router } from 'express';
import { setup2FA, verify2FA, enable2FA, disable2FA, check2FAStatus } from '../controllers/twofa.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All 2FA routes require authentication
router.use(authenticate);

// Get 2FA status
router.get('/status', check2FAStatus);

// Setup 2FA (generate QR code)
router.post('/setup', setup2FA);

// Verify and enable 2FA
router.post('/verify', verify2FA);

// Enable 2FA
router.post('/enable', enable2FA);

// Disable 2FA
router.post('/disable', disable2FA);

export default router;
