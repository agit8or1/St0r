import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, Folder, HardDrive, Loader2, FolderOpen } from 'lucide-react';

interface DirectoryNode {
  name: string;
  path: string;
  type: 'drive' | 'directory';
  hasChildren: boolean;
  children?: DirectoryNode[];
  expanded?: boolean;
  loading?: boolean;
}

interface DirectoryBrowserProps {
  clientId: string;
  onSelect: (path: string) => void;
  selectedPath?: string;
}

export function DirectoryBrowser({ clientId, onSelect, selectedPath }: DirectoryBrowserProps) {
  const [roots, setRoots] = useState<DirectoryNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRoots();
  }, [clientId]);

  const loadRoots = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/client-filesystem/${clientId}/browse/root`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });

      if (!response.ok) {
        throw new Error('Failed to load filesystem roots');
      }

      const data = await response.json();
      setRoots(data.roots || []);
    } catch (err: any) {
      console.error('Failed to load roots:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadChildren = async (node: DirectoryNode, path: DirectoryNode[]) => {
    try {
      // Mark as loading
      updateNode(path, { ...node, loading: true });

      const response = await fetch(
        `/api/client-filesystem/${clientId}/browse/directory?path=${encodeURIComponent(node.path)}`,
        { headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } }
      );

      if (!response.ok) {
        throw new Error('Failed to load directory');
      }

      const data = await response.json();
      updateNode(path, {
        ...node,
        children: data.directories || [],
        loading: false,
        expanded: true
      });
    } catch (err) {
      console.error('Failed to load children:', err);
      updateNode(path, { ...node, loading: false, expanded: false });
    }
  };

  const updateNode = (path: DirectoryNode[], updatedNode: DirectoryNode) => {
    setRoots(prevRoots => {
      const newRoots = [...prevRoots];
      let current: DirectoryNode[] = newRoots;

      for (let i = 0; i < path.length - 1; i++) {
        const index = current.findIndex(n => n.path === path[i].path);
        if (index !== -1 && current[index].children) {
          current = current[index].children!;
        }
      }

      const index = current.findIndex(n => n.path === path[path.length - 1].path);
      if (index !== -1) {
        current[index] = updatedNode;
      }

      return newRoots;
    });
  };

  const toggleNode = (node: DirectoryNode, path: DirectoryNode[]) => {
    if (!node.hasChildren) return;

    if (node.expanded) {
      // Collapse
      updateNode(path, { ...node, expanded: false });
    } else if (node.children && node.children.length > 0) {
      // Already loaded, just expand
      updateNode(path, { ...node, expanded: true });
    } else {
      // Load children
      loadChildren(node, path);
    }
  };

  const renderNode = (node: DirectoryNode, depth: number = 0, path: DirectoryNode[] = []): JSX.Element => {
    const currentPath = [...path, node];
    const isSelected = selectedPath === node.path;
    const Icon = node.type === 'drive' ? HardDrive : node.expanded ? FolderOpen : Folder;

    return (
      <div key={node.path}>
        <div
          className={`flex items-center gap-2 py-2 px-3 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer rounded ${
            isSelected ? 'bg-primary-100 dark:bg-primary-900/30' : ''
          }`}
          style={{ paddingLeft: `${depth * 20 + 12}px` }}
        >
          {node.hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleNode(node, currentPath);
              }}
              className="flex-shrink-0"
            >
              {node.loading ? (
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
              ) : node.expanded ? (
                <ChevronDown className="h-4 w-4 text-gray-600 dark:text-gray-400" />
              ) : (
                <ChevronRight className="h-4 w-4 text-gray-600 dark:text-gray-400" />
              )}
            </button>
          )}
          {!node.hasChildren && <div className="w-4" />}

          <div
            className="flex items-center gap-2 flex-1 min-w-0"
            onClick={() => onSelect(node.path)}
          >
            <Icon className="h-4 w-4 flex-shrink-0 text-primary-600 dark:text-primary-400" />
            <span className="text-sm font-mono truncate">{node.name}</span>
          </div>
        </div>

        {node.expanded && node.children && (
          <div>
            {node.children.map(child => renderNode(child, depth + 1, currentPath))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary-600 dark:text-primary-400 mb-4" />
        <p className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
          Scanning client filesystem...
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
          Please wait while the client scans its folder structure.<br />
          This may take a few minutes depending on the client's filesystem size.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-600 dark:text-red-400">
        <p>{error}</p>
        <button
          onClick={loadRoots}
          className="mt-4 text-sm text-primary-600 dark:text-primary-400 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
      <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 border-b border-gray-300 dark:border-gray-600">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Select Directory
        </p>
      </div>
      <div className="max-h-96 overflow-y-auto p-2">
        {roots.length === 0 ? (
          <p className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
            No directories found
          </p>
        ) : (
          roots.map(root => renderNode(root))
        )}
      </div>
    </div>
  );
}
