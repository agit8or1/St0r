#!/bin/bash

set -e

echo "============================================"
echo "St0r Quick Update Script"
echo "============================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
   echo "Please run as root (use sudo)"
   exit 1
fi

# Get the actual user who ran sudo
ACTUAL_USER="${SUDO_USER:-$USER}"
INSTALL_DIR="/opt/urbackup-gui"

# Check if installed
if [ ! -d "$INSTALL_DIR" ]; then
    echo "Error: St0r is not installed at $INSTALL_DIR"
    echo "Please run install.sh first"
    exit 1
fi

echo "This script will:"
echo "  1. Stop the backend service"
echo "  2. Update application files"
echo "  3. Rebuild backend and frontend"
echo "  4. Restart services"
echo ""
echo "Your data and settings will be preserved."
echo ""
read -p "Continue? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Update cancelled."
    exit 0
fi

echo ""
echo "Starting update..."

# Stop service
echo "[1/5] Stopping backend service..."
systemctl stop urbackup-gui

# Update files
echo "[2/5] Updating application files..."
cp -r /home/administrator/urbackup-gui/backend/* $INSTALL_DIR/backend/ 2>/dev/null || true
cp -r /home/administrator/urbackup-gui/frontend/* $INSTALL_DIR/frontend/ 2>/dev/null || true
chown -R $ACTUAL_USER:$ACTUAL_USER $INSTALL_DIR

# Rebuild backend
echo "[3/5] Rebuilding backend..."
cd $INSTALL_DIR/backend
sudo -u $ACTUAL_USER npm install --production
sudo -u $ACTUAL_USER npm run build

# Rebuild frontend
echo "[4/5] Rebuilding frontend..."
cd $INSTALL_DIR/frontend
sudo -u $ACTUAL_USER npm install --production
sudo -u $ACTUAL_USER npm run build

# Restart services
echo "[5/5] Restarting services..."
systemctl start urbackup-gui
systemctl restart nginx

echo ""
echo "============================================"
echo "Update Complete!"
echo "============================================"
echo ""
echo "St0r has been updated successfully."
echo ""
echo "Check status: sudo systemctl status urbackup-gui"
echo "View logs: sudo journalctl -u urbackup-gui -f"
echo ""
