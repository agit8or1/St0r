#!/bin/bash
# St0r (UrBackup GUI) - Universal Installer
# Installs UrBackup Server and/or St0r GUI

set -e

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/agit8or1/St0r/main/install.sh | sudo bash
#   ... | sudo bash -s -- --domain backup.example.com [--email you@example.com]
#   sudo ./install.sh [--domain backup.example.com] [--email you@example.com]   (from a checkout)
#
#   --domain  serve St0r over HTTPS: gets a Let's Encrypt certificate with Certbot
#             (the name must already resolve to this server, port 80 reachable)
#   --email   address for Let's Encrypt expiry notices (optional)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# The St0r release signing key. Downloaded releases are verified against THIS
# copy, which travels inside install.sh itself — never against a key that came
# with the download. Must match setup/release-signers (a test checks this).
RELEASE_SIGNERS='st0r-release namespaces="st0r-release" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIN1ko4rKhmr/4qNxgpu/whY1yZb2ICPeafA6Tw/sYhJH'
RELEASE_DOWNLOAD_BASE="https://github.com/agit8or1/St0r/releases/download"

# verify_release <tarball> <signature> [signers-file]
# Succeeds only if <signature> is a valid st0r-release signature of <tarball>
# by the key above (or by the given signers file — used by the tests).
verify_release() {
    local tarball="$1" sig="$2" signers="${3:-}" tmp="" rc=0
    command -v ssh-keygen >/dev/null 2>&1 || { echo "ERROR: ssh-keygen not found (apt-get install openssh-client)"; return 1; }
    if [ -z "$signers" ]; then
        tmp=$(mktemp)
        printf '%s\n' "$RELEASE_SIGNERS" > "$tmp"
        signers="$tmp"
    fi
    ssh-keygen -Y verify -f "$signers" -I st0r-release -n st0r-release -s "$sig" < "$tarball" >/dev/null 2>&1 || rc=1
    [ -n "$tmp" ] && rm -f "$tmp"
    return $rc
}

# fetch_verified_release <version> <dest-dir>
# Downloads the signed release asset st0r-v<version>.tar.gz and its .sig,
# verifies the signature, and only then extracts it into <dest-dir>. Refuses
# (returns 1, extracts nothing) on any failure. GitHub's auto-generated
# source archives are not used: nothing vouches for them.
fetch_verified_release() {
    local version="$1" dest="$2" work name url inner
    name="st0r-v${version}.tar.gz"
    url="${RELEASE_DOWNLOAD_BASE}/v${version}/${name}"
    work=$(mktemp -d)
    if ! curl -fsSL "$url" -o "$work/$name" || ! curl -fsSL "${url}.sig" -o "$work/$name.sig"; then
        echo "ERROR: could not download the signed release v${version}:"
        echo "  $url (+ .sig)"
        echo "  Releases before 3.2.130 are not signed; install those from a checkout."
        rm -rf "$work"
        return 1
    fi
    if ! verify_release "$work/$name" "$work/$name.sig"; then
        echo "ERROR: signature check FAILED for ${name} — refusing to install it."
        rm -rf "$work"
        return 1
    fi
    mkdir -p "$dest"
    tar -xzf "$work/$name" -C "$dest" --strip-components=1 --no-same-owner
    rm -rf "$work"
    # A validly signed OLD release re-published under a new tag would pass the
    # signature check, so the version inside must match.
    inner=$(tr -d '[:space:]' < "$dest/VERSION" 2>/dev/null || true)
    if [ "$inner" != "$version" ]; then
        echo "ERROR: release v${version} contains VERSION '${inner}' — refusing to install it."
        rm -rf "$dest"
        return 1
    fi
    echo "  ✓ Signature verified (St0r release key)"
}

# install_nginx_site <template> <site-file>
# Writes the St0r site only if there is none yet. An existing one is kept as
# it is: Certbot (or you) may have added the HTTPS server block to it.
install_nginx_site() {
    local template="$1" site="$2"
    if [ -e "$site" ]; then
        echo "  ✓ Keeping existing nginx site $site (not overwritten)"
        echo "    Template for comparison: $template"
        return 0
    fi
    cp "$template" "$site"
    echo "  ✓ Installed nginx site $site"
}

