import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { resolve, dirname } from 'path';
import { getUrBackupDb, openUrBackupDbReadWrite } from '../config/urbackupDb.js';
const execFile = promisify(execFileCb);
import { logger } from '../utils/logger.js';
import { pool } from '../config/database.js';

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
          COALESCE((SELECT SUM(size_bytes) FROM backups WHERE clientid = c.id AND (delete_pending = 0 OR delete_pending IS NULL)), 0) as bytes_used_files,
          COALESCE((SELECT SUM(size_bytes) FROM backup_images WHERE clientid = c.id AND (delete_pending = 0 OR delete_pending IS NULL)), 0) as bytes_used_images,
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
          COALESCE((SELECT SUM(size_bytes) FROM backups WHERE clientid = c.id AND (delete_pending = 0 OR delete_pending IS NULL)), 0) as bytes_used_files,
          COALESCE((SELECT SUM(size_bytes) FROM backup_images WHERE clientid = c.id AND (delete_pending = 0 OR delete_pending IS NULL)), 0) as bytes_used_images,
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
        WHERE clientid = ? AND (delete_pending = 0 OR delete_pending IS NULL) AND complete = 1
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
        WHERE clientid = ? AND (delete_pending = 0 OR delete_pending IS NULL) AND complete = 1
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
          id: `${activity.backup_type}-${activity.id}`,
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

  async getStuckBackups() {
    const db = await getUrBackupDb();
    const files = await db.all(`SELECT id, 'file' as type FROM backups WHERE running IS NOT NULL AND complete = 0`);
    const images = await db.all(`SELECT id, 'image' as type FROM backup_images WHERE running IS NOT NULL AND complete = 0`);
    return [...files, ...images];
  }

  async forceCompleteStuckBackups(): Promise<number> {
    const db = await openUrBackupDbReadWrite();
    try {
      await db.run(`UPDATE backups SET running = NULL, complete = 1 WHERE running IS NOT NULL AND complete = 0`);
      const r1 = await db.get(`SELECT changes() as n`) as any;
      await db.run(`UPDATE backup_images SET running = NULL, complete = 1 WHERE running IS NOT NULL AND complete = 0`);
      const r2 = await db.get(`SELECT changes() as n`) as any;
      return (r1?.n || 0) + (r2?.n || 0);
    } finally {
      await db.close();
    }
  }

  /**
   * Get recent completed backup activities
   */
  async getRecentActivities(limit: number = 100) {
    try {
      const db = await getUrBackupDb();

      // Get recent file backups with duration and error counts from logs table.
      // logs.created is UTC; synctime is Unix epoch — join within 120s window.
      const fileBackups = await db.all(`
        SELECT
          b.id,
          b.clientid,
          c.name as client_name,
          CAST(strftime('%s', b.backuptime) AS INTEGER) as backuptime,
          b.incremental,
          b.complete,
          b.size_bytes,
          b.synctime,
          (b.synctime - CAST(strftime('%s', b.backuptime) AS INTEGER)) as duration,
          COALESCE(l.errors, 0) as errors,
          COALESCE(l.warnings, 0) as warnings,
          l.id as log_id,
          'file' as backup_type
        FROM backups b
        JOIN clients c ON b.clientid = c.id
        LEFT JOIN logs l ON l.clientid = b.clientid
          AND l.image = 0
          AND CAST(strftime('%s', l.created) AS INTEGER) BETWEEN b.synctime - 120 AND b.synctime + 120
        WHERE b.complete = 1
        ORDER BY b.backuptime DESC
        LIMIT ?
      `, limit);

      // Get recent image backups — group by (clientid, backuptime) so multi-partition
      // image backups appear as one entry with all partition letters listed.
      // MAX() cannot be used in a JOIN condition directly in SQLite, so we group
      // in a subquery first, then JOIN against logs in the outer query.
      const imageBackups = await db.all(`
        SELECT
          g.id, g.clientid, g.client_name, g.backuptime, g.incremental, g.complete,
          g.size_bytes, g.partition_count, g.letters, g.synctime,
          (g.synctime - g.backuptime) as duration,
          COALESCE(l.errors, 0) as errors,
          COALESCE(l.warnings, 0) as warnings,
          l.id as log_id,
          'image' as backup_type
        FROM (
          SELECT
            MIN(b.id) as id,
            b.clientid,
            c.name as client_name,
            CAST(strftime('%s', b.backuptime) AS INTEGER) as backuptime,
            b.incremental,
            b.complete,
            SUM(b.size_bytes) as size_bytes,
            COUNT(*) as partition_count,
            GROUP_CONCAT(b.letter, ', ') as letters,
            MAX(b.synctime) as synctime
          FROM backup_images b
          JOIN clients c ON b.clientid = c.id
          WHERE b.complete = 1
          GROUP BY b.clientid, b.backuptime
          ORDER BY b.backuptime DESC
          LIMIT ?
        ) g
        LEFT JOIN logs l ON l.clientid = g.clientid
          AND l.image = 1
          AND CAST(strftime('%s', l.created) AS INTEGER) BETWEEN g.synctime - 120 AND g.synctime + 120
      `, limit);

      // Combine and sort by time
      const activities = [...fileBackups, ...imageBackups]
        .sort((a, b) => b.backuptime - a.backuptime)
        .slice(0, limit);

      // Build a customer name lookup: client_name → customer name (from MariaDB)
      const uniqueClientNames = [...new Set(activities.map(a => a.client_name as string).filter(Boolean))];
      const customerMap = new Map<string, string>();
      if (uniqueClientNames.length > 0) {
        try {
          const placeholders = uniqueClientNames.map(() => '?').join(',');
          const [rows] = await pool.query(
            `SELECT cc.client_name, c.name AS customer_name
             FROM customer_clients cc
             JOIN customers c ON cc.customer_id = c.id
             WHERE cc.client_name IN (${placeholders})`,
            uniqueClientNames
          ) as any[];
          for (const row of rows) {
            customerMap.set(row.client_name, row.customer_name);
          }
        } catch (err) {
          // Non-fatal: customer lookup is best-effort
          logger.warn('Customer lookup failed in getRecentActivities:', err);
        }
      }

      return activities.map(activity => ({
        id: `${activity.backup_type}-${activity.id}`,
        clientid: activity.clientid,
        clientName: activity.client_name,
        customerName: customerMap.get(activity.client_name) || null,
        backuptime: activity.backuptime * 1000,
        incremental: activity.incremental === 1,
        complete: activity.complete === 1,
        type: activity.backup_type,
        size_bytes: activity.size_bytes,
        partition_count: activity.partition_count || null,
        letters: activity.letters || null,
        duration: activity.duration > 0 ? activity.duration : null,
        errors: activity.errors || 0,
        warnings: activity.warnings || 0,
        log_id: activity.log_id || null,
      }));
    } catch (error) {
      logger.error('Failed to get recent activities:', error);
      throw error;
    }
  }

  /**
   * Get backup job counts (successful / failed) for the last N days.
   * Queries the UrBackup logs table which has one row per completed backup job.
   */
  async getBackupStats(days: number = 7) {
    try {
      const db = await getUrBackupDb();
      const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
      const rows = await db.all(`
        SELECT
          CASE WHEN errors = 0 THEN 'successful' ELSE 'failed' END AS status,
          COUNT(*) AS count
        FROM logs
        WHERE restore = 0
          AND CAST(strftime('%s', created) AS INTEGER) >= ?
        GROUP BY status
      `, cutoff) as { status: string; count: number }[];

      const successful = rows.find(r => r.status === 'successful')?.count ?? 0;
      const failed = rows.find(r => r.status === 'failed')?.count ?? 0;
      return { successful, failed, total: successful + failed, days };
    } catch (error) {
      logger.error('Failed to get backup stats:', error);
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
          (SELECT COALESCE(SUM(size_bytes), 0) FROM backups WHERE delete_pending = 0 OR delete_pending IS NULL) as total_file_bytes,
          (SELECT COALESCE(SUM(size_bytes), 0) FROM backup_images WHERE delete_pending = 0 OR delete_pending IS NULL) as total_image_bytes
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
      // image_ok: use UrBackup's flag only when there are actual image backups.
      // After manual deletion UrBackup leaves image_ok=1 until the next backup cycle.
      image_ok: client.image_ok === 1 && client.bytes_used_images > 0,
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

      // Fetch the global internet_authkey (stored with clientid=0) so new clients can authenticate
      const globalAuthkeyRow = await settingsDb.get(
        `SELECT value FROM settings WHERE key = 'internet_authkey' AND clientid = 0`
      );
      const authkey = globalAuthkeyRow?.value || '';

      // Insert all client settings for internet backup
      const settings = [
        ['internet_mode_enabled', 'true'],
        ['internet_server', internetServer],
        ['internet_server_port', internetServerPort],
        ['internet_only', 'true'],
        ['internet_full_file_backups', 'true'],
        ['internet_image_backups', 'true'],
        ['internet_compress', 'true'],
        ['internet_encrypt', 'false'],
        ['computername', clientName],
        ['client_authkey', authkey],
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
        computername: clientName,
        internet_authkey: authkey,
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
   * Delete an individual backup by marking it delete_pending and removing its directory.
   */
  async deleteBackup(backupId: number, isImage: boolean) {
    let mainDb;
    try {
      mainDb = await openUrBackupDbReadWrite();
      const table = isImage ? 'backup_images' : 'backups';

      // Get backup record + client name
      const backup = await mainDb.get(
        `SELECT b.id, b.clientid, b.path, c.name as clientname
         FROM ${table} b
         JOIN clients c ON c.id = b.clientid
         WHERE b.id = ?`,
        [backupId]
      );
      if (!backup) throw new Error(`Backup ${backupId} not found`);

      // Mark delete_pending so UrBackup knows it's gone
      await mainDb.run(`UPDATE ${table} SET delete_pending = 1 WHERE id = ?`, [backupId]);
      await mainDb.close();
      mainDb = null;

      // Look up backup storage folder from settings DB
      const { open } = await import('sqlite');
      const sqlite3 = await import('sqlite3');
      const settingsDb = await open({
        filename: process.env.URBACKUP_DB_PATH?.replace('backup_server.db', 'backup_server_settings.db') || '/var/urbackup/backup_server_settings.db',
        driver: sqlite3.default.Database,
      });
      const row = await settingsDb.get(`SELECT value FROM settings WHERE key='backupfolder'`);
      await settingsDb.close();
      const backupFolder = resolve(row?.value || '/home/administrator/urbackup-storage');

      // Determine directory to delete
      let dirToDelete: string | null = null;
      if (isImage) {
        // Image path is full absolute path to the .vhdz file — delete parent dir
        dirToDelete = resolve(dirname(backup.path));
      } else {
        // File backup path is relative to <backupfolder>/<clientname>/
        dirToDelete = resolve(backupFolder, backup.clientname, backup.path);
      }

      // Security: path must be strictly inside the backup storage folder
      if (!dirToDelete.startsWith(backupFolder + '/')) {
        throw new Error(`Refusing to delete path outside backup storage: ${dirToDelete}`);
      }

      // Run rm -rf in background — large backups can take minutes to delete.
      // delete_pending=1 is already set so the backup won't appear in listings.
      const dirSnapshot = dirToDelete;
      logger.info(`Queuing background deletion: ${dirSnapshot}`);
      execFile('sudo', ['-u', 'urbackup', 'rm', '-rf', '--', dirSnapshot], { timeout: 600_000 })
        .then(() => logger.info(`Background deletion complete: ${dirSnapshot}`))
        .catch(err => logger.error(`Background deletion failed for ${dirSnapshot}:`, err));

      return { success: true, backupId, isImage };
    } catch (error) {
      logger.error(`Failed to delete backup ${backupId}:`, error);
      throw error;
    } finally {
      if (mainDb) await mainDb.close();
    }
  }

  /**
   * Remove a client and all associated data directly from the database.
   * The UrBackup HTTP API silently no-ops without authenticated session,
   * so direct DB deletion is required.
   */
  async removeClient(clientId: number) {
    let mainDb;
    let settingsDb;
    try {
      mainDb = await openUrBackupDbReadWrite();

      // Delete the client row
      await mainDb.run('DELETE FROM clients WHERE id = ?', [clientId]);
      // Clean up related tables
      await mainDb.run('DELETE FROM orig_client_settings WHERE clientid = ?', [clientId]);
      await mainDb.run('UPDATE backups SET delete_pending = 1 WHERE clientid = ?', [clientId]);
      await mainDb.run('UPDATE backup_images SET delete_pending = 1 WHERE clientid = ?', [clientId]);

      // Remove settings from settings database
      const sqlite3 = await import('sqlite3');
      const { open } = await import('sqlite');
      settingsDb = await open({
        filename: process.env.URBACKUP_DB_PATH?.replace('backup_server.db', 'backup_server_settings.db') || '/var/urbackup/backup_server_settings.db',
        driver: sqlite3.default.Database,
        mode: sqlite3.default.OPEN_READWRITE
      });
      await settingsDb.run('DELETE FROM settings WHERE clientid = ?', [clientId]);

      logger.info(`Client ${clientId} removed from database`);
      return { success: true };
    } catch (error) {
      logger.error(`Failed to remove client ${clientId} from database:`, error);
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

  /**
   * Get storage usage aggregated by customer (joins UrBackup SQLite + MariaDB customers)
   */
  async getStorageByCustomer() {
    try {
      const db = await getUrBackupDb();

      // Per-client storage from UrBackup SQLite
      const clientStorage = await db.all(`
        SELECT
          c.name AS client_name,
          COALESCE((SELECT SUM(size_bytes) FROM backups WHERE clientid = c.id AND (delete_pending = 0 OR delete_pending IS NULL)), 0) AS file_bytes,
          COALESCE((SELECT SUM(size_bytes) FROM backup_images WHERE clientid = c.id AND (delete_pending = 0 OR delete_pending IS NULL)), 0) AS image_bytes
        FROM clients c
        WHERE c.delete_pending = 0
      `) as { client_name: string; file_bytes: number; image_bytes: number }[];

      const clientMap = new Map<string, { file_bytes: number; image_bytes: number }>();
      for (const row of clientStorage) {
        clientMap.set(row.client_name, { file_bytes: Number(row.file_bytes), image_bytes: Number(row.image_bytes) });
      }

      // Customer → client mappings from MariaDB
      const [customerRows] = await pool.execute<any[]>(`
        SELECT c.id, c.name AS customer_name, c.company, cc.client_name
        FROM customers c
        LEFT JOIN customer_clients cc ON cc.customer_id = c.id
        WHERE c.is_active = 1
        ORDER BY c.name, cc.client_name
      `);

      type CustEntry = { id: number; name: string; company: string | null; client_count: number; file_bytes: number; image_bytes: number; total_bytes: number; clients: string[] };
      const customerMap = new Map<number, CustEntry>();

      for (const row of customerRows) {
        if (!customerMap.has(row.id)) {
          customerMap.set(row.id, { id: row.id, name: row.customer_name, company: row.company || null, client_count: 0, file_bytes: 0, image_bytes: 0, total_bytes: 0, clients: [] });
        }
        const cust = customerMap.get(row.id)!;
        if (row.client_name) {
          cust.clients.push(row.client_name);
          cust.client_count++;
          const storage = clientMap.get(row.client_name);
          if (storage) {
            cust.file_bytes += storage.file_bytes;
            cust.image_bytes += storage.image_bytes;
          }
        }
      }

      const assignedNames = new Set<string>(customerRows.map((r: any) => r.client_name).filter(Boolean));
      const unassigned = clientStorage.filter(c => !assignedNames.has(c.client_name));

      const result: CustEntry[] = Array.from(customerMap.values()).map(c => ({ ...c, total_bytes: c.file_bytes + c.image_bytes }));
      result.sort((a, b) => b.total_bytes - a.total_bytes);

      if (unassigned.length > 0) {
        const uf = unassigned.reduce((s, c) => s + Number(c.file_bytes), 0);
        const ui = unassigned.reduce((s, c) => s + Number(c.image_bytes), 0);
        result.push({ id: -1, name: 'Unassigned', company: null, client_count: unassigned.length, file_bytes: uf, image_bytes: ui, total_bytes: uf + ui, clients: unassigned.map(c => c.client_name) });
      }

      return result;
    } catch (error) {
      logger.error('Failed to get storage by customer:', error);
      throw error;
    }
  }
}
