#!/usr/bin/env bash
# St0r Agent Installer
# Run as root: curl -fsSL https://YOUR_STOR_SERVER/downloads/stor-agent-install.sh | sudo bash

set -e

INSTALL_DIR="/opt/stor-agent"
SERVICE_FILE="/etc/systemd/system/stor-agent.service"
CONFIG_DIR="/etc/stor-agent"
PORT="${STOR_AGENT_PORT:-7420}"

echo "=== St0r Agent Installer ==="
echo "Install dir: $INSTALL_DIR"
echo "Port: $PORT"

# Require root
if [ "$(id -u)" != "0" ]; then
  echo "ERROR: This script must be run as root (sudo)." >&2
  exit 1
fi

# Install Node.js 20 if not present
if ! command -v node &>/dev/null || [[ "$(node --version | cut -d. -f1 | tr -d 'v')" -lt 20 ]]; then
  echo "--- Installing Node.js 20 ---"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

NODE_PATH=$(command -v node)
echo "Node.js: $($NODE_PATH --version) at $NODE_PATH"

# Create install dir
mkdir -p "$INSTALL_DIR"

# Copy agent files (assume they are in the same dir as this script, OR download from St0r)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/package.json" ]; then
  echo "--- Copying agent files from $SCRIPT_DIR ---"
  cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR/"
else
  echo "ERROR: Agent source files not found next to install script." >&2
  echo "Please ensure the agent package is available at $SCRIPT_DIR" >&2
  exit 1
fi

# Install dependencies and build
cd "$INSTALL_DIR"
echo "--- Installing npm dependencies ---"
npm install --omit=dev 2>&1
echo "--- Building agent ---"
npm run build 2>&1

# Generate config (this also generates the API key on first run)
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

if [ ! -f "$CONFIG_DIR/config.json" ]; then
  API_KEY=$(node -e "const c=require('crypto');console.log(c.randomBytes(32).toString('hex'))")
  cat > "$CONFIG_DIR/config.json" <<CONF
{
  "api_key": "$API_KEY",
  "port": $PORT,
  "allowed_ips": []
}
CONF
  chmod 600 "$CONFIG_DIR/config.json"
  echo "--- Generated API key ---"
else
  API_KEY=$(node -e "console.log(require('$CONFIG_DIR/config.json').api_key)")
  echo "--- Using existing API key ---"
fi

# Install systemd service
cat > "$SERVICE_FILE" <<SERVICE
[Unit]
Description=St0r Agent — remote server management daemon
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_PATH $INSTALL_DIR/dist/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=stor-agent
Environment=NODE_ENV=production
Environment=STOR_AGENT_CONFIG_DIR=$CONFIG_DIR

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable stor-agent
systemctl restart stor-agent

echo ""
echo "============================================"
echo "  St0r Agent installed successfully!"
echo "============================================"
echo "  Service: stor-agent (port $PORT)"
echo "  API Key: $API_KEY"
echo "  Config:  $CONFIG_DIR/config.json"
echo ""
echo "  Add this server in St0r > Servers using:"
echo "    Host: $(hostname -I | awk '{print $1}')"
echo "    Port: $PORT"
echo "    API Key: $API_KEY"
echo "============================================"
