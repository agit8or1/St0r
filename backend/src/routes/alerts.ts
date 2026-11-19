import { Router, Response } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { scopeOf, isClientVisible } from '../middleware/scope.js';
import { logger } from '../utils/logger.js';
import {
  getAlertRules, updateAlertRule, validateRuleUpdate, getActiveAlerts, notify, AlertRuleType,
} from '../services/alertRules.js';

const router = Router();
router.use(authenticate);

router.get('/rules', async (_req: AuthRequest, res: Response) => {
  try {
    res.json(await getAlertRules());
  } catch (err) {
    logger.error('Failed to load alert rules:', err);
    res.status(500).json({ error: 'Failed to load alert rules' });
  }
});

router.put('/rules/:type', requireAdmin, async (req: AuthRequest, res: Response) => {
  const type = String(req.params.type);
  const error = validateRuleUpdate(type, req.body || {});
  if (error) {
    res.status(400).json({ error });
    return;
  }
  try {
    const rule = await updateAlertRule(type as AlertRuleType, req.body);
    logger.info(`Alert rule ${type} updated by ${req.user?.username || 'unknown'}`);
    res.json(rule);
  } catch (err) {
    logger.error('Failed to save alert rule:', err);
    res.status(500).json({ error: 'Failed to save alert rule' });
  }
});

/** Send a test notification over the rule's selected channels. */
router.post('/rules/:type/test', requireAdmin, async (req: AuthRequest, res: Response) => {
  const type = String(req.params.type);
  const rule = (await getAlertRules().catch(() => [])).find(r => r.type === type);
  if (!rule) {
    res.status(404).json({ error: 'Unknown alert rule' });
    return;
  }
  if (!rule.notifyEmail && !rule.notifyPushover) {
    res.status(400).json({ error: 'This rule has no notification channel selected' });
    return;
  }
  const errors = await notify(rule, { severity: 'warning', message: `Test notification for "${rule.name}" from St0r.` });
  if (errors.length) {
    res.status(502).json({ error: errors.join('; ') });
    return;
  }
  res.json({ success: true });
});

router.get('/active', async (req: AuthRequest, res: Response) => {
  try {
    const scope = await scopeOf(req);
    const { alerts } = await getActiveAlerts();
    // Customer-scoped users only see their own clients; server-wide alerts
    // (storage) are for administrators.
    res.json(alerts.filter(a => (a.clientName ? isClientVisible(scope, a.clientName) : scope.isAdmin)));
  } catch (err) {
    logger.error('Failed to evaluate alerts:', err);
    res.status(500).json({ error: 'Failed to evaluate alerts' });
  }
});

export default router;
