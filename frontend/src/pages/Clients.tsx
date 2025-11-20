import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { HardDrive, Circle, ChevronRight, Search, SlidersHorizontal, Users, Settings } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import { ClientManagementModal } from '../components/ClientManagementModal';
import { api } from '../services/api';
import type { Client, Customer, CustomerClient } from '../types';
import { formatTimeAgo, formatBytes } from '../utils/format';
import { getClientStatusText } from '../utils/status';

type SortField = 'name' | 'lastBackup' | 'status' | 'customer';
type SortOrder = 'asc' | 'desc';

export function Clients() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [clientCustomers, setClientCustomers] = useState<Map<string, CustomerClient>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'online' | 'offline' | 'failed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<number | 'all'>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [groupByCustomer, setGroupByCustomer] = useState(true);
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, [filter]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load clients
      let clientData: Client[];
      switch (filter) {
        case 'online':
          clientData = await api.getOnlineClients();
          break;
        case 'offline':
          clientData = await api.getOfflineClients();
          break;
        case 'failed':
          clientData = await api.getFailedClients();
          break;
        default:
          clientData = await api.getClients();
      }
      setClients(clientData);

      // Load customers
      const customerData = await api.getCustomers();
      setCustomers(customerData);

      // Load customer-client mappings (assuming server ID 1 for now)
      const mappings = new Map<string, CustomerClient>();
      for (const client of clientData) {
        try {
          const mapping = await api.getClientCustomer(1, client.name);
          if (mapping) {
            mappings.set(client.name, mapping);
          }
        } catch (err) {
          // Client not assigned to customer
        }
      }
      setClientCustomers(mappings);
    } catch (err) {
      console.error('Failed to load clients:', err);
    } finally {
      setLoading(false);
    }
  };

  // Filter and sort clients
  const filteredAndSortedClients = useMemo(() => {
    let result = [...clients];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (client) =>
          client.name.toLowerCase().includes(query) ||
          client.ip?.toLowerCase().includes(query) ||
          (typeof client.status === 'string' && client.status.toLowerCase().includes(query))
      );
    }

    // Apply customer filter
    if (selectedCustomer !== 'all') {
      result = result.filter((client) => {
        const mapping = clientCustomers.get(client.name);
        return mapping?.customer_id === selectedCustomer;
      });
    }

    // Sort clients
    result.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'lastBackup':
          comparison = (b.lastbackup || 0) - (a.lastbackup || 0);
          break;
        case 'status':
          const aOnline = a.online ? 1 : 0;
          const bOnline = b.online ? 1 : 0;
          comparison = bOnline - aOnline;
          break;
        case 'customer':
          const aCustomer = clientCustomers.get(a.name)?.customer_name || 'Unassigned';
          const bCustomer = clientCustomers.get(b.name)?.customer_name || 'Unassigned';
          comparison = aCustomer.localeCompare(bCustomer);
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [clients, searchQuery, selectedCustomer, sortField, sortOrder, clientCustomers]);

  // Group clients by customer
  const groupedClients = useMemo(() => {
    if (!groupByCustomer) {
      return { Unassigned: filteredAndSortedClients };
    }

    const groups: Record<string, Client[]> = {};

    filteredAndSortedClients.forEach((client) => {
      const mapping = clientCustomers.get(client.name);
      const groupName = mapping?.customer_name || 'Unassigned';

      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(client);
    });

    return groups;
  }, [filteredAndSortedClients, groupByCustomer, clientCustomers]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const renderClient = (client: Client) => {
    const mapping = clientCustomers.get(client.name);

    return (
      <div
        key={client.id}
        onClick={() => navigate(`/clients/${encodeURIComponent(client.name)}`)}
        className="card cursor-pointer hover:shadow-lg transition-shadow"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4 flex-1">
            <div className="rounded-full bg-gray-100 dark:bg-gray-700 p-3">
              <HardDrive className="h-6 w-6 text-gray-600 dark:text-gray-300" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <div title={client.online ? 'Online' : 'Offline'}>
                  <Circle
                    className={`h-4 w-4 fill-current flex-shrink-0 ${
                      client.online
                        ? 'text-green-500 dark:text-green-400'
                        : 'text-red-500 dark:text-red-400'
                    }`}
                  />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {client.name}
                </h3>
              </div>
              {mapping && (
                <div className="flex items-center gap-1 mt-1 text-sm text-primary-600 dark:text-primary-400">
                  <Users className="h-3 w-3" />
                  <span>{mapping.customer_name}</span>
                  {mapping.customer_company && (
                    <span className="text-gray-500 dark:text-gray-400">
                      ({mapping.customer_company})
                    </span>
                  )}
                </div>
              )}
              <div className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-400">
                <p>Status: {getClientStatusText(client.status)}</p>
                {client.ip && <p>IP: {client.ip}</p>}
                <p>Last seen: {formatTimeAgo(client.lastseen || 0)}</p>
                <p>Last file backup: {formatTimeAgo(client.lastbackup || 0)}</p>
                <p>Last image backup: {formatTimeAgo(client.lastbackup_image || 0)}</p>
                {(client.bytes_used_files || client.bytes_used_images) && (
                  <p className="font-medium text-purple-600 dark:text-purple-400">
                    Storage: {formatBytes((client.bytes_used_files || 0) + (client.bytes_used_images || 0))}
                    {client.bytes_used_files && client.bytes_used_images && (
                      <span className="text-xs text-gray-500 dark:text-gray-500 ml-1">
                        ({formatBytes(client.bytes_used_files)} files + {formatBytes(client.bytes_used_images)} images)
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-2">
              {client.file_ok ? (
                <span className="rounded bg-green-100 dark:bg-green-900 px-3 py-1 text-sm font-medium text-green-700 dark:text-green-300">
                  File OK
                </span>
              ) : (
                <span className="rounded bg-red-100 dark:bg-red-900 px-3 py-1 text-sm font-medium text-red-700 dark:text-red-300">
                  File Failed
                </span>
              )}
              {client.image_ok ? (
                <span className="rounded bg-green-100 dark:bg-green-900 px-3 py-1 text-sm font-medium text-green-700 dark:text-green-300">
                  Image OK
                </span>
              ) : (
                <span className="rounded bg-red-100 dark:bg-red-900 px-3 py-1 text-sm font-medium text-red-700 dark:text-red-300">
                  Image Failed
                </span>
              )}
            </div>
            <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" />
          </div>
        </div>
      </div>
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Clients</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Manage and monitor your backup clients
            </p>
          </div>
          <button
            onClick={() => setIsManageModalOpen(true)}
            className="btn bg-green-600 hover:bg-green-700 text-white flex items-center gap-2"
          >
            <Settings className="h-4 w-4" />
            Manage Clients
          </button>
        </div>

        {/* Filters and Search */}
        <div className="card space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <SlidersHorizontal className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Filters & Search
            </h2>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, IP, or status..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-10"
            />
          </div>

          {/* Status Filters */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
            >
              All ({clients.length})
            </button>
            <button
              onClick={() => setFilter('online')}
              className={`btn ${filter === 'online' ? 'btn-primary' : 'btn-secondary'}`}
            >
              Online
            </button>
            <button
              onClick={() => setFilter('offline')}
              className={`btn ${filter === 'offline' ? 'btn-primary' : 'btn-secondary'}`}
            >
              Offline
            </button>
            <button
              onClick={() => setFilter('failed')}
              className={`btn ${filter === 'failed' ? 'btn-primary' : 'btn-secondary'}`}
            >
              Failed
            </button>
          </div>

          {/* Customer Filter */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label">Filter by Customer</label>
              <select
                value={selectedCustomer}
                onChange={(e) =>
                  setSelectedCustomer(e.target.value === 'all' ? 'all' : Number(e.target.value))
                }
                className="input"
              >
                <option value="all">All Customers</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} {customer.company && `(${customer.company})`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Sort By</label>
              <div className="flex gap-2">
                <select
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value as SortField)}
                  className="input flex-1"
                >
                  <option value="name">Name</option>
                  <option value="lastBackup">Last Backup</option>
                  <option value="status">Status</option>
                  <option value="customer">Customer</option>
                </select>
                <button
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  className="btn btn-secondary"
                >
                  {sortOrder === 'asc' ? '↑ A-Z' : '↓ Z-A'}
                </button>
              </div>
            </div>
          </div>

          {/* Group Toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="groupByCustomer"
              checked={groupByCustomer}
              onChange={(e) => setGroupByCustomer(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <label
              htmlFor="groupByCustomer"
              className="text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
            >
              Group by Customer
            </label>
          </div>
        </div>

        {/* Clients List */}
        {loading ? (
          <Loading />
        ) : filteredAndSortedClients.length === 0 ? (
          <div className="card text-center py-12">
            <HardDrive className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-4 text-gray-600 dark:text-gray-400">No clients found</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedClients).map(([groupName, groupClients]) => (
              <div key={groupName}>
                {groupByCustomer && (
                  <div className="flex items-center gap-2 mb-3">
                    <Users className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                      {groupName}
                    </h2>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      ({groupClients.length} {groupClients.length === 1 ? 'client' : 'clients'})
                    </span>
                  </div>
                )}
                <div className="grid gap-4">{groupClients.map(renderClient)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Client Management Modal */}
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
