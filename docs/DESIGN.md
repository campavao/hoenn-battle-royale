# Hoenn Battle Royale — design

Last trainer standing, in Hoenn, in the browser. The Gen 3 successor to
[Kanto Battle Royale](https://github.com/campavao/kanto-battle-royale).

Status: design, 2026-09-15. Tracked in Linear project **Hoenn Battle Royale** (team POK).

## 1. The shape of it

Kanto BR was a Lua mod on top of gen1recomp, a reimplemented engine with hooks. There is
no such engine for Gen 3. What exists is `pret/pokeemerald`, a byte-matching C
decompilation that builds the real Emerald ROM. So the game logic lives in the ROM
itself, and the ROM runs inside a GBA emulator compiled to WebAssembly.

Four pieces:

| Piece | Language | Where it runs | Kanto equivalent |
|---|---|---|---|
| **ROM patch** — a fork of pokeemerald with a `src/br/` tree | C | inside mGBA | `mods/battle_royale/main.lua` + the in-engine half of `lib/` |
| **Web shell** — ROM import, patching, emulator, lobby, match director, bots | TypeScript (Vite) | the browser, Vercel | `lib/relay.lua`, `lobby/browse/entry/menu`, `bots.lua`, `spawn.lua`, `fog.lua` clock |
| **Relay** — dumb room forwarder | Node | Railway | `relay/server.js`, ported near-verbatim to WebSocket |
| **Tools** — headless harness, data exporters, patch builder | C / Node / Python | dev + CI | `tests/drivers/`, `data/generated/` |

The rule from Kanto stands: **the relay is a dumb forwarder, all match rules live in the
host client.** Here the host client is one player's browser tab: its JS is the match
director (clock, spawn dealing, bot simulation) and its ROM is the host's own view.

## 2. Above board: the patch, never the ROM

We ship a **BPS patch** and a web page. The player imports their own
`Pokemon Emerald (U)` ROM (sha1 `f3ae088181bf583e55daf962a92bb46f4f1d07b7`, the one
pokeemerald reproduces). The page verifies the hash, applies the patch in JS
(RomPatcher.js is MIT and handles BPS), stores the *original* ROM in IndexedDB so the
import happens once per device, and boots the patched image in memory. Nothing
Nintendo-owned is ever served or uploaded.

The release build is the **agbcc** build, not `make modern`: agbcc reproduces the retail
ROM byte for byte, so the BPS diff against it is only our changes. A modern-GCC build
re-emits every function of the game and the patch would carry a full recompilation of
Nintendo's code. Modern builds stay allowed for local dev speed.

## 3. Runtime: mGBA in WebAssembly

mGBA's C core exposes everything we need: `core->runFrame`, `core->setKeys`,
`core->busRead8/busWrite8`, `core->rawRead8`, save states, and the GBA struct's
`memory.wram` pointer (EWRAM, 256 KiB). thenick775's `feature/wasm` branch
(`@thenick775/mgba-wasm`, powers gbajs3, proven on phones) already has the emscripten
platform with `loadGame`, `saveState/loadState`, `buttonPress/Unpress`, screenshots,
volume, fast-forward. It exports **no memory access**, so we fork it and add:

- `brWramPtr()` — the EWRAM base as a wasm heap offset, so JS reads the mailbox through
  a `Uint8Array` view with zero copies.
- `brRunFrame()` / a frame hook, so the shell can drain the mailbox once per emulated
  frame instead of on a timer.
- `brSetViewport(left, top, right, bottom)` (POK-319) — the software renderer draws a
  band of pixels past the LCD on each side from the same BG/OBJ registers, at VBlank,
  into a texture the LCD sits inside; the page asks for it before `loadGame`. Sprite rows
  are taken modulo 256 like the hardware's 8-bit OAM y, and a window edge on the LCD's
  border reaches across the band (Emerald's overworld is a full-screen WIN0). All of it
  is `tools/br/mgba-wasm/hbr-exports.patch`, applied to the pinned commit by CI.

It uses pthreads, which means `SharedArrayBuffer`, which means `Cross-Origin-Opener-Policy`
/ `Cross-Origin-Embedder-Policy` headers on the host. Vercel sets those from
`vercel.json`. iOS Safari honours them. The fallback if a device refuses is a
single-threaded build; the spike ticket measures both on a real iPhone.

Local dev already has the pieces: `mgba-src/` is an 0.10.5 checkout with a static
`libmgba.a`, and the Emerson project's `tools/emutest/harness.c` drives a ROM headlessly
(load, savestate, `setKeys`, `runFrame`, PNG frames). That harness becomes this project's
**driver** the way `tools/drive.sh` was Kanto's.

## 4. The mailbox: how the ROM talks to the world

The GBA has no network. The ROM cannot call out. So the bridge is memory:

```
EWRAM_DATA struct BrMailbox {
    u16 magic;            // 'BR'
    u16 protocol;         // wire protocol version
    u16 outHead, outTail; // ROM -> JS ring, ROM writes head
    u16 inHead,  inTail;  // JS -> ROM ring, JS writes head
    u8  out[BR_RING_SLOTS][BR_SLOT_BYTES];
    u8  in [BR_RING_SLOTS][BR_SLOT_BYTES];
    struct BrRoster roster;   // 32 seats: id, name, skin, map, x, y, alive, ...
    struct BrMatch  match;    // phase, ring, clock, seed, level rung, options
} gBrMailbox;
```

- **ROM side**: one task, `Task_BrNet`, runs every frame from the overworld and battle
  main loops. It drains `in` (apply ghost steps, challenge, battle blocks, clock, ring)
  and fills `out` (own step/face/map, engage, battle blocks, catch, faint, pickup).
- **JS side**: after every frame the shell reads `out` through the heap view, encodes to
  the JSON wire the relay forwards, and writes relay traffic into `in`.
- **Addresses** come from the link map. The build emits `br-symbols.json`
  (`gBrMailbox`, `gSaveBlock1Ptr`, `gPlayerParty`, ...) next to the patch; the shell
  loads both. Never hard-code an address.
- Save states include the mailbox. Fine: a state restore re-syncs from the roster.

This is the pattern Kanto used for ghosts (`place/step/face` per tick), so `lib/wire.lua`
ports to a shared TypeScript codec on the JS side and a tiny binary codec in C.

## 5. Battles

**PvP is Emerald's own link battle.** `link.c` already switches every entry point on
`gWirelessCommType` between the cable and the RFU wireless adapter. We add a third
transport, `br_netlink.c`, that satisfies the same block interface (`SendBlock`,
`GetBlockReceivedStatus`, `IsLinkTaskFinished`, `GetMultiplayerId`,
`GetLinkPlayerCount`, `gBlockRecvBuffer`) over the mailbox. Battle code is untouched and
runs `BATTLE_TYPE_LINK` exactly as a cable battle would; internet latency is fine because
link battles wait for the other side's block per turn. This replaces Kanto's
`lockstep.lua`/`channel.lua`.

**Spectating is a recorded battle, streamed live.** Emerald has `BATTLE_TYPE_RECORDED`
and `recorded_battle.c`: given the seed and each battler's actions it replays a battle
deterministically. The two fighters' action stream goes to the relay; a spectator's ROM
plays it as a recorded battle a turn behind. This is Kanto's `mirror.lua` with the
engine doing the replay.

**Bot vs player is a trainer battle** (`BATTLE_TYPE_TRAINER`) against a RAM-backed
trainer: `CreateNPCTrainerParty` gets a BR branch that builds the party from the roster
seat instead of `gTrainers`.

**Bot vs bot is a proxy game**, as in Kanto. The host's tab runs a second, hidden mGBA
instance with the same patched ROM booted straight into a duel (`BR_BOOT_DUEL` in the
mailbox), both sides on the opponent controller, fast-forwarded. It reports the outcome,
the surviving parties and the action stream, which spectators can watch as a recorded
battle.

## 6. Overworld

- **Ghosts** are `ObjectEvent`s spawned with `SpawnSpecialObjectEventParameterized`
  using player sprites, stepped with held movement actions from `step` messages and
  snapped on `place`. `OBJECT_EVENTS_COUNT` is 16, so a map shows the nearest ~12
  ghosts and the rest wait. Skins are the Brendan/May variants and NPC sprites.
- **The ring** lives in region-map space: `gRegionMapEntries` gives every map section a
  rectangle on the 28x15 Hoenn map, the analogue of Kanto's town-map grid. Fog phases
  are radii in that grid; outside the ring the ROM runs `WEATHER_FOG_HORIZONTAL` and a
  damage task (1/10 max HP every 4 s). The fog never clamps.
- **Drop** uses the fly-map screen (`CB2_OpenFlyMap`) as the picker and a walkable-cell
  table (built at compile time from map layouts, `MapGridGetCollisionAt` semantics) to
  land on a random cell. Safari opening keeps its Kanto shape because Hoenn has a Safari
  Zone too (Route 121 entrance, 500 steps, Safari Balls).
- **HUD**: the corner counter, ticker, wound bar and bottom box are overworld windows on
  BG0 via `AddWindow`/`AddTextPrinterParameterized`.
- **Bots move in JS**, not the ROM, on walkability grids exported at build time, paced in
  real seconds, exactly as `bots.lua` did on `data/generated/`. The ROM only sees them
  as ghosts. This keeps the patch small and the bot brain testable with vitest.

## 7. Web shell

Vite + TypeScript, no framework needed; a small state machine:

`import ROM → verify → patch → lobby (LOBBIES / QUICK PLAY / SOLO / HOST / JOIN BY CODE / daily)
→ room (roster, options, pace, passcode) → match (emulator + HUD overlay + touch pad)
→ results (Hall of Fame, record card, PLAY AGAIN)`.

The lobby moves out of the game and into HTML. Kanto drew its lobby as a room because it
had no other surface; a phone browser has a better one, and it stops the ROM from needing
any menu we would otherwise have to build in Gen 3 windows.

Career (name, skin, wins), stats opt-out and pace live in IndexedDB. Touch controls are
the shell's, with the emulator's `buttonPress` API. PWA manifest + service worker so a
home-screen install works offline after the first patch.

**The picture is 240×160 and the game is not** (POK-317). The GBA draws its window and
nothing past it, so the shell draws the rest: a still of every outdoor map
(`tools/br/render-maps.py` → `web/public/field-maps/`) scrolled in lockstep with the ROM's
camera (`gSaveBlock1Ptr->pos`, `gFieldCamera.x/y`, one frame behind the struct, offsets
measured by `tools/br/drivers/field-scroll*.txt`) on a canvas under the picture, at the
picture's own scale, with the palette fade mirrored from `gPaletteFade`. In a battle or a
menu the picture shows that and the field stays around it. Nothing is zoomed or
stretched. A tap out there walks there like a tap on the picture. `web/src/field.ts`.

**The nearest band of that is the ROM's own** (POK-319). The core renders a 256×256
picture with the LCD at (0, 40) inside it: the ring of tiles Emerald already keeps
around the camera (32×32 tiles, the LCD at rows 40..199 with the standing vertical pan),
so the 40 rows above, 56 below and 16 columns right of the window are real BG and OBJ
state -- tile animation, people, the fog's own blend. The ROM's part is small
(`src/br/br_field.c`): draw the ring's sixteenth row and column after a step (the slice
redraws leave them stale), and hide an object by its sprite's TOP, not its bottom, so
every visible sprite's OAM y is unambiguous. The composite fills everything past the
band; an overlay above the picture draws the people the ROM hid for being past it. Off
the field the band is clipped away and the composite shows through. The numbers are
`include/br/br_field.h`'s, pinned by `web/src/field.test.ts`; the harness's libmgba is
unpatched and photographs 240×160 only.

## 8. Relay

`relay/server.js` ports with its message shapes intact (`host_room`, `join_room`,
`quick_join`, `daily_join`, `set_pass`, `to`, `all`, `roster`, `rooms`, `recv`, ...),
swapping newline-JSON-over-TCP for WebSocket frames because browsers cannot open TCP.
Flood buckets, idle sweep, code alphabet, room caps and the daily row are unchanged.
Separate Railway service from the Kanto relay.

**Observability is outside-in, as Kanto's.** The relay has no HTTP surface, and adding
one would mean a deploy, which kills every match in progress. It writes one log line per
thing that happens and a heartbeat every five minutes; `tools/br/play-log.mjs` reads them
off Railway's log API every fifteen minutes (`.github/workflows/play-log.yml`), keeps every
parsed line for good, and commits `play.json` / `stats.json` to the orphan `play-log`
branch. `/play.html` on the site reads that branch raw, so the numbers move without a
release. Names are hashed to four characters before they are written anywhere; the e2e
suite connects as `E2E` and is left out.

## 9. Testing

| Layer | How |
|---|---|
| Bot brain, wire codec, clock, spawn dealing | vitest on the TypeScript |
| Relay | `node --test`, ported from Kanto |
| ROM logic | the C harness: load ROM + savestate, script inputs, read the mailbox and RAM, dump frames. Every fix that touches C gets a driver, as in Kanto |
| End to end | Playwright against the Vite dev server with the wasm core, two tabs, one relay |
| CI | GitHub Actions: build agbcc ROM, diff to BPS, sha1 the baseline, run all suites, deploy web to Vercel and relay to Railway on tag |

## 10. Decisions carried over from Kanto (kept unless noted)

One clock drives ring, level rung, rod and shop tier. The rung you start a fight at is the
rung you fight at. Always SET style. No nickname prompt. 30 s shot clock in every battle.
RUN is hard and escalating. A full party means releasing one, never a PC. Game speed
pinned. LINK/SAVE/OPTION gone from START. The Centre closes when fog arrives, and the
nurse asks one question. A menu is not a hiding place. Every PC is out of order. Loot
balls are gifts. A ball that changes hands is a trade and triggers trade evolutions.
Beaten sprites vanish, balls remain. Gyms are one-shot bosses, first-to-beat closes them.
Bots use their own bag. Two bots fighting is a real battle. Quick play has no host. Solo
play opens no socket. Backfill is wrong for a battle royale.

Changed: the lobby is HTML, not a drawn room. Fast-forward stays available to the
**proxy duel instance only**.

## 11. Decisions (2026-09-15) and what is still open

Decided by Cam:
1. **Base: vanilla `pret/pokeemerald`.** Smaller patch, retail feel, the recorded-battle and
   link paths are the stock ones. Expansion QoL can be cherry-picked later.
2. **Repo layout: one repo**, `campavao/hoenn-battle-royale`, forked from `pret/pokeemerald`
   so upstream merges stay a `git merge`, with `web/`, `relay/`, `tools/br/`, `docs/` at the
   root and our C under `src/br/`.
3. **Lobby in HTML**, not in-game.
4. **Relay: a new service in the existing Railway project**; the Kanto relay is untouched.

5. **Emulator base: thenick775's wasm fork plus our exports** (`tools/br/mgba-wasm/hbr-exports.patch`).
   Measured on Cam's iPhone in Safari, 2026-09-15: 59.8 to 60 fps, p5 59.7, sound fine,
   phone stays cool. Desktop Chrome 60. The single-threaded shim is not needed.
   The wrapper is `web/src/emu/index.ts`.
