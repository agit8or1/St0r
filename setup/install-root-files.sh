#!/bin/bash
# Install the root-owned parts of St0r from a TRUSTED source tree: a release
# whose signature has been verified, or the checkout install.sh is run from.
#
#   setup/install-root-files.sh <source-dir> <service-user>
#
# Installs, all owned by root and not writable by the service user:
#   /usr/local/lib/st0r/auto-update.sh   the updater (runs as root)
#   /usr/local/lib/st0r/start-update     launcher: takes no arguments, starts the updater
#   /etc/st0r/release-signers            public key updates are verified against
#   /etc/sudoers.d/st0r-update           lets the service user run the launcher, nothing else
#
# The St0r install directory (/opt/urbackup-gui) belongs to the service user, so
# nothing the root-run updater trusts may live there.
#
# ST0R_DESTDIR (tests only) installs under that prefix, without changing owners.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin

SRC="${1:?usage: $0 <source-dir> <service-user>}"
SERVICE_USER="${2:?usage: $0 <source-dir> <service-user>}"
DEST="${ST0R_DESTDIR:-}"

if [ -z "$DEST" ] && [ "$(id -u)" -ne 0 ]; then
  echo "$0 must be run as root" >&2
  exit 1
fi
if ! [[ "$SERVICE_USER" =~ ^[a-z_][a-z0-9_.-]{0,31}$ ]]; then
  echo "invalid service user name: $SERVICE_USER" >&2
  exit 1
fi
for f in setup/auto-update.sh setup/start-update.sh setup/release-signers; do
  [ -s "$SRC/$f" ] || { echo "missing $SRC/$f" >&2; exit 1; }
done

LIB="$DEST/usr/local/lib/st0r"
ETC="$DEST/etc/st0r"
SUDOERS_DIR="$DEST/etc/sudoers.d"
OWN=(-o root -g root)
[ -n "$DEST" ] && OWN=()

install -d "${OWN[@]}" -m 0755 "$LIB" "$ETC"
# install(1) writes a new file and renames it into place, so a running updater
# keeps reading the old one.
install "${OWN[@]}" -m 0755 "$SRC/setup/auto-update.sh" "$LIB/auto-update.sh"
install "${OWN[@]}" -m 0755 "$SRC/setup/start-update.sh" "$LIB/start-update"
install "${OWN[@]}" -m 0644 "$SRC/setup/release-signers" "$ETC/release-signers"

if [ "$SERVICE_USER" != root ]; then
  install -d "${OWN[@]}" -m 0750 "$SUDOERS_DIR"
  tmp=$(mktemp)
  # The empty "" argument list means: this command, with no arguments.
  printf '# Installed by St0r. Lets the panel start an update and nothing else.\n%s ALL=(root) NOPASSWD: /usr/local/lib/st0r/start-update ""\n' \
    "$SERVICE_USER" > "$tmp"
  if visudo -cqf "$tmp"; then
    install "${OWN[@]}" -m 0440 "$tmp" "$SUDOERS_DIR/st0r-update"
  else
    echo "WARN: sudoers rule did not validate; not installed" >&2
  fi
  rm -f "$tmp"
fi

echo "Installed root-owned updater files (${LIB}, ${ETC}/release-signers)"
