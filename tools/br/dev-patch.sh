#!/usr/bin/env bash
# Dev only: give the shell the sidecars for the LOCAL agbcc build so a pre-patched ROM
# (pokeemerald.gba, header title HOENN BR) runs in `npm run dev` without a BPS.
#   tools/br/dev-patch.sh        -> web/public/patch/{br-symbols.json,br-version.json}
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
MAP="${1:-$ROOT/pokeemerald.map}"
[[ -f "$MAP" ]] || { echo "no $MAP; run make first"; exit 2; }
mkdir -p "$ROOT/web/public/patch"
python3 "$HERE/symbols.py" "$MAP" > "$ROOT/web/public/patch/br-symbols.json"
bash "$HERE/version-json.sh" "${MAP%.map}.gba" "$ROOT/web/public/patch/br-version.json"
rm -f "$ROOT/web/public/patch/hoenn-br.bps"
echo "sidecars written for $MAP"
