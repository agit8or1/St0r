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
# TypeScript is a dev dependency: --omit=dev left nothing to compile with.
# Install from the lockfile, build, then drop the build-only packages.
npm ci --include=dev 2>&1
echo "--- Building agent ---"
npm run build 2>&1
npm prune --omit=dev 2>&1

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
  echo "--- Using existing API key ---"
fi

# TLS. St0r reaches remote agents over HTTPS only. Unless tls.env already
# exists (your own certificate, or an empty file to keep the agent on loopback
# behind a proxy), generate a self-signed certificate: St0r pins its SHA-256
# fingerprint rather than trusting a CA. Re-running keeps the certificate.
TLS_DIR="$CONFIG_DIR/tls"
if [ ! -e "$CONFIG_DIR/tls.env" ]; then
  command -v openssl &>/dev/null || apt-get install -y openssl
  mkdir -p "$TLS_DIR"
  chmod 700 "$TLS_DIR"
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
    -subj "/CN=stor-agent" -keyout "$TLS_DIR/agent.key" -out "$TLS_DIR/agent.crt" 2>/dev/null
  chmod 600 "$TLS_DIR/agent.key"
  cat > "$CONFIG_DIR/tls.env" <<TLS
STOR_AGENT_TLS_CERT=$TLS_DIR/agent.crt
STOR_AGENT_TLS_KEY=$TLS_DIR/agent.key
TLS
  chmod 600 "$CONFIG_DIR/tls.env"
  echo "--- Generated a self-signed TLS certificate ---"
else
  echo "--- Using existing $CONFIG_DIR/tls.env ---"
fi
TLS_FINGERPRINT=""
if grep -Fqx "STOR_AGENT_TLS_CERT=$TLS_DIR/agent.crt" "$CONFIG_DIR/tls.env"; then
  TLS_FINGERPRINT=$(openssl x509 -in "$TLS_DIR/agent.crt" -noout -fingerprint -sha256 | cut -d= -f2)
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
EnvironmentFile=-$CONFIG_DIR/tls.env

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
echo "  API key: stored in root-readable config (not printed)"
echo "  Config:  $CONFIG_DIR/config.json"
echo ""
echo "  Add this server in St0r > Servers using:"
echo "    Host: $(hostname -I | awk '{print $1}')"
echo "    Port: $PORT"
echo "    Read the API key from $CONFIG_DIR/config.json as root."
if [ -n "$TLS_FINGERPRINT" ]; then
  echo "    TLS fingerprint (SHA-256): $TLS_FINGERPRINT"
else
  echo "    TLS: your own settings in $CONFIG_DIR/tls.env (no fingerprint to pin)."
fi
echo "============================================"
