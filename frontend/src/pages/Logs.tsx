import { useEffect, useState } from 'react';
import { FileText, Search, RefreshCw, Download } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import { api } from '../services/api';

interface LogEntry {
  time: string;
  level: string;
  message: string;
}

export function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [autoRefresh, setAutoRefresh] = useState(false);

  useEffect(() => {
    loadLogs();
  }, []);

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(loadLogs, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  useEffect(() => {
    filterLogs();
  }, [logs, searchTerm, levelFilter]);

  const loadLogs = async () => {
    try {
      const data = await fetch('/api/logs', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      }).then(res => res.json());

      // Parse logs if they come as string array
      const parsedLogs = parseLogData(data);
      setLogs(parsedLogs);
    } catch (err) {
      console.error('Failed to load logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const parseLogData = (data: any): LogEntry[] => {
    // Handle different log formats from UrBackup
    if (Array.isArray(data)) {
      return data.map((log: any, index) => ({
        time: log.time || new Date().toISOString(),
        level: log.level || 'info',
        message: log.message || log.toString(),
      }));
    }

    if (typeof data === 'object' && data.logs) {
      return parseLogData(data.logs);
    }

    // If it's a plain string, split by lines
    if (typeof data === 'string') {
      return data.split('\n').map((line, index) => ({
        time: new Date().toISOString(),
        level: 'info',
        message: line,
      }));
    }

    return [];
  };

  const filterLogs = () => {
    let filtered = logs;

    if (searchTerm) {
      filtered = filtered.filter(log =>
        log.message.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (levelFilter !== 'all') {
      filtered = filtered.filter(log => log.level === levelFilter);
    }

    setFilteredLogs(filtered);
  };

  const getLevelColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'error':
        return 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900';
      case 'warning':
        return 'text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900';
      case 'info':
        return 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900';
      default:
        return 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700';
    }
  };

  const exportLogs = () => {
    const logText = filteredLogs.map(log =>
      `[${log.time}] [${log.level}] ${log.message}`
    ).join('\n');

    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `urbackup-logs-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <Layout>
        <Loading />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Server Logs</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              View and search server logs
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`btn flex items-center gap-2 ${
                autoRefresh ? 'btn-primary' : 'btn-secondary'
              }`}
            >
              <RefreshCw className={`h-4 w-4 ${autoRefresh ? 'animate-spin' : ''}`} />
              Auto-refresh
            </button>
            <button
              onClick={loadLogs}
              className="btn btn-secondary flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button
              onClick={exportLogs}
              className="btn btn-secondary flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="card">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search logs..."
                  className="input pl-10"
                />
              </div>
            </div>
            <div>
              <label className="label">Level Filter</label>
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                className="input"
              >
                <option value="all">All Levels</option>
                <option value="error">Error</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
                <option value="debug">Debug</option>
              </select>
            </div>
          </div>
        </div>

        {/* Log Results */}
        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Showing {filteredLogs.length} of {logs.length} log entries
            </p>
          </div>

          {filteredLogs.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-4 text-gray-600 dark:text-gray-400">No logs found</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {filteredLogs.map((log, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3 font-mono text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50"
                >
                  <span className={`rounded px-2 py-1 text-xs font-semibold ${getLevelColor(log.level)}`}>
                    {log.level.toUpperCase()}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {new Date(log.time).toLocaleString()}
                  </span>
                  <span className="flex-1 text-gray-900 dark:text-gray-100 break-all">
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
