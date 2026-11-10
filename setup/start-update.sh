#!/bin/bash
# St0r update launcher, installed root-owned as /usr/local/lib/st0r/start-update.
#
# The panel's only sudo rule (/etc/sudoers.d/st0r-update) allows exactly this
# command with no arguments. It takes none, reads nothing from the St0r install
# directory, and starts only the root-owned updater next to it as a transient
# systemd unit, so the update survives the panel being stopped.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin

if [ "$#" -ne 0 ]; then
  echo "usage: $0   (takes no arguments)" >&2
  exit 2
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "$0 must be run as root" >&2
  exit 1
fi

UNIT=urbackup-gui-update
UPDATER=/usr/local/lib/st0r/auto-update.sh
LOG=/var/log/urbackup-gui-update.log

if systemctl is-active --quiet "$UNIT"; then
  echo "An update is already running"
  exit 0
fi
systemctl reset-failed "${UNIT}.service" 2>/dev/null || true

exec systemd-run \
  --unit="$UNIT" \
  --description="St0r update" \
  --property="StandardOutput=append:${LOG}" \
  --property="StandardError=append:${LOG}" \
  "$UPDATER"
