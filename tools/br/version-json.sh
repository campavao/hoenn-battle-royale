#!/usr/bin/env bash
# Emit patch/br-version.json from include/br/br_version.h plus the build's own facts.
#
#     tools/br/version-json.sh <rom.gba> [out.json]
#
# The shell and the relay gate a room on this file (POK-244): both sides of a link
# battle must agree on patch + protocol. Reads the two #defines with grep instead of
# a C preprocessor so it has no toolchain dependency; keep br_version.h's defines on
# one line each (`#define NAME VALUE`) for that to keep working.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
VERSION_H="$ROOT/include/br/br_version.h"

ROM="${1:?usage: version-json.sh <rom.gba> [out.json]}"
OUT="${2:-$ROOT/patch/br-version.json}"

[[ -f "$VERSION_H" ]] || { echo "missing $VERSION_H" >&2; exit 2; }
[[ -f "$ROM" ]] || { echo "missing rom $ROM" >&2; exit 2; }

grep_define() {
  # `#define BR_PATCH_VERSION 1` -> 1. Errors out if the define is missing so a
  # renamed macro fails CI loudly instead of silently shipping a stale version.
  local name="$1"
  local line
  line="$(grep -E "^[[:space:]]*#define[[:space:]]+${name}[[:space:]]+" "$VERSION_H" || true)"
  [[ -n "$line" ]] || { echo "missing #define $name in $VERSION_H" >&2; exit 2; }
  echo "$line" | awk '{print $3}'
}

PATCH_VERSION="$(grep_define BR_PATCH_VERSION)"
PROTOCOL="$(grep_define BR_PROTOCOL)"

SHELL_VERSION="unknown"
if [[ -n "${HBR_SHELL_VERSION:-}" ]]; then
  # A tagged release (ci.yml's release job) names the shell after the tag, so the
  # version line on the phone says the release a player is running, not package.json's
  # never-bumped 0.0.0.
  SHELL_VERSION="$HBR_SHELL_VERSION"
elif [[ -f "$ROOT/web/package.json" ]]; then
  # No jq dependency: package.json's "version" field, first hit, quotes stripped.
  SHELL_VERSION="$(grep -m1 '"version"' "$ROOT/web/package.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')"
fi

if command -v sha1sum >/dev/null 2>&1; then
  ROM_SHA1="$(sha1sum "$ROM" | awk '{print $1}')"
else
  ROM_SHA1="$(shasum -a 1 "$ROM" | awk '{print $1}')"
fi

COMMIT="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$(dirname "$OUT")"
cat > "$OUT" <<JSON
{
  "patch": ${PATCH_VERSION},
  "protocol": ${PROTOCOL},
  "shell": "${SHELL_VERSION}",
  "romSha1": "${ROM_SHA1}",
  "commit": "${COMMIT}",
  "builtAt": "${BUILT_AT}"
}
JSON

cat "$OUT"
