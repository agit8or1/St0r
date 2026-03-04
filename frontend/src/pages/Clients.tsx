import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { HardDrive, Search, Settings, Users, ChevronUp, ChevronDown } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import { ClientManagementModal } from '../components/ClientManagementModal';
import { api } from '../services/api';
import type { Client, Customer, CustomerClient } from '../types';
import { formatTimeAgo, formatBytes } from '../utils/format';

type SortField = 'name' | 'lastBackup' | 'status' | 'customer';
type SortOrder = 'asc' | 'desc';

export function Clients() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [clientCustomers, setClientCustomers] = useState<Map<string, CustomerClient>>(new Map());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'online' | 'offline' | 'failed'>('all');
  const [selectedCustomer, setSelectedCustomer] = useState<number | 'all'>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState<Set<string>>(new Set());

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
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
    } catch (err) {
      console.error('Failed to load clients:', err);
    } finally {
      setLoading(false);
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
        (!c.file_ok || !c.image_ok)
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

  const onlineCount = clients.filter(c => c.online).length;
  const failedCount = clients.filter(c => !c.file_ok || !c.image_ok).length;

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
          <button onClick={() => setIsManageModalOpen(true)} className="btn bg-green-600 hover:bg-green-700 text-white flex items-center gap-2 text-sm">
            <Settings className="h-4 w-4" />
            Manage
          </button>
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
                    <th className="w-6 px-3 py-2" />
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100" onClick={() => handleSort('name')}>
                      Endpoint <SortIcon field="name" />
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100" onClick={() => handleSort('customer')}>
                      Customer <SortIcon field="customer" />
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100" onClick={() => handleSort('lastBackup')}>
                      Last File Backup <SortIcon field="lastBackup" />
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Last Image</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Storage</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Status</th>
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
                          <div className={`h-2 w-2 rounded-full ${client.online ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} title={client.online ? 'Online' : 'Offline'} />
                        </td>
                        {/* Name */}
                        <td className="px-3 py-2">
                          <span className="font-medium text-gray-900 dark:text-gray-100">{client.name}</span>
                        </td>
                        {/* Customer dropdown */}
                        <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <Users className="h-3 w-3 text-gray-400 flex-shrink-0" />
                            <select
                              value={mapping?.customer_id != null ? String(mapping.customer_id) : ''}
                              disabled={savingCustomer.has(client.name)}
                              onChange={async e => {
                                const val = e.target.value;
                                await handleAssignCustomer(client, val ? Number(val) : null);
                              }}
                              className="text-xs bg-transparent border-none text-primary-600 dark:text-primary-400 cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary-400 rounded px-0.5 disabled:opacity-50 max-w-[140px]"
                            >
                              <option value="">— Unassigned —</option>
                              {customers.map(c => (
                                <option key={c.id} value={String(c.id)}>{c.name}{c.company ? ` (${c.company})` : ''}</option>
                              ))}
                            </select>
                          </div>
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
                        {/* Storage */}
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {storage > 0 ? formatBytes(storage) : '—'}
                        </td>
                        {/* Status badges */}
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                              client.file_ok ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                            }`}>F</span>
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                              client.image_ok ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                            }`}>I</span>
                          </div>
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
    </Layout>
  );
}
