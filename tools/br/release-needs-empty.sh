#!/usr/bin/env bash
# Whether a release has to wait for nobody to be on /world: prints yes or no.
# tools/br/release-needs-empty.sh [base] [head]
#
# A running match stands on the relay, the world bundle (web/spike-b/shared/, whose WORLD_HASH
# every page sends on join) and the ROM, which both sides of a link battle must share. A site
# deploy that changes none of them can't touch it: a page keeps the build it loaded. And any
# open tab holds /health's `world` at 1 or more, so asking it of every release holds most of
# them back (Cam, 2026-11-02). base defaults to the highest version tag, leaving out $TAG (the
# one a re-run is making); no base to compare with is a yes.
set -euo pipefail

base="${1:-$(git tag -l 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | { grep -vxF "${TAG:-}" || true; } | head -n1)}"
head="${2:-HEAD}"
if [ -z "$base" ]; then echo yes; exit 0; fi

changed="$(mktemp)"
trap 'rm -f "$changed"' EXIT
git diff -z --no-renames --name-only "$base" "$head" > "$changed"

if tr '\0' '\n' < "$changed" | grep -qE '^(relay/|web/spike-b/shared/)'; then echo yes; exit 0; fi
if node web/scripts/ci-scope.mjs < "$changed" | grep -qx 'rom=true'; then echo yes; exit 0; fi
echo no
