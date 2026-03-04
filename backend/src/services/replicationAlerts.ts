import nodemailer from 'nodemailer';
import { logger } from '../utils/logger.js';

export interface ReplicationEvent {
  id: string;
  target_id: string | null;
  type: string;
  severity: string;
  message: string;
}

export interface AlertChannel {
  id: string;
  type: 'email' | 'webhook';
  enabled: boolean;
  config_json: Record<string, any>;
}

// Rate limit: track last alert time per (targetId + type)
const lastAlertTime = new Map<string, number>();
const RATE_LIMIT_MS = 10 * 60 * 1000; // 10 minutes

export async function sendAlert(event: ReplicationEvent, channels: AlertChannel[]): Promise<void> {
  const rateLimitKey = `${event.target_id}:${event.type}`;
  const now = Date.now();
  const last = lastAlertTime.get(rateLimitKey) || 0;

  if (now - last < RATE_LIMIT_MS) {
    logger.debug(`[ReplicationAlerts] Rate limited: ${rateLimitKey}`);
    return;
  }

  lastAlertTime.set(rateLimitKey, now);

  for (const channel of channels) {
    if (!channel.enabled) continue;

    try {
      if (channel.type === 'email') {
        await sendEmail(event, channel.config_json);
      } else if (channel.type === 'webhook') {
        await sendWebhook(event, channel.config_json);
      }
    } catch (err) {
      logger.error(`[ReplicationAlerts] Failed to send via channel ${channel.id}:`, err);
    }
  }
}

async function sendEmail(event: ReplicationEvent, config: Record<string, any>): Promise<void> {
  const { host, port, secure, user, pass, from, to } = config;
  if (!to) {
    logger.warn('[ReplicationAlerts] Email channel missing "to" address');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: host || 'localhost',
    port: port || 25,
    secure: !!secure,
    auth: user && pass ? { user, pass } : undefined,
  });

  await transporter.sendMail({
    from: from || 'urbackup-gui@localhost',
    to,
    subject: `[St0r Replication] ${event.severity.toUpperCase()}: ${event.type}`,
    text: `Replication Alert\n\nSeverity: ${event.severity}\nType: ${event.type}\nMessage: ${event.message}\nTime: ${new Date().toISOString()}`,
  });

  logger.info(`[ReplicationAlerts] Email sent to ${to}`);
}

async function sendWebhook(event: ReplicationEvent, config: Record<string, any>): Promise<void> {
  const { url } = config;
  if (!url) {
    logger.warn('[ReplicationAlerts] Webhook channel missing "url"');
    return;
  }

  const payload = {
    source: 'urbackup-gui-replication',
    severity: event.severity,
    type: event.type,
    target_id: event.target_id,
    message: event.message,
    timestamp: new Date().toISOString(),
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    throw new Error(`Webhook returned ${resp.status}`);
  }

  logger.info(`[ReplicationAlerts] Webhook sent to ${url}`);
}
