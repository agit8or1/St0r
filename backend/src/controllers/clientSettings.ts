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
    // Wrap in { settings } so the frontend can access data.settings consistently
    res.json({ settings });
  } catch (error: any) {
    // UrBackup API "error: 1" means unknown client or unauthenticated — not a server crash
    if (error?.message?.includes('UrBackup API error: 1')) {
      res.status(404).json({ error: 'Client settings not found', settings: {} });
      return;
    }
    logger.error('Failed to get client settings:', error);
    res.status(500).json({ error: 'Failed to get client settings', settings: {} });
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
