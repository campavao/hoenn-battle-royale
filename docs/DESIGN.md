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
`struct BrMailbox gBrMailbox` in EWRAM (`include/br/br_mailbox.h`, 0x2028 bytes).

```
magic 'BR', protocol, patch, size   the page refuses a mailbox it does not recognise
outHead/outTail, inHead/inTail      two rings, one per direction; the producer writes
                                    the slot, then bumps head
frame, dropped                      BrNet_Tick count, out pushes lost to a full ring
out[64][64], in[64][64]             slots: [type][len][payload <= 62]
boot                                16 bytes the page writes before the title screen
```

That is all of it. Everything else the page reads is a global of its own (`gBrSeats`,
`gBrMatch`, `gBrRing`, `gBrHud`, `gBrPick`, `gBrZone`, ...), found by name.

- **ROM side**: no task. `AgbMain` calls `BrInit` once at boot and `BrFrame` every frame
  after `ReadKeys`, in every state -- title, overworld, battle, menus (`src/br/br_main.c`).
  `BrNet_Tick` drains `in` into the handler each module registered with `BrNet_On`, then
  each module ticks. `BrWire_Send`/`BrWire_SendLarge` push to `out`; a message that spans
  slots goes in whole or not at all.
- **Page side**: after every frame `web/src/net/bridge.ts` reads `out`, decodes it
  (`slots.ts`), and forwards it as JSON (`wire.ts`) through the relay; relay traffic for
  the ROM is packed and pushed into `in`.
- **Layouts**: `include/br/br_wire.h` has every crossing message's bytes, one comment
  block per `BR_MSG_*`; `docs/WIRE.md` has the table and the framing. Every struct
  field the page or a driver reads by offset is pinned with `BR_OFFSET` where it is
  declared, so moving one fails the build.
- **Addresses** come from the link map. `tools/br/symbols.py` writes `br-symbols.json`
  next to the patch and the page loads both. Never hard-code an address: the modern and
  agbcc builds put things in different places.

## 5. Battles

**PvP is Emerald's own link battle.** `link.c` already switches every entry point on
`gWirelessCommType` between the cable and the RFU wireless adapter. We add a third
transport, `br_netlink.c`, that satisfies the same block interface (`SendBlock`,
`GetBlockReceivedStatus`, `IsLinkTaskFinished`, `GetMultiplayerId`,
`GetLinkPlayerCount`, `gBlockRecvBuffer`) with `bt` messages. Battle code is untouched and
runs `BATTLE_TYPE_LINK` exactly as a cable battle would; internet latency is fine because
link battles wait for the other side's block per turn. The fight starts from the eyeline
(`br_engage.c`): the page relays a `challenge` to both ROMs, and a ROM accepts one only in
the match proper and from a ghost on its own map. A watchdog closes a link that never
hears from the other side, and an `out` for the peer wins an undecided fight.

**Spectating is a recorded battle, streamed live.** The challenger's ROM sees both
sides, so it publishes the fight: `bstart` (seed, both parties, names), then `turn` (the
action bytes, once every battler has chosen) and `shot` (the clock). A spectator's ROM
replays it as `BATTLE_TYPE_RECORDED_LINK` a turn behind (`br_spectate.c`, the BR block in
`recorded_battle.c`). This is Kanto's `mirror.lua` with the engine doing the replay.

