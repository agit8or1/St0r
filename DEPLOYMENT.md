# st0r — Deployment Guide

## Quick Deploy (Development → Production)

```bash
cd /home/administrator/St0r

# Build and deploy backend
cd backend && npm run build
sudo rsync -a dist/ /opt/urbackup-gui/backend/dist/

# Build and deploy frontend
cd ../frontend && npm run build
sudo rsync -a dist/ /opt/urbackup-gui/frontend/dist/

# Restart service
sudo systemctl restart urbackup-gui
```

## Directory Structure

```
/home/administrator/St0r/           ← Development / source
├── backend/src/                    ← TypeScript source
├── backend/dist/                   ← Compiled JS (gitignored)
├── frontend/src/                   ← React source
├── frontend/dist/                  ← Vite build output (gitignored)
└── deploy.sh                       ← Helper deploy script

/opt/urbackup-gui/                  ← Production (served by systemd + nginx)
├── backend/dist/                   ← Running backend
├── backend/.env                    ← Production secrets (not in git)
├── frontend/dist/                  ← Static files served by nginx
└── version.json                    ← Version manifest for update checker
```

## Backend Only

```bash
cd backend && npm run build
sudo rsync -a dist/ /opt/urbackup-gui/backend/dist/
sudo systemctl restart urbackup-gui
```

## Frontend Only

```bash
cd frontend && npm run build
sudo rsync -a dist/ /opt/urbackup-gui/frontend/dist/
# No service restart needed — nginx serves static files directly
```

## Database Migrations

When upgrading, apply any new migration files:

```bash
sudo mysql -u root urbackup_gui < database/migrations/002_add_totp_and_customers.sql
sudo mysql -u root urbackup_gui < database/migrations/003_replication.sql
```

## Version Info

Current version: **3.2.23**

See [CHANGELOG.md](CHANGELOG.md) for complete release notes.
