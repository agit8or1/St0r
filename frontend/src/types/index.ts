export interface User {
  id: number;
  username: string;
  email: string;
  isAdmin: boolean;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface UrBackupServer {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServerRequest {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  isDefault?: boolean;
}

export interface Client {
  id: string;
  name: string;
  lastbackup?: number;
  lastbackup_image?: number;
  lastseen?: number;
  online: boolean;
  status: string;
  ip?: string;
  uid?: string;
  file_ok?: boolean;
  image_ok?: boolean;
  bytes_used_files?: number;
  bytes_used_images?: number;
}

export interface Activity {
  id: string;
  action: string;
  client: string;
  pcdone: number;
  eta_ms: number;
  done_bytes: number;
  total_bytes: number;
  errors?: number;
  success?: boolean | number | string;
}

export interface Backup {
  id: string;
  backuptime: number;
  image: boolean;
  incremental: boolean;
  size_bytes: number;
  duration: number;
}

export interface Status {
  online_clients: number;
  offline_clients: number;
  active_processes: number;
  failed_backups: number;
}

export interface Usage {
  used: number;
  total: number;
}

export interface Customer {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: string;
  notes?: string;
  is_active: boolean;
  client_count?: number;
  user_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface CustomerClient {
  id: number;
  customer_id: number;
  server_id: number;
  client_name: string;
  client_id?: string;
  notes?: string;
  server_name?: string;
  server_host?: string;
  customer_name?: string;
  customer_company?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SystemMetrics {
  cpu: {
    usage: number;
    cores: number;
    model: string;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  uptime: number;
  hostname: string;
}

export interface ServerLatency {
  serverId: number;
  host: string;
  port: number;
  latency: number;
  status: 'connected' | 'unreachable';
}

export interface StorageInfo {
  used: number;
  available: number;
  servers: Array<{
    serverId: number;
    serverName: string;
    used: number;
    available: number;
    error?: string;
  }>;
}
