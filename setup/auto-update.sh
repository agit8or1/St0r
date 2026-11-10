#!/bin/bash
# St0r Auto-Update Script
#
# Installed root-owned as /usr/local/lib/st0r/auto-update.sh and started, as
# root, by /usr/local/lib/st0r/start-update (via systemd-run). Output is
# captured to the log file by the unit's StandardOutput/StandardError.
#
# The install directory (/opt/urbackup-gui) belongs to the panel's service
# user, so as root this script trusts and executes nothing from it. As root it
# only: downloads the release and verifies its signature against
# /etc/st0r/release-signers; applies the database migrations from the verified
# tarball; installs the root-owned updater files from the verified tarball; and
# stops/starts the service. Copying files into /opt and every npm command run
# as the service user, from the release's own lockfile (npm ci), with install
# scripts disabled. Dependency changes ship in the signed release only.

# ── Self-exec from /tmp so replacing this file mid-run doesn't corrupt us ──
if [[ "$0" != /tmp/st0r-update-* ]]; then
  _self=$(mktemp /tmp/st0r-update-XXXXXX.sh)
  cp "$0" "$_self"
  chmod 0700 "$_self"
  exec "$_self" "$@"
fi

set -euo pipefail
# Root's own PATH only — never a directory the service user can write to.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 022

INSTALL_DIR="/opt/urbackup-gui"
SIGNERS_FILE="/etc/st0r/release-signers"
# Installs from before the root-owned updater existed reach this script once,
# through the copy under /opt; that run verifies with the key there and then
# installs /etc/st0r/release-signers from the verified release.
LEGACY_SIGNERS_FILE="${INSTALL_DIR}/setup/release-signers"
BACKUP_DIR="/opt/urbackup-gui-backup-$(date +%Y%m%d-%H%M%S)"
# Written once the backup has finished; a partial backup is never restored
# with --delete over the install.
BACKUP_MARKER=".st0r-backup-complete"
GITHUB_API="https://api.github.com/repos/agit8or1/St0r/releases/latest"
TEMP_DIR=$(mktemp -d)

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

timestamp() { date '+%Y-%m-%d %H:%M:%S'; }
# The update page only recognises a failure that prints FAILED.
refuse() { echo "$(timestamp) ERROR: $*"; echo "FAILED"; exit 1; }

# ── The service user, and the Node.js its service runs ───────────────────────
SERVICE_USER=$(systemctl show urbackup-gui -p User --value 2>/dev/null || true)
[ -n "$SERVICE_USER" ] || refuse "cannot read User= from the urbackup-gui service"
id "$SERVICE_USER" >/dev/null 2>&1 || refuse "service user '${SERVICE_USER}' does not exist"
SERVICE_GROUP=$(id -gn "$SERVICE_USER")
SERVICE_HOME=$(getent passwd "$SERVICE_USER" | cut -d: -f6)
[ -d "$SERVICE_HOME" ] || SERVICE_HOME="$INSTALL_DIR"

# npm is run only as the service user (below), never as root, so it may live in
# that user's own nvm directory.
NODE_BIN=$(systemctl show urbackup-gui -p ExecStart --value 2>/dev/null \
  | sed -n 's/^{ path=\([^ ;]*\).*/\1/p' | head -1)
[ -x "${NODE_BIN:-}" ] || NODE_BIN=$(command -v node || true)
[ -x "${NODE_BIN:-}" ] || refuse "node not found (looked at the urbackup-gui service's ExecStart and PATH)"
NODE_DIR=$(dirname "$NODE_BIN")
[ -x "$NODE_DIR/npm" ] || refuse "npm not found next to ${NODE_BIN}"

# Run a command as the service user with a clean environment.
as_service() {
  runuser -u "$SERVICE_USER" -- env -i \
    HOME="$SERVICE_HOME" LANG=C.UTF-8 \
    PATH="$NODE_DIR:/usr/local/bin:/usr/bin:/bin" \
    npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false \
    "$@"
}
echo "Using npm $(as_service npm --version) at ${NODE_DIR}/npm, as ${SERVICE_USER}"

