import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
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

// Load environment variables
dotenv.config();

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
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      logger.error('Failed to connect to database. Exiting...');
      process.exit(1);
    }

    // Initialize default user if needed
    await initializeDefaultUser();

    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
