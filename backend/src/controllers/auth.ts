import { Request, Response } from 'express';
import { findUserByUsername, updateLastLogin } from '../models/user.js';
import { comparePassword, generateToken } from '../utils/auth.js';
import { logger } from '../utils/logger.js';

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const user = await findUserByUsername(username);

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const isValidPassword = await comparePassword(password, user.password_hash);

    if (!isValidPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    await updateLastLogin(user.id);

    const token = generateToken({
      userId: user.id,
      username: user.username,
      isAdmin: user.is_admin,
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        isAdmin: user.is_admin,
      },
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function validateToken(req: Request, res: Response): Promise<void> {
  // If we reach here, the token is valid (middleware already validated it)
  res.json({ valid: true });
}
