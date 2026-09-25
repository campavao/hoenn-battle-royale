#!/usr/bin/env bash
# Publish the shell to Vercel: tools/br/release-web.sh [--prod]
#
# What a player's browser needs from the site is three files in /patch/ -- br-version.json,
# br-symbols.json and hoenn-br.bps -- and NOT a ROM. The BPS is built here from the retail
# Emerald the player is expected to own; it is never committed (a build artifact), so a
# git-driven Vercel deploy can never carry it. That is why this exists and why the release
# path is the CLI from a machine that has the ROM.
#
#   1. refuse unless the built ROM matches the sidecars and the patch, so the site never
#      publishes a patch for a build nobody has, and refuse a patch over the size ceiling;
#      refuse uncommitted changes, and sidecars stamped at any commit but HEAD
#   2. deploy from the REPO ROOT, because the Vercel project's Root Directory is "web"
#   3. verify the live URL serves the patch, 404s the ROM and names this build
#      (tools/br/verify-site.sh, the same checks CI's release job runs)
#
# The ROM is kept out by three separate things, on purpose: .vercelignore at the root,
# vite.config.ts's br-drop-roms plugin, and web/scripts/no-rom.mjs (which also knows a
# ROM by its header, whatever it is called). Publishing somebody
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
    echo "Build the ROM, then the sidecars and the patch (docs/DEPLOY.md):"
    echo "  make -j\"\$(nproc)\"                       # the agbcc build; the release is never 'make modern'"
    echo "  bash tools/br/dev-patch.sh pokeemerald.map \"<retail Emerald (U).gba>\""
    echo "(from Git Bash: the patch is checked with node, which is not on the MSYS2 PATH.)"
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
  echo "rebuild, then re-run dev-patch.sh with the retail ROM."
  exit 1
fi
# ...and the patch has to be for it too, and small: its footer CRCs say retail in and this
# build out, and a patch over the ceiling is shifted retail ROM, not our changes (the
# 10.2 MB same-offset patch of 2026-09 was exactly that). make-bps.ts is the same gate
# make-patch.sh ran when it wrote the file.
( cd "$ROOT/web" && ./node_modules/.bin/vite-node "$HERE/make-bps.ts" -- --shipped "$ROOT/pokeemerald.gba" "$PATCH_DIR/hoenn-br.bps" ) || {
  echo "re-run dev-patch.sh with the retail ROM; it builds the patch with flips."
  exit 1
}

# What goes out has to be a commit. `vercel deploy` uploads the working tree, and the
# version line names a commit, so uncommitted changes -- tracked anywhere (a ROM built
# from them), or new files under web/ (the shell) -- would publish something no commit
# reproduces. And the sidecars have to be stamped at that commit, not before it
# (DEPLOY.md's "run it again after committing", which used to be on trust).
dirty="$({ git status --porcelain --untracked-files=no; git status --porcelain -- web; } | sort -u)"
if [[ -n "$dirty" ]]; then
  echo "uncommitted changes would go out with this deploy:"
  printf '%s\n' "$dirty" | head -20
  echo "commit them, then re-run dev-patch.sh."
  exit 1
fi
stamped="$(python -c "import json,sys;print(json.load(open(sys.argv[1]))['commit'])" "$PATCH_DIR/br-version.json")"
if [[ "$stamped" != "$(git rev-parse HEAD)" ]]; then
  echo "br-version.json names commit $stamped, but HEAD is $(git rev-parse HEAD)"
  echo "re-run dev-patch.sh so the version line names what is going out."
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

# The same checks CI's release job runs (verify-site.sh), including the one that matters
# most: /patch/pokeemerald.gba must 404. A preview sits behind Deployment Protection, so
# it is checked through `vercel curl`; production is public.
if [[ "$PROD" -eq 1 ]]; then via=(); else via=(--vercel-scope "$SCOPE"); fi
bash "$HERE/verify-site.sh" "$url" "$have" ${via[@]+"${via[@]}"} \
  || { echo "the deploy is up but wrong -- do not announce it"; exit 1; }
echo
echo "live: $url"
