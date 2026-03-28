import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { HardDrive, Search, Settings, Users, ChevronUp, ChevronDown, AlertTriangle, XCircle, Edit2, RefreshCw } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import { ClientManagementModal } from '../components/ClientManagementModal';
import { Tooltip } from '../components/Tooltip';
import { api } from '../services/api';
import type { Client, Customer, CustomerClient, StorageLimitStatus } from '../types';
import { formatTimeAgo, formatBytes } from '../utils/format';

type SortField = 'name' | 'lastBackup' | 'status' | 'customer';
type SortOrder = 'asc' | 'desc';

function StorageLimitCell({ storage, limitStatus, onEdit }: {
  storage: number;
  limitStatus?: StorageLimitStatus;
  onEdit: (e: React.MouseEvent) => void;
}) {
  const usedStr = storage > 0 ? formatBytes(storage) : '—';

  if (!limitStatus?.has_limit || !limitStatus.limit_bytes) {
    return (
      <div className="flex items-center gap-1 group">
        <span className="text-gray-600 dark:text-gray-400 text-sm">{usedStr}</span>
        <Tooltip text="Set a storage limit for this endpoint">
          <button onClick={onEdit} className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700">
            <Edit2 className="h-3 w-3 text-gray-400" />
          </button>
        </Tooltip>
      </div>
    );
  }

  const { pct = 0, status, limit_bytes } = limitStatus;
  const barColor = status === 'exceeded' || status === 'critical'
    ? 'bg-red-500'
    : status === 'warning'
    ? 'bg-yellow-400'
    : 'bg-green-500';
  const textColor = status === 'exceeded' || status === 'critical'
    ? 'text-red-600 dark:text-red-400'
    : status === 'warning'
    ? 'text-yellow-600 dark:text-yellow-400'
    : 'text-gray-600 dark:text-gray-400';

  return (
    <div className="flex items-center gap-1.5 min-w-[120px] group">
      <div className="flex-1 min-w-[60px]">
        <div className="flex items-center justify-between mb-0.5">
          <span className={`text-xs font-medium ${textColor}`}>{usedStr}</span>
          <span className="text-xs text-gray-400">/ {formatBytes(limit_bytes)}</span>
        </div>
        <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      </div>
      {(status === 'warning') && (
        <Tooltip text="Storage usage is approaching the limit">
          <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />
        </Tooltip>
      )}
      {(status === 'critical' || status === 'exceeded') && (
        <Tooltip text="Storage limit exceeded or critically full">
          <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
        </Tooltip>
      )}
      <Tooltip text="Edit storage limit">
        <button onClick={onEdit} className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700">
          <Edit2 className="h-3 w-3 text-gray-400" />
        </button>
      </Tooltip>
    </div>
  );
}

