import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { UrBackupService } from '../services/urbackup.js';
import { logger } from '../utils/logger.js';

// Since st0r runs on the same server as UrBackup, we always use a single local service instance
const urbackupService = new UrBackupService();

async function getService(): Promise<UrBackupService> {
  return urbackupService;
}

export async function getStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const service = await getService();

    if (!service) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const status = await service.getStatus();
    res.json(status);
  } catch (error) {
    logger.error('Failed to get status:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
}

export async function getClients(req: AuthRequest, res: Response): Promise<void> {
  try {
    const serverId = req.query.serverId as string;
    const userId = req.user?.userId;
    const username = req.user?.username || 'unknown';

    logger.info(`[${username}] GET /api/urbackup/clients (serverId: ${serverId || 'default'})`);

    const service = await getService();

    if (!service) {
      logger.warn(`[${username}] Server not found (serverId: ${serverId})`);
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    // Get both client list and status for comprehensive information
    const [clients, status] = await Promise.all([
      service.getClients(),
      service.getStatus()
    ]);

    logger.info(`[${username}] Retrieved ${clients?.length || 0} clients from UrBackup API`);

    // Create a map of client status data from the status response
    const statusMap = new Map();
    if (status && Array.isArray(status)) {
      status.forEach((clientStatus: any) => {
        const clientId = clientStatus.id || clientStatus.clientid;
        if (clientId) {
          statusMap.set(clientId, {
            online: clientStatus.online === true,
            ip: clientStatus.ip || clientStatus.lastip || null,
            os_simple: clientStatus.os_simple,
            os_version_string: clientStatus.os_version_string,
            delete_pending: clientStatus.delete_pending === '1' || clientStatus.delete_pending === 1
          });
        }
      });
    }

    // Get current timestamp for online status calculation
    const now = Math.floor(Date.now() / 1000);
    const ONLINE_THRESHOLD = 10 * 60; // 10 minutes

    // Normalize and enrich client data
    const normalizedClients = clients.map((client: any) => {
      const clientId = client.id || client.clientid || client.client_id;
      const statusInfo = statusMap.get(clientId) || {};

      // Get IP address and filter out invalid values
      let ipAddress = statusInfo.ip || client.ip || client.lastip || null;
      if (ipAddress === '-' || ipAddress === '' || ipAddress === 'null') {
        ipAddress = null;
      }

      // Determine online status with proper validation
      // 1. First check if status API explicitly says client is online
      // 2. Then check lastseen timestamp as fallback
      // 3. Consider online ONLY if seen within last 10 minutes AND lastseen is not in future
      let isOnline = false;
      let onlineReason = 'offline';

      // Check status API first
      if (statusInfo.online === true) {
        isOnline = true;
        onlineReason = 'status_api';
      }
      // Fallback to lastseen check
      else if (client.lastseen && typeof client.lastseen === 'number') {
        // lastseen is in milliseconds, convert to seconds for comparison
        const lastseenSeconds = Math.floor(client.lastseen / 1000);
        const timeSinceLastSeen = now - lastseenSeconds;
        // Only consider online if: within threshold AND not in future (sanity check)
        if (timeSinceLastSeen >= 0 && timeSinceLastSeen <= ONLINE_THRESHOLD) {
          isOnline = true;
          onlineReason = 'lastseen_recent';
        } else {
          onlineReason = `offline_${Math.floor(timeSinceLastSeen / 60)}min_ago`;
        }
      }

      // Log client status for debugging
      if (isOnline) {
        logger.info(`  Client "${client.name}" (ID: ${clientId}) is ONLINE via ${onlineReason}, lastseen: ${client.lastseen ? new Date(client.lastseen).toISOString() : 'never'}, IP: ${ipAddress || 'none'}`);
      }

      return {
        ...client,
        id: clientId,
        online: isOnline,
        ip: ipAddress,
        os_simple: statusInfo.os_simple || client.os_simple,
        os_version_string: statusInfo.os_version_string || client.os_version_string,
        delete_pending: statusInfo.delete_pending || false
      };
    });

    // Filter out clients pending deletion
    const activeClients = normalizedClients.filter(client => !client.delete_pending);

    const onlineCount = activeClients.filter(c => c.online).length;
    logger.info(`[${username}] Returning ${activeClients.length} clients (${onlineCount} online, ${activeClients.length - onlineCount} offline)`);

    res.json(activeClients);
  } catch (error) {
    logger.error('Failed to get clients:', error);
    res.status(500).json({ error: 'Failed to get clients' });
  }
}

export async function getOnlineClients(req: AuthRequest, res: Response): Promise<void> {
  try {
    const service = await getService();

    if (!service) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const clients = await service.getOnlineClients();
    res.json(clients);
  } catch (error) {
    logger.error('Failed to get online clients:', error);
    res.status(500).json({ error: 'Failed to get online clients' });
  }
}

export async function getOfflineClients(req: AuthRequest, res: Response): Promise<void> {
  try {
    const service = await getService();

    if (!service) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const clients = await service.getOfflineClients();
    res.json(clients);
  } catch (error) {
    logger.error('Failed to get offline clients:', error);
    res.status(500).json({ error: 'Failed to get offline clients' });
  }
}

export async function getFailedClients(req: AuthRequest, res: Response): Promise<void> {
  try {
    const service = await getService();

    if (!service) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const clients = await service.getFailedClients();
    res.json(clients);
  } catch (error) {
    logger.error('Failed to get failed clients:', error);
    res.status(500).json({ error: 'Failed to get failed clients' });
  }
}

export async function getActivities(req: AuthRequest, res: Response): Promise<void> {
  try {
    const service = await getService();

    if (!service) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const activities = await service.getActivities();
    res.json(activities);
  } catch (error) {
    logger.error('Failed to get activities:', error);
    res.status(500).json({ error: 'Failed to get activities' });
  }
}

export async function getCurrentActivities(req: AuthRequest, res: Response): Promise<void> {
  try {
    const service = await getService();

    if (!service) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const activities = await service.getCurrentActivities();
    res.json(activities);
  } catch (error) {
    logger.error('Failed to get current activities:', error);
    res.status(500).json({ error: 'Failed to get current activities' });
  }
}

export async function getBackups(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;

    if (!clientId) {
      res.status(400).json({ error: 'Client ID is required' });
      return;
    }

    const service = await getService();

    if (!service) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const backups = await service.getBackups(clientId);
    res.json(backups);
  } catch (error) {
    logger.error('Failed to get backups:', error);
    res.status(500).json({ error: 'Failed to get backups' });
  }
}

export async function startBackup(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientName, clientId, backupType, isIncremental } = req.body;

    logger.info(`Backup start request: client=${clientName}, clientId=${clientId}, type=${backupType}, incremental=${isIncremental}`);

    if ((!clientName && !clientId) || !backupType) {
      res.status(400).json({ error: 'Client name/ID and backup type are required' });
      return;
    }

    const service = await getService();

    if (!service) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    let result;

    if (backupType === 'file') {
      result = isIncremental
        ? await service.startIncrementalFileBackup(clientName, clientId)
        : await service.startFullFileBackup(clientName, clientId);
    } else if (backupType === 'image') {
      result = isIncremental
        ? await service.startIncrementalImageBackup(clientName, clientId)
        : await service.startFullImageBackup(clientName, clientId);
    } else {
      res.status(400).json({ error: 'Invalid backup type' });
      return;
    }

    res.json({ success: true, result });
  } catch (error: any) {
    logger.error('Failed to start backup:', error);
    res.status(500).json({ error: error.message || 'Failed to start backup' });
  }
}

