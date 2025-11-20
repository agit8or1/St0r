#!/bin/bash
# St0r (UrBackup GUI) Automated Update Script
# This script downloads and installs the latest version automatically

set -e  # Exit on error

LOG_FILE="/var/log/urbackup-gui-update.log"
INSTALL_DIR="/opt/urbackup-gui"
BACKUP_DIR="/tmp/urbackup-gui-backup-$(date +%Y%m%d_%H%M%S)"
UPDATE_URL="https://stor.agit8or.net/downloads/urbackup-gui.tar.gz"
# Determine the actual user (not root)
ACTUAL_USER="${SUDO_USER:-administrator}"

# Function to log messages
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Function to restore backup on failure
restore_backup() {
    log "ERROR: Update failed. Restoring from backup..."
    if [ -d "$BACKUP_DIR" ]; then
        rm -rf "$INSTALL_DIR"
        mv "$BACKUP_DIR" "$INSTALL_DIR"
        systemctl restart urbackup-gui
        log "Backup restored successfully"
    fi
    exit 1
}

# Set up error trap
trap restore_backup ERR

log "===== Starting St0r Automated Update ====="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    log "ERROR: This script must be run as root"
    exit 1
fi

# Create backup
log "Creating backup of current installation..."
cp -r "$INSTALL_DIR" "$BACKUP_DIR"
log "Backup created at $BACKUP_DIR"

# Download latest version
log "Downloading latest version..."
cd /tmp
rm -f urbackup-gui-latest.tar.gz
if command -v wget &> /dev/null; then
    wget -q -O urbackup-gui-latest.tar.gz "$UPDATE_URL"
elif command -v curl &> /dev/null; then
    curl -s -L -o urbackup-gui-latest.tar.gz "$UPDATE_URL"
else
    log "ERROR: Neither wget nor curl is installed"
    restore_backup
fi

if [ ! -f urbackup-gui-latest.tar.gz ]; then
    log "ERROR: Failed to download update"
    restore_backup
fi

log "Download complete"

# Stop service
log "Stopping urbackup-gui service..."
systemctl stop urbackup-gui

# Extract to temp directory
log "Extracting update..."
rm -rf /tmp/urbackup-gui-new
mkdir -p /tmp/urbackup-gui-new
tar -xzf urbackup-gui-latest.tar.gz -C /tmp/urbackup-gui-new

# Preserve .env file and node_modules
log "Preserving configuration and dependencies..."
if [ -f "$INSTALL_DIR/backend/.env" ]; then
    cp "$INSTALL_DIR/backend/.env" /tmp/urbackup-gui-env-backup
fi

# Install new version
log "Installing new version..."

# Preserve downloads directory if it exists
DOWNLOADS_BACKUP="/tmp/urbackup-gui-downloads-backup"
if [ -d "$INSTALL_DIR/frontend/dist/downloads" ]; then
    log "Preserving downloads directory..."
    cp -r "$INSTALL_DIR/frontend/dist/downloads" "$DOWNLOADS_BACKUP"
fi

rm -rf "$INSTALL_DIR/frontend/dist"
rm -rf "$INSTALL_DIR/backend/dist"
rm -rf "$INSTALL_DIR/backend/node_modules"
mkdir -p "$INSTALL_DIR/frontend"
mkdir -p "$INSTALL_DIR/backend"

cp -r /tmp/urbackup-gui-new/frontend/* "$INSTALL_DIR/frontend/"
cp -r /tmp/urbackup-gui-new/backend/* "$INSTALL_DIR/backend/"

# Restore downloads directory
if [ -d "$DOWNLOADS_BACKUP" ]; then
    log "Restoring downloads directory..."
    mkdir -p "$INSTALL_DIR/frontend/dist"
    cp -r "$DOWNLOADS_BACKUP" "$INSTALL_DIR/frontend/dist/downloads"
    rm -rf "$DOWNLOADS_BACKUP"
fi

# Copy version.json to root (used by API)
if [ -f /tmp/urbackup-gui-new/version.json ]; then
    log "Updating version.json..."
    cp /tmp/urbackup-gui-new/version.json "$INSTALL_DIR/version.json"
    NEW_VERSION=$(grep "version" "$INSTALL_DIR/version.json" | head -1 | cut -d'"' -f4)
    log "Updated to version: $NEW_VERSION"
else
    log "WARNING: version.json not found in package!"
fi

# Restore .env
if [ -f /tmp/urbackup-gui-env-backup ]; then
    cp /tmp/urbackup-gui-env-backup "$INSTALL_DIR/backend/.env"
    rm /tmp/urbackup-gui-env-backup
    log "Restored .env configuration"
fi

# Install/update dependencies
log "Installing backend dependencies (this may take 30-60 seconds)..."
cd "$INSTALL_DIR/backend"
npm install --omit=dev >> "$LOG_FILE" 2>&1 &
NPM_PID=$!

# Show progress while npm is running
while kill -0 $NPM_PID 2>/dev/null; do
    sleep 2
    log "  Still installing dependencies..."
done
wait $NPM_PID
NPM_EXIT=$?

if [ $NPM_EXIT -ne 0 ]; then
    log "ERROR: npm install failed"
    restore_backup
fi

log "✓ Dependencies installed successfully"

# Fix permissions
log "Fixing file permissions..."
chown -R "$ACTUAL_USER:$ACTUAL_USER" "$INSTALL_DIR"
log "✓ Permissions updated"

# Start service
log "Starting urbackup-gui service..."
systemctl start urbackup-gui

# Wait for service to start
log "Waiting for service to become ready..."
sleep 3

# Check if service is running
if systemctl is-active --quiet urbackup-gui; then
    log "✓ Service started successfully"
    log "===== Update completed successfully ====="
    log "Cleaning up temporary files..."
    rm -f /tmp/urbackup-gui-latest.tar.gz
    rm -rf /tmp/urbackup-gui-new
    log "✓ Cleanup complete"
    # Keep backup for rollback if needed
    log "Backup kept at $BACKUP_DIR (can be removed manually if update is stable)"
    log ""
    log "SUCCESS - St0r has been updated! Please refresh your browser."
    echo "SUCCESS"
    exit 0
else
    log "ERROR: Service failed to start after update"
    restore_backup
fi
