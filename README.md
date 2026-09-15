# Hoenn Battle Royale

Last trainer standing, in Hoenn, in the browser.

A Pokémon Emerald ROM patch built from this fork of [pret/pokeemerald](https://github.com/pret/pokeemerald),
running in mGBA compiled to WebAssembly, with a relay for rooms. Players import their own
Emerald ROM; the site patches it in the browser and never uploads or serves it.

The Gen 3 successor to [Kanto Battle Royale](https://github.com/campavao/kanto-battle-royale).

| Where | What |
|---|---|
| `src/br/`, `include/br/` | the battle-royale C, compiled into the ROM |
| `web/` | the site: ROM import, patching, emulator, lobby, match director, bots |
| `relay/` | the room relay (Node, WebSocket) |
| `tools/br/` | headless harness, data exporters, patch builder |
| `docs/DESIGN.md` | the design |

Upstream pokeemerald's own README is [README.pokeemerald.md](README.pokeemerald.md). Branch
`master` tracks pret; the work is on `hoenn-battle-royale`.

Work is tracked in the Linear project **Hoenn Battle Royale**.

## Status

Foundations (M0), 2026-09-15. No patch is published yet.
