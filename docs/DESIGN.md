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
  block per `BR_MSG_*`; the ids and reassembly caps are generated from
  `tools/br/wire-table.txt`, whose hash is the last row of the append-only
  `tools/br/wire-protocols.txt`, under `BR_PROTOCOL`; `docs/WIRE.md`
  has the table and the framing. Every struct
  field the page or a driver reads by offset is pinned with `BR_OFFSET` where it is
  declared, or in `src/br/br_pins.c` for one of pret's structs, so moving one fails the
  build.
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
the match proper and from a ghost on its own map; one that lands in a menu waits for it
to settle, and a battle drops it. Before any engage's fight starts, player or bot, both
sides settle: the challenger freezes from its challenge on, the challenged freezes when it
lands, and each waits (up to two seconds) for the other's ghost to play out the steps the
wire already gave it, so both screens show the same two trainers when the fight opens. A
watchdog closes a link that never hears from the other side, and an `out` for the peer
wins an undecided fight.

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
then the next screen. One at a time, and nothing else starts under one: no challenge goes
out, and one that comes in waits as it would in a menu.

## 6. Overworld

- **Ghosts** (`br_ghosts.h`) are every other seat, drawn as `ObjectEvent`s spawned with
  `SpawnSpecialObjectEventParameterized` under local ids `0xC8 + seat`, snapped by
  `place`, walked by `step`, turned by `face`. A seat on another map, or outside the box
  the engine keeps objects in, is a roster row with no object. The sixteen object slots
  are shared out every frame (`BrField_ShareObjects`): the map's own people keep the last
  three free ones, loot is owed two once every ghost in engage range has one, and the
  nearest ghosts get the rest, twelve at most.
  Ghosts are not solid (POK-310), and an `out` takes a seat off every map for good. Skins
  are player and NPC sprites.
- **Loot** (`br_loot.h`): a `spill` puts a fallen trainer's team down as balls and its
  bag as a bag, on the cells the sender chose, the same on every ROM; `pickup` takes a
  piece away everywhere. Local ids `0xC0..0xC7`, eight pieces on a map, spawned only in
  view and nearest first, like the ghosts. The page keeps
  what is inside a bag and `give`s it to whoever takes it. A beaten route trainer leaves
  every map (`npcout`).
