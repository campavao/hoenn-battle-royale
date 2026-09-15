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
| `expect u8/u16/u32 <addr> <value>` | assert; addr is `0xHEX`, a symbol from `br-symbols.json`, or `sym+0xOFF` |
| `poke u8/u16/u32 <addr> <value>` / `pokebytes <addr> <hex...>` | write RAM |
| `dump <addr> <len>` | hex dump |
| `title` / `say <text>` | print the game code / echo |

Lessons carried from the Emerson harness: hold a direction across many frames for a
step (a short tap is a turn in place); hold A about 4 frames to advance text; colours
wash out after a Qt-saved savestate load, auto-contrast the PNGs in post.

`states/` holds savestates (gitignored). Save one from the mGBA GUI standing where the
driver should start; `state <path>` loads it.
