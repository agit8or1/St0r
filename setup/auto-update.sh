#!/bin/bash
# St0r Auto-Update Script
# Downloads the latest release from GitHub, builds, and installs it.
# Runs as root via systemd-run. Output is captured to the log file
# by the caller (systemd StandardOutput/StandardError properties).

set -euo pipefail

INSTALL_DIR="/opt/urbackup-gui"
BACKUP_DIR="/opt/urbackup-gui-backup-$(date +%Y%m%d-%H%M%S)"
GITHUB_API="https://api.github.com/repos/agit8or1/St0r/releases/latest"
TEMP_DIR=$(mktemp -d)

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

timestamp() { date '+%Y-%m-%d %H:%M:%S'; }

echo "$(timestamp) Starting St0r update..."

# ── 1. Fetch release info ──────────────────────────────────────────────────
echo "$(timestamp) Fetching latest release from GitHub..."
RELEASE_JSON=$(curl -fsSL -H "Accept: application/vnd.github+json" \
  -H "User-Agent: St0r-Update-Checker/1.0" "$GITHUB_API")

TARBALL_URL=$(echo "$RELEASE_JSON" | grep '"tarball_url"' | head -1 | cut -d'"' -f4)
VERSION=$(echo "$RELEASE_JSON"     | grep '"tag_name"'    | head -1 | cut -d'"' -f4)

if [ -z "$TARBALL_URL" ] || [ -z "$VERSION" ]; then
  echo "ERROR: Could not parse GitHub release info"
  exit 1
fi
echo "$(timestamp) Latest version: $VERSION"

# ── 2. Backup current installation ────────────────────────────────────────
echo "$(timestamp) Creating backup at $BACKUP_DIR..."
cp -a "$INSTALL_DIR" "$BACKUP_DIR"

# ── 3. Download & extract ──────────────────────────────────────────────────
echo "$(timestamp) Downloading latest version..."
curl -fsSL -L "$TARBALL_URL" -o "$TEMP_DIR/release.tar.gz"

echo "$(timestamp) Extracting update..."
mkdir -p "$TEMP_DIR/src"
tar xzf "$TEMP_DIR/release.tar.gz" -C "$TEMP_DIR/src" --strip-components=1

# ── 4. Stop service ────────────────────────────────────────────────────────
echo "$(timestamp) Stopping urbackup-gui service..."
systemctl stop urbackup-gui || true

# ── 5. Install new files (preserve .env) ──────────────────────────────────
echo "$(timestamp) Installing new version..."
# Backend source (compiled from TypeScript below)
rsync -a --exclude='.env' --exclude='node_modules' --exclude='dist' \
  "$TEMP_DIR/src/backend/"  "$INSTALL_DIR/backend/"

# Frontend source
rsync -a --exclude='node_modules' --exclude='dist' \
  "$TEMP_DIR/src/frontend/" "$INSTALL_DIR/frontend/"

# Database migrations
rsync -a "$TEMP_DIR/src/database/" "$INSTALL_DIR/database/"

# Scripts
rsync -a "$TEMP_DIR/src/setup/" "$INSTALL_DIR/setup/"
chmod +x "$INSTALL_DIR/setup/auto-update.sh"
cp -f "$INSTALL_DIR/setup/auto-update.sh" "$INSTALL_DIR/auto-update.sh"
chmod +x "$INSTALL_DIR/auto-update.sh"

# ── 6. Build backend ──────────────────────────────────────────────────────
echo "$(timestamp) Installing backend dependencies..."
cd "$INSTALL_DIR/backend"
npm install --omit=dev 2>&1
echo "$(timestamp) Dependencies installed successfully"

echo "$(timestamp) Building backend..."
npm run build 2>&1

# ── 7. Run DB migrations ───────────────────────────────────────────────────
echo "$(timestamp) Running database migrations..."
for mig in "$INSTALL_DIR/database/migrations"/*.sql; do
  [ -f "$mig" ] || continue
  echo "$(timestamp) Migration: $(basename "$mig")"
  mysql -u root urbackup_gui < "$mig" || echo "WARN: migration may have already been applied"
done

# ── 8. Restart service ────────────────────────────────────────────────────
echo "$(timestamp) Starting urbackup-gui service..."
systemctl start urbackup-gui

echo "$(timestamp) Update completed successfully - $VERSION installed"
echo "SUCCESS"
