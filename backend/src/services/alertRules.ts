import nodemailer from 'nodemailer';
import { query } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { UrBackupService } from './urbackup.js';
import { diskGuard } from './diskGuard.js';

/**
 * Alert rules shown on the Alerts page (issue #27).
 *
 * The page used to keep its rules in React state only, seeded from hard-coded
 * defaults, so every edit vanished on reload and no rule ever fired. Rules now
 * live in MariaDB (`alert_rules`), are evaluated on the server against live
 * UrBackup status, and notify through the e-mail settings configured in
 * Settings → Email & Alerts (UrBackup's mail config) and/or Pushover.
 */

export type AlertRuleType = 'backup_failure' | 'client_offline' | 'storage_low' | 'backup_old';

export interface AlertRule {
  type: AlertRuleType;
  name: string;
  enabled: boolean;
  /** hours (client_offline), percent (storage_low), days (backup_old); null for backup_failure */
  threshold: number | null;
  notifyEmail: boolean;
  notifyPushover: boolean;
  /** Overrides the admin address from the mail settings when non-empty. */
  emailTo: string;
}

export interface ActiveAlert {
  /** Stable key: `<type>:<subject>` — lets the UI and the notifier dedupe. */
  key: string;
  type: AlertRuleType;
  severity: 'critical' | 'warning';
  message: string;
  clientName?: string;
  /** When the condition started, when known (epoch ms); otherwise when it was first seen. */
  since: number | null;
}

export const RULE_TYPES: AlertRuleType[] = ['backup_failure', 'client_offline', 'storage_low', 'backup_old'];

const DEFAULT_RULES: AlertRule[] = [
  { type: 'backup_failure', name: 'Backup Failure Alert', enabled: true, threshold: null, notifyEmail: true, notifyPushover: false, emailTo: '' },
  { type: 'client_offline', name: 'Client Offline Alert', enabled: true, threshold: 24, notifyEmail: true, notifyPushover: false, emailTo: '' },
  { type: 'storage_low', name: 'Storage Low Alert', enabled: false, threshold: 90, notifyEmail: true, notifyPushover: false, emailTo: '' },
  { type: 'backup_old', name: 'Old Backup Alert', enabled: true, threshold: 7, notifyEmail: true, notifyPushover: false, emailTo: '' },
];

/** Valid threshold range per rule type. */
const THRESHOLD_LIMITS: Partial<Record<AlertRuleType, { min: number; max: number }>> = {
  client_offline: { min: 1, max: 24 * 365 },
  storage_low: { min: 1, max: 100 },
  backup_old: { min: 1, max: 3650 },
};

export async function ensureAlertTables(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS alert_rules (
      type VARCHAR(32) NOT NULL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      threshold INT NULL,
      notify_email TINYINT(1) NOT NULL DEFAULT 1,
      notify_pushover TINYINT(1) NOT NULL DEFAULT 0,
      email_to VARCHAR(1024) NOT NULL DEFAULT '',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // One row per condition that has already been notified, so a still-failing
  // client is reported once, not every cycle. Cleared when the condition clears.
  await query(`
    CREATE TABLE IF NOT EXISTS alert_state (
      alert_key VARCHAR(512) NOT NULL PRIMARY KEY,
      rule_type VARCHAR(32) NOT NULL,
      first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      notified_at TIMESTAMP NULL,
      INDEX idx_rule_type (rule_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  for (const r of DEFAULT_RULES) {
    await query(
      `INSERT IGNORE INTO alert_rules (type, name, enabled, threshold, notify_email, notify_pushover, email_to)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [r.type, r.name, r.enabled ? 1 : 0, r.threshold, r.notifyEmail ? 1 : 0, r.notifyPushover ? 1 : 0, r.emailTo]
    );
  }
}

function rowToRule(row: any): AlertRule {
  return {
    type: row.type,
    name: row.name,
    enabled: !!row.enabled,
    threshold: row.threshold === null || row.threshold === undefined ? null : Number(row.threshold),
    notifyEmail: !!row.notify_email,
    notifyPushover: !!row.notify_pushover,
    emailTo: row.email_to || '',
  };
}

export async function getAlertRules(): Promise<AlertRule[]> {
  const rows = await query<any[]>('SELECT * FROM alert_rules');
  const byType = new Map(rows.map(r => [r.type, rowToRule(r)]));
  return RULE_TYPES.map(t => byType.get(t) ?? DEFAULT_RULES.find(d => d.type === t)!);
}

