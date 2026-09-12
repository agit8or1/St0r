import { Request, Response } from 'express';
import { getAllUsers, getUserByUsername, createUser, updateUser, deleteUserById } from '../models/user.js';
import { hashPassword } from '../utils/auth.js';
import { logger } from '../utils/logger.js';
import { query } from '../config/database.js';
import { invalidateScopeCache } from '../middleware/scope.js';
import { invalidateUserCache } from '../middleware/auth.js';

/**
 * Replace a user's customer assignments. Administrators are unrestricted, so any
 * assignment on an admin account is dropped to avoid implying a scope that is
 * not enforced.
 */
async function setUserCustomers(userId: number, customerIds: unknown, isAdmin: boolean): Promise<void> {
  if (!Array.isArray(customerIds)) return;

  const ids = isAdmin
    ? []
    : [...new Set(customerIds.map((id) => parseInt(String(id), 10)).filter((id) => Number.isFinite(id)))];

  await query('DELETE FROM customer_users WHERE user_id = ?', [userId]);
  for (const customerId of ids) {
    await query(
      'INSERT IGNORE INTO customer_users (customer_id, user_id) VALUES (?, ?)',
      [customerId, userId]
    );
  }
  invalidateScopeCache(userId);
}

async function customerIdsByUser(): Promise<Map<number, number[]>> {
  const rows = await query<any[]>(
    `SELECT cu.user_id, cu.customer_id, c.name AS customer_name
       FROM customer_users cu
       JOIN customers c ON c.id = cu.customer_id AND c.is_active = 1`
  );
  const map = new Map<number, number[]>();
  for (const row of rows) {
    const list = map.get(row.user_id) || [];
    list.push(Number(row.customer_id));
    map.set(row.user_id, list);
  }
  return map;
}

/**
 * Get all users
 */
export async function getUsers(req: Request, res: Response) {
  try {
    const users = await getAllUsers();
    const assignments = await customerIdsByUser();
    // Never expose the password hash or the TOTP seed
    const safeUsers = users.map(({ password_hash, ...user }) => {
      const { totp_secret, ...rest } = user as typeof user & { totp_secret?: string };
      return {
        ...rest,
        customer_ids: user.is_admin ? [] : assignments.get(user.id) || [],
      };
    });
    res.json(safeUsers);
  } catch (error: any) {
    logger.error('Failed to get users:', error);
    res.status(500).json({
      error: 'Failed to get users',
      message: 'An internal error occurred'
    });
  }
}

/**
 * Create a new user
 */
export async function addUser(req: Request, res: Response) {
  try {
    const { username, email, password, isAdmin, customerIds } = req.body;

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

    await setUserCustomers(userId, customerIds, !!isAdmin);

    res.status(201).json({
      success: true,
      userId,
      message: 'User created successfully'
    });
  } catch (error: any) {
    logger.error('Failed to create user:', error);
    res.status(500).json({
      error: 'Failed to create user',
      message: 'An internal error occurred'
    });
  }
}

/**
 * Update a user
 */
export async function modifyUser(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { username, email, password, isAdmin, customerIds } = req.body;

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

    const targetId = parseInt(id);
    await updateUser(targetId, updates);

    if (isAdmin !== undefined || Array.isArray(customerIds)) {
      const effectiveIsAdmin =
        isAdmin !== undefined
          ? !!isAdmin
          : !!(await getAllUsers()).find((u) => u.id === targetId)?.is_admin;
      await setUserCustomers(targetId, customerIds ?? [], effectiveIsAdmin);
    }
    invalidateScopeCache(targetId);
    // Role and activation changes take effect on the next request, not on the
    // target's next login.
    invalidateUserCache(targetId);

    res.json({
      success: true,
      message: 'User updated successfully'
    });
  } catch (error: any) {
    logger.error('Failed to update user:', error);
    res.status(500).json({
      error: 'Failed to update user',
      message: 'An internal error occurred'
    });
  }
}

/**
 * Delete a user
 */
export async function removeUser(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const requestingUser = (req as any).user;

    if (!id) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }

    const targetId = parseInt(id);

    // Prevent self-deletion
    if (requestingUser?.userId === targetId) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }

    // Prevent deleting the last admin
    const allUsers = await getAllUsers();
    const targetUser = allUsers.find(u => u.id === targetId);
    if (targetUser?.is_admin) {
      const adminCount = allUsers.filter(u => u.is_admin).length;
      if (adminCount <= 1) {
        res.status(400).json({ error: 'Cannot delete the last administrator account' });
        return;
      }
    }

    await deleteUserById(targetId);
    invalidateScopeCache(targetId);
    invalidateUserCache(targetId);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error: any) {
    logger.error('Failed to delete user:', error);
    res.status(500).json({
      error: 'Failed to delete user',
      message: 'An internal error occurred'
    });
  }
}
