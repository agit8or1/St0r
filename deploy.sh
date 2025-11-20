#!/bin/bash
# UrBackup GUI Deployment Script
# This script builds and deploys the application to /opt/urbackup-gui

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SOURCE_DIR="/home/administrator/urbackup-gui"
DEPLOY_DIR="/opt/urbackup-gui"
NODE_PATH="/home/administrator/.nvm/versions/node/v22.21.1/bin"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}UrBackup GUI Deployment Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if running as correct user
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: This script must be run with sudo${NC}"
    exit 1
fi

# Step 1: Build Backend
echo -e "${YELLOW}[1/5] Building backend...${NC}"
cd "$SOURCE_DIR/backend"
sudo -u administrator bash -c "export PATH=$NODE_PATH:\$PATH && npm run build"
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Backend built successfully${NC}"
else
    echo -e "${RED}✗ Backend build failed${NC}"
    exit 1
fi
echo ""

# Step 2: Build Frontend
echo -e "${YELLOW}[2/5] Building frontend...${NC}"
cd "$SOURCE_DIR/frontend"
sudo -u administrator bash -c "export PATH=$NODE_PATH:\$PATH && npm run build"
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Frontend built successfully${NC}"
else
    echo -e "${RED}✗ Frontend build failed${NC}"
    exit 1
fi
echo ""

# Step 3: Deploy Backend
echo -e "${YELLOW}[3/5] Deploying backend to $DEPLOY_DIR...${NC}"
cp -r "$SOURCE_DIR/backend/dist/"* "$DEPLOY_DIR/backend/dist/"
cp "$SOURCE_DIR/backend/package.json" "$DEPLOY_DIR/backend/"
echo -e "${GREEN}✓ Backend deployed${NC}"
echo ""

# Step 4: Deploy Frontend
echo -e "${YELLOW}[4/5] Deploying frontend to $DEPLOY_DIR...${NC}"
cp -r "$SOURCE_DIR/frontend/dist/"* "$DEPLOY_DIR/frontend/dist/"
echo -e "${GREEN}✓ Frontend deployed${NC}"
echo ""

# Step 5: Restart Service
echo -e "${YELLOW}[5/5] Restarting urbackup-gui service...${NC}"
systemctl restart urbackup-gui
sleep 3

# Check service status
if systemctl is-active --quiet urbackup-gui; then
    echo -e "${GREEN}✓ Service restarted successfully${NC}"
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}Deployment completed successfully!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    systemctl status urbackup-gui --no-pager -l | head -15
else
    echo -e "${RED}✗ Service failed to start${NC}"
    echo ""
    echo -e "${RED}Last 20 lines of logs:${NC}"
    journalctl -u urbackup-gui -n 20 --no-pager
    exit 1
fi