/** Validate a partial update; returns an error message or null. */
export function validateRuleUpdate(type: string, body: any): string | null {
  if (!RULE_TYPES.includes(type as AlertRuleType)) return 'Unknown alert rule';
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 255)) {
    return 'Rule name must be 1-255 characters';
  }
  for (const k of ['enabled', 'notifyEmail', 'notifyPushover']) {
    if (body[k] !== undefined && typeof body[k] !== 'boolean') return `${k} must be true or false`;
  }
  if (body.threshold !== undefined && body.threshold !== null) {
    const limits = THRESHOLD_LIMITS[type as AlertRuleType];
    const n = Number(body.threshold);
    if (!limits) return 'This rule has no threshold';
    if (!Number.isInteger(n) || n < limits.min || n > limits.max) {
      return `Threshold must be a whole number between ${limits.min} and ${limits.max}`;
    }
  }
  if (body.emailTo !== undefined) {
    if (typeof body.emailTo !== 'string' || body.emailTo.length > 1024 || /[\r\n]/.test(body.emailTo)) {
      return 'Invalid e-mail address list';
    }
  }
  return null;
}

export async function updateAlertRule(type: AlertRuleType, body: any): Promise<AlertRule> {
  const current = (await getAlertRules()).find(r => r.type === type)!;
  const next: AlertRule = {
    ...current,
    ...(body.name !== undefined ? { name: String(body.name).trim() } : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(body.notifyEmail !== undefined ? { notifyEmail: body.notifyEmail } : {}),
    ...(body.notifyPushover !== undefined ? { notifyPushover: body.notifyPushover } : {}),
    ...(body.emailTo !== undefined ? { emailTo: String(body.emailTo).trim() } : {}),
    ...(body.threshold !== undefined && THRESHOLD_LIMITS[type] ? { threshold: Number(body.threshold) } : {}),
  };
  await query(
    `INSERT INTO alert_rules (type, name, enabled, threshold, notify_email, notify_pushover, email_to)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), enabled = VALUES(enabled), threshold = VALUES(threshold),
       notify_email = VALUES(notify_email), notify_pushover = VALUES(notify_pushover), email_to = VALUES(email_to)`,
    [type, next.name, next.enabled ? 1 : 0, next.threshold, next.notifyEmail ? 1 : 0, next.notifyPushover ? 1 : 0, next.emailTo]
  );
  // A changed threshold or a re-enabled rule should re-evaluate from scratch.
  await query('DELETE FROM alert_state WHERE rule_type = ?', [type]);
  return next;
}

/**
 * Pure evaluation of the rules against a client list and storage usage, so it
 * can be tested without UrBackup.
 */
export function evaluateRules(
  rules: AlertRule[],
  clients: any[],
  storageUsedPct: number | null,
  now: number = Date.now()
): ActiveAlert[] {
  const alerts: ActiveAlert[] = [];
  const HOUR = 3600 * 1000;
  const DAY = 24 * HOUR;

  for (const rule of rules) {
    if (!rule.enabled) continue;
    switch (rule.type) {
      case 'backup_failure':
        for (const c of clients) {
          // Only backup types that are actually enabled count (issue #14); a
          // client fails when every enabled type is not OK.
          const checks: boolean[] = [];
          if (!c.file_backups_disabled) checks.push(!!c.file_ok);
          if (!c.image_backups_disabled) checks.push(!!c.image_ok);
          if (checks.length > 0 && checks.every(ok => !ok)) {
            alerts.push({
              key: `backup_failure:${c.name}`, type: 'backup_failure', severity: 'critical',
              message: `Backups are failing for client ${c.name}`, clientName: c.name, since: null,
            });
          }
        }
        break;
      case 'client_offline': {
        const hours = rule.threshold ?? 24;
        for (const c of clients) {
          if (c.online) continue;
          const lastseen = typeof c.lastseen === 'number' ? c.lastseen : null;
          if (lastseen !== null && now - lastseen < hours * HOUR) continue;
          alerts.push({
            key: `client_offline:${c.name}`, type: 'client_offline', severity: 'warning',
            message: lastseen
              ? `Client ${c.name} has been offline for ${Math.floor((now - lastseen) / HOUR)} hours`
              : `Client ${c.name} is offline and has never been seen`,
            clientName: c.name, since: lastseen,
          });
        }
        break;
      }
      case 'storage_low': {
        const pct = rule.threshold ?? 90;
        if (storageUsedPct !== null && storageUsedPct >= pct) {
          alerts.push({
            key: 'storage_low:server', type: 'storage_low',
            severity: storageUsedPct >= 95 ? 'critical' : 'warning',
            message: `Backup storage is ${storageUsedPct.toFixed(1)}% full (threshold ${pct}%)`, since: null,
          });
        }
        break;
      }
      case 'backup_old': {
        const days = rule.threshold ?? 7;
        for (const c of clients) {
          const times: number[] = [];
          if (!c.file_backups_disabled && typeof c.lastbackup === 'number') times.push(c.lastbackup);
          if (!c.image_backups_disabled && typeof c.lastbackup_image === 'number') times.push(c.lastbackup_image);
          if (c.file_backups_disabled && c.image_backups_disabled) continue;
          const latest = times.length ? Math.max(...times) : null;
          if (latest !== null && now - latest < days * DAY) continue;
          alerts.push({
            key: `backup_old:${c.name}`, type: 'backup_old', severity: 'warning',
            message: latest
              ? `Last backup of ${c.name} is ${Math.floor((now - latest) / DAY)} days old`
              : `Client ${c.name} has no completed backup`,
            clientName: c.name, since: latest,
          });
        }
        break;
      }
    }
  }
  return alerts;
}

const urbackup = new UrBackupService();

export async function getActiveAlerts(): Promise<{ alerts: ActiveAlert[]; rules: AlertRule[] }> {
  const rules = await getAlertRules();
  const clients = await urbackup.getClients();
  let usedPct: number | null = null;
  if (rules.some(r => r.type === 'storage_low' && r.enabled)) {
    try { usedPct = (await diskGuard.getUsage()).usedPct; } catch (err) {
      logger.warn('[Alerts] Could not read storage usage:', err);
    }
  }
  return { alerts: evaluateRules(rules, clients, usedPct), rules };
}

// --- Notification ---------------------------------------------------------

async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const s = await urbackup.getSettings();
  const recipients = to || String(s.mail_admin || '');
  if (!s.mail_server || !recipients) {
    throw new Error('E-mail is not configured (set the mail server and admin address in Settings → Email & Alerts)');
  }
  const port = parseInt(String(s.mail_serverport || '25'), 10) || 25;
  const sslOnly = s.mail_ssl === true || s.mail_ssl === '1' || s.mail_ssl === 'true';
  const transporter = nodemailer.createTransport({
    host: String(s.mail_server),
    port,
    secure: port === 465,
    requireTLS: sslOnly && port !== 465,
    auth: s.mail_username ? { user: String(s.mail_username), pass: String(s.mail_password || '') } : undefined,
  });
  await transporter.sendMail({
    from: String(s.mail_from || 'st0r@localhost'),
    to: recipients,
    subject,
    text,
  });
}

