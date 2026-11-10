#!/bin/bash
# Put sqlite3's native binary into <backend>/node_modules/sqlite3, for a tree
# installed with `npm ci --ignore-scripts`. Run as the service user.
#
#   setup/install-sqlite3.sh <backend-dir>
#
# sqlite3's own install step (prebuild-install) downloads a prebuilt binary that
# package-lock.json does not pin. Here the same file is downloaded and checked
# against the SHA-256 in setup/sqlite3-prebuilt.sha256 before it is unpacked, so
# a binary that is not the one St0r was released with is never put in place.
# Without a pinned build for this platform, sqlite3 is compiled from its own
# lockfile-pinned source instead (needs python3, make and g++).
set -euo pipefail

BACKEND="${1:?usage: $0 <backend-dir>}"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SUMS="${ST0R_SQLITE3_SUMS:-$HERE/sqlite3-prebuilt.sha256}"
BASE_URL="${ST0R_SQLITE3_BASE_URL:-https://github.com/TryGhost/node-sqlite3/releases/download}"
PKG="$BACKEND/node_modules/sqlite3"

[ -f "$PKG/package.json" ] || { echo "sqlite3 is not installed in $BACKEND/node_modules" >&2; exit 1; }
VERSION=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([0-9][0-9.]*\)".*/\1/p' "$PKG/package.json" | head -1)
[ -n "$VERSION" ] || { echo "cannot read the sqlite3 version" >&2; exit 1; }

case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) ARCH="" ;;
esac
if ldd --version 2>&1 | grep -qi musl; then LIBC=linuxmusl; else LIBC=linux; fi
NAME="sqlite3-v${VERSION}-napi-v6-${LIBC}-${ARCH}.tar.gz"
SUM=""
[ -n "$ARCH" ] && SUM=$(awk -v n="$NAME" '$1 !~ /^#/ && $2 == n { print $1 }' "$SUMS")

if [ -z "$SUM" ]; then
  echo "No pinned sqlite3 binary for ${NAME}; building sqlite3 from source"
  cd "$BACKEND"
  exec npm rebuild sqlite3 --build-from-source
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL --proto '=https' --max-time 300 -o "$TMP/$NAME" "$BASE_URL/v${VERSION}/${NAME}"
if ! echo "${SUM}  $TMP/$NAME" | sha256sum -c --quiet - >/dev/null 2>&1; then
  echo "sqlite3 binary ${NAME} does not match its pinned SHA-256 — not installing it" >&2
  exit 1
fi
mkdir "$TMP/x"
tar xzf "$TMP/$NAME" -C "$TMP/x" --no-same-owner --no-same-permissions
[ -f "$TMP/x/build/Release/node_sqlite3.node" ] || { echo "unexpected contents in ${NAME}" >&2; exit 1; }
install -d "$PKG/build/Release"
install -m 0644 "$TMP/x/build/Release/node_sqlite3.node" "$PKG/build/Release/node_sqlite3.node"
echo "Installed sqlite3 ${VERSION} (${LIBC}-${ARCH}, SHA-256 verified)"
