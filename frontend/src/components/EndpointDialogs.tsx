import { useState } from 'react';
import { api } from '../services/api';

export interface EndpointRef {
  id: number | string;
  name: string;
}

type Notify = (type: 'success' | 'error', text: string) => void;

function errorText(err: unknown, fallback: string): string {
  const data = (err as any)?.response?.data;
  return (data && typeof data.error === 'string' && data.error) || fallback;
}

function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">{children}</div>
    </div>
  );
}

/** Deletes an endpoint and (by default straight away) all of its backups. */
export function DeleteEndpointDialog({ endpoint, onClose, onDeleted, notify }: {
  endpoint: EndpointRef;
  onClose: () => void;
  onDeleted: () => void;
  notify: Notify;
}) {
  const [deleteDataNow, setDeleteDataNow] = useState(true);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      const result = await api.removeClient(endpoint.id, deleteDataNow);
      if (result.purge.status === 'started' || result.purge.status === 'running') {
        notify('success', `"${endpoint.name}" deleted. Its backups are being deleted now; this can take a while for large backups.`);
      } else {
        notify('success', `"${endpoint.name}" deleted. Its backups will be deleted at UrBackup's nightly cleanup: ${result.purge.reason}.`);
      }
      onDeleted();
    } catch (err) {
      console.error('Failed to delete endpoint:', err);
      notify('error', errorText(err, `Failed to delete "${endpoint.name}". Please try again.`));
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <Backdrop>
      <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">Delete endpoint</h3>
      <p className="text-gray-600 dark:text-gray-400 mb-3">
        Delete "{endpoint.name}"? <strong>All of its file and image backups are permanently deleted</strong> from
        backup storage. This cannot be undone.
      </p>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
        Uninstall the UrBackup client on the endpoint too. While it is still connected, UrBackup keeps its data
        until it goes offline. To keep the backups and only stop new ones, use <strong>Disable</strong> instead.
      </p>
      <label className="flex items-start gap-2 mb-6 text-sm text-gray-800 dark:text-gray-200">
        <input
          type="checkbox"
          checked={deleteDataNow}
          onChange={(e) => setDeleteDataNow(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded-sm border-gray-300 text-red-600 focus:ring-red-500"
        />
        <span>
          Delete the backup data now
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            Otherwise it is deleted at UrBackup's nightly cleanup. Deleting now also runs the normal retention
            cleanup for all endpoints.
          </span>
        </span>
      </label>
      <div className="flex gap-3 justify-end">
        <button onClick={onClose} disabled={busy} className="btn btn-secondary">Cancel</button>
        <button onClick={confirm} disabled={busy} className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-60">
          {busy ? 'Deleting…' : 'Delete endpoint and backups'}
        </button>
      </div>
    </Backdrop>
  );
}

/** Pauses an endpoint's backups (enable = resume). Existing backups are kept. */
export function DisableEndpointDialog({ endpoint, enable, onClose, onChanged, notify }: {
  endpoint: EndpointRef;
  enable: boolean;
  onClose: () => void;
  onChanged: () => void;
  notify: Notify;
}) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      if (enable) {
        await api.enableClient(endpoint.id);
        notify('success', `"${endpoint.name}" enabled. Its backup schedule is back.`);
      } else {
        await api.disableClient(endpoint.id);
        notify('success', `"${endpoint.name}" disabled. No new backups will run; its existing backups are kept.`);
      }
      onChanged();
    } catch (err) {
      console.error('Failed to change endpoint state:', err);
      notify('error', errorText(err, `Failed to ${enable ? 'enable' : 'disable'} "${endpoint.name}".`));
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <Backdrop>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
        {enable ? 'Enable' : 'Disable'} endpoint
      </h3>
      {enable ? (
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Enable "{endpoint.name}"? Its backup schedule and the backup buttons in its tray icon are restored to what
          they were before it was disabled.
        </p>
      ) : (
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Disable "{endpoint.name}"? No scheduled or manual backups run until it is enabled again, and it raises no
          alerts. <strong>Its existing backups are kept</strong> and can still be browsed and restored. A backup that
          is already running finishes.
        </p>
      )}
      <div className="flex gap-3 justify-end">
        <button onClick={onClose} disabled={busy} className="btn btn-secondary">Cancel</button>
        <button onClick={confirm} disabled={busy} className="btn btn-primary disabled:opacity-60">
          {busy ? 'Saving…' : enable ? 'Enable' : 'Disable'}
        </button>
      </div>
    </Backdrop>
  );
}
