import { getUrBackupDb, openUrBackupDbReadWrite } from '../config/urbackupDb.js';
import { logger } from '../utils/logger.js';

/**
 * Service for querying the UrBackup SQLite database directly
 * This provides read-only access to UrBackup data
 */
export class UrBackupDbService {
  /**
   * Get all clients with their backup status
   */
  async getClients() {
    try {
      const db = await getUrBackupDb();
      const clients = await db.all(`
        SELECT
          c.id,
          c.name,
          CASE WHEN c.lastbackup IS NULL OR c.lastbackup = 0 THEN NULL ELSE CAST(strftime('%s', c.lastbackup) AS INTEGER) END as lastbackup,
          CASE WHEN c.lastseen IS NULL OR c.lastseen = 0 THEN NULL ELSE CAST(strftime('%s', c.lastseen) AS INTEGER) END as lastseen,
          CASE WHEN c.lastbackup_image IS NULL OR c.lastbackup_image = 0 THEN NULL ELSE CAST(strftime('%s', c.lastbackup_image) AS INTEGER) END as lastbackup_image,
          c.bytes_used_files,
          c.bytes_used_images,
          c.last_filebackup_issues,
          c.os_simple,
          c.os_version_str,
          c.client_version_str,
          c.file_ok,
          c.image_ok,
          c.uid,
          c.created,
          -- Get last file backup info
          (SELECT MAX(backuptime) FROM backups WHERE clientid = c.id AND complete = 1) as last_file_backup,
          (SELECT incremental FROM backups WHERE clientid = c.id AND complete = 1 ORDER BY backuptime DESC LIMIT 1) as last_file_backup_incremental,
          -- Get last image backup info
          (SELECT MAX(backuptime) FROM backup_images WHERE clientid = c.id AND complete = 1) as last_image_backup,
          (SELECT incremental FROM backup_images WHERE clientid = c.id AND complete = 1 ORDER BY backuptime DESC LIMIT 1) as last_image_backup_incremental,
          -- Check if currently backing up
          (SELECT COUNT(*) FROM backups WHERE clientid = c.id AND running IS NOT NULL AND complete = 0) as file_backup_running,
          (SELECT COUNT(*) FROM backup_images WHERE clientid = c.id AND running IS NOT NULL AND complete = 0) as image_backup_running
        FROM clients c
        WHERE c.delete_pending = 0
        ORDER BY c.name
      `);

      return clients.map(client => this.formatClient(client));
    } catch (error) {
      logger.error('Failed to get clients from database:', error);
      throw error;
    }
  }

  /**
   * Get a single client by ID
   */
  async getClient(clientId: number) {
    try {
      const db = await getUrBackupDb();
      const client = await db.get(`
        SELECT
          c.id,
          c.name,
          c.lastbackup,
          c.lastseen,
          c.lastbackup_image,
          c.bytes_used_files,
          c.bytes_used_images,
          c.last_filebackup_issues,
          c.os_simple,
          c.os_version_str,
          c.client_version_str,
          c.file_ok,
          c.image_ok,
          c.uid,
          c.created
        FROM clients c
        WHERE c.id = ? AND c.delete_pending = 0
      `, clientId);

      return client ? this.formatClient(client) : null;
    } catch (error) {
      logger.error(`Failed to get client ${clientId} from database:`, error);
      throw error;
    }
  }

  /**
   * Get online clients (seen in last 10 minutes)
   */
  async getOnlineClients() {
    try {
      const db = await getUrBackupDb();
      const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
      const clients = await db.all(`
        SELECT * FROM clients
        WHERE delete_pending = 0 AND lastseen > ?
        ORDER BY name
      `, tenMinutesAgo);

      return clients.map(client => this.formatClient(client));
    } catch (error) {
      logger.error('Failed to get online clients:', error);
      throw error;
    }
  }

  /**
   * Get offline clients (not seen in last 10 minutes)
   */
  async getOfflineClients() {
    try {
      const db = await getUrBackupDb();
      const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
      const clients = await db.all(`
        SELECT * FROM clients
        WHERE delete_pending = 0 AND (lastseen IS NULL OR lastseen <= ?)
        ORDER BY name
      `, tenMinutesAgo);

      return clients.map(client => this.formatClient(client));
    } catch (error) {
      logger.error('Failed to get offline clients:', error);
      throw error;
    }
  }

