import { logger } from '../utils/logger.js';
import { UrBackupDbService } from './urbackupDb.js';
import { execFileSync } from 'child_process';

// For write operations, we still need to communicate with the UrBackup server
// Since we're running on the same server, we can use localhost
const URBACKUP_API_URL = process.env.URBACKUP_API_URL || 'http://localhost:55414/x';
const URBACKUP_USERNAME = process.env.URBACKUP_USERNAME || 'admin';
const URBACKUP_PASSWORD = process.env.URBACKUP_PASSWORD || '';

export class UrBackupService {
  private dbService: UrBackupDbService;
  private sessionId: string = '';
  private sessionExpiry: number = 0;

  constructor() {
    this.dbService = new UrBackupDbService();
  }

  /**
   * Get authenticated session from UrBackup API
   */
  private async login(): Promise<string> {
    // Check if we have a cached valid session
    if (this.sessionId && this.sessionExpiry && Date.now() < this.sessionExpiry) {
      logger.info(`[UrBackup API] Using cached session: ${this.sessionId}`);
      return this.sessionId;
    }

    try {
      const crypto = await import('crypto');

      logger.info(`[UrBackup API] Step 1: Getting salt from UrBackup server`);

      // Step 1: Get salt and session (with retry for error 3)
      let saltData: any = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const saltResponse = await fetch(`${URBACKUP_API_URL}?a=salt`, {
          method: 'POST',
          headers: {
            'User-Agent': 'st0r',
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: `username=${URBACKUP_USERNAME}`
        });

        const saltText = await saltResponse.text();
        const parsedData = JSON.parse(saltText);

        if (parsedData.error === 3) {
          logger.warn(`[UrBackup API] Got error 3 from salt endpoint (attempt ${attempt}/3), retrying...`);
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms before retry
            continue;
          }
        }

        if (parsedData.ses && parsedData.salt) {
          saltData = parsedData;
          break;
        }

        // No-password mode: UrBackup returns ses but no salt
        if (parsedData.ses && !parsedData.salt && parsedData.error === 0) {
          saltData = { ...parsedData, noPassword: true };
          break;
        }
      }

      if (!saltData || !saltData.ses) {
        logger.error(`[UrBackup API] Failed to get valid salt after 3 attempts`);
        throw new Error('Failed to get salt/session from UrBackup server');
      }

      logger.info(`[UrBackup API] Salt response: ${JSON.stringify(saltData)}`);

      // No-password mode: salt endpoint returned ses but no salt.
      // Use simple GET login with the configured password (may be empty).
      if (saltData.noPassword) {
        logger.info(`[UrBackup API] No-password mode — using simple GET login`);
        const loginUrl = `${URBACKUP_API_URL}?a=login&username=${encodeURIComponent(URBACKUP_USERNAME)}&password=${encodeURIComponent(URBACKUP_PASSWORD)}`;
        const loginResponse = await fetch(loginUrl);
        const loginData: any = JSON.parse(await loginResponse.text());
        logger.info(`[UrBackup API] Simple login response: ${JSON.stringify(loginData)}`);
        if (!loginData.success) {
          throw new Error(`UrBackup login failed (error ${loginData.error})`);
        }
        this.sessionId = loginData.session || saltData.ses;
        this.sessionExpiry = Date.now() + (30 * 60 * 1000);
        logger.info(`[UrBackup API] ✓ Authenticated (no-password mode)! Session: ${this.sessionId}`);
        return this.sessionId;
      }

      logger.info(`[UrBackup API] Got salt: ${saltData.salt}, session: ${saltData.ses}`);

      // Step 2: Hash password using session-based auth (calcPwHash method)
      // This matches the frontend TypeScript code exactly
      let finalPassword: string;
      if (saltData.pbkdf2_rounds) {
        // Use PBKDF2 for newer UrBackup versions
        logger.info(`[UrBackup API] Using session-based auth with PBKDF2 (${saltData.pbkdf2_rounds} rounds)`);

        // Step 2a: MD5(salt + password) as binary
        const md5Binary = crypto.createHash('md5')
          .update(saltData.salt + URBACKUP_PASSWORD)
          .digest();  // Keep as binary Buffer
        logger.info(`[UrBackup API] MD5(salt+password): ${md5Binary.toString('hex')}`);

        // Step 2b: PBKDF2(md5_binary, salt, rounds) to get password_md5
        const pbkdf2Hash = crypto.pbkdf2Sync(
          md5Binary,
          saltData.salt,
          saltData.pbkdf2_rounds,
          32,
          'sha256'
        ).toString('hex').toLowerCase();
        logger.info(`[UrBackup API] PBKDF2 hash (password_md5): ${pbkdf2Hash}`);

        // Step 2c: MD5(rnd + password_md5) - This is the key step!
        finalPassword = crypto.createHash('md5')
          .update(saltData.rnd + pbkdf2Hash)
          .digest('hex').toLowerCase();
        logger.info(`[UrBackup API] Final password MD5(rnd + password_md5): ${finalPassword}`);
      } else {
        // Use MD5 for older UrBackup versions (no PBKDF2)
        logger.info(`[UrBackup API] Using session-based auth with MD5 only`);
        const md5Hash = crypto.createHash('md5')
          .update(saltData.salt + URBACKUP_PASSWORD)
          .digest('hex').toLowerCase();

        // MD5(rnd + md5_hash)
        finalPassword = crypto.createHash('md5')
          .update(saltData.rnd + md5Hash)
          .digest('hex').toLowerCase();
      }

      logger.info(`[UrBackup API] Step 3: Logging in with session-based auth`);

      // Step 3: Login with hashed password (NO plainpw flag for session-based auth)
      const loginResponse = await fetch(`${URBACKUP_API_URL}?a=login`, {
        method: 'POST',
        headers: {
          'User-Agent': 'st0r',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `username=${URBACKUP_USERNAME}&password=${finalPassword}&ses=${saltData.ses}`
      });

      const loginText = await loginResponse.text();
      logger.info(`[UrBackup API] Login response text: ${loginText}`);

      const loginData: any = JSON.parse(loginText);
      logger.info(`[UrBackup API] Login response parsed:`, JSON.stringify(loginData));

      // In session-based auth, success=true is enough. The session comes from saltData.
      if (!loginData.success && loginData.error) {
        logger.error(`[UrBackup API] Login failed with error: ${loginData.error}`);
        throw new Error('Failed to authenticate with UrBackup server');
      }

      // Use the session from salt API response (already stored in saltData.ses)
      this.sessionId = loginData.session || saltData.ses;
      this.sessionExpiry = Date.now() + (30 * 60 * 1000); // 30 minute expiry

      logger.info(`[UrBackup API] ✓ Authenticated successfully! Session: ${this.sessionId}`);
      return this.sessionId;
    } catch (error) {
      logger.error('[UrBackup API] Failed to login to UrBackup server:', error);
      throw new Error('Failed to login to UrBackup server');
    }
  }

