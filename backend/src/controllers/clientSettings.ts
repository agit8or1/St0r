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

    const result = await urbackupService.getClientSettings(clientId);
    // UrBackup returns settings as {key: {use, value, value_group}} — extract effective values:
    // use=0 means client-specific override → use 'value' (effective); use=1 means group default → use 'value_group'
    const rawSettings = result?.settings || result || {};
    const settings: Record<string, any> = {};
    for (const [key, val] of Object.entries(rawSettings)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const v = val as any;
        if ('value' in v) {
          settings[key] = v.value;
        } else if ('value_group' in v) {
          settings[key] = v.value_group;
        }
      } else if (typeof val !== 'object') {
        settings[key] = val;
      }
    }
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