  /**
   * Get clients with failed backups
   */
  async getFailedClients() {
    try {
      const db = await getUrBackupDb();
      const clients = await db.all(`
        SELECT * FROM clients
        WHERE delete_pending = 0 AND (file_ok = 0 OR image_ok = 0)
        ORDER BY name
      `);

      return clients.map(client => this.formatClient(client));
    } catch (error) {
      logger.error('Failed to get failed clients:', error);
      throw error;
    }
  }

  /**
   * Get clients with OK backups
   */
  async getOkClients() {
    try {
      const db = await getUrBackupDb();
      const clients = await db.all(`
        SELECT * FROM clients
        WHERE delete_pending = 0 AND file_ok = 1 AND image_ok = 1
        ORDER BY name
      `);

      return clients.map(client => this.formatClient(client));
    } catch (error) {
      logger.error('Failed to get OK clients:', error);
      throw error;
    }
  }

  /**
   * Get file backups for a client
   */
  async getFileBackups(clientId: number) {
    try {
      const db = await getUrBackupDb();
      const backups = await db.all(`
        SELECT
          id,
          clientid,
          CAST(strftime('%s', backuptime) AS INTEGER) as backuptime,
          incremental,
          path,
          complete,
          running,
          size_bytes,
          done,
          archived,
          resumed
        FROM backups
        WHERE clientid = ? AND (delete_pending = 0 OR delete_pending IS NULL)
        ORDER BY backuptime DESC
      `, clientId);

      return backups.map(backup => ({
        ...backup,
        backuptime: backup.backuptime * 1000, // Convert Unix timestamp to milliseconds
        running: backup.running ? backup.running * 1000 : null,
        incremental: backup.incremental !== 0, // 0 = full, >0 = incremental
        complete: backup.complete === 1,
        archived: backup.archived === 1,
        image: false, // Mark as file backup
      }));
    } catch (error) {
      logger.error(`Failed to get file backups for client ${clientId}:`, error);
      throw error;
    }
  }

  /**
   * Get image backups for a client
   */
  async getImageBackups(clientId: number) {
    try {
      const db = await getUrBackupDb();
      const backups = await db.all(`
        SELECT
          id,
          clientid,
          CAST(strftime('%s', backuptime) AS INTEGER) as backuptime,
          incremental,
          incremental_ref,
          path,
          complete,
          running,
          size_bytes,
          version,
          letter,
          archived
        FROM backup_images
        WHERE clientid = ? AND (delete_pending = 0 OR delete_pending IS NULL)
        ORDER BY backuptime DESC
      `, clientId);

      return backups.map(backup => ({
        ...backup,
        backuptime: backup.backuptime * 1000, // Convert Unix timestamp to milliseconds
        running: backup.running ? backup.running * 1000 : null,
        incremental: backup.incremental !== 0, // 0 = full, >0 = incremental
        complete: backup.complete === 1,
        archived: backup.archived === 1,
        image: true, // Mark as image backup
      }));
    } catch (error) {
      logger.error(`Failed to get image backups for client ${clientId}:`, error);
      throw error;
    }
  }

  /**
   * Get real-time backup progress from files database
   * Returns null until UrBackup populates the done/size fields
   */
  async getBackupProgress(backupId: number, clientId: number) {
    // UrBackup doesn't reliably update progress in the database during backup
    // The done and size_bytes fields remain 0 until backup completion
    // Progress tracking needs to be done via the UrBackup API progress endpoint
    // which requires authenticated session and still returns empty data in 2.5.34
    return null;
  }

