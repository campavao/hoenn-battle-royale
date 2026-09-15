#!/usr/bin/env bash
# Run a headless driver against the ROM: tools/br/drive.sh <driver> [rom] [state.ss1]
#
# Compiles the harness on first use (or when harness.c changed) against the static
# libmgba, runs the driver script, writes frames to tools/br/harness/frames/<driver>/,
# exits with the harness's code (0 = every expect held).
#
# Two hosts:
#   Windows (Git Bash / a plain shell) - re-execs itself inside the MSYS2 UCRT64 shell,
#     where libmgba is a prebuilt static lib at MGBA_SRC (default the sibling
#     mgba-src checkout) and the harness links the Windows libs it needs.
#   Linux (CI, or WSL locally) - no MSYS2, so this builds libmgba from source into
#     tools/br/.mgba the first time (mgba 0.10.5, static, GUI/Qt/SDL/etc all off) and
#     links the Linux libs instead. Nothing here re-execs on Linux: the MSYS2 check
#     below simply never matches because /c/msys64 doesn't exist on that host.
set -euo pipefail

if [[ "${MSYSTEM:-}" != "UCRT64" && -x /c/msys64/usr/bin/bash.exe ]]; then
  exec env MSYSTEM=UCRT64 /c/msys64/usr/bin/bash.exe -lc "cd '$(pwd)' && bash '$0' $*"
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

OS="$(uname -s)"
if [[ "$OS" == Linux* ]]; then
  LINUX=1
  M="${MGBA_SRC:-$HERE/.mgba}"
else
  LINUX=0
  M="${MGBA_SRC:-/c/Users/cam95/Documents/Github/mgba-src}"
fi

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

if [[ "$LINUX" -eq 1 && ! -f "$M/build/libmgba.a" ]]; then
  echo "building libmgba into $M (mgba 0.10.5, static, no Qt/SDL/etc)"
  [[ -d "$M" ]] || git clone --branch 0.10.5 --depth 1 https://github.com/mgba-emu/mgba "$M"
  mkdir -p "$M/build"
  # WSL appends the Windows PATH to the Linux one by default, so /mnt/c/msys64/ucrt64/bin
  # is on PATH here; CMake turns every */bin entry into a search prefix, finds MSYS2's
  # zlib/png headers ahead of the system ones, and pulls in a corecrt.h that doesn't
  # compile under a Linux GCC. Strip /mnt/c/* out of PATH for the configure+build only -
  # a no-op on a real Linux box (CI) where no such paths exist.
  CLEAN_PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '^/mnt/c' | paste -sd: -)"
  ( cd "$M/build" && PATH="$CLEAN_PATH" cmake \
      -DBUILD_STATIC=ON -DBUILD_SHARED=OFF -DBUILD_QT=OFF -DBUILD_SDL=OFF \
      -DUSE_FFMPEG=OFF -DUSE_DISCORD_RPC=OFF -DUSE_EPOXY=OFF -DUSE_SQLITE3=OFF \
      -DUSE_ELF=OFF -DUSE_LZMA=OFF -DUSE_MINIZIP=OFF -DUSE_ZLIB=ON -DUSE_PNG=ON \
      -DCMAKE_POLICY_VERSION_MINIMUM=3.5 .. \
    && PATH="$CLEAN_PATH" make -j"$(nproc)" )
fi

if [[ "$LINUX" -eq 1 ]]; then
  EXE="$HERE/harness/harness"
  LINK_LIBS=(-lpng -lz -lm -lpthread)
else
  EXE="$HERE/harness/harness.exe"
  LINK_LIBS=(-lpng16 -lz -lzip -lepoxy -lsqlite3 -lshlwapi -lole32 -lshell32 -luuid -lws2_32 -lwinmm -lm)
fi

if [[ ! -x "$EXE" || "$HERE/harness/harness.c" -nt "$EXE" ]]; then
  gcc "$HERE/harness/harness.c" -o "$EXE" -O1 \
    -I"$M/include" -I"$M/build/include" \
    "$M/build/libmgba.a" \
    "${LINK_LIBS[@]}"
fi

args=("$ROM" "$DRIVER" "$OUT")
[[ -n "$STATE" ]] && args+=(--state "$STATE")
[[ -f "$SYMS" ]] && args+=(--symbols "$SYMS")
"$EXE" "${args[@]}"