  /**
   * Parse UrBackup log for current file transfer progress
   * Returns the latest file being transferred with progress details
   */
  private parseCurrentTransferProgress(clientId: number): any | null {
    try {
      // Read last 200 lines from urbackup log and find the latest progress line in JS
      const tailOutput = execFileSync('tail', ['-200', '/var/log/urbackup.log'], {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const progressLines = tailOutput.split('\n').filter(l => l.includes('% finished'));
      const logOutput = (progressLines[progressLines.length - 1] ?? '').trim();

      if (!logOutput) {
        return null;
      }

      // Parse log line like:
      // 2025-11-17 19:27:49: Loading "C/Users/User/Desktop/Camera01/LRV_20250531_121453_01_100.lrv". 49% finished 945.481 MB/1.86345 GB at 132.21 MBit/s
      const match = logOutput.match(/Loading "(.+)"\.\s+(\d+)% finished\s+([\d.]+)\s+(\w+)\/([\d.]+)\s+(\w+)\s+at\s+([\d.]+)\s+(\w+)\/s/);

      if (!match) {
        return null;
      }

      const [, filename, percent, doneValue, doneUnit, totalValue, totalUnit, speedValue, speedUnit] = match;

      // Convert to bytes
      const unitMultiplier: Record<string, number> = {
        'B': 1,
        'KB': 1024,
        'MB': 1024 * 1024,
        'GB': 1024 * 1024 * 1024,
        'TB': 1024 * 1024 * 1024 * 1024
      };

      const doneBytes = parseFloat(doneValue) * (unitMultiplier[doneUnit] || 1);
      const totalBytes = parseFloat(totalValue) * (unitMultiplier[totalUnit] || 1);
      const speedBytesPerSec = parseFloat(speedValue) * (unitMultiplier[speedUnit.replace('it', '')] || 1) / 8; // Convert bits to bytes

      // Calculate ETA in seconds
      const remainingBytes = totalBytes - doneBytes;
      const etaSeconds = speedBytesPerSec > 0 ? Math.round(remainingBytes / speedBytesPerSec) : 0;

      return {
        currentFile: filename.split('/').pop() || filename,
        currentFileProgress: parseInt(percent),
        done_bytes: Math.round(doneBytes),
        total_bytes: Math.round(totalBytes),
        speed_bpms: Math.round(speedBytesPerSec * 1000), // Convert to bytes per millisecond
        eta_ms: etaSeconds * 1000, // Convert to milliseconds
        pcdone: parseInt(percent)
      };
    } catch (error) {
      logger.debug('[parseCurrentTransferProgress] Could not parse log:', error);
      return null;
    }
  }

  /**
   * Make an authenticated API call to UrBackup
   */
  private async apiCall(action: string, params: Record<string, any> = {}): Promise<any> {
    logger.info(`[UrBackup API] ==> apiCall: action='${action}', params=`, JSON.stringify(params));

    // Actions that REQUIRE a session - always get session first
    const requiresSession = ['start_backup', 'stop_backup', 'start_incr_file_backup', 'start_full_file_backup',
                             'start_incr_image_backup', 'start_full_image_backup', 'progress', 'status'];

    let queryParams: URLSearchParams;

    let sessionForUrl = '';

    if (requiresSession.includes(action)) {
      // Get session first for actions that require it
      logger.info(`[UrBackup API] Action '${action}' requires session - getting session first`);
      const session = await this.login();
      sessionForUrl = session;
      queryParams = new URLSearchParams({
        ...params,
        a: action,
        ses: session
      });
    } else {
      // Try without session first for other actions
      queryParams = new URLSearchParams({
        ...params,
        a: action
      });
    }

    try {
      const url = sessionForUrl
        ? `${URBACKUP_API_URL}?a=${action}&ses=${sessionForUrl}`
        : `${URBACKUP_API_URL}?a=${action}`;
      const body = queryParams.toString();

      logger.info(`[UrBackup API] POST ${url}`);
      logger.info(`[UrBackup API] Body: ${body}`);

      // UrBackup API requires POST requests, not GET!
      let response = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': 'st0r',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body
      });

      logger.info(`[UrBackup API] Response: ${response.status} ${response.statusText}`);

      // Get response text first to check if it's empty
      const responseText = await response.text();
      logger.info(`[UrBackup API] Response body: '${responseText}' (${responseText.length} bytes)`);

      let result: any;

      try {
        // Try to parse as JSON
        result = responseText ? JSON.parse(responseText) : {};
        logger.info(`[UrBackup API] Parsed result:`, JSON.stringify(result));
      } catch (parseError) {
        logger.warn(`[UrBackup API] JSON parse error: ${parseError}`);
        // If parsing fails and status is 200, treat as success
        if (response.status === 200 || response.status === 204) {
          logger.info(`[UrBackup API] <== Empty response, treating as success`);
          return { success: true };
        }
        throw new Error(`Invalid JSON response: ${responseText}`);
      }

      // If a session-required action returns error:1, our cached session is stale — re-login and retry once
      if (result.error === 1 && requiresSession.includes(action)) {
        logger.warn(`[UrBackup API] Session expired for '${action}', clearing cache and re-authenticating`);
        this.sessionId = '';
        this.sessionExpiry = 0;
        const freshSession = await this.login();
        const retryParams = new URLSearchParams({ ...params, a: action, ses: freshSession });
        const retryUrl = `${URBACKUP_API_URL}?a=${action}&ses=${freshSession}`;
        const retryResp = await fetch(retryUrl, {
          method: 'POST',
          headers: { 'User-Agent': 'st0r', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: retryParams.toString()
        });
        const retryText = await retryResp.text();
        result = retryText ? JSON.parse(retryText) : {};
        logger.info(`[UrBackup API] Re-auth retry result:`, JSON.stringify(result));
      }

      // If we get an error AND we didn't already use a session, try with session
      if (result.error && !requiresSession.includes(action)) {
        logger.warn(`[UrBackup API] Got error response, trying with session...`);
        try{
          const session = await this.login();
          logger.info(`[UrBackup API] Retrying with session: ${session}`);

          queryParams = new URLSearchParams({
            ...params,
            a: action,
            ses: session
          });

          const retryUrl = `${URBACKUP_API_URL}?a=${action}&ses=${session}`;
          const retryBody = queryParams.toString();

          logger.info(`[UrBackup API] Retry POST ${retryUrl}`);
          logger.info(`[UrBackup API] Retry Body: ${retryBody}`);

          response = await fetch(retryUrl, {
            method: 'POST',
            headers: {
              'User-Agent': 'st0r',
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: retryBody
          });

          logger.info(`[UrBackup API] Retry Response: ${response.status} ${response.statusText}`);

          const authResponseText = await response.text();
          logger.info(`[UrBackup API] Retry Response body: '${authResponseText}' (${authResponseText.length} bytes)`);

          try {
            result = authResponseText ? JSON.parse(authResponseText) : {};
            logger.info(`[UrBackup API] Retry Parsed result:`, JSON.stringify(result));
          } catch (parseError) {
            logger.warn(`[UrBackup API] Retry JSON parse error: ${parseError}`);
            if (response.status === 200 || response.status === 204) {
              logger.info(`[UrBackup API] <== Retry empty response, treating as success`);
              return { success: true };
            }
            throw new Error(`Invalid JSON response: ${authResponseText}`);
          }
        } catch (authError) {
          logger.warn('[UrBackup API] Authentication failed, using unauthenticated request:', authError);
        }
      }

      // Check for API errors
      if (result.error) {
        logger.error(`[UrBackup API] API returned error: ${result.error}`);
        throw new Error(`UrBackup API error: ${result.error}`);
      }

      // If result is empty and HTTP status was OK, treat as success
      if (Object.keys(result).length === 0 && response.status === 200) {
        logger.info(`[UrBackup API] <== Empty result object, treating as success`);
        return { success: true };
      }

      logger.info(`[UrBackup API] <== Returning result:`, JSON.stringify(result));
      return result;
    } catch (error) {
      logger.error(`API call failed for action ${action}:`, error);
      throw error;
    }
  }

  // ========== HELPER METHODS ==========

  /**
   * Map UrBackup action integer to readable string
   * Based on urbackupserver/server_status.h action enum
   */
  private getActionString(action: number): string {
    // Matches UrBackup's action enum from urbackupserver JS UI (status + progress API)
    const actionMap: Record<number, string> = {
      0:  'Idle',
      1:  'Incremental file backup',
      2:  'Full file backup',
      3:  'Incremental image backup',
      4:  'Full image backup',
      5:  'Resumed incremental file backup',
      6:  'Resumed full file backup',
      7:  'Resumed incremental image backup',
      8:  'Resumed full image backup',
      9:  'Restoring image',
      10: 'Starting backup',
      11: 'Hashing files',
      12: 'Checking files',
      13: 'Restoring file',
    };
    return actionMap[action] || `Unknown action (${action})`;
  }

  private isImageAction(action: number): boolean {
    // Image backup actions: 3, 4, 7, 8, 9
    return [3, 4, 7, 8, 9].includes(action);
  }

  private isIncrementalAction(action: number): boolean {
    // Incremental actions: 1 (incr_file), 3 (incr_image), 5 (resumed incr_file), 7 (resumed incr_image)
    return [1, 3, 5, 7].includes(action);
  }

  // ========== READ OPERATIONS (Using Direct Database Access) ==========

  async testConnection(): Promise<boolean> {
    try {
      await this.dbService.getServerStats();
      return true;
    } catch (error) {
      logger.error('UrBackup database connection test failed:', error);
      return false;
    }
  }

  async getStatus() {
    try {
      const stats = await this.dbService.getServerStats();
      const activities = await this.dbService.getCurrentActivities();

      return {
        ...stats,
        current_activities: activities.length,
        activities: activities
      };
    } catch (error) {
      logger.error('Failed to get status:', error);
      throw error;
    }
  }

  async getClients() {
    try {
      const clients = await this.dbService.getClients();

      // UrBackup doesn't flush lastseen to SQLite immediately — fetch live online
      // status from the API and merge it so connected clients show as online
      try {
        const session = await this.login();
        const statusResult = await fetch(`${URBACKUP_API_URL}?a=status&ses=${session}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'st0r' },
          body: `ses=${session}`
        });
        const statusData: any = await statusResult.json();
        const apiClients: any[] = statusData?.status || [];

        if (apiClients.length > 0) {
          const apiMap = new Map(apiClients.map((c: any) => [c.id, c]));
          return clients.map(client => {
            const api = apiMap.get(client.id);
            if (!api) return client;
            const c = client as any;
            let ip = api.ip || api.lastip || c.ip || null;
            if (ip === '-' || ip === '' || ip === 'null') ip = null;
            return {
              ...client,
              online: api.online === true,
              lastseen: api.lastseen ? api.lastseen * 1000 : client.lastseen,
              status: api.online ? 'online' : 'offline',
              ip,
              os_simple: api.os_simple || c.os_simple,
              os_version_string: api.os_version_string || c.os_version_string,
              delete_pending: api.delete_pending === '1' || api.delete_pending === 1 || false,
              no_backup_paths: api.no_backup_paths === true || api.no_backup_paths === 1 || false,
            };
          });
        }
      } catch (apiErr) {
        logger.warn('Could not fetch live status from UrBackup API, using DB values:', apiErr);
      }

      return clients;
    } catch (error) {
      logger.error('Failed to get clients:', error);
      throw error;
    }
  }

  async getOnlineClients() {
    try {
      return await this.dbService.getOnlineClients();
    } catch (error) {
      logger.error('Failed to get online clients:', error);
      throw error;
    }
  }

  async getOfflineClients() {
    try {
      return await this.dbService.getOfflineClients();
    } catch (error) {
      logger.error('Failed to get offline clients:', error);
      throw error;
    }
  }

  async getFailedClients() {
    try {
      return await this.dbService.getFailedClients();
    } catch (error) {
      logger.error('Failed to get failed clients:', error);
      throw error;
    }
  }

  async getOkClients() {
    try {
      return await this.dbService.getOkClients();
    } catch (error) {
      logger.error('Failed to get OK clients:', error);
      throw error;
    }
  }

  async getActivities() {
    try {
      // Use getCurrentActivities() which includes API progress merging
      const current = await this.getCurrentActivities();
      const recent = await this.dbService.getRecentActivities(100);

      return {
        current: current,
        last: recent
      };
    } catch (error) {
      logger.error('Failed to get activities:', error);
      throw error;
    }
  }

  async getCurrentActivities() {
    try {
      // Get activities from database (running backups with records)
      const dbActivities: any[] = await this.dbService.getCurrentActivities();
      logger.info(`[getCurrentActivities] Database returned ${dbActivities.length} activities`);

      // Try to get real-time progress from UrBackup API (includes indexing)
      try {
        logger.debug(`[getCurrentActivities] Fetching real-time progress from API`);
        const progressResult = await this.apiCall('progress', {});
        const progressData: any[] = progressResult?.progress || [];

        // If the progress API succeeded (even with empty list), it is authoritative.
        // An empty list means nothing is running — don't fall back to stale DB records.
        if (progressData && Array.isArray(progressData) && progressData.length === 0) {
          logger.info('[getCurrentActivities] Progress API returned empty — no active backups');
          return [];
        }

        if (progressData && Array.isArray(progressData) && progressData.length > 0) {
          logger.info(`[getCurrentActivities] Processing ${progressData.length} progress items`);
          // Progress API is authoritative — build result from progress items only.
          // DB activities without a matching progress item are stale and discarded.
          const mergedActivities: any[] = [];

          for (const progress of progressData) {
            const actionStr = this.getActionString(progress.action);
            const isImageBackup = this.isImageAction(progress.action);
            const progressType = isImageBackup ? 'image' : 'file';

            // Find matching DB activity for metadata enrichment only
            const dbMatch = dbActivities.find(
              (act: any) => act.clientid === progress.clientid && act.type === progressType
            );

            // pcdone of -1 means UrBackup is preparing/indexing — valid running state
            const pcdone = (typeof progress.pcdone === 'number' && progress.pcdone >= 0) ? progress.pcdone : 0;

            mergedActivities.push({
              id: dbMatch?.id || progress.id || `progress-${progress.clientid}`,
              clientid: progress.clientid,
              clientName: dbMatch?.clientName || progress.name || progress.client,
              name: dbMatch?.name || progress.name || progress.client,
              client: dbMatch?.client || progress.name || progress.client,
              backuptime: dbMatch?.backuptime || Date.now(),
              incremental: this.isIncrementalAction(progress.action),
              type: progressType,
              path: progress.path || dbMatch?.path || '',
              action: actionStr,
              pcdone,
              done_bytes: progress.done_bytes || 0,
              total_bytes: progress.total_bytes || 0,
              speed_bpms: progress.speed_bpms || 0,
              paused: progress.paused || false,
              details: progress.details || dbMatch?.details || '',
              eta_ms: progress.eta_ms > 0 ? progress.eta_ms : null,
              process_id: progress.id,
            } as any);
          }

          logger.info(`[getCurrentActivities] Returning ${mergedActivities.length} activities from progress API`);
          return mergedActivities;
        }
      } catch (apiError) {
        // If the progress API fails we cannot reliably determine what is running.
        // DB records with complete=0 may be stale, so return empty to avoid phantom activities.
        logger.warn('[getCurrentActivities] Progress API failed — returning empty to avoid stale records:', apiError);
        return [];
      }

      // Parse log for current file transfer progress and attach to running backups
      // Also filter out stale/invalid activities from database
      const filteredDbActivities = dbActivities.filter(activity => {
        if (activity.pcdone < 0) {
          logger.info(`[getCurrentActivities] Filtering out stale DB activity: ${activity.name} (pcdone: ${activity.pcdone})`);
          return false;
        }
        if (activity.complete === 1) {
          logger.info(`[getCurrentActivities] Filtering out completed DB activity: ${activity.name}`);
          return false;
        }
        return true;
      });

      const enhancedActivities = filteredDbActivities.map(activity => {
        // Only parse log for running backups (complete=0 means backup is running)
        if (activity.complete === 0) {
          const transferProgress = this.parseCurrentTransferProgress(activity.clientid);
          if (transferProgress) {
            logger.info(`[getCurrentActivities] Found current file transfer for client ${activity.clientid}: ${transferProgress.currentFile} at ${transferProgress.currentFileProgress}%`);
            return {
              ...activity,
              currentFile: transferProgress.currentFile,
              currentFileProgress: transferProgress.currentFileProgress,
              speed_bpms: transferProgress.speed_bpms,
              // Note: We intentionally do NOT set done_bytes/total_bytes here because those
              // represent the CURRENT FILE progress, not overall backup progress
              // The frontend will use currentFile and currentFileProgress to show what's being transferred
            };
          }
        }
        return activity;
      });

      return enhancedActivities;
    } catch (error) {
      logger.error('Failed to get current activities:', error);
      throw error;
    }
  }

  async getBackups(clientId: string) {
    try {
      const numericId = parseInt(clientId);
      logger.info(`Getting backups for client ID: ${numericId}`);

      const fileBackups = await this.dbService.getFileBackups(numericId);
      const imageBackups = await this.dbService.getImageBackups(numericId);

      logger.info(`Retrieved ${fileBackups.length} file backups and ${imageBackups.length} image backups for client ${numericId}`);

      return {
        file: fileBackups,
        image: imageBackups
      };
    } catch (error) {
      logger.error('Failed to get backups:', error);
      throw error;
    }
  }

  async getUsage() {
    try {
      const clients = await this.dbService.getClients();

      return clients.map(client => ({
        name: client.name,
        files: client.bytes_used_files,
        images: client.bytes_used_images,
        total: (client.bytes_used_files || 0) + (client.bytes_used_images || 0)
      }));
    } catch (error) {
      logger.error('Failed to get usage:', error);
      throw error;
    }
  }

  // ========== WRITE OPERATIONS (Using Direct API Calls) ==========

  async startFullFileBackup(clientName: string, clientId?: string | number) {
    try {
      logger.info(`Starting full file backup for client: ${clientName} (ID: ${clientId})`);

      const params: any = {};
      if (clientId) {
        const numericId = typeof clientId === 'string' ? parseInt(clientId) : clientId;
        if (!isNaN(numericId) && numericId > 0) {
          params.start_client = numericId;
        }
      }

      const result = await this.apiCall('start_backup', {
        ...params,
        start_type: 'full_file'
      });

      logger.info(`Full file backup started successfully for ${clientName}:`, result);
      return result;
    } catch (error: any) {
      logger.error(`Failed to start full file backup for ${clientName}:`, error.message);
      throw new Error(`Failed to start full file backup: ${error.message}`);
    }
  }

  async startIncrementalFileBackup(clientName: string, clientId?: string | number) {
    try {
      logger.info(`Starting incremental file backup for client: ${clientName} (ID: ${clientId})`);

      const params: any = {};
      if (clientId) {
        const numericId = typeof clientId === 'string' ? parseInt(clientId) : clientId;
        if (!isNaN(numericId) && numericId > 0) {
          params.start_client = numericId;
        }
      }

      const result = await this.apiCall('start_backup', {
        ...params,
        start_type: 'incr_file'
      });

      logger.info(`Incremental file backup started successfully for ${clientName}:`, result);
      return result;
    } catch (error: any) {
      logger.error(`Failed to start incremental file backup for ${clientName}:`, error.message);
      throw new Error(`Failed to start incremental file backup: ${error.message}`);
    }
  }

  async startFullImageBackup(clientName: string, clientId?: string | number) {
    try {
      logger.info(`Starting full image backup for client: ${clientName} (ID: ${clientId})`);

      const params: any = {};
      if (clientId) {
        const numericId = typeof clientId === 'string' ? parseInt(clientId) : clientId;
        params.start_client = numericId;
      }

      const result = await this.apiCall('start_backup', {
        ...params,
        start_type: 'full_image'
      });

      logger.info(`Full image backup started successfully for ${clientName}:`, result);
      return result;
    } catch (error: any) {
      logger.error(`Failed to start full image backup for ${clientName}:`, error.message);
      throw new Error(`Failed to start full image backup: ${error.message}`);
    }
  }

  async startIncrementalImageBackup(clientName: string, clientId?: string | number) {
    try {
      logger.info(`Starting incremental image backup for client: ${clientName} (ID: ${clientId})`);

      const params: any = {};
      if (clientId) {
        const numericId = typeof clientId === 'string' ? parseInt(clientId) : clientId;
        params.start_client = numericId;
      }

      const result = await this.apiCall('start_backup', {
        ...params,
        start_type: 'incr_image'
      });

      logger.info(`Incremental image backup started successfully for ${clientName}:`, result);
      return result;
    } catch (error: any) {
      logger.error(`Failed to start incremental image backup for ${clientName}:`, error.message);
      throw new Error(`Failed to start incremental image backup: ${error.message}`);
    }
  }

  async stopActivity(activityId: string, clientId?: string | number) {
    try {
      // UrBackup stops a backup by sending stop_clientid + stop_id to the progress endpoint
      const params: Record<string, any> = {
        stop_id: activityId,
        with_lastacts: '0',
      };
      if (clientId !== undefined && clientId !== null && clientId !== '') {
        params.stop_clientid = String(clientId);
      }
      return await this.apiCall('progress', params);
    } catch (error) {
      logger.error('Failed to stop activity:', error);
      throw error;
    }
  }

  async clearStaleJobs() {
    try {
      logger.info('[clearStaleJobs] Starting stale job cleanup...');

      // Get current activities from database and API
      const dbActivities: any[] = await this.dbService.getCurrentActivities();

      // Get progress from API
      let staleJobs: any[] = [];

      try {
        const progressResult = await this.apiCall('progress', {});
        const progressData: any[] = progressResult?.progress || [];

        // Find stale jobs (negative progress or no activity)
        staleJobs = progressData.filter(progress => {
          if (progress.pcdone < 0) {
            logger.info(`[clearStaleJobs] Found stale job: ${progress.name} (ID: ${progress.id}, pcdone: ${progress.pcdone})`);
            return true;
          }
          return false;
        });

        logger.info(`[clearStaleJobs] Found ${staleJobs.length} stale jobs to stop`);

        // Stop each stale job
        const results: Array<{id: any; name: any; success: boolean; error?: string}> = [];
        for (const job of staleJobs) {
          try {
            logger.info(`[clearStaleJobs] Stopping stale job: ${job.name} (ID: ${job.id})`);
            const result = await this.stopActivity(job.id.toString());
            results.push({
              id: job.id,
              name: job.name,
              success: true
            });
          } catch (error) {
            logger.error(`[clearStaleJobs] Failed to stop job ${job.id}:`, error);
            results.push({
              id: job.id,
              name: job.name,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }

        return {
          staleJobsFound: staleJobs.length,
          staleJobsStopped: results.filter(r => r.success).length,
          results
        };

      } catch (apiError) {
        logger.error('[clearStaleJobs] Failed to get progress from API:', apiError);
        throw new Error('Failed to get current activities from UrBackup API');
      }
    } catch (error) {
      logger.error('[clearStaleJobs] Failed to clear stale jobs:', error);
      throw error;
    }
  }

  async getServerVersion() {
    try {
      const result = await this.apiCall('status');
      return {
        version: result.server_version || 'unknown',
        protocol_version: result.protocol_version || 'unknown'
      };
    } catch (error) {
      logger.error('Failed to get server version:', error);
      throw error;
    }
  }

  async getJobLogs(clientId?: number, num = 50) {
    try {
      const session = await this.login();
      const params = new URLSearchParams({ ses: session, num: String(num) });
      if (clientId) params.set('clientid', String(clientId));
      const response = await fetch(`${URBACKUP_API_URL}?a=logs&ses=${session}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'st0r' },
        body: params.toString()
      });
      const result: any = await response.json();
      return { logs: result?.logs || [], clients: result?.clients || [] };
    } catch (error) {
      logger.error('Failed to get job logs:', error);
      return { logs: [], clients: [] };
    }
  }

  async getJobLog(logId: number) {
    try {
      const session = await this.login();
      const params = new URLSearchParams({ ses: session, logid: String(logId) });
      const response = await fetch(`${URBACKUP_API_URL}?a=logs&ses=${session}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'st0r' },
        body: params.toString()
      });
      const result: any = await response.json();
      const logData = result?.log;
      if (!logData?.data) return { clientname: logData?.clientname || '', entries: [] };
      const entries = logData.data.split('\n').filter(Boolean).map((line: string) => {
        const m = line.match(/^(\d+)-(\d+)-(.*)$/);
        if (!m) return { severity: 0, time: 0, message: line };
        return { severity: parseInt(m[1]), time: parseInt(m[2]), message: m[3] };
      });
      return { clientname: logData.clientname, entries };
    } catch (error) {
      logger.error('Failed to get job log:', error);
      return { clientname: '', entries: [] };
    }
  }

  async getSettings() {
    try {
      const response = await this.apiCall('settings', { sa: 'general' });
      // UrBackup returns {settings: {key: {value: x}, ...}, ...}
      // Return only the flat settings extracted from the nested structure
      const raw: Record<string, any> = response?.settings || {};
      const flat: Record<string, any> = {};
      for (const [key, val] of Object.entries(raw)) {
        if (val && typeof val === 'object' && !Array.isArray(val) && 'value' in (val as any)) {
          flat[key] = (val as any).value;
        } else if (typeof val !== 'object') {
          flat[key] = val;
        }
      }
      return flat;
    } catch (error) {
      logger.error('Failed to get settings:', error);
      throw error;
    }
  }

  async setSettings(newSettings: any) {
    try {
      const session = await this.login();

      // Helper: booleans must be '1'/'0' for UrBackup
      const toUrBackupStr = (v: any): string => {
        if (v === true || v === 'true') return '1';
        if (v === false || v === 'false') return '0';
        return String(v);
      };

      // Get current settings (already flattened by getSettings())
      const currentFlat = await this.getSettings();

      // Apply updates
      for (const [key, value] of Object.entries(newSettings)) {
        if (value !== null && value !== undefined) {
          currentFlat[key] = value;
        }
      }

      // Build POST body for UrBackup general settings save
      const saveParams = new URLSearchParams();
      saveParams.set('sa', 'general_save');
      saveParams.set('ses', session);

      for (const [key, value] of Object.entries(currentFlat)) {
        if (value !== null && value !== undefined) {
          saveParams.set(key, toUrBackupStr(value));
        }
      }

      const response = await fetch(`${URBACKUP_API_URL}?a=settings&ses=${session}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'st0r',
        },
        body: saveParams.toString()
      });

      const result: any = await response.json();

      if (result?.saved_ok === true) {
        return { success: true };
      } else {
        logger.warn('UrBackup general settings save returned:', JSON.stringify(result));
        throw new Error(`Settings save failed: ${JSON.stringify(result)}`);
      }
    } catch (error) {
      logger.error('Failed to set settings:', error);
      throw error;
    }
  }

  async bulkSetSettings(updates: any) {
    return await this.setSettings(updates);
  }

  async getClientSettings(clientId: string) {
    try {
      // Must use t_clientid (not clientid) to get full {use, value, value_group} format
      const session = await this.login();
      const response = await fetch(`${URBACKUP_API_URL}?a=settings&ses=${session}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'st0r' },
        body: `sa=clientsettings&t_clientid=${encodeURIComponent(clientId)}&ses=${session}`
      });
      const result = await response.json() as any;
      return result;
    } catch (error) {
      logger.error('Failed to get client settings:', error);
      throw error;
    }
  }

  async setClientSettings(clientId: string, newSettings: any) {
    try {
      const session = await this.login();

      // Get current settings using t_clientid (full format with use/value/value_group)
      const currentResponse = await this.getClientSettings(clientId);
      const rawSettings = currentResponse?.settings || {};

      const saveParams = new URLSearchParams();
      saveParams.set('sa', 'clientsettings_save');
      saveParams.set('t_clientid', clientId);
      saveParams.set('ses', session); // UrBackup requires ses in POST body AND URL
      saveParams.set('overwrite', 'true');

      // Helper: convert any value to the string UrBackup expects
      const toUrBackupStr = (v: any): string => {
        if (v === true || v === 'true') return 'true';
        if (v === false || v === 'false') return 'false';
        return String(v);
      };

      // Preserve current settings as base (use their existing use values)
      for (const [key, val] of Object.entries(rawSettings)) {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const v = val as any;
          if ('use' in v && 'value' in v) {
            // 'value' is always the resolved effective value
            if (v.value !== null && v.value !== undefined) {
              saveParams.set(key, toUrBackupStr(v.value));
              saveParams.set(`${key}.use`, String(v.use));
            }
          }
        } else if (typeof val !== 'object' && val !== null && val !== undefined) {
          saveParams.set(key, toUrBackupStr(val));
        }
      }

      // Apply user's changes — use=1 means client-specific override
      for (const [key, value] of Object.entries(newSettings)) {
        if (value !== null && value !== undefined) {
          saveParams.set(key, toUrBackupStr(value));
          saveParams.set(`${key}.use`, '1'); // 1 = client-specific override
        }
      }

      const response = await fetch(`${URBACKUP_API_URL}?a=settings&ses=${session}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'st0r',
        },
        body: saveParams.toString()
      });

      const result: any = await response.json();
      return { success: result?.saved_ok === true };
    } catch (error) {
      logger.error('Failed to set client settings:', error);
      throw error;
    }
  }

  async browseClientFilesystem(clientId: string, path: string = '') {
    try {
      return await this.apiCall('dir', {
        clientid: clientId,
        path: path
      });
    } catch (error) {
      logger.error('Failed to browse client filesystem:', error);
      throw error;
    }
  }

  async browseBackupFiles(clientId: string, backupId: string, path: string = '/') {
    try {
      return await this.apiCall('backups', {
        sa: 'files',
        clientid: clientId,
        backupid: backupId,
        path: path
      });
    } catch (error) {
      logger.error('Failed to browse backup files:', error);
      throw error;
    }
  }

  async addClient(clientName: string) {
    try {
      logger.info(`Adding new client via UrBackup API: ${clientName}`);

      // Use UrBackup's add_client API — it generates the correct internet_authkey
      // and stores it properly in the settings DB
      const session = await this.login();
      const response = await fetch(`${URBACKUP_API_URL}?a=add_client&ses=${session}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'st0r' },
        body: `clientname=${encodeURIComponent(clientName)}&ses=${session}`
      });
      const result: any = await response.json();

      if (!result.ok && !result.added_new_client) {
        throw new Error(result.already_exists ? 'Client already exists' : 'Failed to add client via UrBackup API');
      }

      logger.info(`Client ${clientName} added with ID ${result.new_clientid}, authkey: ${result.new_authkey}`);
      return {
        success: true,
        clientid: result.new_clientid,
        authkey: result.new_authkey
      };
    } catch (error: any) {
      logger.error(`Failed to add client ${clientName}:`, error.message);
      throw new Error(`Failed to add client: ${error.message}`);
    }
  }

  async removeClient(clientId: string | number) {
    try {
      logger.info(`Removing client with ID: ${clientId}`);
      const numericId = typeof clientId === 'string' ? parseInt(clientId) : clientId;
      // Use direct DB deletion — the UrBackup HTTP API requires an authenticated
      // session cookie and silently no-ops without it (delete_pending stays 0).
      const result = await this.dbService.removeClient(numericId);
      logger.info(`Client ${clientId} removed successfully`);
      return result;
    } catch (error: any) {
      logger.error(`Failed to remove client ${clientId}:`, error.message);
      throw new Error(`Failed to remove client: ${error.message}`);
    }
  }

  async getClientAuthkey(clientId: string | number) {
    try {
      logger.info(`Getting authentication key for client ID: ${clientId}`);
      const numericId = typeof clientId === 'string' ? parseInt(clientId) : clientId;
      const authkey = await this.dbService.getClientAuthkey(numericId);
      return authkey;
    } catch (error: any) {
      logger.error(`Failed to get auth key for client ${clientId}:`, error.message);
      throw new Error(`Failed to get client authentication key: ${error.message}`);
    }
  }

  async updateClientName(clientId: string | number, newName: string) {
    try {
      logger.info(`Updating client ${clientId} name to: ${newName}`);
      const numericId = typeof clientId === 'string' ? parseInt(clientId) : clientId;
      await this.setClientSettings(String(numericId), { name: newName });
      return { success: true };
    } catch (error: any) {
      logger.error(`Failed to update client name:`, error.message);
      throw new Error(`Failed to update client name: ${error.message}`);
    }
  }

  async regenerateClientAuthkey(clientId: string | number): Promise<string> {
    try {
      logger.info(`Regenerating authentication key for client ID: ${clientId}`);
      const numericId = typeof clientId === 'string' ? parseInt(clientId) : clientId;

      // Generate a new random 64-character hex authentication key
      const newAuthkey = Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('');

      await this.setClientSettings(String(numericId), { internet_authkey: newAuthkey });

      logger.info(`Authentication key regenerated for client ${clientId}`);
      return newAuthkey;
    } catch (error: any) {
      logger.error(`Failed to regenerate auth key for client ${clientId}:`, error.message);
      throw new Error(`Failed to regenerate client authentication key: ${error.message}`);
    }
  }
}