  /**
   * Get currently running backup activities
   */
  async getCurrentActivities() {
    try {
      const db = await getUrBackupDb();

      // Get running file backups
      const fileBackups = await db.all(`
        SELECT
          b.id,
          b.clientid,
          c.name as client_name,
          CAST(strftime('%s', b.backuptime) AS INTEGER) as backuptime,
          b.incremental,
          b.path,
          b.size_bytes,
          b.done,
          b.size_calculated,
          'file' as backup_type
        FROM backups b
        JOIN clients c ON b.clientid = c.id
        WHERE b.running IS NOT NULL AND b.complete = 0
        ORDER BY b.backuptime DESC
      `);

      // Get running image backups
      const imageBackups = await db.all(`
        SELECT
          b.id,
          b.clientid,
          c.name as client_name,
          CAST(strftime('%s', b.backuptime) AS INTEGER) as backuptime,
          b.incremental,
          b.path,
          b.size_bytes,
          'image' as backup_type
        FROM backup_images b
        JOIN clients c ON b.clientid = c.id
        WHERE b.running IS NOT NULL AND b.complete = 0
        ORDER BY b.backuptime DESC
      `);

      // Combine all activities (removed false "preparing" detection)
      const allActivities = [...fileBackups, ...imageBackups];

      logger.info(`[getCurrentActivities] Found ${fileBackups.length} file backups, ${imageBackups.length} image backups`);

      // Map activities with basic information
      // Note: UrBackup doesn't provide real-time progress via database or API in version 2.5.34
      const mappedActivities = allActivities.map((activity) => {
        // Determine action based on activity state
        let action = '';
        if (activity.preparing) {
          action = 'Preparing backup (indexing)';
        } else if (activity.size_calculated === 0) {
          // Check how long the backup has been running
          const runningTime = Date.now() / 1000 - activity.backuptime;
          if (runningTime > 120) {  // If running more than 2 minutes
            action = `${activity.incremental === 1 ? 'Incremental' : 'Full'} ${activity.backup_type} backup in progress`;
          } else {
            action = 'Indexing files';
          }
        } else {
          action = `${activity.incremental === 1 ? 'Incremental' : 'Full'} ${activity.backup_type} backup`;
        }

        return {
          id: activity.id,
          clientid: activity.clientid,
          clientName: activity.client_name,
          name: activity.client_name,
          client: activity.client_name,
          backuptime: activity.backuptime * 1000,
          incremental: activity.incremental === 1,
          type: activity.backup_type,
          path: activity.path,
          size_bytes: activity.size_bytes,
          done: activity.done || 0,
          percent_done: activity.done || 0,
          pcdone: activity.done || 0,
          done_bytes: 0,
          total_bytes: activity.size_bytes || 0,
          speed_bpms: 0,
          action: action,
          preparing: activity.preparing || false
        };
      });

      return mappedActivities;
    } catch (error) {
      logger.error('Failed to get current activities:', error);
      throw error;
    }
  }

  /**
   * Get recent completed backup activities
   */
  async getRecentActivities(limit: number = 100) {
    try {
      const db = await getUrBackupDb();

      // Get recent file backups
      const fileBackups = await db.all(`
        SELECT
          b.id,
          b.clientid,
          c.name as client_name,
          b.backuptime,
          b.incremental,
          b.complete,
          b.size_bytes,
          'file' as backup_type
        FROM backups b
        JOIN clients c ON b.clientid = c.id
        WHERE b.complete = 1
        ORDER BY b.backuptime DESC
        LIMIT ?
      `, limit);

      // Get recent image backups
      const imageBackups = await db.all(`
        SELECT
          b.id,
          b.clientid,
          c.name as client_name,
          b.backuptime,
          b.incremental,
          b.complete,
          b.size_bytes,
          'image' as backup_type
        FROM backup_images b
        JOIN clients c ON b.clientid = c.id
        WHERE b.complete = 1
        ORDER BY b.backuptime DESC
        LIMIT ?
      `, limit);

      // Combine and sort by time
      const activities = [...fileBackups, ...imageBackups]
        .sort((a, b) => b.backuptime - a.backuptime)
        .slice(0, limit);

      return activities.map(activity => ({
        id: activity.id,
        clientid: activity.clientid,
        clientName: activity.client_name,
        backuptime: activity.backuptime * 1000,
        incremental: activity.incremental === 1,
        complete: activity.complete === 1,
        type: activity.backup_type,
        size_bytes: activity.size_bytes,
      }));
    } catch (error) {
      logger.error('Failed to get recent activities:', error);
      throw error;
    }
  }

