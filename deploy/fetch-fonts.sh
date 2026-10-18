#!/usr/bin/env bash
# Download Barlow Semi Condensed (SIL Open Font License) so Beacon can serve it itself.
# Usage: bash deploy/fetch-fonts.sh [target-dir]   (default: public/fonts)
set -euo pipefail
DEST="${1:-$(cd "$(dirname "$0")/.." && pwd)/public/fonts}"
BASE="https://github.com/google/fonts/raw/main/ofl/barlowsemicondensed"
mkdir -p "$DEST"
for f in Regular Italic Medium SemiBold Bold; do
  out="$DEST/BarlowSemiCondensed-$f.ttf"
  [ -s "$out" ] && continue
  curl -fsSL --retry 2 -o "$out.tmp" "$BASE/BarlowSemiCondensed-$f.ttf" && mv "$out.tmp" "$out"
done
[ -s "$DEST/OFL.txt" ] || curl -fsSL -o "$DEST/OFL.txt" "$BASE/OFL.txt" || true
echo "Barlow Semi Condensed installed in $DEST"
