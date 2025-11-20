import { Router } from 'express';
import { getUsers, addUser, modifyUser, removeUser } from '../controllers/users.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get all users
router.get('/', getUsers);

// Create a new user
router.post('/', addUser);

// Update a user
router.put('/:id', modifyUser);

// Delete a user
router.delete('/:id', removeUser);

export default router;
