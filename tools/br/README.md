# tools/br

## drive.sh — headless drivers

    tools/br/drive.sh <driver> [rom] [state.ss1]

Runs `drivers/<driver>.txt` against the built ROM inside libmgba with no window and no
audio, writes frames to `harness/frames/<driver>/`, exits 0 only if every `expect` held.
Works from Git Bash (it re-execs itself in the MSYS2 UCRT64 shell). Needs the static
libmgba at `C:\Users\cam95\Documents\Github\mgba-src\build\libmgba.a` (override with
`MGBA_SRC`). With no ROM named it drives the newer of `pokeemerald.gba` and
`pokeemerald_modern.gba`, and says which. The symbol table comes from that ROM's own
`.map` on every run (into the frames directory); `BR_SYMBOLS=<file>` overrides it for a
ROM with no map beside it.

`tools/br/drive-all.sh [rom]` runs every driver the way CI does, and fails any driver
that asserts nothing (the harness alone passes a driver with no `expect`). Each driver
is checked one of three ways:

- `expect` lines, which the harness asserts;
- a `# checked-by: <script>` line: the run's output is piped into that python script
  (repo-relative), which must exit 0 (`objects-band` -> `tools/br/objects-band.py`);
- a `# capture-only: <why>` line, for drivers that only write frames or dumps for a
  person to read. They still have to run clean.

`drive-all.sh --lint` checks the markers without running anything.

Driver grammar (one action per line, `#` comments):

| action | meaning |
|---|---|
| `state <path.ss1>` | load a savestate |
| `wait <frames>` | run frames |
| `hold <KEYS> <frames>` | hold `A B SELECT START RIGHT LEFT UP DOWN R L` (join with `+`) |
| `tap <KEYS>` | hold 4 frames, release |
| `shot <name>` | write `<name>.png` |
| `expect u8/u16/u32 <addr> <value>` | assert equal; addr is `0xHEX`, a symbol from `br-symbols.json`, or `sym+0xOFF` |
| `expectge u8/u16/u32 <addr> <value>` | assert got >= value |
| `expectle u8/u16/u32 <addr> <value>` | assert got <= value |
| `expectne u8/u16/u32 <addr> <value>` | assert got != value |
| `expectmsg <type> u8/u16 <off> <value>` | assert on the newest out-ring message of that type: its data at byte `off`, across continuation slots. Draining does not erase it |
| `drain gBrMailbox` | from now on take every out-ring slot each frame, as the page would. **Every driver that opens a netlink session needs this.** Without it a link battle fills the ring in seconds, `gBrNetlink.pendingLen` sticks, and the fight freezes mid-turn looking exactly like a game bug -- it cost POK-312 a High ticket. The harness fails a run whose `pendingLen` holds for 300 frames rather than driving on in a dead ROM. `drain 0x0` stops it again (a page that has stopped reading) |
| `*sym+off` as an addr | dereference the u32 pointer at `sym` first (`*gSaveBlock1Ptr+4` is the location) |
| `poke u8/u16/u32 <addr> <value>` / `pokebytes <addr> <hex...>` | write RAM |
| `dump <addr> <len>` | hex dump |
| `title` / `say <text>` | print the game code / echo |

Lessons carried from the Emerson harness: hold a direction across many frames for a
step (a short tap is a turn in place); hold A about 4 frames to advance text; colours
wash out after a Qt-saved savestate load, auto-contrast the PNGs in post.

`states/` holds savestates (gitignored). Save one from the mGBA GUI standing where the
driver should start; `state <path>` loads it.

Reads go through the GBA bus, so a `u32` at an address that is not 4-aligned comes back
rotated (hardware behaviour, mGBA reproduces it). Read `u16` at 2-aligned or `u8` instead.

## Data generators — what the page reads, and the order to run them

The page never parses the decomp. These scripts read it and write committed JSON and PNGs
under `web/src/data/` and `web/public/`. Nothing runs them automatically, so rerun the
ones whose inputs you changed, in this order (python from the repo root; the `.ts` ones
from `web/`, which has vite-node):

| # | run | writes | reads / depends on |
|---|---|---|---|
| 1 | `python tools/br/export-world.py` | `web/src/data/world.json`, `world.meta.json`, `regionmap.json`, `landing.json` | `data/maps`, `data/layouts`, tileset attributes, region map sections |
| 2 | `npx vite-node ../tools/br/landing-reach.ts` | `landing.json`, rewritten in place: cells with no way out marked `off`, doorsteps added | **always right after 1**, which overwrites `landing.json` and drops those marks |
| 3 | `python tools/br/render-maps.py` | `web/public/field-maps/<MAP>.png`, `.border.png` | `world.json` from 1, layouts, tilesets |
| 4 | `python tools/br/export-sprites.py` | `web/public/field-sprites/<gfx>.png`, `web/src/data/sprites.json` | object-event graphics tables and pics |
| 5 | `python tools/br/export-ui.py` | `web/public/ui/*.png`, `web/src/data/ui.json` | the font, text window, message box, and the skin ladder: `sSkinGraphics` in `src/br/br_ghosts.c`, so **rerun it when that table changes**. The skins are drawn from 4's sheets |
| 6 | `python tools/br/export-encounters.py` | `web/src/data/encounters.json` | `src/data/wild_encounters.json`, `evolution.h`, `species.h` |
| 7 | `python tools/br/export-trainers.py > web/src/data/trainers.json` | the trainers on each map | each map's `scripts.inc` |
| 8 | `python tools/br/mine-lines.py > web/src/data/lines.json` | MY VOICE's word list | NPC text |

Run order matters for 1 → 2 and 1 → 3; the rest stand alone (5's skins name sheets that
4 writes, but it does not read them). The symbol table and
version file are per build, not per data change: `symbols.py` and `version-json.sh`, run
by `dev-patch.sh` and CI after every ROM build.

Two more write the mailbox's contract into C and TypeScript both, and a vitest fails
when either side is stale: `rom-limits.py` (the species, move, level and map bounds, from
the pret sources) and `wire-ids.py` (the message ids and reassembly caps, from
`wire-table.txt` -- edit the table, never its outputs; a table that changes shape is a
`BR_PROTOCOL` bump, pinned in `include/br/br_version.h`).

Not generators: `bots-replay.ts` and `zone-occupancy.ts` (the bot brain run offline, for
questions), `moveset-sim.py` (eyeballs br_levels.c's move picks), `transcribe.py`
(play-test videos), `play-log.mjs` (the relay's play log, CI).