  /**
   * Get server statistics
   */
  async getServerStats() {
    try {
      const db = await getUrBackupDb();

      const stats = await db.get(`
        SELECT
          (SELECT COUNT(*) FROM clients WHERE delete_pending = 0) as total_clients,
          (SELECT COUNT(*) FROM clients WHERE delete_pending = 0 AND lastseen > ?) as online_clients,
          (SELECT COUNT(*) FROM clients WHERE delete_pending = 0 AND (file_ok = 0 OR image_ok = 0)) as failed_clients,
          (SELECT COUNT(*) FROM backups WHERE running IS NOT NULL AND complete = 0) as running_file_backups,
          (SELECT COUNT(*) FROM backup_images WHERE running IS NOT NULL AND complete = 0) as running_image_backups,
          (SELECT SUM(bytes_used_files) FROM clients WHERE delete_pending = 0) as total_file_bytes,
          (SELECT SUM(bytes_used_images) FROM clients WHERE delete_pending = 0) as total_image_bytes
      `, Math.floor(Date.now() / 1000) - 600);

      return stats;
    } catch (error) {
      logger.error('Failed to get server stats:', error);
      throw error;
    }
  }

  /**
   * Format client data for API response
   */
  private formatClient(client: any) {
    const now = Math.floor(Date.now() / 1000);
    const tenMinutesAgo = now - 600;

    // Helper function to parse SQLite DATE fields (stored as text 'YYYY-MM-DD HH:MM:SS')
    const parseTimestamp = (value: any): number | null => {
      if (!value) return null;

      // If it's already a number (Unix epoch), use it
      if (typeof value === 'number') {
        // Return null for zero or negative timestamps
        if (value <= 0) return null;
        return value * 1000;
      }

      // If it's a string, parse it as ISO 8601 datetime
      if (typeof value === 'string') {
        // SQLite stores as 'YYYY-MM-DD HH:MM:SS', which Date.parse can handle with 'T' separator
        const isoString = value.replace(' ', 'T') + 'Z';
        const timestamp = Date.parse(isoString);

        // Return null for invalid, negative, or very old timestamps (before year 2000)
        if (isNaN(timestamp) || timestamp <= 0 || timestamp < 946684800000) {
          return null;
        }

        return timestamp;
      }

      return null;
    };

    // Parse lastseen to check if online
    const lastseenTimestamp = parseTimestamp(client.lastseen);
    const lastseenSeconds = lastseenTimestamp ? Math.floor(lastseenTimestamp / 1000) : 0;

    return {
      id: client.id,
      name: client.name,
      lastbackup: parseTimestamp(client.lastbackup),
      lastseen: lastseenTimestamp,
      lastbackup_image: parseTimestamp(client.lastbackup_image),
      online: lastseenSeconds > 0 && lastseenSeconds > tenMinutesAgo,
      file_ok: client.file_ok === 1,
      image_ok: client.image_ok === 1,
      status: this.getClientStatus(client, tenMinutesAgo),
      os: client.os_simple,
      os_version: client.os_version_str,
      client_version: client.client_version_str,
      bytes_used_files: client.bytes_used_files || 0,
      bytes_used_images: client.bytes_used_images || 0,
      uid: client.uid,
      created: client.created ? client.created * 1000 : null,
      file_backup_running: client.file_backup_running > 0,
      image_backup_running: client.image_backup_running > 0,
    };
  }

  /**
   * Determine client status based on online state
   * Status is ONLY "online" or "offline" - backup success/failure is shown separately
   */
  private getClientStatus(client: any, tenMinutesAgo: number): string {
    // Parse lastseen timestamp (could be text or number)
    let lastseenSeconds = 0;
    if (client.lastseen) {
      if (typeof client.lastseen === 'number') {
        lastseenSeconds = client.lastseen;
      } else if (typeof client.lastseen === 'string') {
        const isoString = client.lastseen.replace(' ', 'T') + 'Z';
        const timestamp = Date.parse(isoString);
        lastseenSeconds = !isNaN(timestamp) ? Math.floor(timestamp / 1000) : 0;
      }
    }

    // Check if online (seen within last 10 minutes)
    const isOnline = lastseenSeconds > 0 && lastseenSeconds > tenMinutesAgo;

    return isOnline ? 'online' : 'offline';
  }

