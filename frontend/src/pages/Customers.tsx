import { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { Tooltip } from '../components/Tooltip';
import { Users, Plus, Edit, Trash2, Save, X, HardDrive, Phone, Mail, Building } from 'lucide-react';
import { api } from '../services/api';
import type { Customer, Client } from '../types';

export function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Partial<Customer> | null>(null);
  const [showClientModal, setShowClientModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedClientName, setSelectedClientName] = useState<string>('');
  const [customerClients, setCustomerClients] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [customerData, clientData] = await Promise.all([
        api.getCustomers(),
        api.getClients()
      ]);
      setCustomers(customerData);
      setClients(clientData);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingCustomer({
      name: '',
      email: '',
      phone: '',
      company: '',
      address: '',
      notes: '',
      is_active: true
    });
    setShowModal(true);
  };

  const handleEdit = async (customer: Customer) => {
    setEditingCustomer(customer);
    setShowModal(true);

    // Load customer's clients
    try {
      const assignedClients = await api.getCustomerClients(customer.id);
      setCustomerClients(assignedClients);
    } catch (err) {
      console.error('Failed to load customer clients:', err);
      setCustomerClients([]);
    }
  };

  const handleSave = async () => {
    if (!editingCustomer?.name) {
      alert('Customer name is required');
      return;
    }

    try {
      if (editingCustomer.id) {
        await api.updateCustomer(editingCustomer.id, editingCustomer);
      } else {
        await api.createCustomer(editingCustomer);
      }
      setShowModal(false);
      setEditingCustomer(null);
      setCustomerClients([]);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to save customer');
    }
  };

  const handleDelete = async (customer: Customer) => {
    if (!confirm(`Are you sure you want to delete customer "${customer.name}"?`)) {
      return;
    }

    try {
      await api.deleteCustomer(customer.id);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete customer');
    }
  };

  const handleAddClient = (customer: Customer) => {
    setSelectedCustomer(customer);
    setSelectedClientName('');
    setShowClientModal(true);
  };

  const handleAssignClient = async () => {
    if (!selectedCustomer || !selectedClientName) {
      alert('Please select a client');
      return;
    }

    try {
      const client = clients.find(c => c.name === selectedClientName);
      await api.addClientToCustomer(selectedCustomer.id, {
        server_id: 1, // Assuming default server ID
        client_name: selectedClientName,
        client_id: client?.id
      });
      setShowClientModal(false);
      setSelectedCustomer(null);
      setSelectedClientName('');
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to assign client');
    }
  };

  const handleAddClientToCustomer = async (clientName: string) => {
    if (!editingCustomer?.id) return;

    try {
      const client = clients.find(c => c.name === clientName);
      await api.addClientToCustomer(editingCustomer.id, {
        server_id: 1,
        client_name: clientName,
        client_id: client?.id
      });

      // Reload customer clients
      const assignedClients = await api.getCustomerClients(editingCustomer.id);
      setCustomerClients(assignedClients);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to add client');
    }
  };

  const handleRemoveClientFromCustomer = async (clientId: number) => {
    if (!editingCustomer?.id) return;

    if (!confirm('Are you sure you want to remove this client from the customer?')) {
      return;
    }

    try {
      await api.removeClientFromCustomer(editingCustomer.id, clientId);

      // Reload customer clients
      const assignedClients = await api.getCustomerClients(editingCustomer.id);
      setCustomerClients(assignedClients);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to remove client');
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
              <Users className="h-8 w-8" />
              Customers
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Manage customers and their device assignments
            </p>
          </div>
          <Tooltip text="Create a new customer record" position="bottom">
            <button
              onClick={handleCreate}
              className="btn btn-primary flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Customer
            </button>
          </Tooltip>
        </div>

        {/* Customers List */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-600 dark:text-gray-400">Loading customers...</div>
          </div>
        ) : customers.length === 0 ? (
          <div className="card text-center py-12">
            <Users className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-4 text-gray-600 dark:text-gray-400">No customers found</p>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Get started by creating your first customer
            </p>
            <button
              onClick={handleCreate}
              className="btn btn-primary mt-4 inline-flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Customer
            </button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {customers.map((customer) => (
              <div key={customer.id} className="card">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="rounded-full bg-primary-100 dark:bg-primary-900 p-3">
                      <Users className="h-6 w-6 text-primary-600 dark:text-primary-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <Tooltip text={customer.notes ? customer.notes : 'No notes'}>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate cursor-default">
                          {customer.name}
                        </h3>
                      </Tooltip>
                      {customer.company && (
                        <Tooltip text={`Company: ${customer.company}`}>
                          <div className="flex items-center gap-1 mt-1 text-sm text-gray-600 dark:text-gray-400 cursor-default">
                            <Building className="h-3 w-3" />
                            <span className="truncate">{customer.company}</span>
                          </div>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                  <Tooltip text={customer.is_active ? 'Customer is active' : 'Customer is inactive'}>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${customer.is_active !== false ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                      {customer.is_active !== false ? 'Active' : 'Inactive'}
                    </span>
                  </Tooltip>
                </div>

                <div className="space-y-2 text-sm">
                  {customer.email && (
                    <Tooltip text={`Send email to ${customer.email}`}>
                      <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400 cursor-default">
                        <Mail className="h-4 w-4" />
                        <span className="truncate">{customer.email}</span>
                      </div>
                    </Tooltip>
                  )}
                  {customer.phone && (
                    <Tooltip text={`Phone: ${customer.phone}`}>
                      <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400 cursor-default">
                        <Phone className="h-4 w-4" />
                        <span>{customer.phone}</span>
                      </div>
                    </Tooltip>
                  )}
                  <Tooltip text="Number of backup endpoints assigned to this customer">
                    <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400 cursor-default">
                      <HardDrive className="h-4 w-4" />
                      <span>{customer.client_count || 0} clients</span>
                    </div>
                  </Tooltip>
                </div>

                <div className="flex gap-2 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <Tooltip text="Assign an existing backup endpoint to this customer" className="flex-1">
                    <button
                      onClick={() => handleAddClient(customer)}
                      className="btn btn-secondary w-full text-sm"
                    >
                      Add Client
                    </button>
                  </Tooltip>
                  <Tooltip text="Edit customer details">
                    <button
                      onClick={() => handleEdit(customer)}
                      className="p-2 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                  </Tooltip>
                  <Tooltip text="Delete this customer and all endpoint assignments">
                    <button
                      onClick={() => handleDelete(customer)}
                      className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Customer Edit/Create Modal */}
      {showModal && editingCustomer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              {editingCustomer.id ? 'Edit Customer' : 'Create Customer'}
            </h2>

            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label">Customer Name *</label>
                  <input
                    type="text"
                    value={editingCustomer.name || ''}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, name: e.target.value })
                    }
                    className="input"
                    placeholder="Enter customer name"
                  />
                </div>

                <div>
                  <label className="label">Company</label>
                  <input
                    type="text"
                    value={editingCustomer.company || ''}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, company: e.target.value })
                    }
                    className="input"
                    placeholder="Company name"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label">Email</label>
                  <input
                    type="email"
                    value={editingCustomer.email || ''}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, email: e.target.value })
                    }
                    className="input"
                    placeholder="email@example.com"
                  />
                </div>

                <div>
                  <label className="label">Phone</label>
                  <input
                    type="tel"
                    value={editingCustomer.phone || ''}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, phone: e.target.value })
                    }
                    className="input"
                    placeholder="+1 (555) 123-4567"
                  />
                </div>
              </div>

              <div>
                <label className="label">Address</label>
                <textarea
                  value={editingCustomer.address || ''}
                  onChange={(e) =>
                    setEditingCustomer({ ...editingCustomer, address: e.target.value })
                  }
                  className="input"
                  rows={3}
                  placeholder="Full address"
                />
              </div>

              <div>
                <label className="label">Notes</label>
                <textarea
                  value={editingCustomer.notes || ''}
                  onChange={(e) =>
                    setEditingCustomer({ ...editingCustomer, notes: e.target.value })
                  }
                  className="input"
                  rows={3}
                  placeholder="Additional notes"
                />
              </div>

              <Tooltip text="Inactive customers are hidden from most views but not deleted">
                <div className="flex items-center gap-2 cursor-default">
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={editingCustomer.is_active !== false}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, is_active: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label
                    htmlFor="is_active"
                    className="text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer"
                  >
                    Active
                  </label>
                </div>
              </Tooltip>

              {/* Client Management Section - Only shown when editing existing customer */}
              {editingCustomer.id && (
                <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between mb-3">
                    <Tooltip text="Backup endpoints currently linked to this customer">
                      <h3 className="font-medium text-gray-900 dark:text-gray-100 cursor-default">Assigned Clients</h3>
                    </Tooltip>
                    <Tooltip text="Total endpoints linked to this customer">
                      <span className="text-sm text-gray-600 dark:text-gray-400 cursor-default">
                        {customerClients.length} clients
                      </span>
                    </Tooltip>
                  </div>

                  {/* Add Client to Customer */}
                  <div className="mb-4 flex gap-2">
                    <select
                      value={selectedClientName}
                      onChange={(e) => setSelectedClientName(e.target.value)}
                      className="input flex-1"
                    >
                      <option value="">-- Add a client --</option>
                      {clients
                        .filter(c => !customerClients.some(cc => cc.client_name === c.name))
                        .map((client) => (
                          <option key={client.id} value={client.name}>
                            {client.name} {client.ip && `(${client.ip})`}
                          </option>
                        ))}
                    </select>
                    <Tooltip text="Link the selected endpoint to this customer">
                      <button
                        onClick={() => {
                          if (selectedClientName) {
                            handleAddClientToCustomer(selectedClientName);
                            setSelectedClientName('');
                          }
                        }}
                        disabled={!selectedClientName}
                        className="btn btn-primary"
                      >
                        Add
                      </button>
                    </Tooltip>
                  </div>

                  {/* List of Assigned Clients */}
                  {customerClients.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                      No clients assigned yet
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {customerClients.map((cc) => (
                        <div
                          key={cc.id}
                          className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
                        >
                          <Tooltip text={`Backup endpoint: ${cc.client_name}`}>
                            <div className="flex items-center gap-2 cursor-default">
                              <HardDrive className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {cc.client_name}
                              </span>
                            </div>
                          </Tooltip>
                          <Tooltip text="Unlink this endpoint from the customer">
                            <button
                              onClick={() => handleRemoveClientFromCustomer(cc.id)}
                              className="p-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </Tooltip>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Tooltip text="Discard changes and close">
                <button
                  onClick={() => {
                    setShowModal(false);
                    setEditingCustomer(null);
                    setCustomerClients([]);
                    setSelectedClientName('');
                  }}
                  className="btn btn-secondary flex items-center gap-2"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </button>
              </Tooltip>
              <Tooltip text="Save customer details to the database">
                <button onClick={handleSave} className="btn btn-primary flex items-center gap-2">
                  <Save className="h-4 w-4" />
                  Save
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      )}

      {/* Add Client Modal */}
      {showClientModal && selectedCustomer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              Add Client to {selectedCustomer.name}
            </h2>

            <div className="space-y-4">
              <div>
                <Tooltip text="Choose an existing backup endpoint to link to this customer">
                  <label className="label cursor-default">Select Client</label>
                </Tooltip>
                <select
                  value={selectedClientName}
                  onChange={(e) => setSelectedClientName(e.target.value)}
                  className="input"
                >
                  <option value="">-- Select a client --</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.name}>
                      {client.name} {client.ip && `(${client.ip})`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Tooltip text="Discard and close without assigning">
                <button
                  onClick={() => {
                    setShowClientModal(false);
                    setSelectedCustomer(null);
                    setSelectedClientName('');
                  }}
                  className="btn btn-secondary flex items-center gap-2"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </button>
              </Tooltip>
              <Tooltip text="Link the selected endpoint to this customer">
                <button
                  onClick={handleAssignClient}
                  className="btn btn-primary flex items-center gap-2"
                >
                  <Save className="h-4 w-4" />
                  Assign Client
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