- **The ring** (`br_ring.h`) lives in region-map space: `gRegionMapEntries` gives every
  map section a rectangle on the 28x15 Hoenn map, the analogue of Kanto's town-map grid.
  The host sends the centre and radius in sections (`ring`); a map is inside when its
  rectangle touches the circle. Outside, the weather is `WEATHER_FOG_HORIZONTAL` and the
  party bleeds a tenth of max HP every four seconds, in a wild or route fight too. A fight
  between contestants (a bot's, a link one, a replay of one) that starts outside is fought
  in the fog as well: the engine takes a tenth from each mon on the field at every turn's
  end, down to 1, so both ROMs and a spectator see the same HP (`BrRing_FogEndTurn`). The
  fog never clamps: the last phase is everywhere.
- **The drop** (`br_pick.h`): the fly map (`CB2_OpenFlyMap`) is the picker, every
  section selectable. The ROM does not know where a trainer can stand, so it sends
  `pick {seat, section}`, and the host deals a free cell back as `land`. With no answer
  the ROM drops at the spawn the `start` dealt it. The Safari opening keeps its Kanto
  shape because Hoenn has a Safari Zone too; its catch pool and item balls are dealt
  from the match seed on every ROM alike (`br_zone.h`).
- **HUD** (`br_hud.h`): the corner (trainers left and the clock; under them where the
  ring is closing, all ring phase long, or FOG EVERYWHERE on the last phase; and an eye
  while anyone watches), the ticker and the bottom box, as overworld windows on BG0.
  START's MAP says the same under the fog: `FOG: <place>`. A ring move is one ticker
  line, Kanto's -- `THE FOG SPREADS! ALL GREW STRONGER!`, or `THE FOG COVERS ALL OF
  HOENN!` on the last, none on the first -- and the box names the place but on the
  last. A line identical to the last one queued is dropped (POK-324).
- **A clear map** (`br_strip.h`, 2026-10-13): in a match the map's own people never
  spawn -- route trainers, gym trainers, townsfolk -- and neither do cut trees, smash rocks
  or Strength boulders. What stays: the eight leaders on their gyms, the CENTER nurse, the
  MART clerk, MR. BRINEY and the ferry attendants, item balls, berry trees, Pokemon and
  props. A ROM with no match running is pret's Hoenn.
- **No HMs** (`br_hm.h`): walk or ride into water and you are surfing, surf up a waterfall and you
  climb it, A on a dive spot and you go down. No Pokemon has to know the move, nothing
  asks first, and no field move plays its cut-in. The starting bag has no HMs, and the
  bots surf and cut as freely (`brain.ts` `canSurf`, `canCut`).
- **Items that do not stop you** (`br_items.h`): a vitamin off the ground is used there
  and then, on the whole party (that stat's EVs to the top); a sell item (NUGGET, PEARL,
  STARDUST, a shard) is its sell price; a status heal is a FULL RESTORE, and no shelf sells
  one; a ball off the ground is six (the MASTER BALL stays one); and a medicine used from
  the BAG treats the whole party, with no one to pick.
- **Visible encounters** (`br_patch.h`, 2026-10-13): a step in grass, a cave or water
  meets nothing. Each map with a wild table has a few darkened patches instead (one per
  16 cells a battle could start on, one to eight), dealt from the match seed off the
  map's shipped layout so every ROM finds the same cells. Stepping on one is a battle
  from that map's table, and its `pickup` (keys `0x2000..0x3FFF`) takes it off every
  map. Repels are money; Keen Eye and a repel's level skip nothing. A FISHING ROD and
  SWEET SCENT still find a mon anywhere: they never went through the step check.
- **Events** (`br_event.h`, `web/src/match/events.ts`, 2026-10-13): every other ring from
  the first shrink (phases 2, 4, 6 and 8) the host drops one in a section inside the
  ring, the last in the ring's own centre so the final ring closes on it. Seven pieces on
  the nearest free cells: a legendary (Regi, then Latias/Latios, then Kyogre/Groudon,
  then Rayquaza) and two rares at the phase's rung, three gold balls and a bag of
  supplies, as ordinary `spill`s under keys `0xB000 | n << 4 | i`. No claim and no
  completion: whoever gets there takes it. An `event` marks the section on every ROM's
  MAP with an item ball, gray once the legendary is taken; the ticker says where, and a
  late joiner gets the marks with the rest of the catch-up. The placed NPC is a trader on
  the cell past the pieces: A on him, pick any one of yours, and he swaps it for a rare
  the event did not drop, at your rung. Not a fainted one, and what it held goes back to
  your bag. He trades once, with whoever gets to him first, and then leaves every map:
  that trade's `pickup` of key `0xB000 | n << 4 | 15` uses him up for the room, and a
  late joiner's catch-up hands the event back without him. He keeps what he is given
  (not POK-294's ball at your feet, which would make the trade a free mon). Nothing the
  match puts down is solid, him included. Bots go for events like players: their pieces
  are loot, an event on another map is headed for, and a bot at the trader hands him its
  most hurt mon. Two trades at the same moment can both land; the room keeps one trader
  gone either way.
- **Story events** (`web/src/match/story.ts`, Cam, 2026-10-13: "They should all result in
  a legendary Pokemon I think, or at least a rare item"): an event set where Emerald set
  that beat. When a ring phase drops an event, the host tells a story this match has not
  had whose section this ring reaches, and drops today's cluster only when none is. A story
  gives its own reward (the fossils at the top of MIRAGE TOWER, Steven's BELDUM, the TM24
  in NEW MAUVILLE, SHOAL CAVE's FOCUS BAND and SHELL BELL) with the supplies bag and the
  trader beside it, and no rares or gold balls unless its row says so. It is event loot on
  the story's own map, so the MAP mark, the catch-up and the bots work as they do for any
  event. The places are made reachable: the bag has the GO-GOGGLES for Route 111's desert,
  MIRAGE TOWER stands every visit and its own fossils are hidden (taking one brings the
  tower down), and SHOAL CAVE is at low tide all match (`br_story.h`). The ring centres
  anywhere the drop can (landing.json, whose flood surfs since the HMs went), so the
  east's stories come up as the west's do. The three REGIs sit in their chambers, each door
  opened its own way with no HM to teach: DESERT RUINS on A at the wall, ANCIENT TOMB on A with a
  Flying-type in the party (not "knows FLY": with no HMs almost nobody could), ISLAND CAVE
  by itself a phase after its event dropped, or sooner by Emerald's own braille lap of the
  room, which a player who knows it may walk and a bot does not (the native REGIs are
  gone). Some rewards are people (`br_story.c`, sPeople): STEVEN in GRANITE
  CAVE with TM47, and CAPTAIN STERN at Slateport's harbour, who gives a DEEP SEA TOOTH or
  SCALE only for the SCANNER from the ABANDONED SHIP's office. The LAVARIDGE egg woman has
  no flag to stand her down, so her WYNAUT is a ball at her feet. Bots walk a grid that
  knows no door or terms, so `storySealed` keeps a chamber from a bot that could not open
  it and STERN's thanks from one without the SCANNER. The gates are the teams' bosses
  where Emerald stood them, each holding what his team was after: MAXIE with GROUDON
  and a MASTER BALL in his hideout, ARCHIE with KYOGRE on Route 128, SHELLY with the
  WEATHER INSTITUTE's CASTFORM, MATT with the AQUA HIDEOUT's MASTER BALL, MAXIE with the
  METEORITE on MT. CHIMNEY and the SPACE CENTER's SUN STONE (those two with two rares).
  A at him is his own trainer fight, one page of speech; the win hands over what he
  held, and the rest of his story waits until then ("MAXIE GUARDS IT"). Each ROM fights
  him for itself and whoever wins first takes it from the room; his win drops no team, and
  a win that comes too late says SOMEBODY GOT THERE FIRST. At MT. CHIMNEY and the SPACE
  CENTER he holds the stone and the two rares open when he falls. A bot that steps up to
  him fights him through `duel()` with his own team at the rung: a loss puts it out, as it
  does a player, and a win leaves it hurt. A story with no legendary in it is "A RARE
  FIND AT" on the ticker, not "A LEGENDARY". The islands are a boat ride: SOUTHERN ISLAND
  (LATIAS or LATIOS), BIRTH ISLAND (DEOXYS), FARAWAY ISLAND (MEW) and NAVEL ROCK (HO-OH at
  the peak, LUGIA at the foot). The bag has all four tickets, already shown, and Lilycove's
  ferry offers an island only while a live event there still has its legendary
  (`br_story.c`, Ferry, which sets the ENABLE_SHIP flag the menu asks). Their section on
  the page is Lilycove's, the dock, and the ring and the MAP mark measure them there too
  (`BrStory_Dock`), so an island comes up when the ring reaches Lilycove. The native
  legendaries are gone for the match. Bots never take the ferry. The final rings are
  SKY PILLAR (RAYQUAZA where it sleeps; the door is open and its own RAYQUAZA gone) and
  SOOTOPOLIS (KYOGRE or GROUDON at the CAVE OF ORIGIN, and the city in rain or drought
  while it is live, the match seed's pick, so a fight there starts in it, a link battle on
  both GBAs alike). A match in four (`FINAL_CHANCE`) centres its ring on one and holds
  that story for the last event; their final rings take in Route 131 and Route 126, sea
  a bot can fight in.
  A final story in reach on an earlier event is the one told. Bots climb SKY PILLAR (the
  world has the clean floors the match plays, and 4F's cracks drop to 3F, the only way to
  its west stairs) and leave SOOTOPOLIS alone: its way in is a dive.
- **Gift-givers** (Cam, 2026-10-13): at the buzzer the host stands one person in every
  town and city (`match/gifts.ts`), holding one held item (LEFTOVERS, CHOICE BAND, QUICK
  CLAW and the like). On the wire he is a `spill` of a one-item bag under key `0xC000 | i`,
  which br_loot.c draws as a person; A on him says "A GIFT: ...", and his `pickup` takes
  him off every map, so the first trainer there has it. Bots take one like any piece.
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
beside START. PLAY AGAIN brings the room screen back.

**Everything else outside the game is drawn too.** A name, a room code and a passcode are
typed on a drawn entry (`web/src/ui/entry.ts`, Kanto's CodeEntry: the D-pad scrubs a
letter, a key grid takes a tap, the keyboard types); MY CAREER, FORGET ROM and PLAY
ANYWAY ask in the frame, and the page calls no `prompt()`, `confirm()` or `alert()`
(`ui.test.ts` fails on one). A door that will not open is its own screen, in Kanto's words
(THAT GAME STARTED, THAT GAME IS FULL, HOST REMOVED YOU), with what the relay said and
BACK TO LOBBY -- and it is the room's last word: the end grace, a count to a start and a
`start` held for the way back all stop there (`match/room.ts`, `DeadEnd`). The import and
patch screens are drawn in the same frame and end on the version line; the page has no
HTML header. The results come at the `win` for everybody but the champion, whose come
after their own Hall of Fame (`web/src/ui/results.ts`, `ParadeHold`: BR_PHASE_DONE, or a
grace before the parade's deadline if it never gets there). In a match, the room's line,
the strip, who is still in, WATCH, LEAVE and the settings are the in-match sheet
(`sheetScreen`): over the running game behind the menu button on a phone, and docked
beside the game on a desktop -- in view all match, taking no keys, 480 px wide where the
window can spare it (960×640 and up) and the picture's own 240 below that. A cut between
the stage and the game fades from black in Emerald's four steps.

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

**The nearest band of that is the ROM's own** (POK-319, POK-329). The core renders the
ring of tiles Emerald keeps around the camera, past the LCD, from the same registers:
real BG and OBJ state -- tile animation, people, the fog's own blend. POK-319 drew pret's
32×32-tile ring once, 256×256 with the LCD at (0, 40). Since POK-329 the ring is 32×64
tiles on 256×512 BGs, pos.y-4..pos.y+27, and the ROM declares the picture it feeds in
`gBrFieldView`: 256×496, the LCD at row 104 -- the whole ring but the one spare row a
step needs, the player's rows -11..+19, which covers a portrait phone above and below
the pad (the page reads it out of the patched image and asks the core for the part of it
the match's layout shows, measured before each boot: all of it on a portrait phone, and
elsewhere the rows the layout shows; a ROM without it gets the legacy band). The zoom is
a phone's on every screen (Cam, 2026-10-14, `fieldScale`): 240 game pixels across a
portrait phone's glass, the same on its side, and the widest phone's (430 / 240, rounded
up to whole device pixels) on anything bigger, which shows more map, not a bigger
picture. So a desktop or a phone on its side shows far more beside the LCD than above
and below it, and there the same VRAM is **the wide ring** (`gBrFieldViewWide`): 512×256
BGs, 64×32 tiles, pos.x-8..pos.x+23 by pret's 16 rows, and a 496×240 picture, 128
columns each side and 40 rows. The page asks for whichever ring's picture covers more of
its layout (`askBand`), and writing a left into `gBrFieldShown` is what asks the ROM for
the wide one (latched as the field's BGs are set up, so once a boot). The side table's
bit 3 says a sprite's 9-bit x reads 512 left, so the core draws a person in the left band
where they are, and the core draws a 256-column BG (BG0, the HUD) only in its own 256
columns. Past that picture the composite carries on. The OAM's 8-bit y has one reading
only in the 256 rows around the LCD (the sprite window, 40 above and 56 below), so the
ROM keeps a side table of each OAM entry's high bits (`gBrOamHi`, latched in `LoadOam`
with the OAM it describes) and the core reads it (`brSetOamTable`) to draw every sprite once, at its
true rows, anywhere in the band. With that the page tells the ROM the rows it shows
(`gBrFieldShown`) and the ROM's world grows to them: a sprite is hidden only past those
rows, and the object box (spawn, cull, ghosts, loot) gains a row for every 16 shown past
the window -- on a portrait phone the player's rows -11..+20, the people and the grass out
there the ROM's own. The grown rows are spare room: pret's own box spawns first, BR's
ghosts, loot and traders come next, and a person in the grown rows gets a slot only while
four are left past the headroom (`BrField_SpawnGrown`). Only field sprites are marked;
battles and menus keep the hardware's reading. A core without the table, or a layout that shows no more than the
window, leaves gBrFieldShown at 0 and the world at pret's. The ROM's part
(`src/br/br_field.c`): draw the part of the ring pret's slice redraws leave stale after a
step, with a row or column that would land in a slot still on screen drawn when the step
completes (THE RING in `include/br/br_field.h`), say which rows are still to draw
(`gBrRingStale`), and hide an object by its sprite's TOP, so every visible sprite's OAM y
is unambiguous. The page cuts the band where it is not the map: past the current map's
edge, past the ring's 16 columns mid-step, and over the rows still to draw; the
composite fills everything the band does not cover, and an overlay above the picture
draws the people the ROM hid. Off the field the band is clipped away and the composite
shows through. The numbers are `include/br/br_field.h`'s, pinned by
`web/src/field.test.ts`; `web/e2e/picture.spec.ts` holds the core's picture to the map's
still walking every way (`web/scripts/seam-probe.mjs --check` does it by hand); the
harness's libmgba is unpatched and photographs 240×160 only.

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
balls are gifts. A ball that changes hands is a trade and triggers trade evolutions; a
LINK CABLE from the bag does the same for a mon you kept.
Beaten sprites vanish, balls remain. Gyms are one-shot bosses, first-to-beat closes them.
Bots use their own bag. Two bots fighting is a real battle. Quick play has no host. Solo
play opens no socket. Backfill is wrong for a battle royale. One ticker line when the ring
moves, and a ticker line is something you act on or would ask about -- outs (the ones that
land together as one line), a gym, the win; a tally goes to the log (POK-324).

Changed: the lobby is the page's, not the ROM's -- but drawn in Emerald's font and frames
since POK-320, with Kanto's room of seats. Fast-forward stays available to the **proxy
duel instance only**. A bot's bag starts empty and holds only what it picks up: nothing
dealt at the drop, no potion when the ring moves (POK-322; Kanto deals BOT_LOOT).

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
