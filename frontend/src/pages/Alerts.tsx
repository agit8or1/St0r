import { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { Bell, Plus, Edit, Trash2, Save, X, AlertTriangle, CheckCircle } from 'lucide-react';
import { api } from '../services/api';

interface AlertRule {
  id: number;
  name: string;
  type: 'backup_failure' | 'client_offline' | 'storage_low' | 'backup_old';
  enabled: boolean;
  threshold?: number;
  notifyEmail: boolean;
  notifyPushover: boolean;
  emailTo?: string;
}

interface Alert {
  id: number;
  type: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  clientName?: string;
  timestamp: string;
  acknowledged: boolean;
}

export function Alerts() {
  const [activeAlerts, setActiveAlerts] = useState<Alert[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([
    {
      id: 1,
      name: 'Backup Failure Alert',
      type: 'backup_failure',
      enabled: true,
      notifyEmail: true,
      notifyPushover: false,
      emailTo: 'admin@example.com'
    },
    {
      id: 2,
      name: 'Client Offline Alert',
      type: 'client_offline',
      enabled: true,
      threshold: 24,
      notifyEmail: true,
      notifyPushover: true,
      emailTo: 'admin@example.com'
    },
    {
      id: 3,
      name: 'Storage Low Alert',
      type: 'storage_low',
      enabled: false,
      threshold: 90,
      notifyEmail: true,
      notifyPushover: false,
      emailTo: 'admin@example.com'
    },
    {
      id: 4,
      name: 'Old Backup Alert',
      type: 'backup_old',
      enabled: true,
      threshold: 7,
      notifyEmail: true,
      notifyPushover: false,
      emailTo: 'admin@example.com'
    }
  ]);
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);

  useEffect(() => {
    loadActiveAlerts();
  }, []);

  const loadActiveAlerts = async () => {
    try {
      // Generate sample alerts based on actual client status
      const clients = await api.getClients();
      const alerts: Alert[] = [];

      // Check for failed backups
      clients.forEach(client => {
        if (!client.file_ok && !client.image_ok) {
          alerts.push({
            id: Math.random(),
            type: 'backup_failure',
            severity: 'critical',
            message: `Backup failed for client ${client.name}`,
            clientName: client.name,
            timestamp: new Date().toISOString(),
            acknowledged: false
          });
        }
      });

      // Check for offline clients
      clients.forEach(client => {
        if (!client.online) {
          alerts.push({
            id: Math.random(),
            type: 'client_offline',
            severity: 'warning',
            message: `Client ${client.name} is offline`,
            clientName: client.name,
            timestamp: new Date().toISOString(),
            acknowledged: false
          });
        }
      });

      setActiveAlerts(alerts);
    } catch (err) {
      console.error('Failed to load alerts:', err);
    }
  };

  const handleAcknowledge = (alertId: number) => {
    setActiveAlerts(alerts =>
      alerts.map(a => a.id === alertId ? { ...a, acknowledged: true } : a)
    );
  };

  const handleDismiss = (alertId: number) => {
    setActiveAlerts(alerts => alerts.filter(a => a.id !== alertId));
  };

  const handleEditRule = (rule: AlertRule) => {
    setEditingRule(rule);
    setShowModal(true);
  };

  const handleSaveRule = () => {
    if (!editingRule) return;

    setAlertRules(rules =>
      rules.map(r => r.id === editingRule.id ? editingRule : r)
    );
    setShowModal(false);
    setEditingRule(null);
  };

  const handleToggleRule = (ruleId: number) => {
    setAlertRules(rules =>
      rules.map(r => r.id === ruleId ? { ...r, enabled: !r.enabled } : r)
    );
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
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Active Alerts ({activeAlerts.filter(a => !a.acknowledged).length})
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
                  key={alert.id}
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
                          <span className="text-xs px-2 py-0.5 rounded-full bg-white dark:bg-gray-800">
                            {alert.severity.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-sm">{alert.message}</p>
                        <p className="text-xs mt-1 opacity-75">
                          {new Date(alert.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAcknowledge(alert.id)}
                        className="px-3 py-1 text-sm rounded bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        Acknowledge
                      </button>
                      <button
                        onClick={() => handleDismiss(alert.id)}
                        className="px-3 py-1 text-sm rounded bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        Dismiss
                      </button>
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

          <div className="space-y-3">
            {alertRules.map(rule => (
              <div
                key={rule.id}
                className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg"
              >
                <div className="flex items-center gap-4 flex-1">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={() => handleToggleRule(rule.id)}
                    className="h-5 w-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100">
                      {rule.name}
                    </h3>
                    <div className="flex gap-4 mt-1 text-sm text-gray-600 dark:text-gray-400">
                      {rule.threshold && (
                        <span>Threshold: {rule.threshold} {rule.type === 'storage_low' ? '%' : rule.type === 'client_offline' ? 'hours' : 'days'}</span>
                      )}
                      <span>
                        {rule.notifyEmail && '📧 Email'}
                        {rule.notifyEmail && rule.notifyPushover && ' • '}
                        {rule.notifyPushover && '📱 Pushover'}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleEditRule(rule)}
                  className="p-2 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded"
                >
                  <Edit className="h-4 w-4" />
                </button>
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
                  key={alert.id}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg opacity-60"
                >
                  <div className="flex-1">
                    <p className="text-sm text-gray-900 dark:text-gray-100">{alert.message}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {new Date(alert.timestamp).toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDismiss(alert.id)}
                    className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Edit Rule Modal */}
      {showModal && editingRule && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
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

              {editingRule.threshold !== undefined && (
                <div>
                  <label className="label">
                    Threshold ({editingRule.type === 'storage_low' ? '%' : editingRule.type === 'client_offline' ? 'hours' : 'days'})
                  </label>
                  <input
                    type="number"
                    value={editingRule.threshold}
                    onChange={(e) => setEditingRule({ ...editingRule, threshold: Number(e.target.value) })}
                    className="input"
                  />
                </div>
              )}

              <div>
                <label className="label">Email To</label>
                <input
                  type="email"
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
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
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
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label htmlFor="notifyPushover" className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Send Pushover Notifications
                  </label>
                </div>
              </div>
            </div>

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
                className="btn btn-primary flex items-center gap-2"
              >
                <Save className="h-4 w-4" />
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
