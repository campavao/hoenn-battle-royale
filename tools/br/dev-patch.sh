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
# The drivers read the copy at the repo root (tools/br/drive.sh), the shell reads the
# one in public/. They are the same file and they must be the same build: a stale root
# copy points every driver at addresses the new ROM does not use, and all 38 fail at
# once on the first expect, which looks exactly like a broken ROM.
cp "$ROOT/web/public/patch/br-symbols.json" "$ROOT/br-symbols.json"
bash "$HERE/version-json.sh" "${MAP%.map}.gba" "$ROOT/web/public/patch/br-version.json"
echo "sidecars written for $MAP"

BASELINE="${2:-${BR_BASELINE_ROM:-}}"
if [[ -n "$BASELINE" && -f "$BASELINE" ]]; then
  # npx is not on the MSYS2 login shell's PATH; node_modules/.bin always is. Both ROM
  # paths are resolved before the cd -- a relative "pokeemerald.gba" means the repo
  # root to the caller and web/ to the subshell, which is a file that does not exist.
  ROM="$(cd "$(dirname "${MAP%.map}.gba")" && pwd)/$(basename "${MAP%.map}.gba")"
  BASE="$(cd "$(dirname "$BASELINE")" && pwd)/$(basename "$BASELINE")"
  ( cd "$ROOT/web" && ./node_modules/.bin/vite-node "$HERE/make-bps.ts" -- "$BASE" "$ROM" "$ROOT/web/public/patch/hoenn-br.bps" )
else
  rm -f "$ROOT/web/public/patch/hoenn-br.bps"
  echo "no baseline rom (arg 2 or \$BR_BASELINE_ROM): skipping the BPS -- dev will only run a pre-patched ROM"
fi
