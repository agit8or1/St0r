// `Response` is aliased so it does not shadow the global fetch Response used below
import { Router, Request, Response as ExpressResponse } from 'express';
import { authenticate } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import { assertClientAccess } from '../middleware/scope.js';
import { logger } from '../utils/logger.js';
import { openUrBackupSettingsDbReadOnly } from '../config/urbackupDb.js';
import { UrBackupService } from '../services/urbackup.js';
import os from 'os';
import { existsSync } from 'fs';
import path from 'path';

const router = Router();

/**
 * What a client is actually told to connect to.
 *
 * UrBackup's own `internet_server` / `internet_server_port` settings are the
 * authoritative answer: they are what gets baked into every installer, they are
 * configured per install, and they cannot drift from the installer the way a
 * separate environment variable can. Read those first, and fall back to the
 * environment only when UrBackup has nothing configured.
 *
 * Note the port differs from the web UI port (55414) — internet clients connect
 * on internet_server_port (55415 by default), so reporting the web port here
 * told the user something that was never true of the installer.
 */
async function getClientFacingServer(): Promise<{ address: string; port: string }> {
  try {
    const db = await openUrBackupSettingsDbReadOnly();
    const rows = await db.all<{ key: string; value: string }[]>(
      "SELECT key, value FROM settings WHERE clientid = 0 AND key IN ('internet_server', 'internet_server_port')"
    );
    const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const address = settings.internet_server?.trim();
    const port = settings.internet_server_port?.trim();
    if (address) {
      return { address, port: port || '55415' };
    }
  } catch (error) {
    logger.warn(`Could not read internet_server from UrBackup settings, falling back to configuration: ${error}`);
  }

  return {
    address: getServerAddress(),
    port: process.env.URBACKUP_INTERNET_PORT || '55415',
  };
}

// Fallback only: FQDN from configuration, else an auto-detected address.
function getServerAddress(): string {
  // Check for FQDN in environment variable first (either key)
  const fqdn = process.env.URBACKUP_SERVER_FQDN || process.env.URBACKUP_SERVER_HOST;
  if (fqdn) {
    return fqdn;
  }

  // Fall back to auto-detected IP
  const networkInterfaces = os.networkInterfaces();
  for (const iface of Object.values(networkInterfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }

  // Could not detect — require explicit configuration
  logger.warn('Could not auto-detect server IP. Set URBACKUP_SERVER_FQDN in .env');
  return 'URBACKUP_SERVER_FQDN_NOT_SET';
}

// Resolve a client's name and internet_authkey from UrBackup settings.
// Per-client key has use=0 (override), group/global key has use=1.
// UrBackup answers for unknown client ids with the global settings and an empty
// clientname, so the name doubles as the existence check — without it we would hand
// out an installer carrying the global key and no computername, which installs but
// never registers as the intended client.
async function resolveClient(clientId: string): Promise<{ name: string; authkey: string }> {
  const urbackupService = new UrBackupService();
  const clientSettingsResponse = await urbackupService.getClientSettings(clientId);
  const settings = clientSettingsResponse?.settings;

  const name = settings?.clientname ? String(settings.clientname).trim() : '';
  if (!name) {
    throw new Error(`No client with id ${clientId} exists in UrBackup`);
  }

  const rawAuthkey = settings?.internet_authkey;
  const authkey = rawAuthkey?.value ?? rawAuthkey?.value_group;
  if (!authkey) {
    throw new Error('Could not get internet_authkey for this client from UrBackup settings');
  }

  return { name, authkey: String(authkey) };
}

// Ask UrBackup for an installer with this client's name, server address, port and
// authkey already baked in. This is the same artifact the UrBackup web UI hands out,
// so it is configured correctly on every platform it supports.
async function fetchPreconfiguredInstaller(
  clientId: string,
  targetOs: 'windows' | 'linux'
): Promise<{ response: Response; clientName: string }> {
  const { name, authkey } = await resolveClient(clientId);
  const urbackupApiUrl = process.env.URBACKUP_API_URL || 'http://localhost:55414/x';
  const downloadUrl = `${urbackupApiUrl}?a=download_client&clientid=${encodeURIComponent(clientId)}&os=${targetOs}&authkey=${encodeURIComponent(authkey)}`;

  logger.info(`Fetching pre-configured ${targetOs} installer from UrBackup for client ${clientId}`);

  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(`UrBackup returned ${response.status}`);
  }

  // UrBackup reports failures as a text/html or text/plain body rather than an HTTP error
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html') || contentType.includes('text/plain')) {
    const errorText = await response.text();
    throw new Error(errorText.includes('ERROR') ? errorText : `Unexpected response from UrBackup: ${errorText.slice(0, 200)}`);
  }

  return { response, clientName: name };
}

