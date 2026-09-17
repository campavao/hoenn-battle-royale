# tools/br

## drive.sh — headless drivers

    tools/br/drive.sh <driver> [rom] [state.ss1]

Runs `drivers/<driver>.txt` against the built ROM inside libmgba with no window and no
audio, writes frames to `harness/frames/<driver>/`, exits 0 only if every `expect` held.
Works from Git Bash (it re-execs itself in the MSYS2 UCRT64 shell). Needs the static
libmgba at `C:\Users\cam95\Documents\Github\mgba-src\build\libmgba.a` (override with
`MGBA_SRC`). The ROM defaults to `pokeemerald.gba`, then `pokeemerald_modern.gba`.

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
| `drain gBrMailbox` | from now on take every out-ring slot each frame, as the page would. **Every driver that opens a netlink session needs this.** Without it a link battle fills the ring in seconds, `gBrNetlink.pendingLen` sticks, and the fight freezes mid-turn looking exactly like a game bug -- it cost POK-312 a High ticket. The harness fails a run whose `pendingLen` holds for 300 frames rather than driving on in a dead ROM |
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
