#!/bin/bash
# St0r (UrBackup GUI) - Universal Installer
# Installs UrBackup Server and/or St0r GUI

set -e

# Version
INSTALLER_VERSION="3.2.2"
INSTALLER_DATE="2025-11-20"

echo "============================================"
echo "St0r Universal Installer"
echo "Version: $INSTALLER_VERSION ($INSTALLER_DATE)"
echo "============================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
   echo "Error: This script must be run as root"
   echo "Please run: sudo ./install.sh"
   exit 1
fi

# Get the actual user who ran sudo
ACTUAL_USER="${SUDO_USER:-$USER}"
INSTALL_DIR="/opt/urbackup-gui"
VERSION_FILE="$INSTALL_DIR/.version"

echo "Running as user: $ACTUAL_USER"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STEP 1: Detect what's already installed
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "Checking current installation..."
echo ""

# Check UrBackup Server
URBACKUP_INSTALLED=false
URBACKUP_VERSION="Not installed"
if dpkg -l 2>/dev/null | grep -q "^ii.*urbackup-server"; then
    URBACKUP_INSTALLED=true
    URBACKUP_VERSION=$(dpkg -l | grep urbackup-server | awk '{print $3}')
fi

# Check St0r GUI
STOR_INSTALLED=false
STOR_VERSION="Not installed"
if [ -d "$INSTALL_DIR" ] && [ -f "/etc/systemd/system/urbackup-gui.service" ]; then
    STOR_INSTALLED=true
    if [ -f "$VERSION_FILE" ]; then
        STOR_VERSION=$(grep "VERSION=" "$VERSION_FILE" | cut -d= -f2)
    else
        STOR_VERSION="Unknown"
    fi
fi

# Display current status
echo "Current Installation Status:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  UrBackup Server: $URBACKUP_VERSION"
echo "  St0r GUI:        $STOR_VERSION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STEP 2: Ask what to install/upgrade
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INSTALL_URBACKUP=false
INSTALL_STOR=false

echo "What would you like to install?"
echo ""

