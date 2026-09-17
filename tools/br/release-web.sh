#!/usr/bin/env bash
# Publish the shell to Vercel: tools/br/release-web.sh [--prod]
#
# What a player's browser needs from the site is three files in /patch/ -- br-version.json,
# br-symbols.json and hoenn-br.bps -- and NOT a ROM. The BPS is built here from the retail
# Emerald the player is expected to own; it is never committed (10 MB, and a build
# artifact), so a git-driven Vercel deploy can never carry it. That is why this exists and
# why the release path is the CLI from a machine that has the ROM.
#
#   1. refuse unless the built ROM matches the sidecars, so the site never publishes a
#      patch for a build nobody has
#   2. deploy from the REPO ROOT, because the Vercel project's Root Directory is "web"
#   3. verify the live URL serves the patch and 404s the ROM
#
# The ROM is kept out by three separate things, on purpose: .vercelignore at the root,
# vite.config.ts's br-drop-roms plugin, and web/scripts/no-rom.mjs. Publishing somebody
# else's copyright is the one mistake here that cannot be taken back.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PATCH_DIR="$ROOT/web/public/patch"
SCOPE="${VERCEL_SCOPE:-campavaos-projects}"
PROD=0
[[ "${1:-}" == "--prod" ]] && PROD=1

cd "$ROOT"

# Run this from Git Bash or PowerShell, NOT the MSYS2 UCRT64 shell the ROM is built in:
# node and npx are not on its PATH, and the failure is a bare "npx: command not found"
# forty lines in, after the checks have all passed.
command -v npx >/dev/null || {
  echo "npx is not on this shell's PATH."
  echo "The MSYS2 UCRT64 shell builds the ROM; it has no node. Run this one from Git Bash."
  exit 1
}

for f in br-version.json br-symbols.json hoenn-br.bps; do
  [[ -f "$PATCH_DIR/$f" ]] || {
    echo "missing $PATCH_DIR/$f"
    echo
    echo "Build the ROM, then both sidecars and the patch, in this order -- dev-patch.sh"
    echo "DELETES the BPS, so it has to come first:"
    echo "  make -j\"\$(nproc)\"                       # the agbcc build; the release is never 'make modern'"
    echo "  bash tools/br/dev-patch.sh pokeemerald.map"
    echo "  cd web && npx vite-node ../tools/br/make-bps.ts -- \\"
    echo "      \"<retail Emerald (U).gba>\" ../pokeemerald.gba public/patch/hoenn-br.bps"
    echo "(make-bps wants node, which is not on the MSYS2 PATH -- run it from PowerShell.)"
    exit 1
  }
done

# The sidecar knows the sha1 of the build it was written for. If the ROM on disk is not
# that build, the BPS and the symbol table disagree about where everything is, and the
# site would hand every player a patch whose addresses are wrong.
want="$(python -c "import json,sys;print(json.load(open(sys.argv[1]))['romSha1'])" "$PATCH_DIR/br-version.json")"
have="$(sha1sum "$ROOT/pokeemerald.gba" | cut -d' ' -f1)"
if [[ "$want" != "$have" ]]; then
  echo "the sidecars are for rom $want but pokeemerald.gba is $have"
  echo "rebuild, then re-run dev-patch.sh and make-bps in that order."
  exit 1
fi
echo "publishing rom $have, commit $(git rev-parse --short HEAD)"

if [[ "$PROD" -eq 1 ]]; then
  out="$(npx vercel deploy --prod --yes --scope "$SCOPE")"
  url="https://hoenn-battle-royale.vercel.app"
else
  out="$(npx vercel deploy --yes --scope "$SCOPE")"
  url="$(printf '%s' "$out" | grep -oE 'https://hoenn-battle-royale-[a-z0-9]+-[a-z0-9-]+\.vercel\.app' | tail -1)"
fi
printf '%s\n' "$out" | tail -3
echo
echo "checking $url"

fail=0
# Through `vercel curl` rather than plain curl: a preview URL sits behind Deployment
# Protection, so a bare request gets a 302 to the SSO page and every check "fails" on a
# deploy that is perfectly fine. Production is public and works either way.
check() { # path expected-status
  code="$(npx vercel curl "$url$1" --scope "$SCOPE" -- -s -o /dev/null -w '%{http_code}' 2>/dev/null | tail -1)"
  if [[ "$code" == "$2" ]]; then echo "  ok   $1 -> $code"; else echo "  FAIL $1 -> $code (wanted $2)"; fail=1; fi
}
check /patch/br-version.json 200
check /patch/br-symbols.json 200
check /patch/hoenn-br.bps 200
# The one that matters most. A 200 here means a copyrighted ROM is on the internet.
check /patch/pokeemerald.gba 404

[[ "$fail" -eq 0 ]] || { echo "the deploy is up but wrong -- do not announce it"; exit 1; }
echo
echo "live: $url"
