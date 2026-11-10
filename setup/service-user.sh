# St0r service user: sourced (as root) by install.sh and the updater.
#
# St0r runs as its own system account, "st0r": no login shell, no sudo beyond
# the two root-owned commands in /etc/sudoers.d/st0r-update, and member of the
# urbackup group for read access to the backups. Installs from before 3.2.132
# ran as whoever installed St0r, usually an administrator with full sudo; they
# are moved over by st0r_migrate, after st0r_preflight has shown the new account
# can do the job.

ST0R_USER=st0r
ST0R_HOME=/var/lib/st0r
ST0R_INSTALL_DIR=/opt/urbackup-gui
ST0R_BACKUP_PREFIX=/opt/urbackup-gui-backup-
ST0R_UNIT_FILE=/etc/systemd/system/urbackup-gui.service
# Logs the root-side jobs write and the panel only reads.
ST0R_ROOT_LOGS=(/var/log/urbackup-gui-update.log /var/log/stor-os-update.log /var/log/urbackup-server-update.log)

st0r_log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

# Create the account (idempotent) and give it backup read access.
st0r_ensure_user() {
  if ! id "$ST0R_USER" >/dev/null 2>&1; then
    useradd --system --user-group --home-dir "$ST0R_HOME" --no-create-home \
      --shell /usr/sbin/nologin --comment "St0r backup panel" "$ST0R_USER"
  fi
  install -d -o "$ST0R_USER" -g "$(id -gn "$ST0R_USER")" -m 0750 "$ST0R_HOME"
  if getent group urbackup >/dev/null; then
    usermod -a -G urbackup "$ST0R_USER"
  fi
}

# The configured backup storage folder, or nothing.
st0r_backup_folder() {
  local db=/var/urbackup/backup_server_settings.db bf=""
  if [ -r "$db" ] && command -v sqlite3 >/dev/null && id urbackup >/dev/null 2>&1; then
    bf=$(runuser -u urbackup -- sqlite3 -readonly "$db" \
      "SELECT value FROM settings WHERE key='backupfolder' AND clientid=0 LIMIT 1" 2>/dev/null | head -1) || bf=""
  fi
  if [ -z "$bf" ] && [ -r /var/urbackup/backupfolder ]; then
    bf=$(head -1 /var/urbackup/backupfolder)
  fi
  printf '%s' "$bf"
}

# Can <user> run St0r with <node>? Prints the reason and fails if not.
#   - it can run node and npm,
#   - it cannot modify them (or a compromised panel could change what runs next),
#   - it can read the backup storage folder.
st0r_preflight() {
  local user="$1" node="$2" node_dir bf
  node_dir=$(dirname "$node")
  if ! runuser -u "$user" -- "$node" -e 'process.exit(0)' >/dev/null 2>&1; then
    echo "$user cannot run $node"; return 1
  fi
  if ! runuser -u "$user" -- env -i PATH="$node_dir:/usr/bin:/bin" HOME=/ npm --version >/dev/null 2>&1; then
    echo "$user cannot run npm from $node_dir"; return 1
  fi
  local p
  for p in "$node" "$node_dir" "$(readlink -f "$node")" "$(dirname "$(readlink -f "$node")")"; do
    if runuser -u "$user" -- test -w "$p"; then
      echo "$user could modify $p"; return 1
    fi
  done
  bf=$(st0r_backup_folder)
  if [ -n "$bf" ] && [ -d "$bf" ] && ! runuser -u "$user" -- test -r "$bf" -a -x "$bf"; then
    echo "$user cannot read the backup storage folder $bf"; return 1
  fi
  return 0
}

# Give the install, its backups and the unit to <new>. The service must be stopped.
st0r_migrate() {
  local old="$1" new="$2" unit="$ST0R_UNIT_FILE" grp d f
  grp=$(id -gn "$new")
  for d in "$ST0R_INSTALL_DIR" "$ST0R_BACKUP_PREFIX"[0-9]*; do
    [ -d "$d" ] && [ ! -L "$d" ] || continue
    # -h: a symlink's own owner, never its target; -xdev: stay on this filesystem.
    find "$d" -xdev -exec chown -h "${new}:${grp}" {} +
  done
  # Written by root-side jobs (updater, helper); the panel only reads them.
  for f in "${ST0R_ROOT_LOGS[@]}"; do
    if [ -f "$f" ] && [ ! -L "$f" ]; then chown root:root "$f"; chmod 0644 "$f"; fi
  done
  if [ -f "$unit" ]; then
    sed -i -e "s/^User=.*/User=${new}/" -e '/^Group=/d' "$unit"
    systemctl daemon-reload
  fi
  st0r_log "Service user changed from ${old} to ${new}"
}

# The panel answers on its port. Used after a migration to decide whether to keep it.
st0r_service_healthy() {
  local port i
  port=$(runuser -u "$(systemctl show urbackup-gui -p User --value)" -- \
    sed -n 's/^PORT=\([0-9]\{1,5\}\)[[:space:]]*$/\1/p' "$ST0R_INSTALL_DIR/backend/.env" 2>/dev/null | tail -1)
  port="${port:-3000}"
  for i in $(seq 1 30); do
    if curl -fsS --max-time 3 "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}
