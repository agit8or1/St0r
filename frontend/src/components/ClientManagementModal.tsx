import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Eye, EyeOff, Copy, Check, Edit2, RefreshCw, Save } from 'lucide-react';
import { api } from '../services/api';
import type { Client } from '../types';

interface ClientManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  clients: Client[];
  onClientAdded: () => void;
  onClientRemoved: () => void;
}

export function ClientManagementModal({
  isOpen,
  onClose,
  clients,
  onClientAdded,
  onClientRemoved,
}: ClientManagementModalProps) {
  const [newClientName, setNewClientName] = useState('');
  const [adding, setAdding] = useState(false);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [authKeys, setAuthKeys] = useState<Map<string, string>>(new Map());
  const [loadingAuthKey, setLoadingAuthKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editingClient, setEditingClient] = useState<string | null>(null);
  const [editedName, setEditedName] = useState('');
  const [regeneratingKey, setRegeneratingKey] = useState<string | null>(null);
  const [modalMessage, setModalMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{ id: number | string; name: string } | null>(null);
  const [pendingRegenKey, setPendingRegenKey] = useState<{ id: number | string; name: string } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setExpandedClient(null);
      setAuthKeys(new Map());
    }
  }, [isOpen]);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setModalMessage({ type, text });
    if (type === 'success') setTimeout(() => setModalMessage(null), 4000);
  };

  const handleAddClient = async () => {
    if (!newClientName.trim()) {
      showMsg('error', 'Please enter a client name');
      return;
    }

    setAdding(true);
    try {
      await api.addClient(newClientName.trim());
      const added = newClientName.trim();
      setNewClientName('');
      onClientAdded();
      showMsg('success', `Client "${added}" added successfully!`);
    } catch (error) {
      console.error('Failed to add client:', error);
      showMsg('error', 'Failed to add client. Please try again.');
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveClient = async (clientId: number | string, clientName: string) => {
    setPendingRemove({ id: clientId, name: clientName });
  };

  const doRemoveClient = async () => {
    if (!pendingRemove) return;
    const { id, name } = pendingRemove;
    setPendingRemove(null);
    setDeleting(String(id));
    try {
      await api.removeClient(id);
      onClientRemoved();
      showMsg('success', `Client "${name}" marked for removal. All backups will be removed.`);
    } catch (error) {
      console.error('Failed to remove client:', error);
      showMsg('error', 'Failed to remove client. Please try again.');
    } finally {
      setDeleting(null);
    }
  };

  const handleToggleAuthKey = async (client: Client) => {
    const clientIdStr = String(client.id);

    // If already expanded, collapse it
    if (expandedClient === clientIdStr) {
      setExpandedClient(null);
      return;
    }

    // If auth key is already loaded, just expand
    if (authKeys.has(clientIdStr)) {
      setExpandedClient(clientIdStr);
      return;
    }

    // Load auth key
    setLoadingAuthKey(clientIdStr);
    try {
      const result = await api.getClientAuthkey(client.id);
      const newAuthKeys = new Map(authKeys);
      newAuthKeys.set(clientIdStr, result.authkey);
      setAuthKeys(newAuthKeys);
      setExpandedClient(clientIdStr);
    } catch (error) {
      console.error('Failed to get auth key:', error);
      showMsg('error', 'Failed to retrieve authentication key. Please try again.');
    } finally {
      setLoadingAuthKey(null);
    }
  };

  const handleCopyAuthKey = async (clientId: string, authkey: string) => {
    try {
      await navigator.clipboard.writeText(authkey);
      setCopiedKey(clientId);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      showMsg('error', 'Failed to copy authentication key');
    }
  };

  const handleStartEdit = (client: Client) => {
    setEditingClient(String(client.id));
    setEditedName(client.name);
  };

  const handleCancelEdit = () => {
    setEditingClient(null);
    setEditedName('');
  };

  const handleSaveEdit = async (clientId: string | number, oldName: string) => {
    if (!editedName.trim() || editedName === oldName) {
      handleCancelEdit();
      return;
    }

    try {
      await api.updateClientName(clientId, editedName.trim());
      onClientAdded(); // Reload clients
      handleCancelEdit();
      showMsg('success', `Client renamed from "${oldName}" to "${editedName}"`);
    } catch (error) {
      console.error('Failed to update client name:', error);
      showMsg('error', 'Failed to update client name. Please try again.');
    }
  };

  const handleRegenerateKey = async (clientId: string | number, clientName: string) => {
    setPendingRegenKey({ id: clientId, name: clientName });
  };

  const doRegenerateKey = async () => {
    if (!pendingRegenKey) return;
    const { id, name } = pendingRegenKey;
    setPendingRegenKey(null);
    const clientIdStr = String(id);
    setRegeneratingKey(clientIdStr);
    try {
      await api.regenerateClientKey(id);

      // Clear the cached auth key so it will be reloaded
      const newAuthKeys = new Map(authKeys);
      newAuthKeys.delete(clientIdStr);
      setAuthKeys(newAuthKeys);

      // If the key was expanded, reload it
      if (expandedClient === clientIdStr) {
        setLoadingAuthKey(clientIdStr);
        const result = await api.getClientAuthkey(id);
        newAuthKeys.set(clientIdStr, result.authkey);
        setAuthKeys(newAuthKeys);
        setLoadingAuthKey(null);
      }

      showMsg('success', `Authentication key regenerated for "${name}". The client will need to reconnect.`);
    } catch (error) {
      console.error('Failed to regenerate key:', error);
      showMsg('error', 'Failed to regenerate authentication key. Please try again.');
    } finally {
      setRegeneratingKey(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      {/* Remove client confirm */}
      {pendingRemove && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">Remove Client</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Are you sure you want to remove "{pendingRemove.name}"? This will also delete all backups for this client.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setPendingRemove(null)} className="btn btn-secondary">Cancel</button>
              <button onClick={doRemoveClient} className="btn bg-red-600 text-white hover:bg-red-700">Remove</button>
            </div>
          </div>
        </div>
      )}
      {/* Regenerate key confirm */}
      {pendingRegenKey && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-yellow-600 dark:text-yellow-400 mb-2">Regenerate Auth Key</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Regenerate authentication key for "{pendingRegenKey.name}"? The client will need to reconnect with the new key.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setPendingRegenKey(null)} className="btn btn-secondary">Cancel</button>
              <button onClick={doRegenerateKey} className="btn btn-primary">Regenerate</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Client Management
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Status message */}
          {modalMessage && (
            <div className={`mb-4 rounded-lg p-3 text-sm ${
              modalMessage.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'
            }`}>
              {modalMessage.text}
            </div>
          )}

          {/* Add New Client Section */}
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Add New Client
            </h3>
            <div className="flex gap-3">
              <input
                type="text"
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                placeholder="Enter client name (e.g., laptop1, server2)"
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={adding}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleAddClient();
                  }
                }}
              />
              <button
                onClick={handleAddClient}
                disabled={adding || !newClientName.trim()}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                {adding ? (
                  <>
                    <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Add Client
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Existing Clients List */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
              Existing Clients ({clients.length})
            </h3>
            {clients.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                No clients found
              </div>
            ) : (
              <div className="space-y-2">
                {clients.map((client) => {
                  const clientIdStr = String(client.id);
                  const isExpanded = expandedClient === clientIdStr;
                  const authkey = authKeys.get(clientIdStr);
                  const isLoadingKey = loadingAuthKey === clientIdStr;
                  const isCopied = copiedKey === clientIdStr;
                  const isDeleting = deleting === clientIdStr;

                  return (
                    <div
                      key={client.id}
                      className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                    >
                      <div className="p-4 flex items-center justify-between bg-gray-50 dark:bg-gray-900/50">
                        <div className="flex-1">
                          {editingClient === clientIdStr ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editedName}
                                onChange={(e) => setEditedName(e.target.value)}
                                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                autoFocus
                                onKeyPress={(e) => {
                                  if (e.key === 'Enter') {
                                    handleSaveEdit(client.id, client.name);
                                  } else if (e.key === 'Escape') {
                                    handleCancelEdit();
                                  }
                                }}
                              />
                              <button
                                onClick={() => handleSaveEdit(client.id, client.name)}
                                className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
                                title="Save"
                              >
                                <Save className="h-4 w-4" />
                              </button>
                              <button
                                onClick={handleCancelEdit}
                                className="px-2 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded text-sm"
                                title="Cancel"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900 dark:text-white">
                                  {client.name}
                                </span>
                                <button
                                  onClick={() => handleStartEdit(client)}
                                  className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-600 dark:text-gray-400"
                                  title="Edit name"
                                >
                                  <Edit2 className="h-3 w-3" />
                                </button>
                              </div>
                              <div className="text-sm text-gray-500 dark:text-gray-400">
                                ID: {client.id} {client.ip && `• IP: ${client.ip}`}
                              </div>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleToggleAuthKey(client)}
                            disabled={isLoadingKey}
                            className="px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                          >
                            {isLoadingKey ? (
                              <>
                                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                                Loading...
                              </>
                            ) : isExpanded ? (
                              <>
                                <EyeOff className="h-4 w-4" />
                                Hide Key
                              </>
                            ) : (
                              <>
                                <Eye className="h-4 w-4" />
                                View Key
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => handleRemoveClient(client.id, client.name)}
                            disabled={isDeleting}
                            className="px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                          >
                            {isDeleting ? (
                              <>
                                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                                Removing...
                              </>
                            ) : (
                              <>
                                <Trash2 className="h-4 w-4" />
                                Remove
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Auth Key Display */}
                      {isExpanded && authkey && (
                        <div className="p-4 bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Authentication Key:
                          </div>
                          <div className="flex items-center gap-2 mb-3">
                            <code className="flex-1 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-xs font-mono text-gray-900 dark:text-gray-100 break-all">
                              {authkey}
                            </code>
                            <button
                              onClick={() => handleCopyAuthKey(clientIdStr, authkey)}
                              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap"
                            >
                              {isCopied ? (
                                <>
                                  <Check className="h-4 w-4" />
                                  Copied!
                                </>
                              ) : (
                                <>
                                  <Copy className="h-4 w-4" />
                                  Copy
                                </>
                              )}
                            </button>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              Length: {authkey.length} characters
                            </div>
                            <button
                              onClick={() => handleRegenerateKey(client.id, client.name)}
                              disabled={regeneratingKey === clientIdStr}
                              className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white rounded text-xs font-medium transition-colors flex items-center gap-2"
                            >
                              {regeneratingKey === clientIdStr ? (
                                <>
                                  <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" />
                                  Regenerating...
                                </>
                              ) : (
                                <>
                                  <RefreshCw className="h-3 w-3" />
                                  Regenerate Key
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
