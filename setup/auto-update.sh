#!/bin/bash
# St0r Auto-Update Script
# Downloads the latest release from GitHub, builds, and installs it.
# Runs as root via systemd-run. Output is captured to the log file
# by the caller (systemd StandardOutput/StandardError properties).

# ── Self-exec from /tmp so overwriting this file mid-run doesn't corrupt us ──
if [[ "$0" != /tmp/st0r-update-* ]]; then
  _self=$(mktemp /tmp/st0r-update-XXXXXX.sh)
  cp "$0" "$_self"
  chmod +x "$_self"
  exec "$_self" "$@"
fi

set -euo pipefail

# ── Locate Node.js / npm (systemd-run uses minimal PATH without user profiles) ──
if ! command -v npm &>/dev/null; then
  for _npm_bin in /usr/bin/npm \
                  /usr/local/bin/npm \
                  /root/.nvm/versions/node/*/bin/npm \
                  /home/*/.nvm/versions/node/*/bin/npm; do
    [ -x "$_npm_bin" ] || continue
    export PATH="${_npm_bin%/npm}:$PATH"
    break
  done
fi
command -v npm &>/dev/null || { echo "ERROR: npm not found — install Node.js system-wide or ensure nvm is set up"; exit 1; }
echo "Using npm $(npm --version) at $(command -v npm)"

INSTALL_DIR="/opt/urbackup-gui"
BACKUP_DIR="/opt/urbackup-gui-backup-$(date +%Y%m%d-%H%M%S)"
GITHUB_API="https://api.github.com/repos/agit8or1/St0r/releases/latest"
TEMP_DIR=$(mktemp -d)

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

timestamp() { date '+%Y-%m-%d %H:%M:%S'; }

# ── Automatic rollback on any failure ─────────────────────────────────────────
rollback() {
  local err=$?
  trap - ERR  # Prevent recursive rollback calls
  echo ""
  echo "$(timestamp) ════════════════════════════════════════════════"
  echo "$(timestamp) UPDATE FAILED (exit code $err) — rolling back"
  echo "$(timestamp) ════════════════════════════════════════════════"
  if [ -d "$BACKUP_DIR" ]; then
    echo "$(timestamp) Restoring from backup $BACKUP_DIR ..."
    rsync -a --delete "$BACKUP_DIR/" "$INSTALL_DIR/"
    echo "$(timestamp) Restore complete"
  else
    echo "$(timestamp) No backup found — cannot restore automatically"
  fi
  echo "$(timestamp) Restarting urbackup-gui service..."
  systemctl start urbackup-gui 2>/dev/null || true
  echo "FAILED"
}
trap rollback ERR

# Clear previous log so the progress modal starts fresh
truncate -s 0 /var/log/urbackup-gui-update.log 2>/dev/null || true

echo "$(timestamp) Starting St0r update..."

# ── Read optional GitHub token for higher API rate limits (5000/hr vs 60/hr) ──
GITHUB_TOKEN=$(grep -E "^GITHUB_TOKEN=" "${INSTALL_DIR}/backend/.env" 2>/dev/null \
  | cut -d= -f2- | tr -d '[:space:]') || true

# ── 1. Fetch release info (retry up to 3 times) ───────────────────────────────
echo "$(timestamp) Fetching latest release from GitHub..."

RELEASE_JSON=""
for _attempt in 1 2 3; do
  # Use -sS (silent but show errors) instead of -f so we can read the response
  # body on failures (e.g. rate-limit message) without curl exiting non-zero
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    RELEASE_JSON=$(curl -sSL --max-time 30 \
      -H "Accept: application/vnd.github+json" \
      -H "User-Agent: St0r-Update-Checker/1.0" \
      -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      "$GITHUB_API" 2>/dev/null) || true
  else
    RELEASE_JSON=$(curl -sSL --max-time 30 \
      -H "Accept: application/vnd.github+json" \
      -H "User-Agent: St0r-Update-Checker/1.0" \
      "$GITHUB_API" 2>/dev/null) || true
  fi

  # Validate the response contains a tag_name field
  if echo "${RELEASE_JSON}" | python3 -c \
      "import json,sys; d=json.load(sys.stdin); assert 'tag_name' in d" 2>/dev/null; then
    break
  fi

  # Extract GitHub's error message if available
  _api_err=$(echo "${RELEASE_JSON}" | python3 -c \
    "import json,sys; print(json.load(sys.stdin).get('message','(no message)'))" \
    2>/dev/null || echo "invalid or empty response")

  echo "$(timestamp) GitHub API attempt ${_attempt}/3 failed: ${_api_err}"

  if [ "${_attempt}" -lt 3 ]; then
    echo "$(timestamp) Retrying in 15s..."
    sleep 15
  else
    echo "$(timestamp) ERROR: GitHub API unavailable after 3 attempts"
    if [ -z "${GITHUB_TOKEN:-}" ]; then
      echo "$(timestamp) Hint: add GITHUB_TOKEN=<token> to ${INSTALL_DIR}/backend/.env"
      echo "$(timestamp)       to raise the rate limit from 60 to 5000 requests/hour"
    fi
    exit 1
  fi
done

# Parse version tag
VERSION=$(echo "$RELEASE_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['tag_name'])")

if [ -z "$VERSION" ]; then
  echo "$(timestamp) ERROR: Could not parse version from GitHub response"
  exit 1
fi

# Build direct archive URL — avoids API redirect chain
TARBALL_URL="https://github.com/agit8or1/St0r/archive/refs/tags/${VERSION}.tar.gz"

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
systemctl stop urbackup-gui 2>/dev/null || true

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
# Full install needed so devDependencies (TypeScript) are available for the build
npm install 2>&1
echo "$(timestamp) Dependencies installed successfully"

echo "$(timestamp) Building backend..."
# Clean previous compiled output to avoid stale files causing tsc errors
rm -rf dist
npm run build 2>&1
echo "$(timestamp) Backend build successful"

# Prune devDependencies after successful build
npm prune --omit=dev 2>&1

# ── 7. Run DB migrations ───────────────────────────────────────────────────
echo "$(timestamp) Running database migrations..."
for mig in "$INSTALL_DIR/database/migrations"/*.sql; do
  [ -f "$mig" ] || continue
  echo "$(timestamp) Migration: $(basename "$mig")"
  mysql -u root urbackup_gui < "$mig" || echo "WARN: migration may have already been applied"
done

# ── 8. Restart service ────────────────────────────────────────────────────
echo "$(timestamp) Starting urbackup-gui service..."
systemctl start urbackup-gui 2>/dev/null || true

echo "$(timestamp) Update completed successfully - $VERSION installed"
echo "SUCCESS"
