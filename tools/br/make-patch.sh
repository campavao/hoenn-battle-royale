#!/usr/bin/env bash
# Build the release patch: a BPS from retail Emerald (U) to this fork's agbcc build.
#
#     tools/br/make-patch.sh <baseline.gba> <new.gba> <out.bps>
#
# The one way the project makes its patch. CI's rom job (baseline = the pret build at
# tools/br/BASELINE_COMMIT, which check-rom.sh has just proved is retail byte for byte)
# and tools/br/dev-patch.sh (the hand release; baseline = the retail ROM on disk) both
# come here, so a tag and a hand release ship the same bytes for the same ROM:
#
#   1. flips, pinned (tools/br/flips.sh), in delta mode -- it finds the blocks every
#      upstream hook shifted, so the patch is our changes and not re-emitted retail ROM
#   2. tools/br/make-bps.ts applies it with the page's own decoder: the baseline has to
#      be retail, the result has to be <new.gba> byte for byte, and the file has to be
#      under the size ceiling
#   3. only then does it replace <out.bps>, so a patch that fails never overwrites the
#      last good one
#
# The release patch is always the agbcc build, never `make modern` (a modern build
# recompiles every function, so the diff would carry a full recompilation of Nintendo's
# code alongside our changes). Needs node and web/node_modules (`npm ci` in web/).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

usage="usage: make-patch.sh <baseline.gba> <new.gba> <out.bps>"
BASELINE="${1:?$usage}"
NEW="${2:?$usage}"
OUT="${3:?$usage}"

[[ -f "$BASELINE" ]] || { echo "no baseline rom: $BASELINE" >&2; exit 2; }
[[ -f "$NEW" ]] || { echo "no fork rom: $NEW" >&2; exit 2; }
VITE_NODE="$ROOT/web/node_modules/.bin/vite-node"
[[ -x "$VITE_NODE" ]] || { echo "no $VITE_NODE: run npm ci in web/ first" >&2; exit 2; }

# Absolute before the cd into web/ below: a relative "pokeemerald.gba" means the repo
# root to the caller and web/ to the subshell, which is a file that does not exist.
abs() { echo "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; }
BASELINE="$(abs "$BASELINE")"
NEW="$(abs "$NEW")"
mkdir -p "$(dirname "$OUT")"
OUT="$(abs "$OUT")"
TMP="$OUT.tmp"
trap 'rm -f "$TMP"' EXIT

# --exact: never strip a "copier header" (a SNES-era guess flips makes from file sizes).
bash "$HERE/flips.sh" --create --bps-delta --exact "$BASELINE" "$NEW" "$TMP"
( cd "$ROOT/web" && "$VITE_NODE" "$HERE/make-bps.ts" -- "$BASELINE" "$NEW" "$TMP" )
mv "$TMP" "$OUT"
echo "patch size: $(wc -c < "$OUT" | tr -d ' ') bytes ($OUT)"