export async function stopActivity(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { activityId } = req.params;

    if (!activityId) {
      res.status(400).json({ error: 'Activity ID is required' });
      return;
    }

    const service = await getService();

    if (!service) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const result = await service.stopActivity(activityId);
    res.json(result);
  } catch (error) {
    logger.error('Failed to stop activity:', error);
    res.status(500).json({ error: 'Failed to stop activity' });
  }
}

export async function getUsage(req: AuthRequest, res: Response): Promise<void> {
  try {
    const service = await getService();

    if (!service) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const usage = await service.getUsage();
    res.json(usage);
  } catch (error) {
    logger.error('Failed to get usage:', error);
    res.status(500).json({ error: 'Failed to get usage' });
  }
}

export async function addClient(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientName, serverId } = req.body;

    if (!clientName) {
      res.status(400).json({ error: 'Client name is required' });
      return;
    }

    const service = await getService();

    if (!service) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const result = await service.addClient(clientName);
    res.json({ success: result, clientName });
  } catch (error) {
    logger.error('Failed to add client:', error);
    res.status(500).json({ error: 'Failed to add client' });
  }
}

export async function removeClient(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;
    const { serverId } = req.body;

    if (!clientId) {
      res.status(400).json({ error: 'Client ID is required' });
      return;
    }

    const service = await getService();

    if (!service) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const result = await service.removeClient(clientId);
    res.json({ success: result, clientId });
  } catch (error) {
    logger.error('Failed to remove client:', error);
    res.status(500).json({ error: 'Failed to remove client' });
  }
}

export async function getClientAuthkey(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;
    const serverId = req.query.serverId as string;

    if (!clientId) {
      res.status(400).json({ error: 'Client ID is required' });
      return;
    }

    const service = await getService();

    if (!service) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const authkey = await service.getClientAuthkey(clientId);
    res.json({ authkey, clientId });
  } catch (error) {
    logger.error('Failed to get client authkey:', error);
    res.status(500).json({ error: 'Failed to get client authentication key' });
  }
}

export async function updateClientName(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;
    const { newName, serverId } = req.body;

    if (!clientId || !newName) {
      res.status(400).json({ error: 'Client ID and new name are required' });
      return;
    }

    const service = await getService();

    if (!service) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const result = await service.updateClientName(clientId, newName);
    res.json({ success: result, clientId, newName });
  } catch (error) {
    logger.error('Failed to update client name:', error);
    res.status(500).json({ error: 'Failed to update client name' });
  }
}

export async function regenerateClientKey(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;
    const { serverId } = req.body;

    if (!clientId) {
      res.status(400).json({ error: 'Client ID is required' });
      return;
    }

    const service = await getService();

    if (!service) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const newAuthkey = await service.regenerateClientAuthkey(clientId);
    res.json({ success: true, authkey: newAuthkey, clientId });
  } catch (error) {
    logger.error('Failed to regenerate client key:', error);
    res.status(500).json({ error: 'Failed to regenerate client authentication key' });
  }
}
