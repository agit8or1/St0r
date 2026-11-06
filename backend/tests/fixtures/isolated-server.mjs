// Boots the real dist/server.js for tests: the middleware chain, routes and error
// handler run unmodified. The database, logger, background services and the
// restore controller are mocked, so nothing outside this process is touched
// (no MariaDB, no UrBackup, no mysql restore, no initial-password file).
// Run with: node --experimental-test-module-mocks tests/fixtures/isolated-server.mjs
// Needs PORT and JWT_SECRET; prints "Server running" once listening.
import { mock } from 'node:test';
import { unlink } from 'node:fs/promises';

const dist = new URL('../../dist/', import.meta.url);
const at = (path) => new URL(path, dist).href;

const admin = { id: 1, username: 'test', email: 'test@example.invalid', password_hash: 'test-hash',
                is_admin: 1, is_active: 1 };
mock.module(at('config/database.js'), { namedExports: {
  pool: { end: async () => {} },
  testConnection: async () => true,
  // Users exist, so startup creates no default account; everything else is empty.
  query: async (sql) => (/\bFROM\s+app_users\b/i.test(sql) ? [admin] : []),
} });

const quiet = () => {};
mock.module(at('utils/logger.js'), { namedExports: { logger: {
  info: (msg) => { if (String(msg).startsWith('Server running')) console.log(msg); },
  warn: quiet, error: quiet, debug: quiet,
} } });

const idle = { start: async () => {}, stop: () => {} };
mock.module(at('services/replicationScheduler.js'), { namedExports: { replicationScheduler: idle } });
mock.module(at('services/replicationTrigger.js'), { namedExports: { replicationTrigger: idle } });
mock.module(at('services/diskGuard.js'), { namedExports: { diskGuard: idle, DiskGuard: class {} } });

// The upload route keeps its real multer middleware; only the restore behind it is
// replaced with one that reports what multer produced and removes the temp file.
const unused = (_req, res) => { res.status(501).json({ error: 'not under test' }); };
mock.module(at('controllers/databaseBackup.js'), { namedExports: {
  createBackup: unused, listBackups: unused, deleteBackup: unused, downloadBackup: unused,
  restoreBackup: unused, getBackupStats: unused, cleanupOldBackups: unused,
  uploadAndRestore: async (req, res) => {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
    await unlink(req.file.path);
    res.json({ field: req.file.fieldname, name: req.file.originalname, size: req.file.size });
  },
} });

await import(at('server.js'));
