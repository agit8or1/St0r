import { UrBackupService } from './urbackup.js';
import { logger } from '../utils/logger.js';

export class StorageCalculator {
  /**
   * Get storage data from UrBackup usage endpoint (most reliable method)
   */
  async calculateStorageFromStatus(service: UrBackupService): Promise<{ used: number; available: number }> {
    try {
      // First try the usage endpoint which has actual storage data
      try {
        const usage = await service.getUsage();

        if (Array.isArray(usage) && usage.length > 0) {
          let totalUsed = 0;

          logger.info(`Got usage data for ${usage.length} clients`);

          for (const clientUsage of usage as any[]) {
            const bytes = parseInt(clientUsage.bytes || '0');
            if (bytes > 0) {
              logger.info(`Client ${clientUsage.name}: ${bytes} bytes`);
              totalUsed += bytes;
            }
          }

          if (totalUsed > 0) {
            logger.info(`Calculated storage from usage API: ${totalUsed} bytes`);
            return { used: totalUsed, available: 0 };
          }
        }
      } catch (usageError) {
        logger.warn('Usage API not available, trying backup summation:', usageError);
      }

      // Fallback: Try getting clients and their backups
      const clients = await service.getClients();
      logger.info(`Fallback: calculating from ${clients.length} clients' backups`);

      let totalUsed = 0;

      for (const client of clients as any[]) {
        if (client.id || client.clientid) {
          try {
            const clientId = (client.id || client.clientid).toString();
            const backups = await service.getBackups(clientId);

            // getBackups returns {file: [], image: []}
            const allBackups = [...(backups.file || []), ...(backups.image || [])];

            for (const backup of allBackups) {
              if (backup.size_bytes) {
                totalUsed += backup.size_bytes;
              }
            }
          } catch (backupError) {
            logger.debug(`Could not get backups for client ${client.name}:`, backupError);
          }
        }
      }

      logger.info(`Calculated storage from backup summation: ${totalUsed} bytes from ${clients.length} clients`);
      return { used: totalUsed, available: 0 };
    } catch (error) {
      logger.error('Failed to calculate storage:', error);
      return { used: 0, available: 0 };
    }
  }
}
