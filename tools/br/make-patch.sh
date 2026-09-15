#!/usr/bin/env bash
# Build patch/hoenn-br.bps: a BPS diff from the baseline pokeemerald.gba (agbcc, pret at
# tools/br/BASELINE_COMMIT) to this fork's own agbcc build. Linux-only (CI, or WSL locally);
# the release patch is always the agbcc build, never `make modern` (a modern build
# recompiles every function, so the diff would carry a full recompilation of Nintendo's
# code alongside our changes).
#
#     tools/br/make-patch.sh <baseline.gba> <new.gba> <out.bps>
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
FLIPS_DIR="$HERE/.flips"
FLIPS_BIN="$FLIPS_DIR/flips"

BASELINE="${1:?usage: make-patch.sh <baseline.gba> <new.gba> <out.bps>}"
NEW="${2:?usage: make-patch.sh <baseline.gba> <new.gba> <out.bps>}"
OUT="${3:?usage: make-patch.sh <baseline.gba> <new.gba> <out.bps>}"

[[ -f "$BASELINE" ]] || { echo "no baseline rom: $BASELINE" >&2; exit 2; }
[[ -f "$NEW" ]] || { echo "no fork rom: $NEW" >&2; exit 2; }

if [[ ! -x "$FLIPS_BIN" ]]; then
  echo "building flips into $FLIPS_DIR"
  rm -rf "$FLIPS_DIR"
  git clone --depth 1 https://github.com/Alcaro/Flips "$FLIPS_DIR"
  # Plain `make` targets the GTK GUI and needs pkg-config + libgtk-3-dev, neither of
  # which CI (or a bare WSL box) has. TARGET=cli builds the headless binary we actually
  # want, which is also all `--create --bps` needs.
  ( cd "$FLIPS_DIR" && TARGET=cli make )
  [[ -x "$FLIPS_BIN" ]] || { echo "flips build did not produce $FLIPS_BIN" >&2; exit 2; }
fi

mkdir -p "$(dirname "$OUT")"
"$FLIPS_BIN" --create --bps "$BASELINE" "$NEW" "$OUT"

SIZE="$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT")"
echo "patch size: $SIZE bytes ($OUT)"
