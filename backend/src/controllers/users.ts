import { Request, Response } from 'express';
import { getAllUsers, getUserByUsername, createUser, updateUser, deleteUserById } from '../models/user.js';
import { hashPassword } from '../utils/auth.js';
import { logger } from '../utils/logger.js';

/**
 * Get all users
 */
export async function getUsers(req: Request, res: Response) {
  try {
    const users = await getAllUsers();
    // Remove password hashes from response
    const safeUsers = users.map(({ password_hash, ...user }) => user);
    res.json(safeUsers);
  } catch (error: any) {
    logger.error('Failed to get users:', error);
    res.status(500).json({
      error: 'Failed to get users',
      message: error.message
    });
  }
}

/**
 * Create a new user
 */
export async function addUser(req: Request, res: Response) {
  try {
    const { username, email, password, isAdmin } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    // Check if user already exists
    const existingUser = await getUserByUsername(username);
    if (existingUser) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const userId = await createUser(
      username,
      email || `${username}@localhost`,
      passwordHash,
      isAdmin || false
    );

    res.status(201).json({
      success: true,
      userId,
      message: 'User created successfully'
    });
  } catch (error: any) {
    logger.error('Failed to create user:', error);
    res.status(500).json({
      error: 'Failed to create user',
      message: error.message
    });
  }
}

/**
 * Update a user
 */
export async function modifyUser(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { username, email, password, isAdmin } = req.body;

    if (!id) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }

    const updates: any = {};
    if (username) updates.username = username;
    if (email) updates.email = email;
    if (isAdmin !== undefined) updates.is_admin = isAdmin;
    if (password) {
      updates.password_hash = await hashPassword(password);
    }

    await updateUser(parseInt(id), updates);

    res.json({
      success: true,
      message: 'User updated successfully'
    });
  } catch (error: any) {
    logger.error('Failed to update user:', error);
    res.status(500).json({
      error: 'Failed to update user',
      message: error.message
    });
  }
}

/**
 * Delete a user
 */
export async function removeUser(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }

    await deleteUserById(parseInt(id));

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error: any) {
    logger.error('Failed to delete user:', error);
    res.status(500).json({
      error: 'Failed to delete user',
      message: error.message
    });
  }
}