**Bot vs player is a trainer battle.** A bot has no ROM, so the host stages its team:
`trainer` builds the card straight into `gEnemyParty` (`br_bot.c`; HP is a share of the
real mon, moves come from the learnset unless the row is a ROM's own report), and the
`challenge` that follows starts an ordinary `BATTLE_TYPE_TRAINER` fight. The ROM that
fought reports `result`, `spent` and the bot's remaining `party` back.

**Bot vs bot is a proxy game**, as in Kanto. The host's tab runs a second, hidden mGBA
instance with the same patched ROM, hands it both teams in a `duel`, and both sides are
played by the AI. It enters the battle the same way a bot fight does -- a boot mode that
went straight into the duel stalled on the intro (`br_duel.h`) -- and answers with a
`dresult`; its `bstart`/`turn` let the room watch.

Every way off the field -- a fight, a replay, the drop's picker, the MAP row -- goes
through `BrField_Leave` (`br_field.h`): fade, wait, hand the overworld's windows back,
then the next screen. One at a time.

## 6. Overworld

- **Ghosts** (`br_ghosts.h`) are every other seat, drawn as `ObjectEvent`s spawned with
  `SpawnSpecialObjectEventParameterized` under local ids `0xC8 + seat`, snapped by
  `place`, walked by `step`, turned by `face`. A seat on another map is a roster row with
  no object. At most `BR_MAX_GHOSTS` (12) are spawned at once, in seat order. They are
  not solid (POK-310), and an `out` takes a seat off every map for good. Skins are
  player and NPC sprites.
- **Loot** (`br_loot.h`): a `spill` puts a fallen trainer's team down as balls and its
  bag as a bag, on the cells the sender chose, the same on every ROM; `pickup` takes a
  piece away everywhere. Local ids `0xC0..0xC7`, eight pieces on a map. The page keeps
  what is inside a bag and `give`s it to whoever takes it. A beaten route trainer leaves
  every map (`npcout`).
- **The ring** (`br_ring.h`) lives in region-map space: `gRegionMapEntries` gives every
  map section a rectangle on the 28x15 Hoenn map, the analogue of Kanto's town-map grid.
  The host sends the centre and radius in sections (`ring`); a map is inside when its
  rectangle touches the circle. Outside, the weather is `WEATHER_FOG_HORIZONTAL` and the
  party bleeds a tenth of max HP every four seconds, in a wild or route fight too. The
  fog never clamps: the last phase is everywhere.
- **The drop** (`br_pick.h`): the fly map (`CB2_OpenFlyMap`) is the picker, every
  section selectable. The ROM does not know where a trainer can stand, so it sends
  `pick {seat, section}`, and the host deals a free cell back as `land`. With no answer
  the ROM drops at the spawn the `start` dealt it. The Safari opening keeps its Kanto
  shape because Hoenn has a Safari Zone too; its catch pool and item balls are dealt
  from the match seed on every ROM alike (`br_zone.h`).
- **HUD** (`br_hud.h`): the corner (trainers left over the clock, and an eye while
  anyone watches), the ticker and the bottom box, as overworld windows on BG0.
- **Rules**: one clock (`br_levels.h`: the ring phase is the level rung, no EXP), the
  catch with a full party (`br_catch.h`), the MOVES row (`br_moves.h`), gym leaders as
  one-shot bosses (`br_gym.h`), the shot clock and RUN (`br_battle.h`).
- **Bots move in JS**, not the ROM, on walkability grids exported at build time, paced in
  real seconds, exactly as `bots.lua` did on `data/generated/`. The ROM only sees them
  as ghosts. This keeps the patch small and the bot brain testable with vitest.

## 7. Web shell

Vite + TypeScript, no framework needed; a small state machine:

`import ROM → verify → patch → lobby (LOBBIES / QUICK PLAY / SOLO / HOST / JOIN BY CODE / daily)
→ room (roster, options, pace, passcode) → match (emulator + HUD overlay + touch pad)
→ results (Hall of Fame, record card, PLAY AGAIN)`.

The lobby moves out of the game and onto the page. Kanto drew its lobby as a room because
it had no other surface; the page is a better one, and it stops the ROM from needing any
menu we would otherwise have to build in Gen 3 windows.

**It is drawn in Emerald's own look** (POK-320, Cam: "the UI should look almost native to
Pokémon Emerald"). `tools/br/export-ui.py` writes the ROM's `latin_normal` font (a 16-cell
mask indexed by charmap byte, with `gFontNormalLatinGlyphWidths`), its standard window
frame, its message box, the text palettes and the skin ladder's gfx ids to
`web/public/ui/` + `web/src/data/ui.json`; `web/src/ui/emerald.ts` draws them on a canvas
at the picture's scale (whole pixels on a desktop, the phone's own fit below that). Every
screen outside the game -- the main menu, LOBBIES, the trainer's rows, the wardrobe with
every sprite on the ladder, and the room with Kanto's 2×4 of seats -- is a `DrawnScreen`
on one `Stage` (`web/src/ui/stage.ts`, `screens.ts`). Under the canvas the stage keeps a
mirror in real DOM: an invisible `<button>` over every pressable thing and a `<div>` over
every line, with the ids the page always had (`#room-code`, `#room-roster li`,
`#room-start`...), so a tap, a screen reader and a Playwright locator all find what the
eye does. The D-pad moves Emerald's cursor, A presses, B backs out; the game hears no
key while a screen is up.

**A hosted room waits for its host.** The room screen covers the game until the match
starts (the ROM idles in Littleroot under it); only quick play and the daily start
themselves, with a STARTS IN count on the screen. Everything the host used to have to set
"ahead of time" -- MAX, FILL, the door, TEXT, ANIM, FOG, SAFARI -- is on the room screen
beside START. PLAY AGAIN brings the room screen back. The drawer keeps only what belongs
to a running match: the strip, who is still in, WATCH, the results.

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

Changed: the lobby is the page's, not the ROM's -- but drawn in Emerald's font and frames
since POK-320, with Kanto's room of seats. Fast-forward stays available to the **proxy
duel instance only**.

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
