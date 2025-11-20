import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { UrBackupService } from '../services/urbackup.js';
import { logger } from '../utils/logger.js';

const urbackupService = new UrBackupService();

export async function getClientSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;

    if (!clientId) {
      res.status(400).json({ error: 'Client ID is required' });
      return;
    }

    const settings = await urbackupService.getClientSettings(clientId);
    res.json(settings);
  } catch (error) {
    logger.error('Failed to get client settings:', error);
    res.status(500).json({ error: 'Failed to get client settings' });
  }
}

export async function setClientSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;
    const settings = req.body;

    if (!clientId) {
      res.status(400).json({ error: 'Client ID is required' });
      return;
    }

    if (!settings || Object.keys(settings).length === 0) {
      res.status(400).json({ error: 'Settings are required' });
      return;
    }

    const result = await urbackupService.setClientSettings(clientId, settings);
    res.json(result);
  } catch (error) {
    logger.error('Failed to set client settings:', error);
    res.status(500).json({ error: 'Failed to set client settings' });
  }
}
