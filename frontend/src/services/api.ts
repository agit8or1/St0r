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
} from '../types';

class ApiService {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: '/api',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add token to requests
    this.api.interceptors.request.use((config) => {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Handle 401 errors
    this.api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('token');
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

  async stopActivity(activityId: string, serverId?: number): Promise<void> {
    await this.api.post(`/urbackup/activities/${activityId}/stop`, {
      serverId,
    });
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
    const response = await this.api.get<SystemMetrics>('/system/metrics');
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

  downloadWindowsInstaller(authKey?: string, clientId?: string): void {
    const token = localStorage.getItem('token');
    const url = new URL('/api/client-installer/windows', window.location.origin);
    url.searchParams.set('token', token || '');
    if (authKey) {
      url.searchParams.set('authkey', authKey);
    }
    if (clientId) {
      url.searchParams.set('clientid', clientId);
    }
    window.location.href = url.toString();
  }

  downloadLinuxInstaller(authKey?: string, clientId?: string): void {
    const token = localStorage.getItem('token');
    const url = new URL('/api/client-installer/linux', window.location.origin);
    url.searchParams.set('token', token || '');
    if (authKey) {
      url.searchParams.set('authkey', authKey);
    }
    if (clientId) {
      url.searchParams.set('clientid', clientId);
    }
    window.location.href = url.toString();
  }
}

export const api = new ApiService();
