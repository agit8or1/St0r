import axios, { AxiosInstance } from 'axios';
import type {
  AuthResponse,
  UrBackupServer,
  CreateServerRequest,
  Client,
  Activity,
  Backup,
  Status,
  Usage,
  Customer,
  CustomerClient,
  SystemMetrics,
  ServerLatency,
  StorageInfo,
  StorageLimit,
  StorageLimitStatus,
  ReplicationSettings,
  ReplicationTarget,
  ReplicationRun,
  ReplicationEvent,
  ReplicationAlertChannel,
  ReplicationTargetStatus,
} from '../types';

class ApiService {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: '/api',
      withCredentials: true,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Handle 401 errors
    this.api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401 && window.location.pathname !== '/login') {
          localStorage.removeItem('user');
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  // Auth
  async login(username: string, password: string): Promise<AuthResponse> {
    const response = await this.api.post<AuthResponse>('/auth/login', {
      username,
      password,
    });
    return response.data;
  }

  async validateToken(): Promise<boolean> {
    try {
      await this.api.get('/auth/validate');
      return true;
    } catch {
      return false;
    }
  }

  async logout(): Promise<void> {
    await this.api.post('/auth/logout');
  }

  // Servers
  async getServers(): Promise<UrBackupServer[]> {
    const response = await this.api.get<UrBackupServer[]>('/servers');
    return response.data;
  }

  async getServer(id: number): Promise<UrBackupServer> {
    const response = await this.api.get<UrBackupServer>(`/servers/${id}`);
    return response.data;
  }

  async createServer(data: CreateServerRequest): Promise<{ id: number }> {
    const response = await this.api.post<{ id: number }>('/servers', data);
    return response.data;
  }

  async updateServer(id: number, data: Partial<CreateServerRequest>): Promise<void> {
    await this.api.put(`/servers/${id}`, data);
  }

  async deleteServer(id: number): Promise<void> {
    await this.api.delete(`/servers/${id}`);
  }

  async testConnection(host: string, port: number, username: string, password: string) {
    const response = await this.api.post('/servers/test-connection', {
      host,
      port,
      username,
      password,
    });
    return response.data;
  }

  // UrBackup operations
  async getStatus(serverId?: number): Promise<Status> {
    const response = await this.api.get<Status>('/urbackup/status', {
      params: serverId ? { serverId } : undefined,
    });
    return response.data;
  }

  async getClients(serverId?: number): Promise<Client[]> {
    const response = await this.api.get<Client[]>('/urbackup/clients', {
      params: serverId ? { serverId } : undefined,
    });
    return response.data;
  }

  async getOnlineClients(serverId?: number): Promise<Client[]> {
    const response = await this.api.get<Client[]>('/urbackup/clients/online', {
      params: serverId ? { serverId } : undefined,
    });
    return response.data;
  }

  async getOfflineClients(serverId?: number): Promise<Client[]> {
    const response = await this.api.get<Client[]>('/urbackup/clients/offline', {
      params: serverId ? { serverId } : undefined,
    });
    return response.data;
  }

  async getFailedClients(serverId?: number): Promise<Client[]> {
    const response = await this.api.get<Client[]>('/urbackup/clients/failed', {
      params: serverId ? { serverId } : undefined,
    });
    return response.data;
  }

  async getActivities(serverId?: number): Promise<Activity[]> {
    const response = await this.api.get<Activity[]>('/urbackup/activities', {
      params: serverId ? { serverId } : undefined,
    });
    return response.data;
  }

  async getCurrentActivities(serverId?: number): Promise<Activity[]> {
    const response = await this.api.get<Activity[]>('/urbackup/activities/current', {
      params: serverId ? { serverId } : undefined,
    });
    return response.data;
  }

  async getBackups(clientId: string, serverId?: number): Promise<Backup[]> {
    const response = await this.api.get<Backup[]>(`/urbackup/clients/${clientId}/backups`, {
      params: serverId ? { serverId } : undefined,
    });
    return response.data;
  }

  async startBackup(
    clientName: string,
    backupType: 'file' | 'image',
    isIncremental: boolean,
    clientId?: string | number,
    serverId?: number
  ): Promise<void> {
    await this.api.post('/urbackup/backups/start', {
      clientName,
      clientId,
      backupType,
      isIncremental,
      serverId,
    });
  }

  async stopActivity(activityId: string, clientId?: string | number, serverId?: number): Promise<void> {
    await this.api.post(`/urbackup/activities/${activityId}/stop`, {
      clientId,
      serverId,
    });
  }

  async clearStaleJobs(serverId?: number): Promise<{ staleJobsFound: number; staleJobsStopped: number }> {
    const response = await this.api.post<{ staleJobsFound: number; staleJobsStopped: number }>(
      '/urbackup/activities/clear-stale',
      { serverId }
    );
    return response.data;
  }

  async getUsage(serverId?: number): Promise<Usage> {
    const response = await this.api.get<Usage>('/urbackup/usage', {
      params: serverId ? { serverId } : undefined,
    });
    return response.data;
  }

  async addClient(clientName: string, serverId?: number): Promise<{ success: boolean; clientName: string }> {
    const response = await this.api.post<{ success: boolean; clientName: string }>('/urbackup/clients', {
      clientName,
      serverId,
    });
    return response.data;
  }

  async removeClient(clientId: number | string, serverId?: number): Promise<{ success: boolean; clientId: string }> {
    const response = await this.api.delete<{ success: boolean; clientId: string }>(`/urbackup/clients/${clientId}`, {
      data: { serverId },
    });
    return response.data;
  }

  async getClientAuthkey(clientId: number | string, serverId?: number): Promise<{ authkey: string; clientId: string }> {
    const response = await this.api.get<{ authkey: string; clientId: string }>(`/urbackup/clients/${clientId}/authkey`, {
      params: serverId ? { serverId } : undefined,
    });
    return response.data;
  }

  async updateClientName(clientId: number | string, newName: string, serverId?: number): Promise<{ success: boolean }> {
    const response = await this.api.patch<{ success: boolean }>(`/urbackup/clients/${clientId}/name`, {
      newName,
      serverId,
    });
    return response.data;
  }

  async regenerateClientKey(clientId: number | string, serverId?: number): Promise<{ success: boolean; authkey: string }> {
    const response = await this.api.post<{ success: boolean; authkey: string }>(`/urbackup/clients/${clientId}/regenerate-key`, {
      serverId,
    });
    return response.data;
  }

  getImageBackupConvertUrl(clientId: string | number, backupId: number): string {
    return `/api/urbackup/clients/${clientId}/image-backups/${backupId}/convert-download`;
  }

  async browseClientFilesystem(clientId: string, path: string = '/', backupId?: string) {
    const params: any = { path };
    if (backupId) params.backupId = backupId;
    const response = await this.api.get(`/urbackup/clients/${clientId}/browse`, { params });
    return response.data;
  }

  async deleteBackup(clientId: string | number, backupId: string | number, isImage: boolean): Promise<{ success: boolean }> {
    const response = await this.api.delete(`/urbackup/clients/${clientId}/backups/${backupId}`, { params: { image: isImage ? '1' : '0' } });
    return response.data;
  }

  async getJobLogs(clientId?: number, num = 50): Promise<{ logs: any[]; clients: any[] }> {
    const params: any = { num };
    if (clientId) params.clientId = clientId;
    const response = await this.api.get('/urbackup/job-logs', { params });
    return response.data;
  }

  async getJobLog(logId: number): Promise<{ clientname: string; entries: { severity: number; time: number; message: string }[] }> {
    const response = await this.api.get(`/urbackup/job-logs/${logId}`);
    return response.data;
  }

  async getBackupStats(days = 7): Promise<{ successful: number; failed: number; total: number; days: number }> {
    const response = await this.api.get('/urbackup/backup-stats', { params: { days } });
    return response.data;
  }

  async getStorageByCustomer(): Promise<{ id: number; name: string; company: string | null; client_count: number; file_bytes: number; image_bytes: number; total_bytes: number; clients: string[] }[]> {
    const response = await this.api.get('/urbackup/storage-by-customer');
    return response.data;
  }

  // Customers
  async getCustomers(): Promise<Customer[]> {
    const response = await this.api.get<Customer[]>('/customers');
    return response.data;
  }

  async getCustomer(id: number): Promise<Customer> {
    const response = await this.api.get<Customer>(`/customers/${id}`);
    return response.data;
  }

  async createCustomer(data: Partial<Customer>): Promise<Customer> {
    const response = await this.api.post<Customer>('/customers', data);
    return response.data;
  }

  async updateCustomer(id: number, data: Partial<Customer>): Promise<void> {
    await this.api.put(`/customers/${id}`, data);
  }

  async deleteCustomer(id: number): Promise<void> {
    await this.api.delete(`/customers/${id}`);
  }

  async getCustomerClients(customerId: number): Promise<CustomerClient[]> {
    const response = await this.api.get<CustomerClient[]>(`/customers/${customerId}/clients`);
    return response.data;
  }

  async addClientToCustomer(customerId: number, data: { server_id: number; client_name: string; client_id?: string; notes?: string }): Promise<CustomerClient> {
    const response = await this.api.post<CustomerClient>(`/customers/${customerId}/clients`, data);
    return response.data;
  }

  async removeClientFromCustomer(customerId: number, clientId: number): Promise<void> {
    await this.api.delete(`/customers/${customerId}/clients/${clientId}`);
  }

  async getClientCustomer(serverId: number, clientName: string): Promise<CustomerClient | null> {
    const response = await this.api.get<CustomerClient | null>(`/customers/by-client/${serverId}/${clientName}`);
    return response.data;
  }

  // Client Settings
  async getClientSettings(clientId: string, serverId?: number): Promise<any> {
    const response = await this.api.get(`/client-settings/${clientId}`, {
      params: serverId ? { serverId } : undefined,
    });
    return response.data;
  }

  async updateClientSettings(clientId: string, settings: any, serverId?: number): Promise<void> {
    await this.api.put(`/client-settings/${clientId}`, settings, {
      params: serverId ? { serverId } : undefined,
    });
  }

  // System Monitoring
  async getSystemMetrics(): Promise<SystemMetrics> {
    const response = await this.api.get<SystemMetrics>('/system-update/metrics');
    return response.data;
  }

  async getServerLatency(serverId: number): Promise<ServerLatency> {
    const response = await this.api.get<ServerLatency>(`/system/latency/${serverId}`);
    return response.data;
  }

  // Storage
  async getTotalStorage(): Promise<StorageInfo> {
    const response = await this.api.get<StorageInfo>('/storage/total');
    return response.data;
  }

  // Client Installers
  async getServerInfo(): Promise<{ serverIP: string; serverPort: string; serverUrl: string }> {
    const response = await this.api.get<{ serverIP: string; serverPort: string; serverUrl: string }>('/client-installer/server-info');
    return response.data;
  }

  async downloadWindowsInstaller(authKey?: string, clientId?: string): Promise<void> {
    const url = new URL('/api/client-installer/windows', window.location.origin);
    if (authKey) {
      url.searchParams.set('authkey', authKey);
    }
    if (clientId) {
      url.searchParams.set('clientid', clientId);
    }
    const response = await fetch(url.toString(), { credentials: 'include' });
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `UrBackupClient-${clientId || 'windows'}.exe`;
    a.click();
    URL.revokeObjectURL(objectUrl);
  }

  async downloadLinuxInstaller(authKey?: string, clientId?: string): Promise<void> {
    const url = new URL('/api/client-installer/linux', window.location.origin);
    if (authKey) {
      url.searchParams.set('authkey', authKey);
    }
    if (clientId) {
      url.searchParams.set('clientid', clientId);
    }
    const response = await fetch(url.toString(), { credentials: 'include' });
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `urbackup-client-installer.sh`;
    a.click();
    URL.revokeObjectURL(objectUrl);
  }

  // Replication
  async getReplicationSettings(): Promise<ReplicationSettings> {
    const response = await this.api.get<ReplicationSettings>('/replication/settings');
    return response.data;
  }

  async updateReplicationSettings(data: Partial<ReplicationSettings>): Promise<void> {
    await this.api.put('/replication/settings', data);
  }

  async getReplicationTargets(): Promise<ReplicationTarget[]> {
    const response = await this.api.get<ReplicationTarget[]>('/replication/targets');
    return response.data;
  }

  async createReplicationTarget(data: Partial<ReplicationTarget> & { ssh_private_key?: string; ssh_password?: string; target_db_dsn?: string }): Promise<ReplicationTarget> {
    const response = await this.api.post<ReplicationTarget>('/replication/targets', data);
    return response.data;
  }

  async updateReplicationTarget(id: string, data: Partial<ReplicationTarget> & { ssh_private_key?: string; ssh_password?: string; target_db_dsn?: string }): Promise<ReplicationTarget> {
    const response = await this.api.put<ReplicationTarget>(`/replication/targets/${id}`, data);
    return response.data;
  }

  async deleteReplicationTarget(id: string): Promise<void> {
    await this.api.delete(`/replication/targets/${id}`);
  }

  async testReplicationTarget(id: string): Promise<{ ok: boolean; checks: Record<string, { ok: boolean; message: string }> }> {
    const response = await this.api.post<{ ok: boolean; checks: Record<string, { ok: boolean; message: string }> }>(`/replication/targets/${id}/test`);
    return response.data;
  }

  async runReplicationTarget(id: string): Promise<{ runId: string }> {
    const response = await this.api.post<{ runId: string }>(`/replication/targets/${id}/run`);
    return response.data;
  }

  async getReplicationStatus(): Promise<ReplicationTargetStatus[]> {
    const response = await this.api.get<ReplicationTargetStatus[]>('/replication/status');
    return response.data;
  }

  async getReplicationRuns(targetId?: string, limit = 50): Promise<ReplicationRun[]> {
    const response = await this.api.get<ReplicationRun[]>('/replication/runs', {
      params: { ...(targetId ? { target_id: targetId } : {}), limit },
    });
    return response.data;
  }

  async getReplicationRun(id: string): Promise<ReplicationRun> {
    const response = await this.api.get<ReplicationRun>(`/replication/runs/${id}`);
    return response.data;
  }

  async getReplicationAlertChannels(): Promise<ReplicationAlertChannel[]> {
    const response = await this.api.get<ReplicationAlertChannel[]>('/replication/alerts/channels');
    return response.data;
  }

  async updateReplicationAlertChannels(channels: Partial<ReplicationAlertChannel>[]): Promise<ReplicationAlertChannel[]> {
    const response = await this.api.put<ReplicationAlertChannel[]>('/replication/alerts/channels', { channels });
    return response.data;
  }

  async deleteReplicationAlertChannel(id: string): Promise<void> {
    await this.api.delete(`/replication/alerts/channels/${id}`);
  }

  async getReplicationEvents(targetId?: string, limit = 50): Promise<ReplicationEvent[]> {
    const response = await this.api.get<ReplicationEvent[]>('/replication/events', {
      params: { ...(targetId ? { target_id: targetId } : {}), limit },
    });
    return response.data;
  }

  async getReplicationSetupInstructions(): Promise<{ steps: Array<{ title: string; description: string; commands: string[] }> }> {
    const response = await this.api.get('/replication/targets/setup-instructions');
    return response.data;
  }

  // Storage Limits
  async getStorageLimits(): Promise<StorageLimit[]> {
    const response = await this.api.get<StorageLimit[]>('/storage-limits');
    return response.data;
  }

  async upsertStorageLimit(clientName: string, limit: { limit_bytes: number; warn_threshold_pct?: number; critical_threshold_pct?: number }): Promise<StorageLimit> {
    const response = await this.api.put<StorageLimit>(`/storage-limits/${encodeURIComponent(clientName)}`, limit);
    return response.data;
  }

  async deleteStorageLimit(clientName: string): Promise<void> {
    await this.api.delete(`/storage-limits/${encodeURIComponent(clientName)}`);
  }

  async getStorageLimitStatuses(clients: { name: string; bytes_used: number }[]): Promise<StorageLimitStatus[]> {
    const response = await this.api.post<StorageLimitStatus[]>('/storage-limits/status', { clients });
    return response.data;
  }
}

export const api = new ApiService();
