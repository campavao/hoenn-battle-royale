#!/usr/bin/env bash
# Floating IPS at a pinned commit, built on first use, run with the given arguments:
#
#     tools/br/flips.sh --create --bps-delta --exact <baseline.gba> <new.gba> <out.bps>
#
# The project's one BPS encoder; tools/br/make-patch.sh is its only caller. Every
# upstream hook grows its object and shifts everything linked after it, so most of the
# fork's ROM is retail bytes at a new offset. flips' delta creator finds those moved
# blocks (SourceCopy); the page's own test encoder (web/src/patch/bps.testutil.ts) only
# matches at the same offset, and the 10.2 MB live patch it built was ~9 MB of shifted
# retail ROM. flips makes the same ROM in ~0.7 MB.
#
# Pinned, because an unpinned HEAD clone is third-party code nobody read deciding what
# bytes every player downloads. (Upstream declared the repo finished at this commit.)
# TARGET=cli is the headless binary -- plain `make` wants GTK -- and -O2 because the
# Makefile's default is a -g debug build. On Windows it builds in the MSYS2 UCRT64 shell
# (the Git Bash toolchain is not a compiler), linked static so the .exe runs from Git
# Bash or PowerShell with no MSYS2 DLLs on PATH.
set -euo pipefail

FLIPS_REPO=https://github.com/Alcaro/Flips
FLIPS_COMMIT=ff216a75df0987047a67d7923567dc4482ce07ac

HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="$HERE/.flips"

if [[ "$(cat "$DIR/.built" 2>/dev/null || true)" != "$FLIPS_COMMIT" ]]; then
  echo "building flips ${FLIPS_COMMIT:0:12} into $DIR" >&2
  rm -rf "$DIR"
  mkdir -p "$DIR"
  git -C "$DIR" init -q
  git -C "$DIR" fetch -q --depth 1 "$FLIPS_REPO" "$FLIPS_COMMIT"
  # A local `master`: the Makefile stamps `git rev-list --count master` into the binary.
  git -C "$DIR" checkout -q -b master FETCH_HEAD
  if [[ "${MSYSTEM:-}" != "UCRT64" && -x /c/msys64/usr/bin/bash.exe ]]; then
    MSYSTEM=UCRT64 /c/msys64/usr/bin/bash.exe -lc "cd '$DIR' && TARGET=cli make CFLAGS=-O2 LFLAGS=-static" >&2
  else
    ( cd "$DIR" && TARGET=cli make CFLAGS=-O2 ) >&2
  fi
  echo "$FLIPS_COMMIT" > "$DIR/.built"
fi

BIN="$DIR/flips"
[[ -f "$BIN.exe" ]] && BIN="$BIN.exe"
[[ -f "$BIN" ]] || { echo "the flips build did not produce $BIN" >&2; rm -f "$DIR/.built"; exit 2; }
exec "$BIN" "$@"
