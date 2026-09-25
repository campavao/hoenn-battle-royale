#!/usr/bin/env bash
# Is the live site what this release meant to publish?
#
#     tools/br/verify-site.sh <url> <romSha1> [--vercel-scope <scope>]
#
# The checks both release paths run after a deploy: tools/br/release-web.sh by hand, and
# ci.yml's release job for a tag. They were two copies, and only CI's compared the ROM:
#
#   /patch/br-version.json, br-symbols.json and hoenn-br.bps answer 200
#   /patch/pokeemerald.gba answers 404 -- a 200 means a copyrighted ROM is on the internet
#   the live br-version.json names <romSha1>, the build this release is for
#
# --vercel-scope sends every request through `npx vercel curl`: a preview URL sits behind
# Deployment Protection, and a bare request gets a 302 to the SSO page, which would fail
# every check on a deploy that is fine. Production is public; plain curl.
set -euo pipefail

usage="usage: verify-site.sh <url> <romSha1> [--vercel-scope <scope>]"
URL="${1:?$usage}"
WANT="${2:?$usage}"
SCOPE=""
if [[ "${3:-}" == "--vercel-scope" ]]; then SCOPE="${4:?$usage}"; fi
PY="$(command -v python3 || command -v python)"

get() { # <path> <curl args...>
  local path="$1"; shift
  if [[ -n "$SCOPE" ]]; then
    npx vercel curl "$URL$path" --scope "$SCOPE" -- "$@" 2>/dev/null
  else
    curl "$@" "$URL$path"
  fi
}

fail=0
check() { # <path> <status>
  local code
  code="$(get "$1" -s -o /dev/null -w '%{http_code}' | tail -1 || true)"
  if [[ "$code" == "$2" ]]; then echo "  ok   $1 -> $code"; else echo "  FAIL $1 -> $code (wanted $2)"; fail=1; fi
}

echo "checking $URL"
check /patch/br-version.json 200
check /patch/br-symbols.json 200
check /patch/hoenn-br.bps 200
check /patch/pokeemerald.gba 404
live="$(get /patch/br-version.json -s | "$PY" -c 'import json,sys; print(json.load(sys.stdin).get("romSha1", ""))' 2>/dev/null || true)"
if [[ "$live" == "$WANT" ]]; then
  echo "  ok   live rom ${live:0:7}"
else
  echo "  FAIL live rom ${live:0:7} (wanted ${WANT:0:7})"
  fail=1
fi
[[ "$fail" -eq 0 ]]