# ── Automatic rollback on any failure ─────────────────────────────────────────
rollback() {
  local err=$?
  trap - ERR  # Prevent recursive rollback calls
  echo ""
  echo "$(timestamp) ════════════════════════════════════════════════"
  echo "$(timestamp) UPDATE FAILED (exit code $err) — rolling back"
  echo "$(timestamp) ════════════════════════════════════════════════"
  if [ -f "$BACKUP_DIR/$BACKUP_MARKER" ]; then
    echo "$(timestamp) Restoring from backup $BACKUP_DIR ..."
    as_service rsync -a --delete --exclude="$BACKUP_MARKER" "$BACKUP_DIR/" "$INSTALL_DIR/" || \
      echo "$(timestamp) WARN: restore from $BACKUP_DIR did not complete"
    echo "$(timestamp) Restore complete"
  else
    echo "$(timestamp) No complete backup — cannot restore automatically"
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
# (.env belongs to the service user, so it is read as that user.)
GITHUB_TOKEN=$(as_service grep -E "^GITHUB_TOKEN=" "${INSTALL_DIR}/backend/.env" 2>/dev/null \
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
  if echo "${RELEASE_JSON}" | python3 -I -c \
      "import json,sys; d=json.load(sys.stdin); assert 'tag_name' in d" 2>/dev/null; then
    break
  fi

  # Extract GitHub's error message if available
  _api_err=$(echo "${RELEASE_JSON}" | python3 -I -c \
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
VERSION=$(echo "$RELEASE_JSON" | python3 -I -c "import json,sys; print(json.load(sys.stdin)['tag_name'])")

if [ -z "$VERSION" ]; then
  echo "$(timestamp) ERROR: Could not parse version from GitHub response"
  exit 1
fi

echo "$(timestamp) Latest version: $VERSION"

# ── 1b. Download and verify the signed release tarball ────────────────────
# Each release carries st0r-<tag>.tar.gz plus a detached SSH signature made with
# the St0r release key, which never touches GitHub. The public key is the
# root-owned one already installed here (/etc/st0r/release-signers), not one
# from the download or from the service user's install directory, so neither
# whoever can publish a GitHub release nor the panel itself can ship code this
# accepts. Unsigned or badly signed releases are refused — there is no override.
ASSET_NAME="st0r-${VERSION}.tar.gz"

if [ ! -s "$SIGNERS_FILE" ]; then
  # Only before the launcher exists, i.e. when this run was started from /opt.
  if [ -s "$LEGACY_SIGNERS_FILE" ] && [ ! -e /usr/local/lib/st0r/start-update ]; then
    echo "$(timestamp) First update with the root-owned updater: verifying with ${LEGACY_SIGNERS_FILE};"
    echo "$(timestamp) later updates use ${SIGNERS_FILE}, installed from this release."
    SIGNERS_FILE="$LEGACY_SIGNERS_FILE"
  else
    refuse "${SIGNERS_FILE} is missing — cannot verify the release signature. Reinstall St0r with install.sh to restore it"
  fi
fi
command -v ssh-keygen >/dev/null || refuse "ssh-keygen not found (apt install openssh-client)"

asset_url() {
  echo "$RELEASE_JSON" | python3 -I -c "
import json, sys
name = sys.argv[1]
for a in json.load(sys.stdin).get('assets', []):
    if a.get('name') == name:
        print(a['browser_download_url']); break" "$1"
}
TARBALL_URL=$(asset_url "$ASSET_NAME")
SIG_URL=$(asset_url "${ASSET_NAME}.sig")
if [ -z "$TARBALL_URL" ] || [ -z "$SIG_URL" ]; then
  refuse "release ${VERSION} has no signed tarball (${ASSET_NAME} + .sig) — not updating"
fi

echo "$(timestamp) Downloading ${ASSET_NAME}..."
curl -fsSL "$TARBALL_URL" -o "$TEMP_DIR/release.tar.gz"
curl -fsSL "$SIG_URL" -o "$TEMP_DIR/release.tar.gz.sig"

echo "$(timestamp) Verifying release signature..."
if ! ssh-keygen -Y verify -f "$SIGNERS_FILE" -I st0r-release -n st0r-release \
       -s "$TEMP_DIR/release.tar.gz.sig" < "$TEMP_DIR/release.tar.gz"; then
  refuse "signature check failed for ${ASSET_NAME} — not installing it"
fi

echo "$(timestamp) Extracting update..."
mkdir -p "$TEMP_DIR/src"
tar xzf "$TEMP_DIR/release.tar.gz" -C "$TEMP_DIR/src" --strip-components=1 \
  --no-same-owner --no-same-permissions
# Root-owned and read-only to everyone else: the service user copies from it.
chmod -R a+rX,go-w "$TEMP_DIR/src"
chmod 0755 "$TEMP_DIR"

# A validly signed OLD release re-published under a new tag would pass the
# signature check, so the version inside must match the tag.
INNER_VERSION=$(tr -d '[:space:]' < "$TEMP_DIR/src/VERSION" 2>/dev/null || true)
if [ "v${INNER_VERSION}" != "${VERSION}" ] && [ "${INNER_VERSION}" != "${VERSION}" ]; then
  refuse "tarball contains version '${INNER_VERSION}' but the release is ${VERSION} — not installing it"
fi
echo "$(timestamp) Signature OK, version ${INNER_VERSION}"

# ── 2. Backup current installation ────────────────────────────────────────
# Updates by older versions of this script ran as root and left root-owned
# directories in the install tree. Hand directories (only) back to the service
# user so it can install into them: -h changes a symlink itself, never its
# target, and directories cannot be hard-linked. Root-owned files inside are
# replaced by rename, not written in place.
find "$INSTALL_DIR" -xdev -type d ! -user "$SERVICE_USER" -exec chown -h "${SERVICE_USER}:${SERVICE_GROUP}" {} +

echo "$(timestamp) Creating backup at $BACKUP_DIR..."
install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0700 "$BACKUP_DIR"
# Exclude node_modules and frontend/dist — they can be rebuilt; including them
# makes the backup take many minutes and wastes several hundred MB of disk.
as_service rsync -a \
  --exclude='backend/node_modules' \
  --exclude='frontend/node_modules' \
  --exclude='frontend/dist' \
  "$INSTALL_DIR/" "$BACKUP_DIR/"
as_service touch "$BACKUP_DIR/$BACKUP_MARKER"

# ── 4. Stop service ────────────────────────────────────────────────────────
echo "$(timestamp) Stopping urbackup-gui service..."
systemctl stop urbackup-gui 2>/dev/null || true

# ── 5. Install new files (preserve .env), as the service user ─────────────
echo "$(timestamp) Installing new version..."
SRC="$TEMP_DIR/src"
# Backend source (compiled from TypeScript below)
as_service rsync -a --exclude='.env' --exclude='node_modules' --exclude='dist' \
  "$SRC/backend/"  "$INSTALL_DIR/backend/"

# Frontend source
as_service rsync -a --exclude='node_modules' --exclude='dist' \
  "$SRC/frontend/" "$INSTALL_DIR/frontend/"

# Remote agent package. "Install agent" tars this directory as-is and ships it to
# remote hosts, so --delete keeps files dropped upstream from going with it. Not
# built here — the agent builds on the host it is installed on.
as_service rsync -a --delete --exclude='node_modules' --exclude='dist' \
  "$SRC/agent/" "$INSTALL_DIR/agent/"

# Database migrations (a copy for reference; they are applied from $SRC below)
as_service rsync -a "$SRC/database/" "$INSTALL_DIR/database/"

# setup/ is kept for reference only: the updater, its launcher and the release
# key that are actually used are the root-owned copies installed in step 7c.
as_service rsync -a "$SRC/setup/" "$INSTALL_DIR/setup/"
# The old root-level copy of the updater is no longer used by anything.
as_service rm -f "$INSTALL_DIR/auto-update.sh"

# Version manifest (used by /api/version to report the installed version).
# rsync replaces the files rather than writing through them.
as_service rsync -a "$SRC/version.json" "$SRC/VERSION" "$INSTALL_DIR/"

# ── 6. Build backend, as the service user ─────────────────────────────────
# npm ci installs exactly the release's signed package-lock.json (integrity
# hashes included) and nothing newer; there is no `npm audit fix` here, since
# that could pull versions the release never shipped. --ignore-scripts keeps
# dependency install scripts from running; the one native module that needs its
# install step (sqlite3, which fetches its prebuilt binary) is rebuilt by name.
# devDependencies (TypeScript, Vite) are needed because the release is source;
# they come from the same lockfile and are pruned after the build.
echo "$(timestamp) Installing backend dependencies (npm ci)..."
as_service bash -c 'cd "$1" && npm ci --include=dev --ignore-scripts 2>&1 && npm rebuild sqlite3 2>&1' _ "$INSTALL_DIR/backend"
echo "$(timestamp) Dependencies installed successfully"

echo "$(timestamp) Building backend..."
# Clean previous compiled output to avoid stale files causing tsc errors
as_service bash -c 'cd "$1" && rm -rf dist && npm run build 2>&1 && npm prune --omit=dev --ignore-scripts 2>&1' _ "$INSTALL_DIR/backend"
echo "$(timestamp) Backend build successful"

# ── 6b. Build frontend, as the service user ───────────────────────────────
echo "$(timestamp) Installing frontend dependencies (npm ci)..."
as_service bash -c 'cd "$1" && npm ci --include=dev --ignore-scripts 2>&1' _ "$INSTALL_DIR/frontend"
echo "$(timestamp) Frontend dependencies installed"

echo "$(timestamp) Building frontend..."
as_service bash -c 'cd "$1" && npm run build 2>&1' _ "$INSTALL_DIR/frontend"
echo "$(timestamp) Frontend build successful"

# ── 7. Run DB migrations ───────────────────────────────────────────────────
echo "$(timestamp) Running database migrations..."

# Check connectivity up front so a credentials or socket problem reports itself
# once and clearly, instead of surfacing as every migration failing in turn.
if ! mysql -u root urbackup_gui -e "SELECT 1" >/dev/null 2>&1; then
  echo "$(timestamp) ERROR: cannot connect to the urbackup_gui database as root."
  echo "$(timestamp)        Migrations cannot be applied, so the update is being rolled"
  echo "$(timestamp)        back rather than left running new code against an old schema."
  false  # must fail a command to fire the ERR trap — a bare `exit` skips rollback
fi

# Migrations are idempotent (IF NOT EXISTS guards), so re-applying them is a clean
# no-op. Any error here is therefore a real failure, not the usual "already
# applied" noise — let it trip the ERR trap and roll back rather than leave the
# new code running against a half-migrated schema.
# Applied as root, so they come from the verified tarball, not from /opt.
for mig in "$SRC/database/migrations"/*.sql; do
  [ -f "$mig" ] || continue
  echo "$(timestamp) Migration: $(basename "$mig")"
  mysql -u root urbackup_gui < "$mig"
done
echo "$(timestamp) Migrations applied successfully"

# ── 7b. Re-assert backup storage access ───────────────────────────────────
# UrBackup's per-client backup folders are mode 0750 owned by urbackup:urbackup,
# so St0r can only browse backups if its service user is in the "urbackup" group.
# install.sh sets this up, but it is skipped when St0r is installed before
# UrBackup Server, which leaves the file browser unable to read anything. Re-assert
# it here so existing installs are repaired on update (issue #20).
if id urbackup &>/dev/null; then
  if id -nG "$SERVICE_USER" 2>/dev/null | tr ' ' '\n' | grep -qx urbackup; then
    echo "$(timestamp) Storage access OK ($SERVICE_USER is in the urbackup group)"
  else
    echo "$(timestamp) Adding $SERVICE_USER to the urbackup group (needed to browse backups)"
    usermod -a -G urbackup "$SERVICE_USER" || \
      echo "$(timestamp) WARN: could not add $SERVICE_USER to the urbackup group — the file browser may not be able to read backups"
  fi
fi

# ── 7c. Root-owned updater files, from the verified release ───────────────
# /usr/local/lib/st0r/{auto-update.sh,start-update}, /etc/st0r/release-signers
# and the sudoers rule for the launcher. A new release key, if any, arrives
# here — in a release signed by the old one.
bash "$SRC/setup/install-root-files.sh" "$SRC" "$SERVICE_USER"

# ── 8. Restart service ────────────────────────────────────────────────────
echo "$(timestamp) Starting urbackup-gui service..."
systemctl start urbackup-gui 2>/dev/null || true

# ── 9. Prune old backups ──────────────────────────────────────────────────
# Every update leaves a full copy of the install (with .env) in /opt; keep the
# newest KEEP_BACKUPS. The update has succeeded by now, so nothing here may
# trigger a rollback.
trap - ERR
KEEP_BACKUPS=3
shopt -s nullglob
backups=(/opt/urbackup-gui-backup-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9])
shopt -u nullglob
# The timestamped names sort chronologically, and globs expand sorted.
if (( ${#backups[@]} > KEEP_BACKUPS )); then
  for old in "${backups[@]:0:${#backups[@]}-KEEP_BACKUPS}"; do
    [ "$old" = "$BACKUP_DIR" ] && continue
    echo "$(timestamp) Removing old backup $old"
    rm -rf --one-file-system -- "$old" || echo "$(timestamp) WARN: could not remove $old"
  done
fi

echo "$(timestamp) Update completed successfully - $VERSION installed"
echo "SUCCESS"
