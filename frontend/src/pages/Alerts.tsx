import { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { Tooltip } from '../components/Tooltip';
import { Bell, Edit, Save, X, AlertTriangle, CheckCircle, Send } from 'lucide-react';
import { alertsApi, AlertRule, ActiveAlert, AlertRuleType } from '../services/api';
import { useAuth } from '../hooks/useAuth';

interface Alert extends ActiveAlert {
  acknowledged: boolean;
}

const ACK_STORAGE_KEY = 'st0r.alerts.acknowledged';
const DISMISS_STORAGE_KEY = 'st0r.alerts.dismissed';

function loadKeySet(storageKey: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(storageKey) || '[]')); } catch { return new Set(); }
}
function saveKeySet(storageKey: string, keys: Set<string>) {
  try { localStorage.setItem(storageKey, JSON.stringify([...keys])); } catch { /* storage unavailable */ }
}

function errorText(err: any, fallback: string): string {
  return err?.response?.data?.error || err?.message || fallback;
}

export function Alerts() {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const [activeAlerts, setActiveAlerts] = useState<Alert[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    loadRules();
    loadActiveAlerts();
  }, []);

  const loadRules = async () => {
    try {
      setAlertRules(await alertsApi.rules());
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err, 'Failed to load alert rules'));
    }
  };

  const loadActiveAlerts = async () => {
    try {
      const alerts = await alertsApi.active();
      const acked = loadKeySet(ACK_STORAGE_KEY);
      const dismissed = loadKeySet(DISMISS_STORAGE_KEY);
      const current = new Set(alerts.map(a => a.key));
      // Forget acknowledgements for conditions that have cleared, so a recurrence shows again.
      saveKeySet(ACK_STORAGE_KEY, new Set([...acked].filter(k => current.has(k))));
      saveKeySet(DISMISS_STORAGE_KEY, new Set([...dismissed].filter(k => current.has(k))));
      setActiveAlerts(alerts
        .filter(a => !dismissed.has(a.key))
        .map(a => ({ ...a, acknowledged: acked.has(a.key) })));
    } catch (err) {
      console.error('Failed to load alerts:', err);
    }
  };

  const handleAcknowledge = (key: string) => {
    const acked = loadKeySet(ACK_STORAGE_KEY);
    acked.add(key);
    saveKeySet(ACK_STORAGE_KEY, acked);
    setActiveAlerts(alerts => alerts.map(a => a.key === key ? { ...a, acknowledged: true } : a));
  };

  const handleDismiss = (key: string) => {
    const dismissed = loadKeySet(DISMISS_STORAGE_KEY);
    dismissed.add(key);
    saveKeySet(DISMISS_STORAGE_KEY, dismissed);
    setActiveAlerts(alerts => alerts.filter(a => a.key !== key));
  };

  const handleEditRule = (rule: AlertRule) => {
    setEditingRule({ ...rule });
    setModalError(null);
    setShowModal(true);
  };

  const saveRule = async (type: AlertRuleType, changes: Partial<AlertRule>): Promise<boolean> => {
    try {
      const saved = await alertsApi.updateRule(type, changes);
      setAlertRules(rules => rules.map(r => r.type === type ? saved : r));
      loadActiveAlerts();
      return true;
    } catch (err) {
      const msg = errorText(err, 'Failed to save alert rule');
      if (showModal) setModalError(msg); else setNotice({ ok: false, text: msg });
      return false;
    }
  };

  const handleSaveRule = async () => {
    if (!editingRule) return;
    setSaving(true);
    const { type, name, threshold, emailTo, notifyEmail, notifyPushover } = editingRule;
    const ok = await saveRule(type, {
      name, emailTo, notifyEmail, notifyPushover,
      ...(threshold !== null ? { threshold } : {}),
    });
    setSaving(false);
    if (ok) {
      setShowModal(false);
      setEditingRule(null);
      setNotice({ ok: true, text: `Saved "${name}"` });
    }
  };

  const handleToggleRule = async (rule: AlertRule) => {
    setNotice(null);
    await saveRule(rule.type, { enabled: !rule.enabled });
  };

  const handleTestRule = async (rule: AlertRule) => {
    setNotice(null);
    try {
      await alertsApi.testRule(rule.type);
      setNotice({ ok: true, text: `Test notification sent for "${rule.name}"` });
    } catch (err) {
      setNotice({ ok: false, text: errorText(err, 'Test notification failed') });
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800';
      case 'warning':
        return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 border-yellow-200 dark:border-yellow-800';
      default:
        return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800';
    }
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      backup_failure: 'Backup Failure',
      client_offline: 'Client Offline',
      storage_low: 'Storage Low',
      backup_old: 'Old Backup'
    };
    return labels[type] || type;
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
            <Bell className="h-8 w-8" />
            Alerts & Notifications
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Manage alerts and notification rules
          </p>
        </div>

        {/* Active Alerts */}
        <div className="card">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            Active Alerts{' '}
            <Tooltip text="Number of unacknowledged alerts currently requiring attention">
              <span className="inline-flex items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40 px-2 py-0.5 text-sm font-bold text-red-700 dark:text-red-300 cursor-default">
                {activeAlerts.filter(a => !a.acknowledged).length}
              </span>
            </Tooltip>
          </h2>

          {activeAlerts.filter(a => !a.acknowledged).length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="mx-auto h-12 w-12 text-green-600 dark:text-green-400" />
              <p className="mt-4 text-gray-600 dark:text-gray-400">No active alerts</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                All systems are operating normally
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeAlerts.filter(a => !a.acknowledged).map(alert => (
                <div
                  key={alert.key}
                  className={`p-4 rounded-lg border ${getSeverityColor(alert.severity)}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <AlertTriangle className="h-5 w-5 mt-0.5" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold">
                            {getTypeLabel(alert.type)}
                          </span>
                          <Tooltip text={
                            alert.severity === 'critical' ? 'CRITICAL — immediate action required; backup or service is failing' :
                            alert.severity === 'warning' ? 'WARNING — something needs attention soon but is not yet critical' :
                            'INFO — informational notice; no immediate action required'
                          }>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-white dark:bg-gray-800 cursor-default">
                              {alert.severity.toUpperCase()}
                            </span>
                          </Tooltip>
                        </div>
                        <p className="text-sm">{alert.message}</p>
                        <p className="text-xs mt-1 opacity-75">
                          {alert.since ? `Since ${new Date(alert.since).toLocaleString()}` : 'Current'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Tooltip text="Mark as acknowledged — alert moves to history but stays visible">
                        <button
                          onClick={() => handleAcknowledge(alert.key)}
                          className="px-3 py-1 text-sm rounded-sm bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          Acknowledge
                        </button>
                      </Tooltip>
                      <Tooltip text="Permanently dismiss this alert">
                        <button
                          onClick={() => handleDismiss(alert.key)}
                          className="px-3 py-1 text-sm rounded-sm bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          Dismiss
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Alert Rules */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Alert Rules
            </h2>
          </div>

          {loadError && (
            <div className="mb-3 p-3 rounded-sm bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 text-sm">{loadError}</div>
          )}
          {notice && (
            <div className={`mb-3 p-3 rounded-sm text-sm ${notice.ok ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200' : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'}`}>
              {notice.text}
            </div>
          )}
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
            Rules are checked on the server every 10 minutes. E-mail uses the mail server and admin address from
            Settings → Email &amp; Alerts; Pushover uses the keys configured there.
          </p>

          <div className="space-y-3">
            {alertRules.map(rule => (
              <div
                key={rule.type}
                className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg"
              >
                <div className="flex items-center gap-4 flex-1">
                  <Tooltip text={rule.enabled ? 'Rule is enabled — click to disable' : 'Rule is disabled — click to enable'}>
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={() => handleToggleRule(rule)}
                      disabled={!isAdmin}
                      className="h-5 w-5 rounded-sm border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                  </Tooltip>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-900 dark:text-gray-100">
                        {rule.name}
                      </h3>
                      <Tooltip text={
                        rule.type === 'backup_failure' ? 'Triggers when a client backup job fails' :
                        rule.type === 'client_offline' ? 'Triggers when a client has not been seen for the specified number of hours' :
                        rule.type === 'storage_low' ? 'Triggers when backup storage usage exceeds the specified percentage' :
                        'Triggers when no successful backup exists within the specified number of days'
                      }>
                        <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-300 cursor-default">
                          {getTypeLabel(rule.type)}
                        </span>
                      </Tooltip>
                    </div>
                    <div className="flex gap-4 mt-1 text-sm text-gray-600 dark:text-gray-400">
                      {rule.threshold !== null && (
                        <Tooltip text={
                          rule.type === 'storage_low' ? `Alert fires when storage usage exceeds ${rule.threshold}%` :
                          rule.type === 'client_offline' ? `Alert fires when a client has been offline for more than ${rule.threshold} hours` :
                          `Alert fires when the most recent backup is older than ${rule.threshold} days`
                        }>
                          <span className="cursor-default">Threshold: {rule.threshold} {rule.type === 'storage_low' ? '%' : rule.type === 'client_offline' ? 'hours' : 'days'}</span>
                        </Tooltip>
                      )}
                      <span>
                        {rule.notifyEmail && '📧 Email'}
                        {rule.notifyEmail && rule.notifyPushover && ' • '}
                        {rule.notifyPushover && '📱 Pushover'}
                      </span>
                    </div>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex gap-1">
                    {(rule.notifyEmail || rule.notifyPushover) && (
                      <Tooltip text="Send a test notification over this rule's channels">
                        <button
                          onClick={() => handleTestRule(rule)}
                          className="p-2 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-sm"
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      </Tooltip>
                    )}
                    <Tooltip text="Edit this alert rule">
                      <button
                        onClick={() => handleEditRule(rule)}
                        className="p-2 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-sm"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                    </Tooltip>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Acknowledged Alerts */}
        {activeAlerts.filter(a => a.acknowledged).length > 0 && (
          <div className="card">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Acknowledged Alerts
            </h2>
            <div className="space-y-2">
              {activeAlerts.filter(a => a.acknowledged).map(alert => (
                <div
                  key={alert.key}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg opacity-60"
                >
                  <div className="flex-1">
                    <p className="text-sm text-gray-900 dark:text-gray-100">{alert.message}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {alert.since ? `Since ${new Date(alert.since).toLocaleString()}` : 'Current'}
                    </p>
                  </div>
                  <Tooltip text="Remove from acknowledged alerts">
                    <button
                      onClick={() => handleDismiss(alert.key)}
                      className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </Tooltip>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Edit Rule Modal */}
      {showModal && editingRule && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              Edit Alert Rule
            </h2>

            <div className="space-y-4">
              <div>
                <label className="label">Rule Name</label>
                <input
                  type="text"
                  value={editingRule.name}
                  onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
                  className="input"
                />
              </div>

              {editingRule.threshold !== null && (
                <div>
                  <label className="label">
                    Threshold ({editingRule.type === 'storage_low' ? '%' : editingRule.type === 'client_offline' ? 'hours' : 'days'})
                  </label>
                  <input
                    type="number"
                    value={editingRule.threshold}
                    min={1}
                    max={editingRule.type === 'storage_low' ? 100 : undefined}
                    onChange={(e) => setEditingRule({ ...editingRule, threshold: Number(e.target.value) })}
                    className="input"
                  />
                </div>
              )}

              <div>
                <label className="label">Email To (optional — defaults to the admin address in Settings)</label>
                <input
                  type="text"
                  placeholder="admin address from Settings"
                  value={editingRule.emailTo || ''}
                  onChange={(e) => setEditingRule({ ...editingRule, emailTo: e.target.value })}
                  className="input"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="notifyEmail"
                    checked={editingRule.notifyEmail}
                    onChange={(e) => setEditingRule({ ...editingRule, notifyEmail: e.target.checked })}
                    className="h-4 w-4 rounded-sm border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label htmlFor="notifyEmail" className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Send Email Notifications
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="notifyPushover"
                    checked={editingRule.notifyPushover}
                    onChange={(e) => setEditingRule({ ...editingRule, notifyPushover: e.target.checked })}
                    className="h-4 w-4 rounded-sm border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label htmlFor="notifyPushover" className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Send Pushover Notifications
                  </label>
                </div>
              </div>
            </div>

            {modalError && (
              <div className="mt-4 p-3 rounded-sm bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 text-sm">{modalError}</div>
            )}

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => { setShowModal(false); setEditingRule(null); }}
                className="btn btn-secondary flex items-center gap-2"
              >
                <X className="h-4 w-4" />
                Cancel
              </button>
              <button
                onClick={handleSaveRule}
                disabled={saving}
                className="btn btn-primary flex items-center gap-2"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
