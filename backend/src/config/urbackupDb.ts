import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { logger } from '../utils/logger.js';

let db: Database | null = null;

// Default UrBackup database path on Linux
const URBACKUP_DB_PATH = process.env.URBACKUP_DB_PATH || '/var/urbackup/backup_server.db';
const URBACKUP_SETTINGS_DB_PATH = URBACKUP_DB_PATH.replace('backup_server.db', 'backup_server_settings.db');

/**
 * Open a connection to the UrBackup SQLite database
 */
export async function openUrBackupDb(): Promise<Database> {
  if (db) {
    return db;
  }

  try {
    db = await open({
      filename: URBACKUP_DB_PATH,
      driver: sqlite3.Database,
      mode: sqlite3.OPEN_READONLY, // Open in read-only mode for safety
    });

    logger.info(`Connected to UrBackup database at ${URBACKUP_DB_PATH}`);
    return db;
  } catch (error) {
    logger.error('Failed to connect to UrBackup database:', error);
    throw new Error(`Failed to connect to UrBackup database: ${error}`);
  }
}

/**
 * Get the database instance, opening it if necessary
 */
export async function getUrBackupDb(): Promise<Database> {
  if (!db) {
    return await openUrBackupDb();
  }
  return db;
}

/**
 * Close the UrBackup database connection
 */
export async function closeUrBackupDb(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
    logger.info('Closed UrBackup database connection');
  }
}

/**
 * Test the connection to the UrBackup database
 */
export async function testUrBackupDbConnection(): Promise<boolean> {
  try {
    const database = await getUrBackupDb();
    await database.get('SELECT 1');
    return true;
  } catch (error) {
    logger.error('UrBackup database connection test failed:', error);
    return false;
  }
}

/**
 * Open a read-write connection to the UrBackup SETTINGS database (backup_server_settings.db).
 * UrBackup picks up writes to per-client settings immediately without restart.
 * Always close the returned connection after use.
 */
export async function openUrBackupSettingsDbReadWrite(): Promise<Database> {
  try {
    const rwDb = await open({
      filename: URBACKUP_SETTINGS_DB_PATH,
      driver: sqlite3.Database,
      mode: sqlite3.OPEN_READWRITE,
    });
    await rwDb.run('PRAGMA busy_timeout = 8000');
    return rwDb;
  } catch (error) {
    logger.error('Failed to open read-write connection to UrBackup settings database:', error);
    throw new Error(`Failed to open settings DB: ${error}`);
  }
}

/**
 * Open a read-write connection to the UrBackup database for write operations
 * Use this for operations that modify the database
 */
export async function openUrBackupDbReadWrite(): Promise<Database> {
  try {
    const rwDb = await open({
      filename: URBACKUP_DB_PATH,
      driver: sqlite3.Database,
      mode: sqlite3.OPEN_READWRITE, // Read-write mode for modifications
    });

    // Wait up to 8 seconds if UrBackup holds the write lock
    await rwDb.run('PRAGMA busy_timeout = 8000');

    logger.info(`Opened read-write connection to UrBackup database`);
    return rwDb;
  } catch (error) {
    logger.error('Failed to open read-write connection to UrBackup database:', error);
    throw new Error(`Failed to open read-write connection: ${error}`);
  }
}