  /**
   * Add a new client directly to the database
   */
  async addClient(clientName: string) {
    let mainDb;
    let settingsDb;
    try {
      // Open main database for client insert
      mainDb = await openUrBackupDbReadWrite();

      // Generate a secure random auth key using crypto (64 hex characters)
      const crypto = await import('crypto');
      const authkey = crypto.randomBytes(32).toString('hex');

      // Insert the client
      const result = await mainDb.run(
        `INSERT INTO clients (name, lastbackup, lastseen, lastbackup_image, bytes_used_files,
         bytes_used_images, last_filebackup_issues, file_ok, image_ok, delete_pending, created)
         VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?)`,
        [clientName, Math.floor(Date.now() / 1000)]
      );

      const clientId = result.lastID;

      // Get server settings from environment
      const internetServer = process.env.URBACKUP_SERVER_FQDN || 'localhost';
      const internetServerPort = process.env.URBACKUP_SERVER_PORT || '55415';

      // Store settings in settings database
      const sqlite3 = await import('sqlite3');
      const { open } = await import('sqlite');
      settingsDb = await open({
        filename: process.env.URBACKUP_DB_PATH?.replace('backup_server.db', 'backup_server_settings.db') || '/var/urbackup/backup_server_settings.db',
        driver: sqlite3.default.Database,
        mode: sqlite3.default.OPEN_READWRITE
      });

      // Insert all client settings for internet backup
      const settings = [
        ['client_authkey', authkey],
        ['internet_mode_enabled', 'true'],
        ['internet_server', internetServer],
        ['internet_server_port', internetServerPort],
        ['internet_only', 'true'],
        ['internet_full_file_backups', 'true'],
        ['internet_image_backups', 'true'],
        ['internet_compress', 'true'],
        ['internet_encrypt', 'false'],
        ['computername', clientName]
      ];

      for (const [key, value] of settings) {
        await settingsDb.run(
          `INSERT INTO settings (key, value, clientid) VALUES (?, ?, ?)`,
          [key, value, clientId]
        );
      }

      // Create orig_client_settings JSON for pre-configured installer
      const origSettings = {
        internet_mode_enabled: 'true',
        internet_server: internetServer,
        internet_server_port: internetServerPort,
        internet_only: 'true',
        internet_full_file_backups: 'true',
        internet_image_backups: 'true',
        internet_compress: 'true',
        internet_encrypt: 'false',
        computername: clientName
      };

      await mainDb.run(
        `INSERT INTO orig_client_settings (clientid, data) VALUES (?, ?)`,
        [clientId, JSON.stringify(origSettings)]
      );

      logger.info(`Client ${clientName} added with ID ${clientId}, authkey: ${authkey}, internet settings configured`);

      return {
        clientId: clientId,
        authkey: authkey
      };
    } catch (error) {
      logger.error('Failed to add client to database:', error);
      throw error;
    } finally {
      if (mainDb) await mainDb.close();
      if (settingsDb) await settingsDb.close();
    }
  }

  /**
   * Get client authentication key from settings database
   */
  async getClientAuthkey(clientId: number): Promise<string> {
    let db;
    try {
      const sqlite3 = await import('sqlite3');
      const { open } = await import('sqlite');
      db = await open({
        filename: process.env.URBACKUP_DB_PATH?.replace('backup_server.db', 'backup_server_settings.db') || '/var/urbackup/backup_server_settings.db',
        driver: sqlite3.default.Database,
        mode: sqlite3.default.OPEN_READONLY
      });

      const result = await db.get(
        `SELECT value FROM settings WHERE key = ? AND clientid = ?`,
        ['client_authkey', clientId]
      );

      if (!result || !result.value) {
        // Generate new authkey if not found
        const authkey = Array.from({length: 26}, () =>
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(
            Math.floor(Math.random() * 62)
          )
        ).join('');

        logger.info(`Generated new authkey for client ${clientId}: ${authkey}`);
        return authkey;
      }

      return result.value;
    } catch (error) {
      logger.error(`Failed to get authkey for client ${clientId}:`, error);
      throw error;
    } finally {
      if (db) await db.close();
    }
  }
}
