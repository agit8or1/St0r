import { Router } from 'express';
import { getUsers, addUser, modifyUser, removeUser } from '../controllers/users.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get all users (admin only — prevents non-admin enumeration of usernames/emails)
router.get('/', requireAdmin, getUsers);

// Create a new user (admin only)
router.post('/', requireAdmin, addUser);

// Update a user (admin only)
router.put('/:id', requireAdmin, modifyUser);

// Delete a user (admin only)
router.delete('/:id', requireAdmin, removeUser);

export default router;
