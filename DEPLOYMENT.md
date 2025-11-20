# UrBackup GUI Deployment Guide

## Quick Deployment

To deploy the latest changes to the live environment:

```bash
cd /home/administrator/urbackup-gui
sudo ./deploy.sh
```

This script will:
1. Build the backend (TypeScript compilation)
2. Build the frontend (Vite production build)
3. Copy built files to `/opt/urbackup-gui/`
4. Restart the `urbackup-gui` service
5. Verify the deployment

## Manual Deployment

If you need to deploy manually:

### Backend Only
```bash
cd /home/administrator/urbackup-gui/backend
sudo -u administrator bash -c 'export PATH=/home/administrator/.nvm/versions/node/v22.21.1/bin:$PATH && npm run build'
sudo cp -r dist/* /opt/urbackup-gui/backend/dist/
sudo systemctl restart urbackup-gui
```

### Frontend Only
```bash
cd /home/administrator/urbackup-gui/frontend
sudo -u administrator bash -c 'export PATH=/home/administrator/.nvm/versions/node/v22.21.1/bin:$PATH && npm run build'
sudo cp -r dist/* /opt/urbackup-gui/frontend/dist/
# No service restart needed for frontend only changes
```

## Directory Structure

```
/home/administrator/urbackup-gui/   <- Development/source directory
├── backend/
│   ├── src/                        <- TypeScript source
│   └── dist/                       <- Compiled JavaScript
├── frontend/
│   ├── src/                        <- React/TypeScript source  
│   └── dist/                       <- Built static files
└── deploy.sh                       <- Deployment script

/opt/urbackup-gui/                  <- Production directory
├── backend/
│   └── dist/                       <- Running backend code
└── frontend/
    └── dist/                       <- Served by nginx
```

## Version Info

Current version: **3.2.3**

See [CHANGELOG.md](CHANGELOG.md) for complete release notes.
