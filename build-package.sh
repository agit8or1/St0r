#!/bin/bash
# St0r (UrBackup GUI) Package Builder
# Creates a distributable tarball for updates

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="/tmp/urbackup-gui-package-build"
PACKAGE_NAME="urbackup-gui.tar.gz"

echo "===== St0r Package Builder ====="
echo "Building package from: $SCRIPT_DIR"

# Clean previous build
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/urbackup-gui"

# Copy backend files
echo "Copying backend files..."
mkdir -p "$BUILD_DIR/urbackup-gui/backend"
cp -r "$SCRIPT_DIR/backend/dist" "$BUILD_DIR/urbackup-gui/backend/"
cp "$SCRIPT_DIR/backend/package.json" "$BUILD_DIR/urbackup-gui/backend/"
cp "$SCRIPT_DIR/backend/package-lock.json" "$BUILD_DIR/urbackup-gui/backend/" 2>/dev/null || true

# Copy frontend files
echo "Copying frontend files..."
mkdir -p "$BUILD_DIR/urbackup-gui/frontend"
cp -r "$SCRIPT_DIR/frontend/dist" "$BUILD_DIR/urbackup-gui/frontend/"
cp "$SCRIPT_DIR/frontend/package.json" "$BUILD_DIR/urbackup-gui/frontend/"

# Copy version file
echo "Copying version file..."
cp "$SCRIPT_DIR/version.json" "$BUILD_DIR/urbackup-gui/"

# Copy auto-update script
echo "Copying auto-update script..."
if [ -f "/opt/urbackup-gui/auto-update.sh" ]; then
    cp "/opt/urbackup-gui/auto-update.sh" "$BUILD_DIR/urbackup-gui/"
fi

# Create tarball
echo "Creating tarball..."
cd "$BUILD_DIR"
tar -czf "$PACKAGE_NAME" urbackup-gui/

# Get package size
PACKAGE_SIZE=$(du -h "$PACKAGE_NAME" | cut -f1)
echo "Package created: $PACKAGE_NAME ($PACKAGE_SIZE)"

# Move to script directory
mv "$PACKAGE_NAME" "$SCRIPT_DIR/"
echo "Package saved to: $SCRIPT_DIR/$PACKAGE_NAME"

# Cleanup
rm -rf "$BUILD_DIR"

echo "===== Build Complete ====="
echo "Package: $SCRIPT_DIR/$PACKAGE_NAME"
echo "Size: $PACKAGE_SIZE"
