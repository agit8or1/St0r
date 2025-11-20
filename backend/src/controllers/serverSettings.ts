import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { UrBackupDbService } from '../services/urbackupDb.js';
import { UrBackupService } from '../services/urbackup.js';
import { logger } from '../utils/logger.js';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

const dbService = new UrBackupDbService();
const urbackupService = new UrBackupService();
const ENV_FILE = '/opt/urbackup-gui/backend/.env';

/**
 * Default UrBackup settings (used when settings are not in database)
 * These match UrBackup's built-in defaults
 */
const DEFAULT_URBACKUP_SETTINGS: Record<string, any> = {
  // Server settings
  port: '55414',
  max_active_clients: 20,
  global_soft_fs_quota: 0,

  // Network settings
  internet_server_port: '55415',

  // Options
  autoshutdown: false,
  allow_restore: true,
  no_images: false,

  // File backup defaults
  max_file_full: 4,
  max_file_incr: 30,
  interval_full: 30, // days
  interval_incr: 5,  // hours
  min_file_full_age: 7,
  min_file_incr_age: 1,

  // Image backup defaults
  max_image_full: 4,
  max_image_incr: 10,
  interval_full_image: 60,  // days
  interval_incr_image: 7,   // days
  min_image_full_age: 30,
  min_image_incr_age: 7,

  // Email settings
  mail_server: '',
  mail_serverport: 25,
  mail_username: '',
  mail_password: '',
  mail_from: '',
  mail_admin: '',
  mail_ssl: false,
  send_reports: false,
  report_mail_freq: 7,

  // Pushover settings
  pushover_user_key: '',
  pushover_api_token: '',
  pushover_enabled: false,
  pushover_alert_failures: false,
};

/**
 * Read settings from UrBackup settings database
 */
async function getUrBackupSettings(): Promise<Record<string, string>> {
  try {
    const sqlite3 = await import('sqlite3');
    const { open } = await import('sqlite');

    const settingsDb = await open({
      filename: process.env.URBACKUP_DB_PATH?.replace('backup_server.db', 'backup_server_settings.db') || '/var/urbackup/backup_server_settings.db',
      driver: sqlite3.default.Database,
      mode: sqlite3.default.OPEN_READONLY
    });

    const rows = await settingsDb.all(
      'SELECT key, value FROM settings WHERE clientid = 0 OR clientid IS NULL'
    );

    const settings: Record<string, string> = {};
    for (const row of rows as any[]) {
      settings[row.key] = row.value || '';
    }

    await settingsDb.close();
    return settings;
  } catch (error) {
    logger.error('Failed to read UrBackup settings:', error);
    return {};
  }
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
 * Get UrBackup server settings
 * Tries to fetch from API first, falls back to database-only if API fails
 */
export async function getServerSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    // Get basic server stats from database
    const stats = await dbService.getServerStats();

    // Get settings from database
    const dbSettings = await getUrBackupSettings();

    // Try to get settings from API, but don't fail if it's not available
    let urbackupSettings: Record<string, any> = {};
    try {
      urbackupSettings = await urbackupService.getSettings();
      logger.info(`Settings fetched from UrBackup API: ${Object.keys(urbackupSettings).length} settings`);
    } catch (apiError) {
      logger.warn('Could not fetch settings from UrBackup API, using database values only:', apiError);
      // Continue with database-only settings
    }

    // Return settings in the format the frontend expects
    const fqdn = process.env.URBACKUP_SERVER_FQDN || '';
    const settings = {
      // Start with default values
      ...DEFAULT_URBACKUP_SETTINGS,

      // Server configuration from environment
      backupPath: dbSettings.backupfolder || urbackupSettings.backupfolder || process.env.URBACKUP_DB_PATH?.replace('/backup_server.db', '') || '/var/urbackup',
      serverPort: process.env.URBACKUP_SERVER_PORT || '55414',
      serverFqdn: fqdn,
      internet_server: fqdn,  // Frontend uses this field name

      // Stats from database
      totalClients: stats.total_clients || 0,
      onlineClients: stats.online_clients || 0,
      failedClients: stats.failed_clients || 0,

      // All UrBackup settings from API (if available) - overrides defaults
      ...urbackupSettings,

      // Override with database settings if present - highest priority
      ...dbSettings,

      // Note for users
      note: 'Settings shown are defaults or database values. Configure via UrBackup web interface at http://localhost:55414'
    };

    const settingsCount = Object.keys(urbackupSettings).length || Object.keys(dbSettings).length;
    logger.info(`Server settings retrieved: FQDN=${settings.serverFqdn || 'not set'}, Port=${settings.serverPort}, Settings count=${settingsCount}`);
    res.json(settings);
  } catch (error) {
    logger.error('Failed to get server settings:', error);
    res.status(500).json({ error: 'Failed to get server settings' });
  }
}

