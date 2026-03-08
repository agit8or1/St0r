import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { testConnection } from './config/database.js';
import { logger } from './utils/logger.js';

// Import routes
import authRoutes from './routes/auth.js';
import urbackupRoutes from './routes/urbackup.js';
import logsRoutes from './routes/logs.js';
import clientSettingsRoutes from './routes/clientSettings.js';
import serverSettingsRoutes from './routes/serverSettings.js';
import usersRoutes from './routes/users.js';
import customersRoutes from './routes/customers.js';
import twofaRoutes from './routes/twofa.js';
import versionRoutes from './routes/version.js';
import setupRoutes from './routes/setup.js';
import profileRoutes from './routes/profile.js';
import systemRoutes from './routes/system.js';
import documentationRoutes from './routes/documentation.js';
import bugReportRoutes from './routes/bugReport.js';
import databaseBackupRoutes from './routes/databaseBackup.js';
import settingsRoutes from './routes/settings.js';
import clientInstallerRoutes from './routes/clientInstaller.js';
import storageRoutes from './routes/storage.js';
import browseRoutes from './routes/browse.js';
import replicationRoutes from './routes/replication.js';
import storageLimitsRoutes from './routes/storageLimits.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy - required for rate limiting when behind nginx
// Trust only loopback addresses (nginx on same machine)
app.set('trust proxy', 'loopback');

// Security middleware
app.use(helmet());
app.use(cors());

// Rate limiting - only for auth endpoints to prevent brute force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit login attempts
  message: 'Too many login attempts, please try again later.',
});

// More generous rate limit for authenticated API endpoints
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200, // 200 requests per minute (plenty for auto-refresh)
  message: 'Too many requests from this IP, please try again later.',
});

app.use('/api/auth/login', authLimiter);
app.use('/api/', apiLimiter);

// Cookie parsing middleware
app.use(cookieParser());

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/urbackup', urbackupRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/client-settings', clientSettingsRoutes);
app.use('/api/server-settings', serverSettingsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/2fa', twofaRoutes);
app.use('/api/version', versionRoutes);
app.use('/api/setup', setupRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/system-update', systemRoutes);
app.use('/api/documentation', documentationRoutes);
app.use('/api/bug-report', bugReportRoutes);
app.use('/api/database-backup', databaseBackupRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/client-installer', clientInstallerRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/browse', browseRoutes);
app.use('/api/replication', replicationRoutes);
app.use('/api/storage-limits', storageLimitsRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// Ensure ancillary tables exist (idempotent)
async function ensureTables() {
  const { query } = await import('./config/database.js');
  await query(`
    CREATE TABLE IF NOT EXISTS client_managed_mode (
      client_id VARCHAR(20) NOT NULL,
      managed TINYINT(1) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (client_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS client_storage_limits (
      id INT AUTO_INCREMENT PRIMARY KEY,
      client_name VARCHAR(255) NOT NULL UNIQUE,
      limit_bytes BIGINT NOT NULL,
      warn_threshold_pct TINYINT NOT NULL DEFAULT 80,
      critical_threshold_pct TINYINT NOT NULL DEFAULT 95,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_client_name (client_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

// Initialize default admin user if none exists
async function initializeDefaultUser() {
  const { getAllUsers } = await import('./models/user.js');
  const { hashPassword } = await import('./utils/auth.js');
  const { query } = await import('./config/database.js');

  try {
    const users = await getAllUsers();
    if (users.length === 0) {
      logger.info('No users found. Creating default admin user...');
      const passwordHash = await hashPassword('admin123');
      await query(
        'INSERT INTO app_users (username, email, password_hash, is_admin) VALUES (?, ?, ?, ?)',
        ['admin', 'admin@localhost', passwordHash, true]
      );
      logger.info('Default admin user created (username: admin, password: admin123)');
      logger.warn('IMPORTANT: Change the default password immediately!');
    }
  } catch (error) {
    logger.error('Failed to initialize default user:', error);
  }
}

// Start server
async function startServer() {
  try {
    // Test database connection — retry for up to 30s to handle slow MariaDB start at boot
    let dbConnected = false;
    for (let attempt = 1; attempt <= 6; attempt++) {
      dbConnected = await testConnection();
      if (dbConnected) break;
      if (attempt < 6) {
        logger.warn(`Database not ready (attempt ${attempt}/6), retrying in 5s...`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
    if (!dbConnected) {
      logger.error('Failed to connect to database after 6 attempts. Exiting...');
      process.exit(1);
    }

    // Ensure ancillary tables exist
    await ensureTables();

    // Initialize default user if needed
    await initializeDefaultUser();

    // Start replication services
    const { replicationScheduler } = await import('./services/replicationScheduler.js');
    const { replicationTrigger } = await import('./services/replicationTrigger.js');
    await replicationScheduler.start();
    replicationTrigger.start();

    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Start automatic stale job cleanup (runs every hour)
    startAutomaticStaleJobCleanup();
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Automatic stale job cleanup
async function startAutomaticStaleJobCleanup() {
  const { UrBackupService } = await import('./services/urbackup.js');

  // Run cleanup every hour
  const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds

  logger.info('[AutoCleanup] Starting automatic stale job cleanup (runs every hour)');

  // Run initial cleanup after 5 minutes
  setTimeout(async () => {
    try {
      logger.info('[AutoCleanup] Running initial stale job cleanup...');
      const service = new UrBackupService();
      const result = await service.clearStaleJobs();
      logger.info(`[AutoCleanup] Cleared ${result.staleJobsStopped}/${result.staleJobsFound} stale jobs`);
    } catch (error) {
      logger.error('[AutoCleanup] Failed to run initial cleanup:', error);
    }
  }, 5 * 60 * 1000);

  // Then run every hour
  setInterval(async () => {
    try {
      logger.info('[AutoCleanup] Running scheduled stale job cleanup...');
      const service = new UrBackupService();
      const result = await service.clearStaleJobs();
      if (result.staleJobsFound > 0) {
        logger.info(`[AutoCleanup] Cleared ${result.staleJobsStopped}/${result.staleJobsFound} stale jobs`);
      } else {
        logger.info('[AutoCleanup] No stale jobs found');
      }
    } catch (error) {
      logger.error('[AutoCleanup] Failed to run scheduled cleanup:', error);
    }
  }, CLEANUP_INTERVAL);
}

// Handle shutdown gracefully
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

startServer();
