import { useState, useEffect, useCallback } from 'react';
import { Layout } from '../components/Layout';
import { Tooltip } from '../components/Tooltip';
import { Loading } from '../components/Loading';
import {
  Users, Plus, Edit, Trash2, Save, X, HardDrive, Phone, Mail, Building,
  ChevronDown, ChevronUp, CheckSquare, Square,
} from 'lucide-react';
import { api } from '../services/api';
import type { Customer, Client, CustomerClient } from '../types';

export function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  // Expanded customer card
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedClients, setExpandedClients] = useState<CustomerClient[]>([]);
  const [expandedLoading, setExpandedLoading] = useState(false);

  // Edit / create modal
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Partial<Customer> | null>(null);
  const [modalError, setModalError] = useState('');
  const [modalSaving, setModalSaving] = useState(false);

  // Clients in the edit modal
  const [modalClients, setModalClients] = useState<CustomerClient[]>([]);
  // Checkbox-based bulk add
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());
  const [addingBulk, setAddingBulk] = useState(false);

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState<Customer | null>(null);
  const [confirmRemoveClient, setConfirmRemoveClient] = useState<{ cc: CustomerClient } | null>(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [customerData, clientData] = await Promise.all([
        api.getCustomers(),
        api.getClients(),
      ]);
      setCustomers(customerData);
      setClients(clientData);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  // ---------- Card expand / collapse ----------

  const toggleExpand = useCallback(async (customer: Customer) => {
    if (expandedId === customer.id) {
      setExpandedId(null);
      setExpandedClients([]);
      return;
    }
    setExpandedId(customer.id);
    setExpandedLoading(true);
    try {
      const cc = await api.getCustomerClients(customer.id);
      setExpandedClients(cc);
    } catch {
      setExpandedClients([]);
    } finally {
      setExpandedLoading(false);
    }
  }, [expandedId]);

  // ---------- Create / Edit modal ----------

  const openCreate = () => {
    setEditingCustomer({ name: '', email: '', phone: '', company: '', address: '', notes: '', is_active: true });
    setModalClients([]);
    setSelectedToAdd(new Set());
    setModalError('');
    setShowModal(true);
  };

  const openEdit = async (customer: Customer) => {
    setEditingCustomer(customer);
    setModalError('');
    setSelectedToAdd(new Set());
    setShowModal(true);
    try {
      const cc = await api.getCustomerClients(customer.id);
      setModalClients(cc);
    } catch {
      setModalClients([]);
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingCustomer(null);
    setModalClients([]);
    setSelectedToAdd(new Set());
    setModalError('');
  };

  const handleSave = async () => {
    if (!editingCustomer?.name?.trim()) {
      setModalError('Customer name is required.');
      return;
    }
    setModalSaving(true);
    setModalError('');
    try {
      if (editingCustomer.id) {
        await api.updateCustomer(editingCustomer.id, editingCustomer);
      } else {
        await api.createCustomer(editingCustomer);
      }
      closeModal();
      await loadData();
      // Refresh expanded panel if it was open for this customer
      if (expandedId === editingCustomer.id) {
        const cc = await api.getCustomerClients(editingCustomer.id);
        setExpandedClients(cc);
      }
    } catch (err: any) {
      setModalError(err.response?.data?.error || 'Failed to save customer.');
    } finally {
      setModalSaving(false);
    }
  };

  // ---------- Delete customer ----------

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await api.deleteCustomer(confirmDelete.id);
      setConfirmDelete(null);
      if (expandedId === confirmDelete.id) setExpandedId(null);
      loadData();
    } catch (err: any) {
      setConfirmDelete(null);
    }
  };

  // ---------- Bulk add clients ----------

  const toggleClientAdd = (name: string) => {
    setSelectedToAdd(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const selectAllUnassigned = () => {
    const unassigned = clients.filter(c => !modalClients.some(cc => cc.client_name === c.name));
    setSelectedToAdd(new Set(unassigned.map(c => c.name)));
  };

  const handleBulkAdd = async () => {
    if (!editingCustomer?.id || selectedToAdd.size === 0) return;
    setAddingBulk(true);
    const names = Array.from(selectedToAdd);
    try {
      await Promise.all(names.map(name => {
        const client = clients.find(c => c.name === name);
        return api.addClientToCustomer(editingCustomer.id!, {
          server_id: 1,
          client_name: name,
          client_id: client?.id !== undefined ? String(client.id) : undefined,
        });
      }));
      setSelectedToAdd(new Set());
      const cc = await api.getCustomerClients(editingCustomer.id);
      setModalClients(cc);
      await loadData();
    } catch (err: any) {
      setModalError(err.response?.data?.error || 'Failed to add some clients.');
    } finally {
      setAddingBulk(false);
    }
  };

  // ---------- Remove single client ----------

  const handleRemoveClient = async () => {
    if (!confirmRemoveClient || !editingCustomer?.id) return;
    try {
      await api.removeClientFromCustomer(editingCustomer.id, confirmRemoveClient.cc.id);
      setConfirmRemoveClient(null);
      const cc = await api.getCustomerClients(editingCustomer.id);
      setModalClients(cc);
      await loadData();
    } catch {
      setConfirmRemoveClient(null);
    }
  };

  // ---------- Derived ----------

  const unassignedClients = clients.filter(c => !modalClients.some(cc => cc.client_name === c.name));

  const getClientInfo = (name: string) => clients.find(c => c.name === name);

  return (
    <Layout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Customers</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Manage customers and their endpoint assignments</p>
          </div>
          <button onClick={openCreate} className="btn bg-green-600 hover:bg-green-700 text-white flex items-center gap-2 text-sm">
            <Plus className="h-4 w-4" />
            Add Customer
          </button>
        </div>

        {/* List */}
        {loading ? <Loading /> : customers.length === 0 ? (
          <div className="card text-center py-12">
            <Users className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-4 text-gray-600 dark:text-gray-400">No customers yet</p>
            <button onClick={openCreate} className="btn btn-primary mt-4 inline-flex items-center gap-2 text-sm">
              <Plus className="h-4 w-4" /> Add Customer
            </button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {customers.map(customer => {
              const isExpanded = expandedId === customer.id;
              return (
                <div key={customer.id} className="card p-0 overflow-hidden">
                  {/* Card header — click to expand */}
                  <div
                    className="p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                    onClick={() => toggleExpand(customer)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="rounded-full bg-primary-100 dark:bg-primary-900/40 p-2 flex-shrink-0">
                          <Users className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">{customer.name}</h3>
                            <span className={`flex-shrink-0 inline-flex rounded-full px-1.5 py-0.5 text-xs font-medium ${
                              customer.is_active !== false
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                            }`}>
                              {customer.is_active !== false ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          {customer.company && (
                            <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                              <Building className="h-3 w-3" />
                              <span className="truncate">{customer.company}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {customer.email && <span className="flex items-center gap-1 truncate"><Mail className="h-3 w-3 flex-shrink-0" />{customer.email}</span>}
                            {customer.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3 flex-shrink-0" />{customer.phone}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                          <HardDrive className="h-3 w-3" />{customer.client_count || 0}
                        </span>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                      </div>
                    </div>
                  </div>

                  {/* Expanded clients panel */}
                  {isExpanded && (
                    <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30">
                      {expandedLoading ? (
                        <p className="text-xs text-gray-500 px-4 py-3">Loading…</p>
                      ) : expandedClients.length === 0 ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400 px-4 py-3">No endpoints assigned.</p>
                      ) : (
                        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                          {expandedClients.map(cc => {
                            const info = getClientInfo(cc.client_name);
                            return (
                              <li key={cc.id} className="flex items-center gap-2 px-4 py-2">
                                <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${info?.online ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                                <HardDrive className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                                <span className="text-xs font-medium text-gray-800 dark:text-gray-200 flex-1 truncate">{cc.client_name}</span>
                                {info?.ip && <span className="text-xs text-gray-400 font-mono">{info.ip}</span>}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {/* Action row */}
                      <div className="flex gap-2 px-4 py-2 border-t border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
                        <button onClick={() => openEdit(customer)} className="flex-1 btn bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-xs flex items-center justify-center gap-1">
                          <Edit className="h-3.5 w-3.5" /> Edit / Manage Clients
                        </button>
                        <button onClick={() => setConfirmDelete(customer)} className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Collapsed action row */}
                  {!isExpanded && (
                    <div className="flex gap-2 px-4 pb-3 pt-0" onClick={e => e.stopPropagation()}>
                      <button onClick={() => openEdit(customer)} className="flex-1 btn bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-xs flex items-center justify-center gap-1">
                        <Edit className="h-3.5 w-3.5" /> Edit / Manage Clients
                      </button>
                      <button onClick={() => setConfirmDelete(customer)} className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Edit / Create Modal ── */}
      {showModal && editingCustomer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={closeModal}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {editingCustomer.id ? 'Edit Customer' : 'New Customer'}
              </h2>
              <button onClick={closeModal} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
              {/* Customer fields */}
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label">Customer Name *</label>
                  <input type="text" value={editingCustomer.name || ''} onChange={e => setEditingCustomer({ ...editingCustomer, name: e.target.value })} className="input" placeholder="Enter customer name" />
                </div>
                <div>
                  <label className="label">Company</label>
                  <input type="text" value={editingCustomer.company || ''} onChange={e => setEditingCustomer({ ...editingCustomer, company: e.target.value })} className="input" placeholder="Company name" />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label">Email</label>
                  <input type="email" value={editingCustomer.email || ''} onChange={e => setEditingCustomer({ ...editingCustomer, email: e.target.value })} className="input" placeholder="email@example.com" />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input type="tel" value={editingCustomer.phone || ''} onChange={e => setEditingCustomer({ ...editingCustomer, phone: e.target.value })} className="input" placeholder="+1 (555) 123-4567" />
                </div>
              </div>
              <div>
                <label className="label">Address</label>
                <textarea value={editingCustomer.address || ''} onChange={e => setEditingCustomer({ ...editingCustomer, address: e.target.value })} className="input" rows={2} placeholder="Full address" />
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea value={editingCustomer.notes || ''} onChange={e => setEditingCustomer({ ...editingCustomer, notes: e.target.value })} className="input" rows={2} placeholder="Additional notes" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="is_active" checked={editingCustomer.is_active !== false} onChange={e => setEditingCustomer({ ...editingCustomer, is_active: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                <label htmlFor="is_active" className="text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer">Active</label>
              </div>

              {/* ── Client management — only when editing existing customer ── */}
              {editingCustomer.id && (
                <div className="pt-4 border-t border-gray-200 dark:border-gray-700 space-y-4">
                  {/* Assigned clients */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-2">
                      <HardDrive className="h-4 w-4" />
                      Assigned Endpoints
                      <span className="ml-auto text-xs font-normal text-gray-500">{modalClients.length} total</span>
                    </h3>
                    {modalClients.length === 0 ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400 py-2">None assigned yet.</p>
                    ) : (
                      <ul className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                        {modalClients.map(cc => {
                          const info = getClientInfo(cc.client_name);
                          return (
                            <li key={cc.id} className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800/50">
                              <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${info?.online ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 flex-1 truncate">{cc.client_name}</span>
                              {info?.ip && <span className="text-xs text-gray-400 font-mono">{info.ip}</span>}
                              <button onClick={() => setConfirmRemoveClient({ cc })} className="p-1 text-red-400 hover:text-red-600 rounded hover:bg-red-50 dark:hover:bg-red-900/20">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  {/* Bulk add */}
                  {unassignedClients.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Add Endpoints</h3>
                        <button onClick={selectAllUnassigned} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
                          Select all ({unassignedClients.length})
                        </button>
                      </div>
                      <ul className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
                        {unassignedClients.map(client => {
                          const checked = selectedToAdd.has(client.name);
                          return (
                            <li
                              key={client.id}
                              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                              onClick={() => toggleClientAdd(client.name)}
                            >
                              {checked
                                ? <CheckSquare className="h-4 w-4 text-primary-600 dark:text-primary-400 flex-shrink-0" />
                                : <Square className="h-4 w-4 text-gray-400 flex-shrink-0" />}
                              <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${client.online ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                              <span className="text-sm text-gray-900 dark:text-gray-100 flex-1 truncate">{client.name}</span>
                              {client.ip && <span className="text-xs text-gray-400 font-mono">{client.ip}</span>}
                            </li>
                          );
                        })}
                      </ul>
                      <button
                        onClick={handleBulkAdd}
                        disabled={selectedToAdd.size === 0 || addingBulk}
                        className="mt-2 w-full btn bg-primary-600 hover:bg-primary-700 text-white text-sm disabled:opacity-40"
                      >
                        {addingBulk ? 'Adding…' : `Add Selected${selectedToAdd.size > 0 ? ` (${selectedToAdd.size})` : ''}`}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {modalError && (
                <p className="text-sm text-red-600 dark:text-red-400">{modalError}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
              <button onClick={closeModal} className="btn bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm">
                Cancel
              </button>
              <button onClick={handleSave} disabled={modalSaving} className="btn bg-primary-600 hover:bg-primary-700 text-white text-sm flex items-center gap-2 disabled:opacity-50">
                <Save className="h-4 w-4" />
                {modalSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete customer confirm ── */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">Delete customer?</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              <strong>{confirmDelete.name}</strong> and all endpoint assignments will be permanently deleted.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="btn bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm">Cancel</button>
              <button onClick={handleDelete} className="btn bg-red-600 hover:bg-red-700 text-white text-sm">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove client confirm ── */}
      {confirmRemoveClient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setConfirmRemoveClient(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">Remove endpoint?</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Remove <strong>{confirmRemoveClient.cc.client_name}</strong> from this customer?
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmRemoveClient(null)} className="btn bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm">Cancel</button>
              <button onClick={handleRemoveClient} className="btn bg-red-600 hover:bg-red-700 text-white text-sm">Remove</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
