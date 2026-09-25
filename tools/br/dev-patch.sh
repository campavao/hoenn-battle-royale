#!/usr/bin/env bash
# Dev only: give the shell what a published release gives it -- the sidecars for the
# LOCAL agbcc build, and the BPS that turns a stock Emerald ROM into it.
#
#   tools/br/dev-patch.sh [pokeemerald.map] [baseline.gba]
#     -> web/public/patch/{br-symbols.json,br-version.json,hoenn-br.bps}
#
# The baseline is a retail Emerald (U) ROM (sha1 f3ae0881...). Give it as the second
# argument or in $BR_BASELINE_ROM. Without one the BPS is skipped and `npm run dev` can
# only run a ROM that is already the fork's build -- which is how this used to work, and
# it made the local shell a different product from the deployed one.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
MAP="${1:-$ROOT/pokeemerald.map}"
[[ -f "$MAP" ]] || { echo "no $MAP; run make first"; exit 2; }
mkdir -p "$ROOT/web/public/patch"
python3 "$HERE/symbols.py" "$MAP" > "$ROOT/web/public/patch/br-symbols.json"
# No copy at the repo root any more: tools/br/drive.sh makes its own table from the
# driven ROM's .map on every run, so a stale root copy can no longer point every driver
# at another build's addresses (all of them failing at once, like a broken ROM).
# ...and the build itself, where the dev shell can fetch it (POK-254 again). A ROM
# already in IndexedDB is a ROM the shell keeps using: `isPrePatched` says "a local
# build, run it" and nothing ever asked WHICH local build. A whole night of fixes can
# land, every driver go green, and the tab still be playing this morning's ROM --
# which is exactly what happened on 2026-09-17. With this file served, the shell can
# notice its stored ROM is not the current one and take the current one instead.
cp "${MAP%.map}.gba" "$ROOT/web/public/patch/pokeemerald.gba"
bash "$HERE/version-json.sh" "${MAP%.map}.gba" "$ROOT/web/public/patch/br-version.json"
echo "sidecars written for $MAP"

BASELINE="${2:-${BR_BASELINE_ROM:-}}"
if [[ -n "$BASELINE" && -f "$BASELINE" ]]; then
  # The same flips-built, round-tripped, size-gated patch CI makes for a tag
  # (make-patch.sh). This is step 2 of docs/DEPLOY.md, so what it writes is what ships.
  bash "$HERE/make-patch.sh" "$BASELINE" "${MAP%.map}.gba" "$ROOT/web/public/patch/hoenn-br.bps"
else
  rm -f "$ROOT/web/public/patch/hoenn-br.bps"
  echo "no baseline rom (arg 2 or \$BR_BASELINE_ROM): skipping the BPS -- dev will only run a pre-patched ROM"
fi
