#!/usr/bin/env bash
# Run a headless driver against the ROM: tools/br/drive.sh <driver> [rom] [state.ss1]
#
# Compiles the harness on first use (or when harness.c changed) against the static
# libmgba, runs the driver script, writes frames to tools/br/harness/frames/<driver>/,
# exits with the harness's code (0 = every expect held). Re-execs itself inside the
# MSYS2 UCRT64 shell when called from anywhere else, so it works from Git Bash too.
set -euo pipefail

if [[ "${MSYSTEM:-}" != "UCRT64" && -x /c/msys64/usr/bin/bash.exe ]]; then
  exec env MSYSTEM=UCRT64 /c/msys64/usr/bin/bash.exe -lc "cd '$(pwd)' && bash '$0' $*"
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
M="${MGBA_SRC:-/c/Users/cam95/Documents/Github/mgba-src}"

DRIVER_NAME="${1:?usage: drive.sh <driver> [rom] [state.ss1]}"
DRIVER="$HERE/drivers/$DRIVER_NAME.txt"
[[ -f "$DRIVER" ]] || DRIVER="$DRIVER_NAME"
[[ -f "$DRIVER" ]] || { echo "no driver $DRIVER_NAME"; exit 2; }

ROM="${2:-}"
if [[ -z "$ROM" ]]; then
  for c in "$ROOT/pokeemerald.gba" "$ROOT/pokeemerald_modern.gba"; do [[ -f "$c" ]] && ROM="$c" && break; done
fi
[[ -f "${ROM:-}" ]] || { echo "no ROM built; run make or make modern first"; exit 2; }

STATE="${3:-}"
SYMS="$ROOT/br-symbols.json"
OUT="$HERE/harness/frames/$(basename "${DRIVER%.txt}")"
mkdir -p "$OUT"; rm -f "$OUT"/*.png

EXE="$HERE/harness/harness.exe"
if [[ ! -x "$EXE" || "$HERE/harness/harness.c" -nt "$EXE" ]]; then
  gcc "$HERE/harness/harness.c" -o "$EXE" -O1 \
    -I"$M/include" -I"$M/build/include" \
    "$M/build/libmgba.a" \
    -lpng16 -lz -lzip -lepoxy -lsqlite3 \
    -lshlwapi -lole32 -lshell32 -luuid -lws2_32 -lwinmm -lm
fi

args=("$ROM" "$DRIVER" "$OUT")
[[ -n "$STATE" ]] && args+=(--state "$STATE")
[[ -f "$SYMS" ]] && args+=(--symbols "$SYMS")
"$EXE" "${args[@]}"
