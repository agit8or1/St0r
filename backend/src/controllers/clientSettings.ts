import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { UrBackupService } from '../services/urbackup.js';
import { logger } from '../utils/logger.js';
import { query } from '../config/database.js';
import { assertClientAccess } from '../middleware/scope.js';
import { flattenClientSettings, splitPatterns } from '../utils/urbackupSettings.js';
import { setEndpointExclusions } from '../services/exclusionSync.js';

const urbackupService = new UrBackupService();

export async function getClientSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;

    // Endpoints only: UrBackup keeps group settings under clientid <= 0.
    if (!clientId || !/^[1-9]\d*$/.test(clientId)) {
      res.status(400).json({ error: 'Client ID is required' });
      return;
    }

    if (!(await assertClientAccess(req, res, { id: clientId }))) return;

    const result = await urbackupService.getClientSettings(clientId);
    // Inherited settings come back with value_group only (issue #57: the page
    // showed St0r's built-in defaults instead of the group's values).
    const { settings, useValues, inherited } = flattenClientSettings(result?.settings || result || {});

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

    let group: { id: number; name: string } | null = null;
    let groups: { id: number; name: string }[] = [];
    try {
      groups = (await urbackupService.getGroups()).groups;
      const memberof = Number(settings.memberof ?? 0);
      group = groups.find(g => g.id === memberof) ?? { id: memberof, name: memberof === 0 ? 'Default' : `Group ${memberof}` };
    } catch (err) {
      logger.warn('Could not read UrBackup groups:', err);
    }

    // Server exclusions always apply (services/exclusionSync.ts); the page shows them locked.
    const serverExclusions = splitPatterns(result?.settings?.exclude_files?.value_group);

    res.json({ settings, useValues, inherited, group, groups, serverExclusions });
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

    // Endpoints only: UrBackup keeps group settings under clientid <= 0.
    if (!clientId || !/^[1-9]\d*$/.test(clientId)) {
      res.status(400).json({ error: 'Client ID is required' });
      return;
    }

    if (!settings || Object.keys(settings).length === 0) {
      res.status(400).json({ error: 'Settings are required' });
      return;
    }

    if ('exclude_files' in settings) {
      settings.exclude_files = await setEndpointExclusions(urbackupService, Number(clientId), settings.exclude_files);
    }

    const result = await urbackupService.setClientSettings(clientId, settings);
    res.json(result);
  } catch (error) {
    logger.error('Failed to set client settings:', error);
    res.status(500).json({ error: 'Failed to set client settings' });
  }
}