export function Clients() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [clientCustomers, setClientCustomers] = useState<Map<string, CustomerClient>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'online' | 'offline' | 'failed'>('all');
  const [selectedCustomer, setSelectedCustomer] = useState<number | 'all'>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState<Set<string>>(new Set());
  const [storageLimitStatuses, setStorageLimitStatuses] = useState<Map<string, StorageLimitStatus>>(new Map());
  const [limitModal, setLimitModal] = useState<{ client: Client } | null>(null);
  const [limitInput, setLimitInput] = useState('');
  const [limitUnit, setLimitUnit] = useState<'GB' | 'TB'>('GB');
  const [limitWarn, setLimitWarn] = useState(80);
  const [limitCritical, setLimitCritical] = useState(95);
  const [savingLimit, setSavingLimit] = useState(false);
  const limitInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (clients.length > 0) loadStorageLimitStatuses(); }, [clients]);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [clientData, customerData] = await Promise.all([
        api.getClients(),
        api.getCustomers(),
      ]);
      setClients(clientData);
      setCustomers(customerData);

      const mappings = new Map<string, CustomerClient>();
      await Promise.all(clientData.map(async (client) => {
        try {
          const mapping = await api.getClientCustomer(1, client.name);
          if (mapping) mappings.set(client.name, mapping);
        } catch {}
      }));
      setClientCustomers(mappings);
    } catch (err: any) {
      console.error('Failed to load clients:', err);
      const msg = err?.response?.data?.error || err?.message || 'Unknown error';
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  };

  const loadStorageLimitStatuses = async () => {
    try {
      const clientsPayload = clients.map(c => ({
        name: c.name,
        bytes_used: (c.bytes_used_files || 0) + (c.bytes_used_images || 0),
      }));
      const statuses = await api.getStorageLimitStatuses(clientsPayload);
      const map = new Map<string, StorageLimitStatus>();
      statuses.forEach(s => map.set(s.name, s));
      setStorageLimitStatuses(map);
    } catch {}
  };

  const openLimitModal = (client: Client, e: React.MouseEvent) => {
    e.stopPropagation();
    const existing = storageLimitStatuses.get(client.name);
    if (existing?.has_limit && existing.limit_bytes) {
      const gb = existing.limit_bytes / 1e9;
      if (gb >= 1000) {
        setLimitUnit('TB');
        setLimitInput(String(+(gb / 1000).toFixed(2)));
      } else {
        setLimitUnit('GB');
        setLimitInput(String(+gb.toFixed(2)));
      }
      setLimitWarn(existing.warn_threshold_pct ?? 80);
      setLimitCritical(existing.critical_threshold_pct ?? 95);
    } else {
      setLimitInput('');
      setLimitUnit('GB');
      setLimitWarn(80);
      setLimitCritical(95);
    }
    setLimitModal({ client });
    setTimeout(() => limitInputRef.current?.focus(), 50);
  };

  const saveLimit = async () => {
    if (!limitModal) return;
    const val = parseFloat(limitInput);
    if (!val || val <= 0) return;
    setSavingLimit(true);
    try {
      const bytes = Math.round(val * (limitUnit === 'TB' ? 1e12 : 1e9));
      await api.upsertStorageLimit(limitModal.client.name, {
        limit_bytes: bytes,
        warn_threshold_pct: limitWarn,
        critical_threshold_pct: limitCritical,
      });
      setLimitModal(null);
      await loadStorageLimitStatuses();
    } catch (err) {
      console.error('Failed to save storage limit:', err);
    } finally {
      setSavingLimit(false);
    }
  };

  const removeLimit = async () => {
    if (!limitModal) return;
    setSavingLimit(true);
    try {
      await api.deleteStorageLimit(limitModal.client.name);
      setLimitModal(null);
      await loadStorageLimitStatuses();
    } catch (err) {
      console.error('Failed to remove storage limit:', err);
    } finally {
      setSavingLimit(false);
    }
  };

  const handleAssignCustomer = async (client: Client, newCustomerId: number | null) => {
    const existing = clientCustomers.get(client.name);
    if (existing?.customer_id === newCustomerId) return;
    setSavingCustomer(prev => new Set(prev).add(client.name));
    try {
      if (existing) await api.removeClientFromCustomer(existing.customer_id, existing.id);
      if (newCustomerId !== null) {
        const newMapping = await api.addClientToCustomer(newCustomerId, {
          server_id: 1, client_name: client.name, client_id: client.id,
        });
        const customer = customers.find(c => c.id === newCustomerId);
        setClientCustomers(prev => new Map(prev).set(client.name, {
          ...newMapping, customer_id: newCustomerId,
          customer_name: customer?.name, customer_company: customer?.company,
        }));
      } else {
        setClientCustomers(prev => { const n = new Map(prev); n.delete(client.name); return n; });
      }
    } catch (err) {
      console.error('Failed to assign customer:', err);
    } finally {
      setSavingCustomer(prev => { const n = new Set(prev); n.delete(client.name); return n; });
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortOrder('asc'); }
  };

  const filtered = useMemo(() => {
    let result = [...clients];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c => c.name.toLowerCase().includes(q) || clientCustomers.get(c.name)?.customer_name?.toLowerCase().includes(q));
    }
    if (filterStatus !== 'all') {
      result = result.filter(c =>
        filterStatus === 'online' ? c.online :
        filterStatus === 'offline' ? !c.online :
        (hasFileProblem(c) || hasImageProblem(c))
      );
    }
    if (selectedCustomer !== 'all') {
      result = result.filter(c => clientCustomers.get(c.name)?.customer_id === selectedCustomer);
    }
    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'lastBackup') cmp = (b.lastbackup || 0) - (a.lastbackup || 0);
      else if (sortField === 'status') cmp = (b.online ? 1 : 0) - (a.online ? 1 : 0);
      else if (sortField === 'customer') {
        const ac = clientCustomers.get(a.name)?.customer_name || '';
        const bc = clientCustomers.get(b.name)?.customer_name || '';
        cmp = ac.localeCompare(bc);
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [clients, searchQuery, filterStatus, selectedCustomer, sortField, sortOrder, clientCustomers]);

  const hasFileProblem = (c: Client) => !c.file_ok || !(c as any).lastbackup;
  const hasImageProblem = (c: Client) => !(c as any).lastbackup_image || !c.image_ok;
  const onlineCount = clients.filter(c => c.online).length;
  const failedCount = clients.filter(c => hasFileProblem(c) || hasImageProblem(c)).length;

  const SortIcon = ({ field }: { field: SortField }) => (
    sortField === field
      ? sortOrder === 'asc' ? <ChevronUp className="h-3 w-3 inline" /> : <ChevronDown className="h-3 w-3 inline" />
      : <span className="h-3 w-3 inline-block" />
  );

  return (
    <Layout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Endpoints</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {clients.length} total · {onlineCount} online · {failedCount} failed
            </p>
          </div>
          <Tooltip text="Add or remove endpoints from UrBackup">
            <button onClick={() => setIsManageModalOpen(true)} className="btn bg-green-600 hover:bg-green-700 text-white flex items-center gap-2 text-sm">
              <Settings className="h-4 w-4" />
              Manage
            </button>
          </Tooltip>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search endpoints or customers…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="input pl-8 py-1.5 text-sm"
            />
          </div>
          <div className="flex gap-1">
            {(['all', 'online', 'offline', 'failed'] as const).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 text-sm rounded font-medium transition-colors ${
                  filterStatus === s
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <select
            value={selectedCustomer}
            onChange={e => setSelectedCustomer(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="input py-1.5 text-sm w-auto"
          >
            <option value="all">All Customers</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ''}</option>
            ))}
          </select>
        </div>

        {/* Storage limit warnings */}
        {(() => {
          const warnings = [...storageLimitStatuses.values()].filter(s => s.has_limit && (s.status === 'warning' || s.status === 'critical' || s.status === 'exceeded'));
          if (warnings.length === 0) return null;
          const critical = warnings.filter(s => s.status === 'critical' || s.status === 'exceeded');
          const warn = warnings.filter(s => s.status === 'warning');
          return (
            <div className={`flex items-start gap-2 px-3 py-2 rounded-lg text-sm ${critical.length > 0 ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800' : 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800'}`}>
              {critical.length > 0 ? <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />}
              <span>
                {critical.length > 0 && <><strong>{critical.map(s => s.name).join(', ')}</strong> {critical.length === 1 ? 'has' : 'have'} exceeded or critically exceeded storage limits. </>}
                {warn.length > 0 && <><strong>{warn.map(s => s.name).join(', ')}</strong> {warn.length === 1 ? 'is' : 'are'} approaching storage limits.</>}
              </span>
            </div>
          );
        })()}

        {/* Error banner */}
        {loadError && (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
            <div className="flex items-start gap-3">
              <XCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-700 dark:text-red-300">Failed to load endpoints</p>
                <p className="mt-1 text-xs text-red-600 dark:text-red-400 font-mono break-all">{loadError}</p>
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                  Common cause: St0r cannot read <code className="bg-red-100 dark:bg-red-900/40 px-1 rounded">/var/urbackup/backup_server.db</code>.
                  Run: <code className="bg-red-100 dark:bg-red-900/40 px-1 rounded">sudo chmod 644 /var/urbackup/backup_server.db</code> or add the service user to the <code className="bg-red-100 dark:bg-red-900/40 px-1 rounded">urbackup</code> group.
                </p>
              </div>
              <button onClick={loadData} className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200 flex-shrink-0">
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        {loading ? <Loading /> : filtered.length === 0 ? (
          <div className="card text-center py-10">
            <HardDrive className="mx-auto h-10 w-10 text-gray-400" />
            <p className="mt-3 text-gray-500 dark:text-gray-400">No endpoints found</p>
          </div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="w-4 px-1 py-2" />
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100" onClick={() => handleSort('name')}>
                      Endpoint <SortIcon field="name" />
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">
                      Customer
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100" onClick={() => handleSort('lastBackup')}>
                      Last File Backup <SortIcon field="lastBackup" />
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Last Image</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Storage / Limit</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">IP Address</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100" onClick={() => handleSort('status')}>
                      Status <SortIcon field="status" />
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Last Seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filtered.map(client => {
                    const mapping = clientCustomers.get(client.name);
                    const storage = (client.bytes_used_files || 0) + (client.bytes_used_images || 0);
                    return (
                      <tr
                        key={client.id}
                        onClick={() => navigate(`/clients/${encodeURIComponent(client.name)}`)}
                        className="hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
                      >
                        {/* Online dot */}
                        <td className="px-3 py-2">
                          <Tooltip text={client.online ? 'Endpoint is online' : 'Endpoint is offline'} position="right">
                            <div className={`h-2 w-2 rounded-full ${client.online ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                          </Tooltip>
                        </td>
                        {/* Name */}
                        <td className="px-3 py-2">
                          <span className="font-medium text-gray-900 dark:text-gray-100">{client.name}</span>
                          {client.client_version_string && (
                            <div className="text-xs text-gray-400 dark:text-gray-500 font-mono mt-0.5">{client.client_version_string}</div>
                          )}
                        </td>
                        {/* Customer (read-only) */}
                        <td className="px-3 py-2">
                          {mapping?.customer_name ? (
                            <div className="flex items-center gap-1">
                              <Users className="h-3 w-3 text-gray-400 flex-shrink-0" />
                              <span className="text-xs text-primary-600 dark:text-primary-400">{mapping.customer_name}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        {/* Last file backup */}
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          <span className={!client.file_ok && client.lastbackup ? 'text-red-500' : ''}>
                            {client.lastbackup ? formatTimeAgo(client.lastbackup) : '—'}
                          </span>
                        </td>
                        {/* Last image backup */}
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          <span className={!client.image_ok && client.lastbackup_image ? 'text-red-500' : ''}>
                            {client.lastbackup_image ? formatTimeAgo(client.lastbackup_image) : '—'}
                          </span>
                        </td>
                        {/* Storage / Limit */}
                        <td className="px-3 py-2 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <StorageLimitCell
                            storage={storage}
                            limitStatus={storageLimitStatuses.get(client.name)}
                            onEdit={e => openLimitModal(client, e)}
                          />
                        </td>
                        {/* IP Address */}
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap font-mono text-xs">
                          {client.ip || '—'}
                        </td>
                        {/* Status badges */}
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-0.5">
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium w-fit ${
                              client.online ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                            }`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${client.online ? 'bg-green-500' : 'bg-gray-400'}`} />
                              {client.online ? 'Online' : 'Offline'}
                            </span>
                            <div className="flex gap-1">
                              <Tooltip text={hasFileProblem(client) ? 'File backup has a problem' : 'File backup is OK'}>
                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                  !hasFileProblem(client) ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                                }`}>F</span>
                              </Tooltip>
                              <Tooltip text={hasImageProblem(client) ? 'Image backup has a problem' : 'Image backup is OK'}>
                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                  !hasImageProblem(client) ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                                }`}>I</span>
                              </Tooltip>
                            </div>
                          </div>
                        </td>
                        {/* Last Seen */}
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                          {client.lastseen ? formatTimeAgo(client.lastseen) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
              {filtered.length} of {clients.length} endpoints · F = File backup · I = Image backup
            </div>
          </div>
        )}
      </div>

      <ClientManagementModal
        isOpen={isManageModalOpen}
        onClose={() => setIsManageModalOpen(false)}
        clients={clients}
        onClientAdded={loadData}
        onClientRemoved={loadData}
      />

      {/* Storage Limit Modal */}
      {limitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setLimitModal(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Storage Limit — {limitModal.client.name}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Limit</label>
                <div className="flex gap-2">
                  <input
                    ref={limitInputRef}
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={limitInput}
                    onChange={e => setLimitInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveLimit()}
                    placeholder="e.g. 500"
                    className="input flex-1 text-sm"
                  />
                  <select value={limitUnit} onChange={e => setLimitUnit(e.target.value as 'GB' | 'TB')} className="input w-20 text-sm">
                    <option value="GB">GB</option>
                    <option value="TB">TB</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Warn at %</label>
                  <input type="number" min="1" max="99" value={limitWarn} onChange={e => setLimitWarn(Number(e.target.value))} className="input text-sm w-full" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Critical at %</label>
                  <input type="number" min="1" max="100" value={limitCritical} onChange={e => setLimitCritical(Number(e.target.value))} className="input text-sm w-full" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={saveLimit} disabled={savingLimit || !limitInput} className="btn bg-primary-600 hover:bg-primary-700 text-white flex-1 text-sm disabled:opacity-50">
                  {savingLimit ? 'Saving…' : 'Save Limit'}
                </button>
                {storageLimitStatuses.get(limitModal.client.name)?.has_limit && (
                  <button onClick={removeLimit} disabled={savingLimit} className="btn bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-red-300 text-sm disabled:opacity-50">
                    Remove
                  </button>
                )}
                <button onClick={() => setLimitModal(null)} className="btn bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