/**
 * Update server settings
 * Saves settings to UrBackup and st0r-specific settings to .env
 */
export async function setServerSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const user = req.user;

    // Only admins can update settings
    if (!user || !user.isAdmin) {
      res.status(403).json({ error: 'Only administrators can update settings' });
      return;
    }

    // Log the entire request body to see what fields are being sent
    logger.info(`setServerSettings request body: ${JSON.stringify(req.body)}`);

    const { serverFqdn, serverPort, internetServerName, internet_server, urbackup_password, ...urbackupSettings } = req.body;

    const envUpdates: Record<string, string> = {};

    // Update FQDN if provided (try all possible field names)
    const fqdn = internet_server || serverFqdn || internetServerName;
    if (fqdn !== undefined && fqdn !== '') {
      envUpdates.URBACKUP_SERVER_FQDN = fqdn;
      process.env.URBACKUP_SERVER_FQDN = fqdn;
      logger.info(`Server FQDN updated by ${user?.username || 'unknown'}: ${fqdn}`);
    }

    // Update port if provided
    if (serverPort !== undefined) {
      const port = parseInt(serverPort);
      if (isNaN(port) || port < 1 || port > 65535) {
        res.status(400).json({ error: 'Invalid port number' });
        return;
      }
      envUpdates.URBACKUP_SERVER_PORT = serverPort;
      process.env.URBACKUP_SERVER_PORT = serverPort;
      logger.info(`Server port updated by ${user?.username || 'unknown'}: ${serverPort}`);
    }

    // Update UrBackup password if provided
    if (urbackup_password !== undefined) {
      envUpdates.URBACKUP_PASSWORD = urbackup_password;
      process.env.URBACKUP_PASSWORD = urbackup_password;
      logger.info(`UrBackup password updated by ${user?.username || 'unknown'}`);
    }

    // Save to .env file
    if (Object.keys(envUpdates).length > 0) {
      await updateEnvFile(envUpdates);
    }

    // Save UrBackup settings to UrBackup API (if any non-st0r settings provided)
    const urbackupKeys = Object.keys(urbackupSettings).filter(key =>
      !['totalClients', 'onlineClients', 'failedClients', 'backupPath', 'note'].includes(key)
    );

    if (urbackupKeys.length > 0) {
      const settingsToSave: any = {};
      urbackupKeys.forEach(key => {
        settingsToSave[key] = urbackupSettings[key];
      });

      await urbackupService.setSettings(settingsToSave);
      logger.info(`UrBackup settings updated by ${user?.username || 'unknown'}: ${urbackupKeys.join(', ')}`);
    }

    res.json({
      success: true,
      message: 'Settings saved successfully',
      settings: {
        serverFqdn: process.env.URBACKUP_SERVER_FQDN || '',
        serverPort: process.env.URBACKUP_SERVER_PORT || '55414'
      }
    });
  } catch (error) {
    logger.error('Failed to set server settings:', error);
    res.status(500).json({ error: 'Failed to set server settings' });
  }
}