async function sendPushover(title: string, message: string, critical: boolean): Promise<void> {
  const token = process.env.ST0R_PUSHOVER_API_TOKEN;
  const user = process.env.ST0R_PUSHOVER_USER_KEY;
  if (!token || !user) {
    throw new Error('Pushover is not configured (set the user key and API token in Settings → Email & Alerts)');
  }
  const body = new URLSearchParams({ token, user, title, message, priority: critical ? '1' : '0' });
  const resp = await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Pushover returned HTTP ${resp.status}`);
}

/** Send one alert over the channels its rule selects. Returns per-channel errors. */
export async function notify(rule: AlertRule, alert: Pick<ActiveAlert, 'severity' | 'message'>): Promise<string[]> {
  const errors: string[] = [];
  const subject = `[St0r] ${alert.severity.toUpperCase()}: ${rule.name}`;
  const text = `${alert.message}\n\nRule: ${rule.name}\nTime: ${new Date().toISOString()}`;
  if (rule.notifyEmail) {
    try { await sendEmail(rule.emailTo, subject, text); } catch (err: any) { errors.push(`E-mail: ${err?.message || err}`); }
  }
  if (rule.notifyPushover) {
    try { await sendPushover(subject, alert.message, alert.severity === 'critical'); } catch (err: any) {
      errors.push(`Pushover: ${err?.message || err}`);
    }
  }
  return errors;
}

class AlertMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  readonly intervalMs = (parseInt(process.env.ST0R_ALERT_INTERVAL_MIN || '10', 10) || 10) * 60 * 1000;

  start(): void {
    if (this.timer) return;
    // First run after a minute so startup isn't slowed and UrBackup is reachable.
    setTimeout(() => this.check(), 60 * 1000).unref();
    this.timer = setInterval(() => this.check(), this.intervalMs);
    this.timer.unref();
    logger.info(`[Alerts] Monitor started (every ${this.intervalMs / 60000} min)`);
  }

  async check(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { alerts, rules } = await getActiveAlerts();
      const ruleByType = new Map(rules.map(r => [r.type, r]));
      const state = await query<any[]>('SELECT alert_key FROM alert_state');
      const known = new Set(state.map(s => s.alert_key));
      const activeKeys = new Set(alerts.map(a => a.key));

      for (const alert of alerts) {
        if (known.has(alert.key)) continue;
        const rule = ruleByType.get(alert.type)!;
        const errors = (rule.notifyEmail || rule.notifyPushover) ? await notify(rule, alert) : [];
        for (const e of errors) logger.warn(`[Alerts] ${alert.key}: ${e}`);
        // Record even on delivery failure, so a broken mail config logs once per
        // condition instead of every cycle.
        await query(
          'INSERT IGNORE INTO alert_state (alert_key, rule_type, notified_at) VALUES (?, ?, NOW())',
          [alert.key.slice(0, 512), alert.type]
        );
        logger.info(`[Alerts] Fired ${alert.key}: ${alert.message}`);
      }

      // Conditions that cleared: forget them so a recurrence notifies again.
      for (const key of known) {
        if (!activeKeys.has(key)) await query('DELETE FROM alert_state WHERE alert_key = ?', [key]);
      }
    } catch (err) {
      logger.error('[Alerts] Check failed:', err);
    } finally {
      this.running = false;
    }
  }
}

export const alertMonitor = new AlertMonitor();
