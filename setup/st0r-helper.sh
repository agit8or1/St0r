#!/bin/bash
# St0r privileged helper, installed root-owned as /usr/local/lib/st0r/st0r-helper.
#
# The panel runs as an unprivileged service user. The only root access it has
# is this helper and the update launcher, through /etc/sudoers.d/st0r-update.
# Each action below is a fixed operation; every argument is validated here, by
# root, and nothing is read from the St0r install directory. The caller is the
# service user (sudo sets SUDO_UID/SUDO_GID).
#
#   st0r-helper urbackup-server-update   upgrade the urbackup-server package (background unit)
#   st0r-helper os-update                apt-get upgrade (background unit)
#   st0r-helper reboot                   reboot the machine
#   st0r-helper urbackup-cleanup <n>     urbackupsrv cleanup -a <n>   (n: 5% / 500M / 20G / 1T)
#   st0r-helper urbackup-remove-unknown  urbackupsrv remove-unknown
#   st0r-helper delete-backup <dir>      remove one backup's directory, as the urbackup user
#   st0r-helper vhd-decompress <file>    decompress an image backup into a private
#                                        directory; prints the path of the result
#   st0r-helper vhd-cleanup <dir>        remove a directory made by vhd-decompress
#   st0r-helper journal <lines>          the St0r service's own journal, as JSON lines
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 022

die() { echo "st0r-helper: $*" >&2; exit 2; }
nargs() { [ "$#" -eq "$EXPECT" ] || die "$ACTION takes ${EXPECT} argument(s)"; }

URBACKUP_SETTINGS_DB=/var/urbackup/backup_server_settings.db

# UrBackup's storage folder, as UrBackup itself records it. Read as the urbackup
# user (the settings database is writable by that group), never parsed as root.
backup_folder() {
  local bf=""
  if [ -r "$URBACKUP_SETTINGS_DB" ] && command -v sqlite3 >/dev/null; then
    bf=$(runuser -u urbackup -- sqlite3 -readonly "$URBACKUP_SETTINGS_DB" \
      "SELECT value FROM settings WHERE key='backupfolder' AND clientid=0 LIMIT 1" 2>/dev/null | head -1) || bf=""
  fi
  if [ -z "$bf" ]; then
    for f in /var/urbackup/backupfolder /etc/urbackup/backupfolder; do
      [ -r "$f" ] && { bf=$(head -1 "$f"); break; }
    done
  fi
  [ -n "$bf" ] || die "cannot determine the UrBackup storage folder"
  local real
  real=$(realpath -e -- "$bf" 2>/dev/null) || die "storage folder $bf does not exist"
  case "$real" in
    /|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/opt|/proc|/root|/run|/sbin|/sys|/tmp|/usr|/var) die "refusing storage folder $real" ;;
  esac
  printf '%s\n' "$real"
}

