import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderTree, Loader2, Plus, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import { Tooltip } from '../components/Tooltip';

interface GroupMember { id: number; name: string; override: boolean }
interface Group { id: number; name: string; members: GroupMember[] }

/**
 * UrBackup client groups (issue #57). Each endpoint is in one group and uses
 * that group's settings for anything it does not set itself.
 */
export function Groups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const resp = await fetch('/api/groups', { credentials: 'include' });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to load groups');
      setGroups(data.groups || []);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to load groups' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setMessage(null);
    try {
      const resp = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newName }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not create the group');
      setNewName('');
      setMessage({ type: 'success', text: `Group "${data.name}" created with a copy of the Default group's settings. Move endpoints into it from each endpoint's settings page.` });
      await load();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Could not create the group' });
    } finally {
      setCreating(false);
    }
  };

  const remove = async (group: Group) => {
    setDeleting(group.id);
    setMessage(null);
    try {
      const resp = await fetch(`/api/groups/${group.id}`, { method: 'DELETE', credentials: 'include' });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not delete the group');
      setMessage({ type: 'success', text: `Group "${group.name}" deleted.${group.members.length ? ' Its endpoints are now in the Default group.' : ''}` });
      await load();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Could not delete the group' });
    } finally {
      setDeleting(null);
      setConfirmDelete(null);
    }
  };

  if (loading) return <Layout><Loading /></Layout>;

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
            <FolderTree className="h-8 w-8" /> Groups
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            These are UrBackup's client groups. Each endpoint is in one group and uses that group's settings,
            such as schedules and how many backups to keep, unless it sets a value itself.
            The Default group's settings are the server-wide defaults.
          </p>
        </div>

        {message && (
          <div role="status" className={`rounded-lg p-4 ${message.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'}`}>
            {message.text}
          </div>
        )}

        <form onSubmit={create} className="card flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[14rem]">
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New group</span>
            <input className="input w-full" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Servers" maxLength={64} />
          </label>
          <button type="submit" className="btn btn-primary flex items-center gap-2" disabled={creating || !newName.trim()}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create group
          </button>
        </form>

        <div className="space-y-4">
          {groups.map(g => (
            <div key={g.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{g.name}</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {g.members.length === 1 ? '1 endpoint' : `${g.members.length} endpoints`}
                    {g.id === 0 && ' · server-wide defaults'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link to={`/groups/${g.id}/settings`} className="btn btn-secondary flex items-center gap-2">
                    <SettingsIcon className="h-4 w-4" /> Settings
                  </Link>
                  {g.id !== 0 && (confirmDelete === g.id ? (
                    <>
                      <button className="btn btn-danger flex items-center gap-2" onClick={() => remove(g)} disabled={deleting === g.id}>
                        {deleting === g.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete {g.name}
                      </button>
                      <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)} disabled={deleting === g.id}>Cancel</button>
                    </>
                  ) : (
                    <Tooltip text="Delete this group. Its endpoints move to the Default group.">
                      <button className="btn btn-secondary flex items-center gap-2" onClick={() => setConfirmDelete(g.id)}>
                        <Trash2 className="h-4 w-4" /> Delete
                      </button>
                    </Tooltip>
                  ))}
                </div>
              </div>
              {g.members.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {g.members.map(m => (
                    <li key={m.id}>
                      <Link
                        to={`/clients/${encodeURIComponent(m.name)}/settings`}
                        className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-700 px-3 py-1 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                      >
                        {m.name}
                        {m.override && <span className="text-xs text-gray-500 dark:text-gray-400">· own settings</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