# Ask about UrBackup Server
if [ "$URBACKUP_INSTALLED" = false ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "UrBackup Server - NOT INSTALLED"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "UrBackup Server is the backup engine that:"
    echo "  • Manages client backups (file and image)"
    echo "  • Stores backup data"
    echo "  • Handles deduplication and compression"
    echo "  • Requires ~100MB disk space + backup storage"
    echo "  • Listens on ports 55413-55415"
    echo ""
    read -p "Install UrBackup Server? (Y/n): " -n 1 -r < /dev/tty
    echo ""
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        INSTALL_URBACKUP=true
        echo "  ✓ Will install UrBackup Server 2.5.34"
    else
        echo "  ⊗ Skipping UrBackup Server installation"
    fi
    echo ""
else
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "UrBackup Server - ALREADY INSTALLED ($URBACKUP_VERSION)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # Check if service is running
    if systemctl is-active --quiet urbackupsrv; then
        echo "  ✓ Service is running"
    else
        echo "  ⚠ Service is not running"
        read -p "Start UrBackup Server service now? (Y/n): " -n 1 -r < /dev/tty
        echo ""
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            systemctl start urbackupsrv 2>/dev/null || true
            if systemctl is-active --quiet urbackupsrv; then
                echo "  ✓ Service started successfully"
            else
                echo "  ✗ Failed to start service"
            fi
        fi
    fi
    echo ""
fi

# Ask about St0r GUI
if [ "$STOR_INSTALLED" = false ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "St0r GUI - NOT INSTALLED"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "St0r is a modern web interface for UrBackup that provides:"
    echo "  • Real-time backup progress with ETA and transfer speed"
    echo "  • Client management dashboard"
    echo "  • Storage visualization"
    echo "  • Activity monitoring"
    echo "  • Requires: Nginx, MariaDB, Node.js"
    echo ""
    read -p "Install St0r GUI? (Y/n): " -n 1 -r < /dev/tty
    echo ""
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        INSTALL_STOR=true
        echo "  ✓ Will install St0r GUI v$INSTALLER_VERSION"
    else
        echo "  ⊗ Skipping St0r GUI installation"
    fi
    echo ""
else
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "St0r GUI - ALREADY INSTALLED ($STOR_VERSION)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    if [ "$STOR_VERSION" = "$INSTALLER_VERSION" ]; then
        echo "You have the latest version installed!"
        echo ""
        read -p "Reinstall/repair anyway? (y/N): " -n 1 -r < /dev/tty
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            INSTALL_STOR=true
            echo "  ✓ Will reinstall St0r GUI v$INSTALLER_VERSION"
        else
            echo "  ⊗ Keeping current installation"
        fi
    else
        echo "Upgrade available: $STOR_VERSION → $INSTALLER_VERSION"
        echo ""
        echo "What's new in v3.2.0:"
        echo "  • File Browser - Browse and download files from any backup"
        echo "  • File Restore - Restore multiple files directly to client"
        echo "  • Bare Metal Restore - Download restore ISO and instructions"
        echo "  • Fixed backup history showing 0 backups"
        echo "  • Fixed file browsing and download security"
        echo "  • Improved deployment process"
        echo ""
        read -p "Upgrade to v$INSTALLER_VERSION? (Y/n): " -n 1 -r < /dev/tty
        echo ""
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            INSTALL_STOR=true
            echo "  ✓ Will upgrade to St0r GUI v$INSTALLER_VERSION"
        else
            echo "  ⊗ Keeping current version"
        fi
    fi
    echo ""
fi

# Check if anything to do
if [ "$INSTALL_URBACKUP" = false ] && [ "$INSTALL_STOR" = false ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Nothing to install"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Current installation is unchanged."
    echo "Run this script again to install or upgrade components."
    exit 0
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STEP 3: Final confirmation
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Installation Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$INSTALL_URBACKUP" = true ]; then
    echo "  ✓ Install UrBackup Server 2.5.34"
fi
if [ "$INSTALL_STOR" = true ]; then
    echo "  ✓ Install St0r GUI v$INSTALLER_VERSION"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
read -p "Proceed with installation? (Y/n): " -n 1 -r < /dev/tty
echo ""
if [[ $REPLY =~ ^[Nn]$ ]]; then
    echo ""
    echo "Installation cancelled by user."
    exit 0
fi

echo ""
echo "Starting installation..."
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STEP 4: Install UrBackup Server
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if [ "$INSTALL_URBACKUP" = true ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Installing UrBackup Server"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # Install via PPA (Ubuntu/Debian)
    echo "  Detecting system..."
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
    else
        OS="unknown"
    fi

    if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
        echo "  Installing UrBackup Server from PPA..."

        # Install software-properties-common for add-apt-repository
        apt-get install -y -qq software-properties-common

        # Add UrBackup PPA
        add-apt-repository -y ppa:uroni/urbackup > /dev/null 2>&1
        apt-get update -qq

        # Install UrBackup Server
        DEBIAN_FRONTEND=noninteractive apt-get install -y -qq urbackup-server

        # Verify installation
        if dpkg -l 2>/dev/null | grep -q "^ii.*urbackup-server"; then
            echo "  ✓ UrBackup Server installed successfully"

            # Start and enable service
            systemctl enable urbackupsrv 2>/dev/null || true
            systemctl start urbackupsrv 2>/dev/null || true

            if systemctl is-active --quiet urbackupsrv; then
                echo "  ✓ UrBackup Server service is running"
            else
                echo "  ⚠ Service may need manual start: systemctl start urbackupsrv"
            fi
        else
            echo "  ✗ Installation verification failed"
            echo ""
            echo "Please install UrBackup Server manually:"
            echo "  https://www.urbackup.org/download.html"
            exit 1
        fi
    else
        echo "  ✗ Unsupported distribution: $OS"
        echo ""
        echo "Please install UrBackup Server manually:"
        echo "  For Ubuntu/Debian: sudo add-apt-repository ppa:uroni/urbackup"
        echo "  For other distros: https://www.urbackup.org/download.html"
        exit 1
    fi

    echo ""
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STEP 5: Install St0r GUI
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if [ "$INSTALL_STOR" = true ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Installing St0r GUI"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # Update system
    echo "[1/9] Updating system packages..."
    apt-get update -qq

    # Install dependencies
    echo "[2/9] Installing system dependencies..."
    apt-get install -y -qq curl gnupg2 software-properties-common nginx mariadb-server

    # Install Node.js 20
    echo "[3/9] Installing Node.js 20..."
    if ! command -v node &> /dev/null || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt 18 ]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
        apt-get install -y -qq nodejs
    fi

    echo "  Node.js version: $(node --version)"
    echo "  npm version: $(npm --version)"

    # Stop services if upgrading
    if [ "$STOR_INSTALLED" = true ]; then
        echo "[4/9] Stopping services for upgrade..."
        systemctl stop urbackup-gui || true

        # Backup existing .env file
        if [ -f "$INSTALL_DIR/backend/.env" ]; then
            cp "$INSTALL_DIR/backend/.env" "/tmp/urbackup-gui.env.backup"
            echo "  ✓ Backed up .env file"
        fi

        # Backup database
        echo "  Creating database backup..."
        mysqldump -u root urbackup_gui > "/tmp/urbackup_gui_backup_$(date +%Y%m%d_%H%M%S).sql" 2>/dev/null || echo "  Warning: Could not backup database"
    else
        echo "[4/9] Creating installation directory..."
    fi

    # Copy/update application files
    mkdir -p $INSTALL_DIR

    # Determine installation method
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
    DOWNLOAD_URL="https://stor.agit8or.net/downloads/stor-v3.2.2-deployment.tar.gz"
    IS_SOURCE_INSTALL=false

    # Check if we're running from source directory (local install) or need to download
    if [ -d "$SCRIPT_DIR/backend" ] && [ -d "$SCRIPT_DIR/frontend" ]; then
        # Local installation from source directory
        echo "  Using local source files from: $SCRIPT_DIR"
        cp -r $SCRIPT_DIR/* $INSTALL_DIR/
        chown -R $ACTUAL_USER:$ACTUAL_USER $INSTALL_DIR

        # Check if this is a source install (has src/ directories)
        if [ -d "$INSTALL_DIR/backend/src" ]; then
            IS_SOURCE_INSTALL=true
        fi
    else
        # Remote installation - download package
        echo "  Downloading latest package..."
        TEMP_PACKAGE="/tmp/urbackup-gui-download-$$.tar.gz"

        if ! curl -fSL "$DOWNLOAD_URL" -o "$TEMP_PACKAGE"; then
            echo ""
            echo "ERROR: Failed to download package"
            echo ""
            echo "Alternative: Download source and run locally"
            exit 1
        fi

        # Extract package
        echo "  Extracting package..."
        cd /tmp
        tar -xzf "$TEMP_PACKAGE"

        if [ ! -d "/tmp/urbackup-gui" ]; then
            echo "ERROR: Package extraction failed"
            rm -f "$TEMP_PACKAGE"
            exit 1
        fi

        # Copy files to installation directory
        cp -r /tmp/urbackup-gui/* $INSTALL_DIR/
        chown -R $ACTUAL_USER:$ACTUAL_USER $INSTALL_DIR

        # Cleanup
        rm -rf /tmp/urbackup-gui "$TEMP_PACKAGE"
        echo "  ✓ Package downloaded and extracted"
    fi

    # Restore .env file if it was backed up
    if [ -f "/tmp/urbackup-gui.env.backup" ]; then
        cp "/tmp/urbackup-gui.env.backup" "$INSTALL_DIR/backend/.env"
        rm "/tmp/urbackup-gui.env.backup"
        echo "  ✓ Restored .env configuration"
    fi

    # Configure MariaDB
    echo "[5/9] Configuring MariaDB..."
    systemctl start mariadb
    systemctl enable mariadb

    # Create database and user (only if fresh install)
    if [ "$STOR_INSTALLED" = false ]; then
        mysql -u root <<EOF
CREATE DATABASE IF NOT EXISTS urbackup_gui;
CREATE USER IF NOT EXISTS 'urbackup'@'localhost' IDENTIFIED BY 'urbackup123';
GRANT ALL PRIVILEGES ON urbackup_gui.* TO 'urbackup'@'localhost';
FLUSH PRIVILEGES;
EOF

        # Run database schema
        echo "[6/9] Setting up database schema..."
        mysql -u root urbackup_gui < $INSTALL_DIR/database/init/01_schema.sql
    else
        echo "[6/9] Skipping database initialization (upgrade mode)..."
    fi

    # Install backend dependencies
    echo "[7/9] Installing backend dependencies..."
    cd $INSTALL_DIR/backend
    rm -rf node_modules
    sudo -u $ACTUAL_USER npm install --omit=dev --silent

    if [ "$IS_SOURCE_INSTALL" = true ]; then
        echo "  Building backend from source..."
        sudo -u $ACTUAL_USER npm run build
    else
        echo "  ✓ Using pre-built backend files"
    fi

    # Install and build frontend
    if [ "$IS_SOURCE_INSTALL" = true ]; then
        echo "[8/9] Building frontend from source..."
        cd $INSTALL_DIR/frontend
        rm -rf node_modules
        sudo -u $ACTUAL_USER npm install --silent
        sudo -u $ACTUAL_USER npm run build
    else
        echo "[8/9] Frontend setup..."
        echo "  ✓ Using pre-built frontend files"
    fi

    # Configure nginx
    echo "[9/9] Configuring services..."
    cp $INSTALL_DIR/setup/nginx-site.conf /etc/nginx/sites-available/urbackup-gui
    ln -sf /etc/nginx/sites-available/urbackup-gui /etc/nginx/sites-enabled/urbackup-gui
    rm -f /etc/nginx/sites-enabled/default

    # Create systemd service for backend
    cp $INSTALL_DIR/setup/urbackup-gui.service /etc/systemd/system/
    systemctl daemon-reload

    # Create .env file if it doesn't exist
    if [ ! -f "$INSTALL_DIR/backend/.env" ]; then
        cat > $INSTALL_DIR/backend/.env <<EOF
NODE_ENV=production
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_NAME=urbackup_gui
DB_USER=urbackup
DB_PASSWORD=urbackup123
JWT_SECRET=$(openssl rand -hex 32)
EOF
        chown $ACTUAL_USER:$ACTUAL_USER $INSTALL_DIR/backend/.env
    fi

    # Start services
    echo ""
    echo "Starting services..."
    systemctl restart urbackup-gui
    systemctl enable urbackup-gui
    systemctl restart nginx
    systemctl enable nginx

    # Write version file
    echo "VERSION=$INSTALLER_VERSION" > "$VERSION_FILE"
    echo "DATE=$INSTALLER_DATE" >> "$VERSION_FILE"
    chown $ACTUAL_USER:$ACTUAL_USER "$VERSION_FILE"

    echo ""
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STEP 6: Installation Complete
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "============================================"
echo "Installation Complete!"
echo "============================================"
echo ""

if [ "$INSTALL_URBACKUP" = true ]; then
    URBACKUP_VERSION=$(dpkg -l | grep urbackup-server | awk '{print $3}')
    echo "✓ UrBackup Server $URBACKUP_VERSION"
    if systemctl is-active --quiet urbackupsrv; then
        echo "  Service: Running"
    else
        echo "  Service: Stopped (run: systemctl start urbackupsrv)"
    fi
    echo ""
fi

if [ "$INSTALL_STOR" = true ]; then
    echo "✓ St0r GUI v$INSTALLER_VERSION"
    echo "  Access at: http://$(hostname -I | awk '{print $1}')"
    echo ""
    echo "  Default credentials:"
    echo "    Username: admin"
    echo "    Password: Chin00k2023###"
    echo ""
    echo "  ⚠ IMPORTANT: Change the default password immediately!"
    echo ""

    if [ "$STOR_INSTALLED" = false ]; then
        echo "What's new in v3.2.0:"
        echo "  • File Browser - Browse and download files from any backup"
        echo "  • File Restore - Restore multiple files directly to client"
        echo "  • Bare Metal Restore - Download restore ISO and instructions"
        echo "  • Fixed backup history showing 0 backups"
        echo "  • Fixed file browsing and download security"
        echo "  • Real-time backup progress with transfer speed and ETA"
        echo "  • Storage pie chart visualization"
    fi

    echo ""
    echo "Useful commands:"
    echo "  sudo systemctl status urbackup-gui  - Check backend status"
    echo "  sudo systemctl restart urbackup-gui - Restart backend"
    echo "  sudo journalctl -u urbackup-gui -f  - View backend logs"
fi

if [ "$INSTALL_URBACKUP" = true ]; then
    echo ""
    echo "UrBackup Server commands:"
    echo "  sudo systemctl status urbackupsrv    - Check server status"
    echo "  sudo systemctl restart urbackupsrv   - Restart server"
    echo "  sudo journalctl -u urbackupsrv -f    - View server logs"
fi

echo ""
