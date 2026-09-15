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
  # Flips' own Makefile targets a GUI by default on some platforms; the CLI-only build
  # is just `make`, which drops a `flips` binary (no `flips-gtk`/`flips.exe`) on Linux.
  ( cd "$FLIPS_DIR" && make )
  [[ -x "$FLIPS_BIN" ]] || { echo "flips build did not produce $FLIPS_BIN" >&2; exit 2; }
fi

mkdir -p "$(dirname "$OUT")"
"$FLIPS_BIN" --create --bps "$BASELINE" "$NEW" "$OUT"

SIZE="$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT")"
echo "patch size: $SIZE bytes ($OUT)"
