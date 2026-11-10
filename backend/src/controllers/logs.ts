import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { helperInstalled, runHelper } from '../utils/privileged.js';

const execFileAsync = promisify(execFile);

/**
 * The St0r service's own journal (JSON lines). The service account is not in
 * the adm/systemd-journal groups, so the root-owned helper reads it — only this
 * unit, at most 1000 lines. Before the helper is installed, read it directly.
 */
async function readServiceJournal(limit: number): Promise<string> {
  if (helperInstalled()) {
    return (await runHelper('journal', [String(limit)], { timeout: 30_000 })).stdout;
  }
  const { stdout } = await execFileAsync('journalctl', [
    '-u', 'urbackup-gui.service', '-n', String(limit), '--no-pager', '-o', 'json',
  ]);
  return stdout;
}

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
  // eslint-disable-next-line no-control-regex -- ESC starts the ANSI colour codes being stripped
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function parseLimit(raw: unknown, fallback: number, max: number): number {
  const n = parseInt(raw as string);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

export async function getLogs(req: AuthRequest, res: Response): Promise<void> {
  try {
    const limit = parseLimit(req.query.limit, 200, 1000);

    const stdout = await readServiceJournal(limit);

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
      } catch {
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
      message: 'An internal error occurred'
    });
  }
}

export async function getLiveLog(req: AuthRequest, res: Response): Promise<void> {
  try {
    const limit = parseLimit(req.query.limit, 50, 1000);

    const stdout = await readServiceJournal(limit);

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
      } catch {
        continue;
      }
    }

    logs.reverse();

    res.json(logs);
  } catch (error: any) {
    logger.error('Failed to get live logs:', error);
    res.status(500).json({
      error: 'Failed to get live logs',
      message: 'An internal error occurred'
    });
  }
}