valid_domain() {
    [[ "$1" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]]
}

ST0R_DOMAIN=""
ST0R_EMAIL=""
parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --domain|--email)
                if [ $# -lt 2 ]; then echo "Error: $1 needs a value"; return 1; fi
                if [ "$1" = --domain ]; then ST0R_DOMAIN="$2"; else ST0R_EMAIL="$2"; fi
                shift 2 ;;
            --domain=*) ST0R_DOMAIN="${1#*=}"; shift ;;
            --email=*)  ST0R_EMAIL="${1#*=}"; shift ;;
            -h|--help)  sed -n '/^# Usage:/,/^# ━/p' "${BASH_SOURCE[0]}" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
            *) echo "Error: unknown option '$1' (see --help)"; return 1 ;;
        esac
    done
    if [ -n "$ST0R_DOMAIN" ] && ! valid_domain "$ST0R_DOMAIN"; then
        echo "Error: --domain '$ST0R_DOMAIN' is not a valid DNS name"; return 1
    fi
    if [ -n "$ST0R_EMAIL" ] && ! [[ "$ST0R_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
        echo "Error: --email '$ST0R_EMAIL' is not an email address"; return 1
    fi
    if [ -n "$ST0R_EMAIL" ] && [ -z "$ST0R_DOMAIN" ]; then
        echo "Error: --email is only used with --domain"; return 1
    fi
}

# enable_https <domain> <email|"">: Certbot for the St0r nginx site.
enable_https() {
    local domain="$1" email="$2" site=/etc/nginx/sites-available/urbackup-gui
    local mail_args=(--register-unsafely-without-email)
    [ -n "$email" ] && mail_args=(--email "$email")
    apt-get install -y -qq certbot python3-certbot-nginx
    # Certbot picks the server block by server_name; the template has "_".
    if grep -Eq '^[[:space:]]*server_name[[:space:]]+_;' "$site"; then
        sed -i -E "s/^([[:space:]]*server_name[[:space:]]+)_;/\1${domain};/" "$site"
    fi
    nginx -t && systemctl reload nginx
    certbot --nginx -d "$domain" --non-interactive --agree-tos --redirect "${mail_args[@]}"
}

# Hand directories (only) under $1 to user $2. Directories cannot be
# hard-linked and -h changes a symlink rather than its target, so this cannot
# be steered at files outside the tree.
chown_dirs_to() {
    find "$1" -xdev -type d ! -user "$2" -exec chown -h "$2:$(id -gn "$2")" {} +
}

# Tests source this file with ST0R_INSTALLER_LIB=1 to get the functions above.
if [ "${ST0R_INSTALLER_LIB:-}" = 1 ]; then return 0 2>/dev/null || exit 0; fi

parse_args "$@" || exit 1

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
FALLBACK_VERSION="3.2.133"
FALLBACK_DATE="2026-11-10"
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

# Who ran the installer (shown only: St0r itself runs as its own "st0r" account)
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
if [ "$INSTALL_URBACKUP" = false ] && [ "$INSTALL_STOR" = false ] && [ -n "$ST0R_DOMAIN" ] && [ "$STOR_INSTALLED" = true ]; then
    echo "Only enabling HTTPS for $ST0R_DOMAIN."
    echo ""
elif [ "$INSTALL_URBACKUP" = false ] && [ "$INSTALL_STOR" = false ]; then
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
if [ -n "$ST0R_DOMAIN" ]; then
    echo "  ✓ Enable HTTPS for $ST0R_DOMAIN (Let's Encrypt via Certbot)"
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

        URBACKUP_DEB_DIR=$(mktemp -d)
        if curl -fsSL "$URBACKUP_DEB_URL" -o "$URBACKUP_DEB_DIR/urbackup-server.deb"; then
            DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$URBACKUP_DEB_DIR/urbackup-server.deb"
            rm -rf "$URBACKUP_DEB_DIR"
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
    apt-get install -y -qq curl gnupg2 nginx mariadb-server rsync sqlite3 openssh-client

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

        # backend/.env is never copied over (see below), so it needs no backup.

        # Backup database (root-only: it holds password hashes and secrets)
        echo "  Creating database backup..."
        DB_DUMP="/root/urbackup_gui_backup_$(date +%Y%m%d_%H%M%S).sql"
        ( umask 077; mysqldump -u root urbackup_gui > "$DB_DUMP" 2>/dev/null ) && echo "  ✓ Database backed up to $DB_DUMP" \
            || echo "  Warning: Could not backup database"
    else
        echo "[4/9] Creating installation directory..."
    fi

    # Copy/update application files.
    #
    # The install directory belongs to the service user, so root
    # does not write into it or trust anything in it: the source is staged in a
    # fresh root-owned directory and copied in AS the service user, and
    # everything root itself uses (schema, migrations, service unit, nginx
    # template, the updater) is taken from the staged source.
    IS_SOURCE_INSTALL=false
    STAGE=$(mktemp -d /tmp/stor-install-XXXXXX)
    trap 'rm -rf "$STAGE"' EXIT
    SRC_DIR="$STAGE/src"

    if [ -d "$SCRIPT_DIR/backend" ] && [ -d "$SCRIPT_DIR/frontend" ]; then
        # Local installation from source directory
        echo "  Using local source files from: $SCRIPT_DIR"
        rsync -a --exclude='.git' --exclude='node_modules' --exclude='backend/.env' \
            "$SCRIPT_DIR/" "$SRC_DIR/"
    else
        # Remote installation: the signed release asset, verified against the
        # key in this script, or nothing.
        echo "  Downloading signed release v${INSTALLER_VERSION} from GitHub..."
        if ! fetch_verified_release "$INSTALLER_VERSION" "$SRC_DIR"; then
            echo ""
            echo "Not installing. Alternative: clone, review and run locally:"
            echo "  git clone https://github.com/agit8or1/St0r.git"
            echo "  sudo ./St0r/install.sh"
            exit 1
        fi
        echo "  ✓ Release downloaded and verified"
    fi
    if [ ! -d "$SRC_DIR/backend" ]; then
        echo "ERROR: backend directory not found in the source"
        exit 1
    fi
    chmod -R a+rX,go-w "$SRC_DIR"
    chmod 0755 "$STAGE"

    # The service account. St0r runs as its own system user (st0r), with no
    # login and no sudo beyond the two root-owned commands in
    # /etc/sudoers.d/st0r-update. Installs that ran as the installing user are
    # moved over (the service is stopped above).
    # shellcheck source=setup/service-user.sh
    . "$SRC_DIR/setup/service-user.sh"
    CURRENT_SERVICE_USER=""
    if [ -f /etc/systemd/system/urbackup-gui.service ]; then
        CURRENT_SERVICE_USER=$(systemctl show urbackup-gui -p User --value 2>/dev/null || true)
    fi
    NODE_BIN=$(command -v node || echo /usr/bin/node)
    st0r_ensure_user
    if WHY=$(st0r_preflight "$ST0R_USER" "$NODE_BIN"); then
        SERVICE_USER="$ST0R_USER"
    elif [ -n "$CURRENT_SERVICE_USER" ]; then
        echo "  WARN: keeping service user ${CURRENT_SERVICE_USER}: ${WHY}"
        SERVICE_USER="$CURRENT_SERVICE_USER"
    else
        echo "ERROR: the ${ST0R_USER} service account cannot run St0r: ${WHY}"
        exit 1
    fi
    if [ -n "$CURRENT_SERVICE_USER" ] && [ "$CURRENT_SERVICE_USER" != "$SERVICE_USER" ]; then
        systemctl stop urbackup-gui 2>/dev/null || true
        st0r_migrate "$CURRENT_SERVICE_USER" "$SERVICE_USER"
    fi
    echo "  Service user: $SERVICE_USER"
    # Run a command as the service user, with its own HOME (npm's cache).
    as_svc() { sudo -u "$SERVICE_USER" -H "$@"; }

    # Fresh install: root creates the directory and hands it over. Upgrade:
    # earlier root-run updates left root-owned directories; hand those back.
    install -d -m 0755 "$INSTALL_DIR"
    chown "$SERVICE_USER:$(id -gn "$SERVICE_USER")" "$INSTALL_DIR"
    chown_dirs_to "$INSTALL_DIR" "$SERVICE_USER"
    as_svc rsync -a "$SRC_DIR/" "$INSTALL_DIR/"
    as_svc rm -f "$INSTALL_DIR/auto-update.sh"   # old location, unused

    # Check if this is a source install (has src/ directories)
    if [ -d "$INSTALL_DIR/backend/src" ]; then
        IS_SOURCE_INSTALL=true
    fi

    # Root-owned updater, its no-argument launcher, the release key and the
    # sudoers rule for the launcher (see setup/install-root-files.sh).
    bash "$SRC_DIR/setup/install-root-files.sh" "$SRC_DIR" "$SERVICE_USER"

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
        mysql -u root urbackup_gui < "$SRC_DIR/database/init/01_schema.sql"
        # Also run all migrations on fresh install (adds replication, managed mode, etc.)
        for mig in "$SRC_DIR"/database/migrations/*.sql; do
            echo "  Applying migration: $(basename $mig)..."
            mysql -u root urbackup_gui < "$mig" 2>/dev/null || true
        done

        # Store generated password for .env creation below
        GENERATED_DB_PASS="$DB_PASS"
    else
        echo "[6/9] Running database migrations (upgrade mode)..."
        # Run any new migration files that exist
        for mig in "$SRC_DIR"/database/migrations/*.sql; do
            echo "  Applying migration: $(basename $mig)..."
            mysql -u root urbackup_gui < "$mig" 2>/dev/null || true
        done
    fi

    # Install backend dependencies, as the service user, exactly as locked in
    # package-lock.json (npm ci) and without dependency install scripts. The one
    # native binary (sqlite3) is the official prebuilt, checked against the
    # SHA-256 pinned in setup/sqlite3-prebuilt.sha256 (install-sqlite3.sh).
    NPM_CI=(npm ci --ignore-scripts --no-audit --no-fund)
    echo "[7/9] Installing backend dependencies..."
    cd $INSTALL_DIR/backend
    as_svc rm -rf node_modules
    if [ "$IS_SOURCE_INSTALL" = true ]; then
        # Need devDependencies (typescript/tsc) to build from source
        as_svc "${NPM_CI[@]}" --include=dev --silent
        as_svc bash "$SRC_DIR/setup/install-sqlite3.sh" "$INSTALL_DIR/backend"
        echo "  Building backend from source..."
        as_svc npm run build
        # Remove dev deps from production install
        as_svc npm prune --omit=dev --ignore-scripts --silent
    else
        as_svc "${NPM_CI[@]}" --omit=dev --silent
        as_svc bash "$SRC_DIR/setup/install-sqlite3.sh" "$INSTALL_DIR/backend"
        echo "  ✓ Using pre-built backend files"
    fi

    # Install and build frontend
    if [ "$IS_SOURCE_INSTALL" = true ]; then
        echo "[8/9] Building frontend from source..."
        cd $INSTALL_DIR/frontend
        as_svc rm -rf node_modules
        as_svc "${NPM_CI[@]}" --include=dev --silent
        as_svc npm run build
        as_svc npm prune --omit=dev --ignore-scripts --silent
    else
        echo "[8/9] Frontend setup..."
        echo "  ✓ Using pre-built frontend files"
    fi

    # Configure nginx
    echo "[9/9] Configuring services..."
    if [ ! -e /etc/nginx/sites-available/urbackup-gui ]; then
        # First install: St0r becomes the default site.
        rm -f /etc/nginx/sites-enabled/default
    fi
    install_nginx_site "$SRC_DIR/setup/nginx-site.conf" /etc/nginx/sites-available/urbackup-gui
    ln -sf /etc/nginx/sites-available/urbackup-gui /etc/nginx/sites-enabled/urbackup-gui

    # Ensure the service user is in the urbackup group (for SQLite write access)
    if id urbackup &>/dev/null; then
        usermod -a -G urbackup "$SERVICE_USER" 2>/dev/null || true
        # Make UrBackup database files group-writable
        chmod -f g+w /var/urbackup/backup_server.db \
                     /var/urbackup/backup_server.db-shm \
                     /var/urbackup/backup_server.db-wal \
                     /var/urbackup/backup_server_settings.db \
                     /var/urbackup/backup_server_settings.db-shm \
                     /var/urbackup/backup_server_settings.db-wal \
                     /var/urbackup 2>/dev/null || true
    fi

    # Create systemd service for backend
    # Substitute the service user and node path into the service file
    sed -e "s|^User=.*|User=${SERVICE_USER}|" \
        -e "s|ExecStart=/usr/bin/node|ExecStart=${NODE_BIN}|g" \
        "$SRC_DIR/setup/urbackup-gui.service" > /etc/systemd/system/urbackup-gui.service
    systemctl daemon-reload

    # Create .env file if it doesn't exist
    if [ ! -f "$INSTALL_DIR/backend/.env" ]; then
        # Use the generated DB password if this is a fresh install, otherwise prompt
        if [ -z "$GENERATED_DB_PASS" ]; then
            GENERATED_DB_PASS=$(openssl rand -hex 24)
        fi
        as_svc bash -c 'umask 027; cat > "$1"' _ "$INSTALL_DIR/backend/.env" <<EOF
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
# Secure flag on the session cookie. auto = on whenever the request came in
# over HTTPS (e.g. after Certbot), off on plain HTTP. true/false force it.
COOKIE_SECURE=auto
EOF
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
        echo "{\"version\":\"$INSTALLER_VERSION\",\"date\":\"$INSTALLER_DATE\"}" \
            | as_svc bash -c 'cat > "$1.tmp" && mv -f "$1.tmp" "$1"' _ "$VERSION_FILE"
    fi

    echo ""
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STEP 5b: HTTPS (--domain)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HTTPS_RESULT=""
if [ -n "$ST0R_DOMAIN" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Enabling HTTPS for $ST0R_DOMAIN"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if [ ! -e /etc/nginx/sites-available/urbackup-gui ]; then
        echo "  ✗ No St0r nginx site found; install St0r first."
        HTTPS_RESULT=failed
    elif enable_https "$ST0R_DOMAIN" "$ST0R_EMAIL"; then
        HTTPS_RESULT=ok
        echo "  ✓ HTTPS enabled; HTTP now redirects to https://$ST0R_DOMAIN"
    else
        HTTPS_RESULT=failed
        echo "  ✗ Certbot could not get a certificate. Check that $ST0R_DOMAIN resolves to this"
        echo "    server and that port 80 is reachable from the Internet, then run:"
        echo "      sudo certbot --nginx -d $ST0R_DOMAIN --redirect"
    fi
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
    if [ "$HTTPS_RESULT" = ok ]; then
        echo "  Access at: https://$ST0R_DOMAIN"
    elif grep -Eq '^[[:space:]]*listen[[:space:]].*443' /etc/nginx/sites-available/urbackup-gui 2>/dev/null; then
        echo "  Access at: https://<your domain> (the existing HTTPS configuration was kept)"
    else
        echo "  Access at: http://$(hostname -I | awk '{print $1}')"
        echo ""
        echo "  ⚠ St0r is being served over plain HTTP: passwords and backup downloads"
        echo "    cross the network unencrypted. Next step — enable HTTPS with a DNS name"
        echo "    that points at this server:"
        echo "      curl -fsSL https://raw.githubusercontent.com/agit8or1/St0r/main/install.sh \\"
        echo "        | sudo bash -s -- --domain backup.example.com"
        echo "    (or from a checkout: sudo ./install.sh --domain backup.example.com)"
    fi
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
        echo "    Password: $(sudo -u "$(systemctl show urbackup-gui -p User --value)" cat "$PW_FILE")"
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
