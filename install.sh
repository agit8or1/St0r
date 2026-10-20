#!/bin/bash
# St0r (UrBackup GUI) - Universal Installer
# Installs UrBackup Server and/or St0r GUI

set -e

# Version
#
# Which St0r this run installs. It used to be a number typed in here, which
# stopped being bumped at 3.2.78 — so `curl ... | sudo bash` kept installing a
# March 2026 release long after newer ones were out, and wrote that number into
# version.json even when installing newer code from a checkout.
#
#  - Run from a checkout (backend/ and frontend/ beside this script): the
#    checkout's own VERSION file. That is the code that gets installed.
#  - Run on its own (curl | bash, or a downloaded install.sh): the latest
#    published GitHub release — the same one the in-app updater
#    (setup/auto-update.sh) installs.
#  - ST0R_INSTALL_VERSION=3.2.118 pins a release explicitly.
#  - If GitHub cannot be asked, FALLBACK_VERSION, with a warning. It is a
#    last resort, not the normal path, so it going stale is no longer silent.
FALLBACK_VERSION="3.2.120"
FALLBACK_DATE="2026-09-15"
RELEASES_API="https://api.github.com/repos/agit8or1/St0r/releases/latest"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Prints "<version> <date>" for the latest published release, or nothing.
latest_release() {
    local json=""
    if command -v curl >/dev/null 2>&1; then
        json=$(curl -fsSL --max-time 20 -H "Accept: application/vnd.github+json" \
            -H "User-Agent: St0r-Installer" "$RELEASES_API" 2>/dev/null) || json=""
    elif command -v wget >/dev/null 2>&1; then
        json=$(wget -qO- --timeout=20 --header="Accept: application/vnd.github+json" \
            "$RELEASES_API" 2>/dev/null) || json=""
    fi
    local tag date
    tag=$(printf '%s' "$json" | tr -d '\n' | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)".*/\1/p')
    date=$(printf '%s' "$json" | tr -d '\n' | sed -n 's/.*"published_at"[[:space:]]*:[[:space:]]*"\([0-9-]\{10\}\)T.*/\1/p')
    if [ -n "$tag" ]; then
        echo "$tag ${date:-unknown}"
    fi
}

INSTALL_SOURCE=""
if [ -n "${ST0R_INSTALL_VERSION:-}" ]; then
    if ! printf '%s' "$ST0R_INSTALL_VERSION" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+$'; then
        echo "Error: ST0R_INSTALL_VERSION must look like 3.2.118 (got: $ST0R_INSTALL_VERSION)"
        exit 1
    fi
    INSTALLER_VERSION="${ST0R_INSTALL_VERSION#v}"
    INSTALLER_DATE="pinned"
    INSTALL_SOURCE="release v$INSTALLER_VERSION (pinned by ST0R_INSTALL_VERSION)"
elif [ -d "$SCRIPT_DIR/backend" ] && [ -d "$SCRIPT_DIR/frontend" ] && [ -f "$SCRIPT_DIR/VERSION" ]; then
    INSTALLER_VERSION=$(tr -d '[:space:]' < "$SCRIPT_DIR/VERSION")
    INSTALLER_DATE=$(sed -n 's/.*"releaseDate"[[:space:]]*:[[:space:]]*"\([0-9-]*\)".*/\1/p' "$SCRIPT_DIR/version.json" 2>/dev/null | head -1)
    INSTALLER_DATE="${INSTALLER_DATE:-unknown}"
    INSTALL_SOURCE="the checkout in $SCRIPT_DIR"
else
    LATEST=$(latest_release)
    if [ -n "$LATEST" ]; then
        INSTALLER_VERSION="${LATEST%% *}"
        INSTALLER_DATE="${LATEST#* }"
        INSTALL_SOURCE="the latest GitHub release"
    else
        INSTALLER_VERSION="$FALLBACK_VERSION"
        INSTALLER_DATE="$FALLBACK_DATE"
        INSTALL_SOURCE="the built-in fallback (GitHub could not be reached)"
        echo "Warning: could not read the latest release from GitHub; falling back to v$FALLBACK_VERSION."
        echo "         Newer releases may exist: https://github.com/agit8or1/St0r/releases"
        echo ""
    fi
