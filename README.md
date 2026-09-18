# Hoenn Battle Royale

Last trainer standing, in Hoenn, in the browser.

**Play: https://hoenn-battle-royale.vercel.app** — on a phone or a computer, with your own
Pokémon Emerald (U) ROM. The site patches it in your browser and never uploads or serves
it. Who is playing: https://hoenn-battle-royale.vercel.app/play.html

A Pokémon Emerald ROM patch built from this fork of [pret/pokeemerald](https://github.com/pret/pokeemerald),
running in mGBA compiled to WebAssembly, with a relay for rooms. The Gen 3 successor to
[Kanto Battle Royale](https://github.com/campavao/kanto-battle-royale), and its rules are
the spec: a Safari Zone opening, a drop, a ring that closes, a shot clock in every fight,
one Pokémon dropped as a ball when a trainer goes down.

## How a match goes

1. Everyone opens in the Safari Zone with thirty balls and a shared two-minute clock.
2. The drop: each trainer lands somewhere in Hoenn, alone, and levels rise on a clock
   for everybody at once. No EXP. Route trainers, gym leaders and Poké Marts are loot.
3. The fog closes in phases over the region map. Outside it, you take damage.
4. Meet another trainer in the open and the fight is forced. RUN gets harder every time;
   30 seconds on the clock or you forfeit. Lose and your Pokémon are on the ground for
   whoever gets there first.
5. Last one standing gets the Hall of Fame. Everyone else watches.

Solo vs bots, a hosted room with a passcode, quick play, and the daily game.

| Where | What |
|---|---|
| `src/br/`, `include/br/` | the battle-royale C, compiled into the ROM |
| `web/` | the site: ROM import, patching, emulator, lobby, match director, bots |
| `relay/` | the room relay (Node, WebSocket, on Railway) |
| `tools/br/` | headless harness and drivers, data exporters, patch builder, play log |
| `docs/DESIGN.md` | the design; `docs/PLAYTEST.md` the play-test findings; `docs/WIRE.md` the messages |

Upstream pokeemerald's own README is [README.pokeemerald.md](README.pokeemerald.md). Branch
`master` tracks pret; the work is on `hoenn-battle-royale`.

## Releases

A tag is a release. `git tag -a v0.1.0 -m "what changed"` and push it: CI builds the ROM
with agbcc (byte-matching, so the patch is our changes and nothing else), diffs it
against the baseline pret build into `hoenn-br.bps`, attaches the patch and its two
sidecars to a [GitHub release](https://github.com/campavao/hoenn-battle-royale/releases),
deploys the site, and redeploys the relay only if `relay/` changed. No ROM is ever built
into an artifact, a release or the site.

The patch on the site is the only one that matters to a player: both sides of a link
battle must run the same one, and the room refuses a mismatch.

Work is tracked in the Linear project **Hoenn Battle Royale**.
