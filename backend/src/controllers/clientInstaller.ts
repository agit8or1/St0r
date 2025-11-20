import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { UrBackupService } from '../services/urbackup.js';
import { UrBackupDbService } from '../services/urbackupDb.js';
import os from 'os';
import { existsSync } from 'fs';
import path from 'path';

const router = Router();

// Helper function to get server address (FQDN or IP)
function getServerAddress(): string {
  // Check for FQDN in environment variable first
  const fqdn = process.env.URBACKUP_SERVER_FQDN;
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

  // Last resort fallback
  return '192.168.22.228';
}

// Get server information for client configuration
router.get('/server-info', authenticate, async (req: Request, res: Response) => {
  try {
    const serverAddress = getServerAddress();
    const serverPort = process.env.URBACKUP_SERVER_PORT || '55414';

    res.json({
      serverIP: serverAddress,
      serverPort: serverPort,
      serverUrl: `http://${serverAddress}:${serverPort}`
    });
  } catch (error) {
    logger.error('Failed to get server info:', error);
    res.status(500).json({ error: 'Failed to get server information' });
  }
});

// Download Windows client installer (.exe) - serves generic installer
router.get('/windows', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    // Accept both clientId and clientid for compatibility
    const clientId = req.query.clientId || req.query.clientid;

    if (!clientId) {
      res.status(400).json({ error: 'clientId parameter is required' });
      return;
    }

    logger.info(`Windows client installer download for client ID: ${clientId}`);

    try {
      // Get client authkey from database
      const dbService = new UrBackupDbService();
      const authkey = await dbService.getClientAuthkey(Number(clientId));

      if (!authkey) {
        throw new Error('Client authkey not found');
      }

      const urbackupApiUrl = process.env.URBACKUP_API_URL || 'http://localhost:55414/x';
      const downloadUrl = `${urbackupApiUrl}?a=download_client&clientid=${clientId}&os=windows&authkey=${authkey}`;

      logger.info(`Fetching pre-configured installer from UrBackup with authkey`);

      const response = await fetch(downloadUrl);

      if (!response.ok) {
        throw new Error(`UrBackup returned ${response.status}`);
      }

      // Check if we got an error message
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html') || contentType.includes('text/plain')) {
        const errorText = await response.text();
        if (errorText.includes('ERROR')) {
          throw new Error(errorText);
        }
      }

      // Stream the pre-configured installer
      const contentLength = response.headers.get('content-length');
      const contentDisposition = response.headers.get('content-disposition');

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', contentDisposition || `attachment; filename="UrBackupClient-${clientId}.exe"`);
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      // Pipe the response
      if (response.body) {
        const reader = response.body.getReader();
        const pump = async () => {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            return;
          }
          res.write(value);
          pump();
        };
        await pump();
      }
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

// Download Linux client installer bash script
router.get('/linux', authenticate, async (req: Request, res: Response) => {
  try {
    const { authkey, clientName } = req.query;

    const serverAddress = getServerAddress();
    const serverPort = process.env.URBACKUP_SERVER_PORT || '55414';

    // Use provided values or fallback to defaults
    const finalAuthkey = (authkey && String(authkey).trim()) || 'abcdefghijklmnopqrstuvwxyz';
    const finalClientName = (clientName && String(clientName).trim()) || 'urbackup-client';

    logger.info(`Linux client installer requested: client=${finalClientName}, server=${serverAddress}:${serverPort}`);

    // Generate bash installer script
    const installerScript = `#!/bin/bash
# UrBackup Client Installer Script
# Auto-generated for ${finalClientName}
# Server: ${serverAddress}:${serverPort}

set -e

echo "======================================"
echo "UrBackup Linux Client Installer"
echo "======================================"
echo ""
echo "Client Name: ${finalClientName}"
echo "Server: ${serverAddress}:${serverPort}"
echo ""

# Detect Linux distribution
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo "Cannot detect Linux distribution"
    exit 1
fi

echo "Detected OS: $OS"
echo ""

# Install UrBackup client based on distribution
case "$OS" in
    ubuntu|debian)
        echo "Installing UrBackup client for Debian/Ubuntu..."

        # Add UrBackup repository key and repo
        wget -qO - https://download.urbackup.org/urbackup-client.key | sudo apt-key add -
        echo "deb http://download.urbackup.org/download/urbackup/client/deb/ $(lsb_release -sc) main" | sudo tee /etc/apt/sources.list.d/urbackup.list

        # Update and install
        sudo apt-get update
        sudo apt-get install -y urbackup-client
        ;;

    centos|rhel|fedora)
        echo "Installing UrBackup client for RedHat/CentOS/Fedora..."

        # Add UrBackup repository
        sudo curl -o /etc/yum.repos.d/urbackup.repo https://download.urbackup.org/download/urbackup/client/rpm/urbackup.repo

        # Install
        sudo yum install -y urbackup-client
        ;;

    *)
        echo "Unsupported distribution: $OS"
        echo "Please install manually from: https://www.urbackup.org/download.html"
        exit 1
        ;;
esac

echo ""
echo "Configuring client..."

# Configure client settings
sudo tee /etc/default/urbackupclient > /dev/null <<EOF
# UrBackup Client Configuration
# Auto-generated by st0r

INTERNET_ONLY=false
INTERNET_SERVER=${serverAddress}
INTERNET_SERVER_PORT=${serverPort}
COMPUTERNAME=${finalClientName}
AUTHKEY=${finalAuthkey}
EOF

# Restart the service
echo "Starting UrBackup client service..."
sudo systemctl restart urbackupclientbackend || sudo service urbackupclientbackend restart

echo ""
echo "======================================"
echo "Installation complete!"
echo "======================================"
echo ""
echo "The UrBackup client is now running and should connect to:"
echo "  ${serverAddress}:${serverPort}"
echo ""
echo "Check status with:"
echo "  sudo systemctl status urbackupclientbackend"
echo ""
echo "View logs with:"
echo "  sudo journalctl -u urbackupclientbackend -f"
echo ""
`;

    // Set headers for file download
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="urbackup-client-installer-${finalClientName}.sh"`);
    res.send(installerScript);
  } catch (error) {
    logger.error('Failed to generate Linux client installer:', error);
    res.status(500).json({ error: 'Failed to generate installer script' });
  }
});

// Serve the raw UrBackup client exe (for PowerShell script to download)
router.get('/downloads/UrBackupClient.exe', async (req: Request, res: Response): Promise<void> => {
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
