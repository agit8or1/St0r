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

    // getClients() already merges live status (online, ip, os, delete_pending) from UrBackup API
    const allClients = await service.getClients();

    logger.info(`[${username}] Retrieved ${allClients?.length || 0} clients from UrBackup API`);

    // Filter out clients pending deletion
    const activeClients = (allClients as any[]).filter((c: any) => !c.delete_pending);

    const onlineCount = activeClients.filter((c: any) => c.online).length;
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

    // Check start_ok from UrBackup result
    const resultArr: any[] = result?.result || (Array.isArray(result) ? result : []);
    const failed = resultArr.filter((r: any) => r.start_ok === false);
    if (failed.length > 0) {
      const types = failed.map((r: any) => r.start_type).join(', ');
      logger.warn(`start_backup returned start_ok=false for types: ${types}. Client may be offline or internet backups may be disabled.`);
      res.status(400).json({
        error: `Backup could not be started (start_ok=false). The client may be offline, or internet ${backupType} backups may be disabled in client settings.`,
        result
      });
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
    const { clientId } = req.body;

    if (!activityId) {
      res.status(400).json({ error: 'Activity ID is required' });
      return;
    }

    const service = await getService();

    if (!service) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const result = await service.stopActivity(activityId, clientId);
    res.json(result);
  } catch (error) {
    logger.error('Failed to stop activity:', error);
    res.status(500).json({ error: 'Failed to stop activity' });
  }
}

export async function clearStaleJobs(req: AuthRequest, res: Response): Promise<void> {
  try {
    const service = await getService();

    if (!service) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const result = await service.clearStaleJobs();
    res.json(result);
  } catch (error) {
    logger.error('Failed to clear stale jobs:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to clear stale jobs' });
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

export async function deleteBackup(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId, backupId } = req.params;
    const isImage = req.query.image === '1' || req.query.image === 'true' || req.body?.isImage === true;
    if (!backupId) { res.status(400).json({ error: 'Backup ID is required' }); return; }
    const service = await getService();
    if (!service) { res.status(404).json({ error: 'Server not found' }); return; }
    const result = await service.deleteBackup(backupId, isImage);
    res.json(result);
  } catch (error: any) {
    logger.error('Failed to delete backup:', error);
    res.status(500).json({ error: error.message || 'Failed to delete backup' });
  }
}

export async function getJobLogs(req: AuthRequest, res: Response): Promise<void> {
  try {
    const service = await getService();
    if (!service) { res.status(404).json({ error: 'Server not found' }); return; }
    const clientId = req.query.clientId ? parseInt(req.query.clientId as string) : undefined;
    const num = req.query.num ? parseInt(req.query.num as string) : 50;
    const result = await service.getJobLogs(clientId, num);
    res.json(result);
  } catch (error) {
    logger.error('Failed to get job logs:', error);
    res.status(500).json({ error: 'Failed to get job logs' });
  }
}

export async function getJobLog(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { logId } = req.params;
    if (!logId) { res.status(400).json({ error: 'Log ID is required' }); return; }
    const service = await getService();
    if (!service) { res.status(404).json({ error: 'Server not found' }); return; }
    const result = await service.getJobLog(parseInt(logId));
    res.json(result);
  } catch (error) {
    logger.error('Failed to get job log:', error);
    res.status(500).json({ error: 'Failed to get job log' });
  }
}

export async function getFailedPaths(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;
    if (!clientId) { res.status(400).json({ error: 'Client ID is required' }); return; }
    const service = await getService();
    if (!service) { res.status(404).json({ error: 'Server not found' }); return; }
    const result = await service.getFailedPaths(parseInt(clientId));
    res.json(result);
  } catch (error) {
    logger.error('Failed to get failed paths:', error);
    res.status(500).json({ error: 'Failed to get failed paths' });
  }
}

export async function browseClientFilesystem(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;
    const path = (req.query.path as string) || '';
    const service = await getService();
    if (!service) { res.status(404).json({ error: 'Server not found' }); return; }
    const result = await service.browseClientFilesystem(clientId, path);
    res.json(result);
  } catch (error) {
    logger.error('Failed to browse client filesystem:', error);
    res.status(500).json({ error: 'Failed to browse client filesystem' });
  }
}
