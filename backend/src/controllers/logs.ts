import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface LogEntry {
  time: string;
  level: string;
  message: string;
}

// Parse journalctl log level from priority
function getPriorityLevel(priority: string): string {
  const p = parseInt(priority);
  if (p <= 3) return 'error';
  if (p === 4) return 'warning';
  if (p === 6) return 'info';
  return 'debug';
}

// Parse ANSI color codes to determine log level
function parseLogLevel(message: string): string {
  if (message.includes('[31m') || message.includes('error')) return 'error';
  if (message.includes('[33m') || message.includes('warn')) return 'warning';
  if (message.includes('[32m') || message.includes('info')) return 'info';
  return 'debug';
}

// Strip ANSI color codes from message
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export async function getLogs(req: AuthRequest, res: Response): Promise<void> {
  try {
    const limit = parseInt(req.query.limit as string) || 200;

    // Get logs from journalctl for urbackup-gui service
    const { stdout } = await execAsync(
      `journalctl -u urbackup-gui.service -n ${limit} --no-pager -o json`
    );

    const logs: LogEntry[] = [];
    const lines = stdout.trim().split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line);

        // MESSAGE field might be a byte array or string
        let message = '';
        if (Array.isArray(entry.MESSAGE)) {
          // Convert byte array to string
          message = String.fromCharCode(...entry.MESSAGE);
        } else if (typeof entry.MESSAGE === 'string') {
          message = entry.MESSAGE;
        } else {
          continue;
        }

        // Clean up message
        message = stripAnsi(message);

        // Get timestamp
        const timestamp = entry.__REALTIME_TIMESTAMP
          ? new Date(parseInt(entry.__REALTIME_TIMESTAMP) / 1000).toISOString()
          : new Date().toISOString();

        // Determine log level
        const level = entry.PRIORITY
          ? getPriorityLevel(entry.PRIORITY)
          : parseLogLevel(message);

        logs.push({
          time: timestamp,
          level,
          message: message.trim()
        });
      } catch (err) {
        // Skip malformed JSON lines
        continue;
      }
    }

    // Reverse to show newest first
    logs.reverse();

    res.json(logs);
  } catch (error: any) {
    logger.error('Failed to get logs:', error);
    res.status(500).json({
      error: 'Failed to get logs',
      message: error.message
    });
  }
}

export async function getLiveLog(req: AuthRequest, res: Response): Promise<void> {
  try {
    const limit = parseInt(req.query.limit as string) || 50;

    // Get latest logs from journalctl
    const { stdout } = await execAsync(
      `journalctl -u urbackup-gui.service -n ${limit} --no-pager -o json`
    );

    const logs: LogEntry[] = [];
    const lines = stdout.trim().split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line);

        let message = '';
        if (Array.isArray(entry.MESSAGE)) {
          message = String.fromCharCode(...entry.MESSAGE);
        } else if (typeof entry.MESSAGE === 'string') {
          message = entry.MESSAGE;
        } else {
          continue;
        }

        message = stripAnsi(message);

        const timestamp = entry.__REALTIME_TIMESTAMP
          ? new Date(parseInt(entry.__REALTIME_TIMESTAMP) / 1000).toISOString()
          : new Date().toISOString();

        const level = entry.PRIORITY
          ? getPriorityLevel(entry.PRIORITY)
          : parseLogLevel(message);

        logs.push({
          time: timestamp,
          level,
          message: message.trim()
        });
      } catch (err) {
        continue;
      }
    }

    logs.reverse();

    res.json(logs);
  } catch (error: any) {
    logger.error('Failed to get live logs:', error);
    res.status(500).json({
      error: 'Failed to get live logs',
      message: error.message
    });
  }
}
