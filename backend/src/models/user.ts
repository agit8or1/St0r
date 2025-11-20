import { query } from '../config/database.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface User {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  is_admin: boolean;
  is_active: boolean;
  last_login: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserRow extends RowDataPacket, User {}

export async function findUserByUsername(username: string): Promise<User | null> {
  const users = await query<UserRow[]>(
    'SELECT * FROM app_users WHERE username = ? AND is_active = TRUE',
    [username]
  );
  return users.length > 0 ? users[0] : null;
}

export async function findUserById(id: number): Promise<User | null> {
  const users = await query<UserRow[]>(
    'SELECT * FROM app_users WHERE id = ? AND is_active = TRUE',
    [id]
  );
  return users.length > 0 ? users[0] : null;
}

export async function createUser(
  username: string,
  email: string,
  passwordHash: string,
  isAdmin: boolean = false
): Promise<number> {
  const result = await query<ResultSetHeader>(
    'INSERT INTO app_users (username, email, password_hash, is_admin) VALUES (?, ?, ?, ?)',
    [username, email, passwordHash, isAdmin]
  );
  return result.insertId;
}

export async function updateLastLogin(userId: number): Promise<void> {
  await query(
    'UPDATE app_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
    [userId]
  );
}

export async function getAllUsers(): Promise<User[]> {
  return await query<UserRow[]>('SELECT * FROM app_users ORDER BY created_at DESC');
}

export async function getUserByUsername(username: string): Promise<User | null> {
  return findUserByUsername(username);
}

export async function updateUser(id: number, updates: Partial<User>): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];

  Object.entries(updates).forEach(([key, value]) => {
    fields.push(`${key} = ?`);
    values.push(value);
  });

  if (fields.length === 0) return;

  values.push(id);
  await query(
    `UPDATE app_users SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}

export async function deleteUserById(id: number): Promise<void> {
  // Soft delete by setting is_active to false
  await query('UPDATE app_users SET is_active = FALSE WHERE id = ?', [id]);
}
