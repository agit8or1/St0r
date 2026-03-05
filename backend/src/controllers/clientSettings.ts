import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { UrBackupService } from '../services/urbackup.js';
import { logger } from '../utils/logger.js';
import { query } from '../config/database.js';

const urbackupService = new UrBackupService();

export async function getClientSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;

    if (!clientId) {
      res.status(400).json({ error: 'Client ID is required' });
      return;
    }

    const result = await urbackupService.getClientSettings(clientId);
    // UrBackup returns settings as {key: {use, value, value_client, value_group}}
    // use=1: client-specific override (use 'value')
    // use=2: group/global default (use 'value', which UrBackup resolves to group/global)
    // 'value' is always the resolved effective value regardless of use
    const rawSettings = result?.settings || result || {};
    const settings: Record<string, any> = {};
    const useValues: Record<string, number> = {};
    for (const [key, val] of Object.entries(rawSettings)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const v = val as any;
        if ('value' in v) {
          settings[key] = v.value;
        }
        if ('use' in v) {
          useValues[key] = v.use;
        }
      } else if (typeof val !== 'object') {
        settings[key] = val;
      }
    }

    // Read managed mode state from MariaDB (reliable — UrBackup does not return custom keys via API).
    // Fall back to tray password check if no MariaDB record exists yet.
    try {
      const rows = await query<any[]>(
        'SELECT managed FROM client_managed_mode WHERE client_id = ?',
        [clientId]
      );
      if (rows.length > 0) {
        const serverManaged = rows[0].managed === 1 || rows[0].managed === true;
        settings['client_set_settings'] = !serverManaged;
      } else {
        // Legacy fallback: no MariaDB record → check tray password
        const trayPw = settings['client_settings_tray_access_pw'];
        settings['client_set_settings'] = !(typeof trayPw === 'string' && trayPw.length > 0);
      }
    } catch {
      // If table doesn't exist yet (first boot before migration), fall back gracefully
      const trayPw = settings['client_settings_tray_access_pw'];
      settings['client_set_settings'] = !(typeof trayPw === 'string' && trayPw.length > 0);
    }

    res.json({ settings, useValues });
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