# Resolve $1 and require it to be at least <storage>/<client>/<entry>.
inside_storage() {
  local path="$1" bf real
  [[ "$path" = /* ]] || die "path must be absolute"
  [ ! -L "$path" ] || die "refusing a symlink: $path"
  bf=$(backup_folder)
  real=$(realpath -e -- "$path" 2>/dev/null) || die "not found: $path"
  case "$real" in
    "$bf"/*/*) ;;
    *) die "refusing $real: not a backup inside $bf" ;;
  esac
  case "/${real#"$bf"/}/" in
    */../*|*/./*) die "refusing $real" ;;
  esac
  printf '%s\n' "$real"
}

# Run a fixed command line as a transient unit, so it outlives the panel being
# restarted. Its log starts empty, so a previous run's result is never re-read.
start_unit() {
  local unit="$1" log="$2"; shift 2
  if systemctl is-active --quiet "$unit"; then
    echo "already running"
    return 0
  fi
  systemctl reset-failed "${unit}.service" 2>/dev/null || true
  rm -f -- "$log"
  install -m 0644 /dev/null "$log"
  systemd-run --unit="$unit" --description="St0r: ${unit}" \
    --property="StandardOutput=append:${log}" \
    --property="StandardError=append:${log}" \
    "$@"
}

main() {
  [ "$(id -u)" -eq 0 ] || die "must be run as root (through sudo)"
  [ "$#" -ge 1 ] || die "usage: st0r-helper <action> [argument]"
  ACTION="$1"; shift
  # Arguments are single values: no newlines or other control characters.
  local a
  for a in "$@"; do
    [[ "$a" != *[[:cntrl:]]* ]] || die "invalid argument"
  done

case "$ACTION" in
  urbackup-server-update)
    EXPECT=0 nargs "$@"
    start_unit urbackup-server-pkg-update /var/log/urbackup-server-update.log \
      /bin/bash -c 'export DEBIAN_FRONTEND=noninteractive; apt-get update -q 2>&1 && apt-get install -y --only-upgrade urbackup-server 2>&1 && systemctl restart urbackupsrv && echo "SUCCESS: UrBackup server updated and restarted" || echo "FAILED: UrBackup server update failed"'
    ;;

  os-update)
    EXPECT=0 nargs "$@"
    start_unit stor-local-os-update /var/log/stor-os-update.log \
      /bin/bash -c 'export DEBIAN_FRONTEND=noninteractive; apt-get update -q 2>&1 && apt-get upgrade -y 2>&1 && echo "SUCCESS: OS packages updated" || echo "FAILED: OS update failed"'
    ;;

  reboot)
    EXPECT=0 nargs "$@"
    exec systemctl reboot
    ;;

  urbackup-cleanup)
    EXPECT=1 nargs "$@"
    [[ "$1" =~ ^[0-9]{1,4}(%|M|G|T)$ ]] || die "amount must look like 5%, 500M, 20G or 1T"
    exec urbackupsrv cleanup -u urbackup -a "$1"
    ;;

  urbackup-remove-unknown)
    EXPECT=0 nargs "$@"
    exec urbackupsrv remove-unknown -u urbackup
    ;;

  delete-backup)
    EXPECT=1 nargs "$@"
    target=$(inside_storage "$1")
    [ -d "$target" ] || die "not a directory: $target"
    # As the urbackup user, who owns the backups: rm does not follow symlinks,
    # and --one-file-system keeps it off anything mounted inside.
    exec runuser -u urbackup -- rm -rf --one-file-system -- "$target"
    ;;

  vhd-decompress)
    EXPECT=1 nargs "$@"
    src=$(inside_storage "$1")
    [[ "$src" = *.vhdz ]] || die "not a compressed image: $src"
    [ -f "$src" ] || die "not a file: $src"
    caller_gid="${SUDO_GID:-}"
    [[ "$caller_gid" =~ ^[0-9]+$ ]] && [ "$caller_gid" -ne 0 ] || die "must be called through sudo by the service user"
    # Private to urbackup while it is written: the service user (which is in the
    # urbackup group) cannot swap anything in it. Then read-only to the caller.
    work=$(mktemp -d /tmp/st0r-vhd-XXXXXXXXXX)
    chown urbackup:urbackup "$work"
    chmod 0700 "$work"
    name=$(basename -- "$src")
    out="$work/$name"
    if ! runuser -u urbackup -- cp --no-preserve=all -- "$src" "$out" \
       || ! urbackupsrv decompress-file -f "$out" >&2 \
       || [ ! -f "$out" ] || [ -L "$out" ]; then
      rm -rf --one-file-system -- "$work"
      die "decompressing $src failed"
    fi
    chown -h "urbackup:${caller_gid}" "$out"
    chmod 0640 "$out"
    chgrp "$caller_gid" "$work"
    chmod 0750 "$work"
    printf '%s\n' "$out"
    ;;

  vhd-cleanup)
    EXPECT=1 nargs "$@"
    [[ "$1" =~ ^/tmp/st0r-vhd-[A-Za-z0-9]{10}$ ]] || die "not a vhd-decompress directory: $1"
    [ -e "$1" ] || exit 0
    [ -d "$1" ] && [ ! -L "$1" ] || die "not a directory: $1"
    [ "$(stat -c %U -- "$1")" = urbackup ] || die "not a vhd-decompress directory: $1"
    exec rm -rf --one-file-system -- "$1"
    ;;

  journal)
    EXPECT=1 nargs "$@"
    [[ "$1" =~ ^[0-9]{1,4}$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 1000 ] || die "lines must be 1-1000"
    exec journalctl -u urbackup-gui.service -n "$1" --no-pager -o json
    ;;

  *)
    die "unknown action: $ACTION"
    ;;
esac
}

# Sourcing this file (tests) defines the checks without running anything.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
