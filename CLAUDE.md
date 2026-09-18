# Hoenn Battle Royale

Kanto Battle Royale's rules on a Pokémon Emerald ROM patch, run in mGBA compiled to
WebAssembly, in the browser. This repo is a fork of `pret/pokeemerald`: `master` tracks pret,
all work is on `hoenn-battle-royale`. Design: `docs/DESIGN.md`. Tickets: Linear project
**Hoenn Battle Royale** (team POK, POK-209 onward).

## Do the work yourself

Read the source, trace, patch, run the suites. Spawn a subagent only when the output would
flood this context and you need the conclusion, not the material (a long log, a sweep of
many files). Size the model to the job: `haiku` for extraction, `sonnet` when it has to
judge, unset only when it needs this session's reasoning.

## Layout

- `src/br/`, `include/br/` — our C. Every touch to an upstream file is a one-line call
  under `#ifdef BR`. Write C89-ish: agbcc is GCC 2.95 (declarations before statements, no
  designated initialisers, no `//` in odd places).
- `web/` — Vite + TypeScript shell. `relay/` — Node WebSocket relay. `tools/br/` — harness,
  exporters, patch builder. `docs/` — design and handoffs. **Deploying (site, relay, tag):
  `docs/DEPLOY.md`** — when Cam asks to ship, that is the recipe, and read the live
  `rom` back afterwards.
- Never commit a `.gba`, `.sav`, `.ss?` or `.bps`. The patch is a CI artifact and a release
  asset; the ROM is never anywhere but the player's device.

## Toolchain (nothing is on PATH)

    MSYS2 UCRT64 shell   MSYSTEM=UCRT64 C:/msys64/usr/bin/bash.exe -lc '<cmd>'
    arm-none-eabi-gcc    /c/msys64/ucrt64/bin (13.4)       -> `make modern` (dev only, ~1 min)
    agbcc                C:\Users\cam95\Documents\Github\agbcc, installed into tools/agbcc
                         -> `make` (release, byte-matching, ~1 min incremental, ~9 min clean)
    tools/br/check-rom.sh  prints OK/MISMATCH for pokeemerald.gba against rom.sha1
    mGBA wasm core       built in WSL from thenick775/mgba feature/wasm + tools/br/mgba-wasm/hbr-exports.patch
                         (emsdk 6.0.5 at ~/emsdk, source at ~/mgba-wasm, output copied to web/public/emu/)
    libmgba (static)     C:\Users\cam95\Documents\Github\mgba-src\build\libmgba.a (0.10.5)
    Emerald ROM (U)      sha1 f3ae088181bf583e55daf962a92bb46f4f1d07b7
    WSL2 Ubuntu          available as the fallback build host

Build (from the repo root, no spaces anywhere in the path or the build breaks):

    MSYSTEM=UCRT64 C:/msys64/usr/bin/bash.exe -lc 'cd /c/Users/cam95/Documents/Github/hoenn-battle-royale && make modern -j"$(nproc)"'

Switching terminals (msys2 <-> WSL) needs `make clean-tools` once. `make clean` deletes both
ROMs, so a driver run right after a clean needs a rebuild first.

## Facts that cost hours

- **The release patch is the agbcc build.** `make modern` recompiles every function, so a BPS
  against retail would carry Nintendo's code re-emitted. Dev on modern, ship on agbcc.
- **Addresses come from `br-symbols.json`** (parsed from the link map by CI). Never hard-code
  an EWRAM address in the shell; a modern and an agbcc build put things in different places.
- **The mailbox is the only way out of the GBA.** The ROM cannot call the network; JS polls
  `gBrMailbox` after every frame. Anything the ROM must know arrives as a message.
- **Both sides of a link battle must run the same patch.** The block exchange desyncs
  otherwise. Gate rooms on `br-version.json` (POK-244).
- **Headless drivers, not hand play.** `tools/br/drive.sh <driver>` runs the ROM with no
  window from a savestate (see the Emerson harness it grew from). Every C change gets one.
  Hold a direction across frames for a step; hold A about 4 frames to advance text.
- **Kanto's rules are the spec.** `docs/DESIGN.md` §10 lists them; the Kanto repo is at
  `C:\Users\cam95\Documents\Github\gen1recomp-multiplayer\mods\battle_royale` with a
  1131-line README. When a ticket cites `lib/<file>.lua`, read that file before designing.

## How you talk

The user is often on a phone. Lead with state (done / running / needs you), one line per
finding, `file:line` and numbers over adjectives, no preamble and no closing summary.
