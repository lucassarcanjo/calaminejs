#!/usr/bin/env bash
# Fetches calamine's own test corpus — 131 files across xlsx/xls/xlsb/ods/xlsm,
# accumulated from a decade of bug reports. Pinned to the tag we build against,
# so a corpus change is a deliberate act rather than a surprise.
#
# Not vendored into this repo: it is 21 MB, it is upstream's to maintain, and
# fetching it keeps the provenance and MIT attribution unambiguous.
set -euo pipefail

TAG="v0.36.1"
DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/fixtures/calamine"

if [ -d "$DEST" ] && [ -f "$DEST/.tag" ] && [ "$(cat "$DEST/.tag")" = "$TAG" ]; then
  echo "corpus already at $TAG ($(find "$DEST" -type f ! -name '.tag' | wc -l | tr -d ' ') files)"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "cloning tafia/calamine at $TAG..."
git clone -q --depth 1 --branch "$TAG" https://github.com/tafia/calamine.git "$TMP/calamine"

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$TMP/calamine/tests/." "$DEST/"
cp "$TMP/calamine/LICENSE-MIT.md" "$DEST/LICENSE-MIT.md"
echo "$TAG" > "$DEST/.tag"

echo "corpus at $TAG: $(find "$DEST" -type f ! -name '.tag' | wc -l | tr -d ' ') files"