fi

echo "============================================"
echo "St0r Universal Installer"
echo "Version: $INSTALLER_VERSION ($INSTALLER_DATE), from $INSTALL_SOURCE"
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
VERSION_FILE="$INSTALL_DIR/version.json"

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
        STOR_VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$VERSION_FILE" | grep -o '"[^"]*"$' | tr -d '"')
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
        echo "What's new: https://github.com/agit8or1/St0r/blob/main/CHANGELOG.md"
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

    if [ "$OS" = "ubuntu" ]; then
        echo "  Installing UrBackup Server from PPA (Ubuntu)..."

        # software-properties-common provides add-apt-repository (Ubuntu only)
        apt-get install -y -qq software-properties-common

        # Add UrBackup PPA and install
        add-apt-repository -y ppa:uroni/urbackup > /dev/null 2>&1
        apt-get update -qq
        DEBIAN_FRONTEND=noninteractive apt-get install -y -qq urbackup-server

    elif [ "$OS" = "debian" ]; then
        echo "  Installing UrBackup Server (Debian — direct .deb download)..."
        echo "  Note: PPAs are Ubuntu-only; using UrBackup's official .deb package."

        # Detect latest UrBackup version from GitHub releases; fall back to known stable
        URBACKUP_DEB_VER=$(curl -fsSL "https://api.github.com/repos/uroni/urbackup_backend/releases/latest" 2>/dev/null \
            | grep '"tag_name"' | cut -d'"' -f4 | sed 's/^v//' || echo "")
        [ -z "$URBACKUP_DEB_VER" ] && URBACKUP_DEB_VER="2.5.34"

        URBACKUP_ARCH=$(dpkg --print-architecture)
        URBACKUP_DEB_URL="https://hndl.urbackup.org/Server/${URBACKUP_DEB_VER}/urbackup-server_${URBACKUP_DEB_VER}_${URBACKUP_ARCH}.deb"
        echo "  Downloading urbackup-server ${URBACKUP_DEB_VER} (${URBACKUP_ARCH})..."

        if curl -fsSL "$URBACKUP_DEB_URL" -o /tmp/urbackup-server.deb; then
            DEBIAN_FRONTEND=noninteractive apt-get install -y -qq /tmp/urbackup-server.deb
            rm -f /tmp/urbackup-server.deb
        else
            echo "  ✗ Download failed: $URBACKUP_DEB_URL"
            echo "  Please install UrBackup Server manually: https://www.urbackup.org/download.html"
            exit 1
        fi

    else
        echo "  ✗ Unsupported distribution: $OS"
        echo ""
        echo "Please install UrBackup Server manually:"
        echo "  https://www.urbackup.org/download.html"
        exit 1
    fi

    # Verify installation (shared for Ubuntu and Debian paths)
    if dpkg -l 2>/dev/null | grep -q "^ii.*urbackup-server"; then
        echo "  ✓ UrBackup Server installed successfully"

        systemctl enable urbackupsrv 2>/dev/null || true
        systemctl start urbackupsrv 2>/dev/null || true

        if systemctl is-active --quiet urbackupsrv; then
            echo "  ✓ UrBackup Server service is running"
        else
            echo "  ⚠ Service may need manual start: systemctl start urbackupsrv"
        fi
    else
        echo "  ✗ Installation verification failed"
        echo "  Please install UrBackup Server manually: https://www.urbackup.org/download.html"
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
    apt-get install -y -qq curl gnupg2 nginx mariadb-server rsync sqlite3

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

    # Determine installation method (SCRIPT_DIR is set at the top, where the
    # version is chosen, so the two always agree)
    DOWNLOAD_URL="https://github.com/agit8or1/St0r/archive/refs/tags/v${INSTALLER_VERSION}.tar.gz"
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
        # Remote installation - download from GitHub
        echo "  Downloading v${INSTALLER_VERSION} from GitHub..."
        TEMP_PACKAGE="/tmp/stor-download-$$.tar.gz"
        TEMP_DIR="/tmp/stor-extract-$$"

        if ! curl -fSL "$DOWNLOAD_URL" -o "$TEMP_PACKAGE"; then
            echo ""
            echo "ERROR: Failed to download package from GitHub"
            echo "  URL: $DOWNLOAD_URL"
            echo ""
            echo "Alternative: clone and run locally:"
            echo "  git clone https://github.com/agit8or1/St0r.git"
            echo "  sudo ./St0r/install.sh"
            exit 1
        fi

        # Extract package
        echo "  Extracting package..."
        mkdir -p "$TEMP_DIR"
        tar -xzf "$TEMP_PACKAGE" -C "$TEMP_DIR" --strip-components=1

        if [ ! -d "$TEMP_DIR/backend" ]; then
            echo "ERROR: Package extraction failed — backend directory not found"
            rm -rf "$TEMP_PACKAGE" "$TEMP_DIR"
            exit 1
        fi

        # Copy files to installation directory
        cp -r "$TEMP_DIR"/. $INSTALL_DIR/
        chown -R $ACTUAL_USER:$ACTUAL_USER $INSTALL_DIR

        # Source install — will build below
        IS_SOURCE_INSTALL=true

        # Cleanup
        rm -rf "$TEMP_DIR" "$TEMP_PACKAGE"
        echo "  ✓ Source downloaded and extracted"
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

    # Configure database
    if [ "$STOR_INSTALLED" = false ]; then
        # Fresh install: generate a random DB password
        DB_PASS=$(openssl rand -hex 24)

        mysql -u root <<SQLEOF
CREATE DATABASE IF NOT EXISTS urbackup_gui CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'urbackup'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON urbackup_gui.* TO 'urbackup'@'localhost';
FLUSH PRIVILEGES;
SQLEOF

        # Run database schema
        echo "[6/9] Setting up database schema..."
        mysql -u root urbackup_gui < $INSTALL_DIR/database/init/01_schema.sql
        # Also run all migrations on fresh install (adds replication, managed mode, etc.)
        for mig in $INSTALL_DIR/database/migrations/*.sql; do
            echo "  Applying migration: $(basename $mig)..."
            mysql -u root urbackup_gui < "$mig" 2>/dev/null || true
        done

        # Store generated password for .env creation below
        GENERATED_DB_PASS="$DB_PASS"
    else
        echo "[6/9] Running database migrations (upgrade mode)..."
        # Run any new migration files that exist
        for mig in $INSTALL_DIR/database/migrations/*.sql; do
            echo "  Applying migration: $(basename $mig)..."
            mysql -u root urbackup_gui < "$mig" 2>/dev/null || true
        done
    fi

    # Install backend dependencies
    echo "[7/9] Installing backend dependencies..."
    cd $INSTALL_DIR/backend
    rm -rf node_modules
    if [ "$IS_SOURCE_INSTALL" = true ]; then
        # Need devDependencies (typescript/tsc) to build from source
        sudo -u $ACTUAL_USER npm install --silent
        echo "  Building backend from source..."
        sudo -u $ACTUAL_USER npm run build
        # Remove dev deps from production install
        sudo -u $ACTUAL_USER npm prune --omit=dev --silent
    else
        sudo -u $ACTUAL_USER npm install --omit=dev --silent
        echo "  ✓ Using pre-built backend files"
    fi

    # Install and build frontend
    if [ "$IS_SOURCE_INSTALL" = true ]; then
        echo "[8/9] Building frontend from source..."
        cd $INSTALL_DIR/frontend
        rm -rf node_modules
        sudo -u $ACTUAL_USER npm install --silent
        sudo -u $ACTUAL_USER npm run build
        sudo -u $ACTUAL_USER npm prune --omit=dev --silent
    else
        echo "[8/9] Frontend setup..."
        echo "  ✓ Using pre-built frontend files"
    fi

    # Configure nginx
    echo "[9/9] Configuring services..."
    cp $INSTALL_DIR/setup/nginx-site.conf /etc/nginx/sites-available/urbackup-gui
    ln -sf /etc/nginx/sites-available/urbackup-gui /etc/nginx/sites-enabled/urbackup-gui
    rm -f /etc/nginx/sites-enabled/default

    # Ensure the service user is in the urbackup group (for SQLite write access)
    if id urbackup &>/dev/null; then
        usermod -a -G urbackup $ACTUAL_USER 2>/dev/null || true
        # Make UrBackup database files group-writable
        chmod -f g+w /var/urbackup/backup_server.db \
                     /var/urbackup/backup_server.db-shm \
                     /var/urbackup/backup_server.db-wal \
                     /var/urbackup/backup_server_settings.db \
                     /var/urbackup/backup_server_settings.db-shm \
                     /var/urbackup/backup_server_settings.db-wal \
                     /var/urbackup 2>/dev/null || true
    fi

    # Install auto-update script
    cp $INSTALL_DIR/setup/auto-update.sh $INSTALL_DIR/auto-update.sh
    chmod +x $INSTALL_DIR/auto-update.sh

    # Create systemd service for backend
    # Substitute the actual runtime user and node path into the service file
    NODE_BIN=$(command -v node || echo /usr/bin/node)
    sed -e "s|User=administrator|User=${ACTUAL_USER}|g" \
        -e "s|ExecStart=/usr/bin/node|ExecStart=${NODE_BIN}|g" \
        $INSTALL_DIR/setup/urbackup-gui.service > /etc/systemd/system/urbackup-gui.service
    systemctl daemon-reload

    # Create .env file if it doesn't exist
    if [ ! -f "$INSTALL_DIR/backend/.env" ]; then
        # Use the generated DB password if this is a fresh install, otherwise prompt
        if [ -z "$GENERATED_DB_PASS" ]; then
            GENERATED_DB_PASS=$(openssl rand -hex 24)
        fi
        cat > $INSTALL_DIR/backend/.env <<EOF
NODE_ENV=production
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_NAME=urbackup_gui
DB_USER=urbackup
DB_PASSWORD=${GENERATED_DB_PASS}
JWT_SECRET=$(openssl rand -hex 64)
APP_SECRET_KEY=$(openssl rand -hex 32)
URBACKUP_DB_PATH=/var/urbackup/backup_server.db
URBACKUP_API_URL=http://localhost:55414/x
URBACKUP_USERNAME=admin
URBACKUP_PASSWORD=
# Set to true only if St0r is served over HTTPS (enables Secure flag on session cookie)
COOKIE_SECURE=false
EOF
        chown $ACTUAL_USER:$ACTUAL_USER $INSTALL_DIR/backend/.env
        chmod 640 $INSTALL_DIR/backend/.env
    fi

    # Start services
    echo ""
    echo "Starting services..."
    systemctl restart urbackup-gui
    systemctl enable urbackup-gui
    systemctl restart nginx
    systemctl enable nginx

    # Write version file — unless the installed tree already carries its own
    # version.json for this exact version, which has the changelog the About
    # page shows. Overwriting it used to record 3.2.78 over newer code.
    if ! grep -Eq "\"version\"[[:space:]]*:[[:space:]]*\"$INSTALLER_VERSION\"" "$VERSION_FILE" 2>/dev/null; then
        echo "{\"version\":\"$INSTALLER_VERSION\",\"date\":\"$INSTALLER_DATE\"}" > "$VERSION_FILE"
    fi
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
    # The backend generates this on first start and writes it 0600. Wait briefly,
    # since the service may still be starting.
    PW_FILE="$INSTALL_DIR/initial-admin-password.txt"
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        [ -s "$PW_FILE" ] && break
        sleep 1
    done

    echo "  Sign in with:"
    echo "    Username: admin"
    if [ -s "$PW_FILE" ]; then
        echo "    Password: $(cat "$PW_FILE")"
        echo ""
        echo "  This password was generated for this installation and saved to:"
        echo "    $PW_FILE"
        echo "  Delete that file once you have signed in."
    else
        echo "    Password: see 'journalctl -u urbackup-gui | grep -A3 \"First run\"'"
        echo ""
        echo "  The password is generated on first start and printed to the service log."
    fi
    echo ""
    echo "  ⚠ You must change this password at first login."
    echo ""
    echo "  ⚠ Enable 2FA for the admin account after login (Profile → Enable 2FA)"

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