// Stream a fetch Response body out through Express without buffering it in memory
async function streamResponse(response: Response, res: ExpressResponse): Promise<void> {
  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

// Get server information for client configuration
// The address and port a client connects to. Not endpoint-specific, and anyone
// installing an agent needs it, so this is not restricted beyond being logged in.
router.get('/server-info', authenticate, async (req: Request, res: ExpressResponse) => {
  try {
    const { address, port } = await getClientFacingServer();

    res.json({
      serverIP: address,
      serverPort: port,
      // Not a browsable URL — this is the host:port a client connects to, and it
      // is what the installer is configured with.
      serverUrl: `${address}:${port}`
    });
  } catch (error) {
    logger.error('Failed to get server info:', error);
    res.status(500).json({ error: 'Failed to get server information' });
  }
});

// Download Windows client installer (.exe) - serves generic installer
// Installers embed the endpoint's internet_authkey, so they are scoped to the
// endpoint rather than restricted to administrators: a read-only account may
// install an agent on its own customer's endpoints and no others.
router.get('/windows', authenticate, async (req: AuthRequest, res: ExpressResponse): Promise<void> => {
  try {
    // Accept both clientId and clientid for compatibility
    const clientId = req.query.clientId || req.query.clientid;

    if (!clientId) {
      res.status(400).json({ error: 'clientId parameter is required' });
      return;
    }

    if (!/^[0-9]{1,10}$/.test(String(clientId))) {
      res.status(400).json({ error: 'Invalid clientId: must be numeric' });
      return;
    }

    if (!(await assertClientAccess(req, res, { id: String(clientId) }))) return;

    logger.info(`Windows client installer download for client ID: ${clientId}`);

    try {
      const { response } = await fetchPreconfiguredInstaller(String(clientId), 'windows');

      const contentLength = response.headers.get('content-length');

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="UrBackupClient-${clientId}.exe"`);
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      await streamResponse(response, res);
    } catch (error) {
      logger.error('Failed to fetch pre-configured installer:', error);
      // Fallback to generic installer
      const installerPath = '/opt/urbackup-gui/installers/UrBackupClient.exe';
      if (existsSync(installerPath)) {
        logger.info('Falling back to generic installer');
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="UrBackupClient.exe"`);
        res.sendFile(installerPath);
      } else {
        res.status(500).json({ error: 'Installer not available' });
      }
    }
  } catch (error) {
    logger.error('Failed to serve Windows client installer:', error);
    res.status(500).json({ error: 'Failed to serve installer' });
  }
});

// Download Linux client installer — the pre-configured self-extracting installer
// that UrBackup builds for this client (same one the UrBackup web UI serves).
router.get('/linux', authenticate, async (req: AuthRequest, res: ExpressResponse): Promise<void> => {
  // Accept both clientId and clientid for compatibility
  const clientId = req.query.clientId || req.query.clientid;

  if (!clientId) {
    res.status(400).json({ error: 'clientId parameter is required' });
    return;
  }

  if (!/^[0-9]{1,10}$/.test(String(clientId))) {
    res.status(400).json({ error: 'Invalid clientId: must be numeric' });
    return;
  }

  if (!(await assertClientAccess(req, res, { id: String(clientId) }))) return;

  logger.info(`Linux client installer download for client ID: ${clientId}`);

  try {
    const { response, clientName } = await fetchPreconfiguredInstaller(String(clientId), 'linux');

    const contentLength = response.headers.get('content-length');
    // UrBackup names the file "UrBackup Client (Name).sh"; spaces and parens make it
    // awkward to run, so use the client name reduced to a shell-friendly filename
    const safeName = clientName.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
    const filename = `urbackup-client-${safeName || clientId}.sh`;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    await streamResponse(response, res);
  } catch (error) {
    logger.error('Failed to generate Linux client installer:', error);
    const detail = error instanceof Error ? error.message : String(error);
    res.status(502).json({
      error: 'Could not build the Linux installer for this client',
      detail,
      hint: 'UrBackup must be reachable and the client must have an internet authkey. Check that the urbackupsrv service is running and that this client exists in UrBackup.'
    });
  }
});

// Serve the raw UrBackup client exe (for PowerShell script to download)
router.get('/downloads/UrBackupClient.exe', async (req: Request, res: ExpressResponse): Promise<void> => {
  try {
    const installerPath = '/opt/urbackup-gui/installers/UrBackupClient.exe';

    if (!existsSync(installerPath)) {
      res.status(404).send('Installer not found');
      return;
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.sendFile(installerPath);
  } catch (error) {
    logger.error('Failed to serve raw installer:', error);
    res.status(500).send('Failed to serve installer');
  }
});

export default router;
