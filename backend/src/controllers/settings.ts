import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

const ENV_FILE = '/opt/urbackup-gui/backend/.env';

interface Settings {
  urbackupServerHost: string;
  urbackupServerPort: string;
  urbackupServerFqdn: string;
}

/**
 * Parse .env file into key-value pairs
 */
async function parseEnvFile(): Promise<Record<string, string>> {
  if (!existsSync(ENV_FILE)) {
    return {};
  }

  const content = await readFile(ENV_FILE, 'utf-8');
  const env: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      env[match[1]] = match[2];
    }
  }

  return env;
}

/**
 * Update .env file with new values
 */
async function updateEnvFile(updates: Record<string, string>): Promise<void> {
  const content = await readFile(ENV_FILE, 'utf-8');
  let newContent = content;

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(newContent)) {
      newContent = newContent.replace(regex, `${key}=${value}`);
    } else {
      // Add new key if it doesn't exist
      newContent += `\n${key}=${value}`;
    }
  }

  await writeFile(ENV_FILE, newContent, 'utf-8');
}

/**
 * Get current settings
 */
export async function getSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const env = await parseEnvFile();

    const settings: Settings = {
      urbackupServerHost: env.URBACKUP_SERVER_HOST || '',
      urbackupServerPort: env.URBACKUP_SERVER_PORT || '55414',
      urbackupServerFqdn: env.URBACKUP_SERVER_FQDN || ''
    };

    res.json(settings);
  } catch (error: any) {
    logger.error('Failed to get settings:', error);
    res.status(500).json({
      error: 'Failed to get settings',
      message: error.message
    });
  }
}

/**
 * Update settings
 */
export async function updateSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const user = req.user;

    // Only admins can update settings
    if (!user || !user.isAdmin) {
      res.status(403).json({ error: 'Only administrators can update settings' });
      return;
    }

    const { urbackupServerHost, urbackupServerPort, urbackupServerFqdn } = req.body;

    if (!urbackupServerPort) {
      res.status(400).json({ error: 'Server port is required' });
      return;
    }

    // Validate port number
    const port = parseInt(urbackupServerPort);
    if (isNaN(port) || port < 1 || port > 65535) {
      res.status(400).json({ error: 'Invalid port number' });
      return;
    }

    const updates: Record<string, string> = {
      URBACKUP_SERVER_PORT: urbackupServerPort
    };

    // Update .env file
    if (urbackupServerHost !== undefined) {
      updates.URBACKUP_SERVER_HOST = urbackupServerHost;
    }
    if (urbackupServerFqdn !== undefined) {
      updates.URBACKUP_SERVER_FQDN = urbackupServerFqdn;
    }

    await updateEnvFile(updates);

    // Update process.env for immediate effect
    if (urbackupServerHost !== undefined) {
      process.env.URBACKUP_SERVER_HOST = urbackupServerHost;
    }
    process.env.URBACKUP_SERVER_PORT = urbackupServerPort;
    if (urbackupServerFqdn !== undefined) {
      process.env.URBACKUP_SERVER_FQDN = urbackupServerFqdn;
    }

    logger.info(`Settings updated by ${user?.username || 'unknown'}: FQDN=${urbackupServerFqdn || 'not set'}, Host=${urbackupServerHost || 'not set'}, Port=${urbackupServerPort}`);

    res.json({
      success: true,
      message: 'Settings updated successfully',
      settings: {
        urbackupServerHost: urbackupServerHost || '',
        urbackupServerPort,
        urbackupServerFqdn: urbackupServerFqdn || ''
      }
    });
  } catch (error: any) {
    logger.error('Failed to update settings:', error);
    res.status(500).json({
      error: 'Failed to update settings',
      message: error.message
    });
  }
}
