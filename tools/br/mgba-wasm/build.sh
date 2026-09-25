#!/usr/bin/env bash
# Builds the wasm core web/public/emu ships: thenick775's mgba `feature/wasm` at COMMIT
# plus hbr-exports.patch. CI's wasm job and docs/DEPLOY.md's rebuild both run this, so
# the core a dev box commits and the one CI builds are the same bytes.
#
#   source ~/emsdk/emsdk_env.sh      # emscripten on PATH (CI: setup-emsdk)
#   bash tools/br/mgba-wasm/build.sh <dir>
#
# <dir> is wiped and becomes the source tree; the core lands in <dir>/build-wasm/wasm/
# (mgba.js, mgba.wasm, mgba.d.ts, mgba.wasm.map). It must be new, empty, or one this
# script made: the patch is edited as uncommitted changes in ~/mgba-wasm, and a slip of
# `build.sh ~/mgba-wasm` would wipe them.
#
# Emscripten's output is byte-stable across machines: a WSL box and an Actions runner
# built the same sha256s from the same checkout. mGBA's is not, quite: version.cmake
# stamps the checkout's git state into version.c (`git describe`, the branch, `rev-list
# --count`, a tag at HEAD), so a full clone, a detached HEAD and a shallow clone each
# build a different mgba.wasm and -- the data segment shifts, and the ASM_CONSTS
# addresses with it -- a different mgba.js. The checkout here is always the shape the
# tracked core was built from (a `git clone --depth 1 --branch feature/wasm`): one
# commit, on a branch named feature/wasm, with the tags that point at it (v2.5.1, which
# becomes projectVersion).
set -euo pipefail

want_emcc=6.0.5 # keep in step with setup-emsdk's `version` in .github/workflows/ci.yml

dir="${1:?usage: build.sh <dir>}"
here="$(cd "$(dirname "$0")" && pwd)"
# A Windows checkout has CRLF in both; WSL reads them through /mnt/c.
commit="$(tr -d '\r' < "$here/COMMIT")"
# Each tree this script makes carries this, in .git so the work tree mGBA stamps is still
# a clone's. A directory with files in it and no marker is not wiped.
marker="$dir/.git/hbr-mgba-build"
if [ -e "$dir" ] && [ ! -e "$marker" ] && [ -n "$(ls -A "$dir")" ]; then
  echo "build.sh: $dir has files and build.sh did not make it; not wiping it (pass a new directory)" >&2
  exit 1
fi

got_emcc="$(emcc -dumpversion)"
if [ "$got_emcc" != "$want_emcc" ]; then
  echo "build.sh: emcc $got_emcc, the core is built with $want_emcc" >&2
  exit 1
fi

rm -rf "$dir"
mkdir -p "$dir"
git -C "$dir" init -q
: > "$marker"
# Into a branch, not FETCH_HEAD: fetch follows tags only for a refspec with a destination.
git -C "$dir" fetch -q --depth 1 https://github.com/thenick775/mgba "$commit:refs/heads/feature/wasm"
git -C "$dir" checkout -q feature/wasm
tr -d '\r' < "$here/hbr-exports.patch" | git -C "$dir" apply

mkdir -p "$dir/build-wasm"
cd "$dir/build-wasm"
emcmake cmake -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5 ..
make -j"$(nproc)"
sha256sum wasm/mgba.wasm wasm/mgba.js wasm/mgba.d.ts
