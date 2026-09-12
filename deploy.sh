#!/bin/bash
# St0r (UrBackup GUI) Deployment Script
# Builds from this checkout and deploys to /opt/urbackup-gui

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
# The source is this checkout, wherever it lives — not a hardcoded path that
# goes stale when the repository is moved or renamed.
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="/opt/urbackup-gui"
BUILD_USER="${SUDO_USER:-administrator}"
SERVICE="urbackup-gui"

# Node lives under nvm, so the version moves. Take the path the running service
# uses; fall back to the newest installed version.
NODE_BIN="$(grep -oP '^ExecStart=\K\S+' "/etc/systemd/system/$SERVICE.service" 2>/dev/null || true)"
if [ -x "$NODE_BIN" ]; then
    NODE_PATH="$(dirname "$NODE_BIN")"
else
    NODE_PATH="$(ls -d /home/"$BUILD_USER"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
fi

if [ ! -x "$NODE_PATH/node" ]; then
    echo -e "${RED}Error: could not find node. Looked in $NODE_PATH${NC}"
    exit 1
fi

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}St0r Deployment Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Source:  $SOURCE_DIR"
echo -e "Deploy:  $DEPLOY_DIR"
echo -e "Node:    $NODE_PATH"
echo ""

# Check if running as correct user
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: This script must be run with sudo${NC}"
    exit 1
fi

if [ ! -d "$DEPLOY_DIR" ]; then
    echo -e "${RED}Error: $DEPLOY_DIR does not exist — run install.sh first${NC}"
    exit 1
fi

# Step 1: Build Backend
echo -e "${YELLOW}[1/6] Building backend...${NC}"
cd "$SOURCE_DIR/backend"
sudo -u "$BUILD_USER" bash -c "export PATH=$NODE_PATH:\$PATH && npm run build"
echo -e "${GREEN}✓ Backend built successfully${NC}"
echo ""

# Step 2: Build Frontend
echo -e "${YELLOW}[2/6] Building frontend...${NC}"
cd "$SOURCE_DIR/frontend"
sudo -u "$BUILD_USER" bash -c "export PATH=$NODE_PATH:\$PATH && npm run build"
echo -e "${GREEN}✓ Frontend built successfully${NC}"
echo ""

# Step 3: Deploy Backend
# --delete so a renamed or removed module does not linger in the installed tree.
echo -e "${YELLOW}[3/6] Deploying backend to $DEPLOY_DIR...${NC}"
rsync -a --delete "$SOURCE_DIR/backend/dist/" "$DEPLOY_DIR/backend/dist/"
cp "$SOURCE_DIR/backend/package.json" "$DEPLOY_DIR/backend/"
echo -e "${GREEN}✓ Backend deployed${NC}"
echo ""

# Step 4: Deploy Frontend
# `downloads/` holds the published update tarball and client installers, which
# are not build output — keep them.
echo -e "${YELLOW}[4/6] Deploying frontend to $DEPLOY_DIR...${NC}"
rsync -a --delete --exclude downloads "$SOURCE_DIR/frontend/dist/" "$DEPLOY_DIR/frontend/dist/"
echo -e "${GREEN}✓ Frontend deployed${NC}"
echo ""

# Step 5: Deploy migrations, version manifest and update script
# version.json is what /api/version reports — without it the installed build
# keeps announcing the previous release.
echo -e "${YELLOW}[5/6] Deploying migrations and version manifest...${NC}"
rsync -a "$SOURCE_DIR/database/" "$DEPLOY_DIR/database/"
cp "$SOURCE_DIR/version.json" "$DEPLOY_DIR/version.json"
cp "$SOURCE_DIR/VERSION" "$DEPLOY_DIR/VERSION"
cp "$SOURCE_DIR/auto-update.sh" "$DEPLOY_DIR/auto-update.sh"
chmod +x "$DEPLOY_DIR/auto-update.sh"

# Apply any new migrations (idempotent — every file uses IF NOT EXISTS guards)
DB_NAME=$(grep -E '^DB_NAME=' "$DEPLOY_DIR/backend/.env" 2>/dev/null | cut -d= -f2-)
DB_USER=$(grep -E '^DB_USER=' "$DEPLOY_DIR/backend/.env" 2>/dev/null | cut -d= -f2-)
DB_PASSWORD=$(grep -E '^DB_PASSWORD=' "$DEPLOY_DIR/backend/.env" 2>/dev/null | cut -d= -f2-)
if [ -n "$DB_NAME" ] && [ -n "$DB_USER" ]; then
    for mig in "$DEPLOY_DIR"/database/migrations/*.sql; do
        [ -f "$mig" ] || continue
        if mysql -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < "$mig" >/dev/null 2>&1; then
            echo "  Applied: $(basename "$mig")"
        else
            echo "  Skipped (already applied or not applicable): $(basename "$mig")"
        fi
    done
else
    echo -e "${YELLOW}  Could not read DB credentials from .env — skipping migrations${NC}"
fi

chown -R "$BUILD_USER:$BUILD_USER" "$DEPLOY_DIR/backend/dist" "$DEPLOY_DIR/frontend" "$DEPLOY_DIR/database"
echo -e "${GREEN}✓ Migrations and version manifest deployed${NC}"
echo ""

# Step 6: Restart Service
echo -e "${YELLOW}[6/6] Restarting $SERVICE service...${NC}"
systemctl restart "$SERVICE"
sleep 3

# Check service status
if systemctl is-active --quiet "$SERVICE"; then
    echo -e "${GREEN}✓ Service restarted successfully${NC}"
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}Deployed version $(cat "$DEPLOY_DIR/VERSION")${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    systemctl status "$SERVICE" --no-pager -l | head -15
else
    echo -e "${RED}✗ Service failed to start${NC}"
    echo ""
    echo -e "${RED}Last 20 lines of logs:${NC}"
    journalctl -u "$SERVICE" -n 20 --no-pager
    exit 1
fi
