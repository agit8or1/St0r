#!/bin/bash
# Build, sign and attach the release tarball that setup/auto-update.sh installs.
#
#   scripts/sign-release.sh v3.2.130            # build + sign + upload to the GitHub release
#   scripts/sign-release.sh v3.2.130 --no-upload
#
# Run AFTER the tag is pushed and the GitHub release exists. The private key
# stays on the release machine (default ~/.config/st0r-release/release_ed25519,
# override with ST0R_RELEASE_KEY) — never commit it or put it in CI secrets.
# Installs verify against setup/release-signers. To rotate the key, ship the
# new public key in setup/release-signers in a release signed by the OLD key.
set -euo pipefail

TAG="${1:?usage: $0 <tag> [--no-upload]}"
UPLOAD=1; [ "${2:-}" = "--no-upload" ] && UPLOAD=0
KEY="${ST0R_RELEASE_KEY:-$HOME/.config/st0r-release/release_ed25519}"
REPO_ROOT=$(git rev-parse --show-toplevel)
OUT="${REPO_ROOT}/dist-release"
NAME="st0r-${TAG}.tar.gz"

cd "$REPO_ROOT"
git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null || { echo "tag ${TAG} not found"; exit 1; }
[ -f "$KEY" ] || { echo "signing key not found: $KEY"; exit 1; }

TAG_VERSION=$(git show "${TAG}:VERSION" | tr -d '[:space:]')
[ "v${TAG_VERSION}" = "$TAG" ] || { echo "VERSION at ${TAG} is ${TAG_VERSION} — refusing to sign"; exit 1; }

mkdir -p "$OUT"
rm -f "$OUT/$NAME" "$OUT/$NAME.sig"
# git archive of the tag: reproducible from the tag, unlike GitHub's on-the-fly archives.
git archive --format=tar.gz --prefix="St0r-${TAG_VERSION}/" -o "$OUT/$NAME" "$TAG"
ssh-keygen -Y sign -q -f "$KEY" -n st0r-release "$OUT/$NAME"

# Verify with the signers file AT THE TAG — the one installs will have once they
# are on this release.
SIGNERS=$(mktemp); trap 'rm -f "$SIGNERS"' EXIT
git show "${TAG}:setup/release-signers" > "$SIGNERS"
ssh-keygen -Y verify -f "$SIGNERS" -I st0r-release -n st0r-release -s "$OUT/$NAME.sig" < "$OUT/$NAME"

echo "sha256: $(sha256sum "$OUT/$NAME" | cut -d' ' -f1)"
if [ "$UPLOAD" = 1 ]; then
  gh release upload "$TAG" "$OUT/$NAME" "$OUT/$NAME.sig" --clobber
  echo "uploaded ${NAME} and ${NAME}.sig to release ${TAG}"
fi
