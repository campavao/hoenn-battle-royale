# Wire protocol (POK-217)

The room vocabulary, ported from Kanto's `mods/battle_royale/lib/wire.lua`. Two
layers, one vocabulary:

- **Relay JSON** -- page &lt;-&gt; relay &lt;-&gt; page, inside the relay's own
  `{type:"recv", from, m}` envelope (`relay/server.js`). `web/src/net/wire.ts`:
  `PROTOCOL = 1`, a `Msg` discriminated union, `encode(msg): string` /
  `decode(json): Msg` with validation.
- **Mailbox binary** -- page &lt;-&gt; ROM, over `struct BrMailbox`'s two rings
  (`include/br/br_mailbox.h`). `web/src/net/slots.ts`: `packSlot(msg)` /
  `unpackSlot(type, payload)`, little-endian, fixed layouts, framed into
  `MAILBOX.PAYLOAD_MAX` (62) byte slots by the continuation scheme below. Only the
  messages the ROM must act on or itself emits cross this layer; see the table.

Every JSON message carries `seat` (0..31, a fixed roster slot) where Kanto carried
an arbitrary `as`/id. The relay's own envelope still adds `from` (the connection id)
on forward, same as Kanto -- that is a property of the transport, not of `Msg`, so
it is not a field on any message here.

## Continuation scheme

A slot's payload is at most 62 bytes. Every packed message -- even one that fits in
a single slot -- opens with a 3-byte header on its **first** slot:

```
offset 0..1: totalLen  u16 LE   the packed message's own length, before slot-splitting
offset 2:    seq       u8       always 0 on the first slot
offset 3..:  data      up to 59 bytes
```

If `totalLen` fits in those 59 bytes, that slot is the whole message. Otherwise the
rest of `data` follows in **continuation** slots, `type | 0x80` (`BR_MSG_CONT`):

```
offset 0:   seq   u8    1, 2, 3, ...
offset 1..: data  up to 61 bytes
```

A reader collects continuation slots until it has `totalLen` bytes, checking `seq`
increments by exactly 1 with no gap -- a dropped or reordered slot must fail loudly
rather than reassemble into a different message. `0x80` is reserved as the
continuation flag for every message type; no `BR_MSG_*` number may set that bit.

## Message table

| Name | Type # | Direction(s) | Crosses to ROM | Sent by / when |
|---|---|---|---|---|
| `place` | `BR_MSG_PLACE` 2 | page&lt;-&gt;page, page&lt;-&gt;ROM | yes | every seat, ~4x/s: position + status |
| `step` | `BR_MSG_STEP` 3 | page&lt;-&gt;page, page&lt;-&gt;ROM | yes | a step just committed |
| `face` | `BR_MSG_FACE` 4 | page&lt;-&gt;page, page&lt;-&gt;ROM | yes | a turn in place |
| `challenge` | `BR_MSG_CHALLENGE` 5 | page&lt;-&gt;page (negotiate), page-&gt;ROM (engage) | yes (once resolved) | challenger; then both sides' pages push the resolved engage to their own ROM |
| `accept` | -- | page&lt;-&gt;page | no | the challenged seat, accepting |
| `decline` | -- | page&lt;-&gt;page | no | the challenged seat, declining |
| `bt` | `BR_MSG_BT` 6 | ROM&lt;-&gt;page&lt;-&gt;page&lt;-&gt;ROM | yes | one raw link-block exchange, per turn, during a PvP battle |
| `party` | `BR_MSG_PARTY` 7 | page-&gt;ROM | yes | host (bot roster seat, before a trainer battle) or a player (Hall of Fame). As the answer to a `peek` it carries an optional tail behind the rows (POK-297): money u32, stacks u8, then id u16 + n u8 a stack, at most 20 -- what that trainer is carrying, for the spectator's peek box. A player's ROM packs its own; the host's page packs a bot's. `status` in a row sent by a ROM is a code (0 none, 1 SLP, 2 PSN, 3 BRN, 4 FRZ, 5 PAR, 6 TOX), not a flag |
| `faint` | `BR_MSG_FAINT` 8 | ROM-&gt;page | yes | ROM, when a party slot faints in battle |
| `out` | `BR_MSG_OUT` 9 | page&lt;-&gt;page, page&lt;-&gt;ROM | yes | the eliminated seat |
| `pickup` | `BR_MSG_PICKUP` 10 | page&lt;-&gt;page, page&lt;-&gt;ROM | yes | whoever picked something up off the ground |
| `spill` | `BR_MSG_SPILL` 11 | page&lt;-&gt;page, page&lt;-&gt;ROM | yes | the defeated trainer's client, on elimination |
| `npcout` | 31 | page&lt;-&gt;page, page-&gt;ROM | yes | whoever beat one of Hoenn's own route trainers -- or the host's fog clock, with `fog: true` (POK-299): every trainer on a map the ring has held outside for forty seconds leaves every ROM the same way, and the record card and the boss line both skip a fog one. `fog` is JSON-only; the ROM does the same thing either way |
| `ring` | `BR_MSG_RING` 12 | host-&gt;page&lt;-&gt;ROM | yes | host, on every fog shrink |
| `clock` | `BR_MSG_CLOCK` 13 | host-&gt;page&lt;-&gt;ROM | yes | host, ticking down a shared countdown (the Safari opening today) |
| `start` | `BR_MSG_START` 14 | host-&gt;page&lt;-&gt;ROM | yes | host, when the match begins |
| `late` | -- | host-&gt;one watcher (unicast) | no | host, to a peer who joined mid-match |
| `win` | -- | host-&gt;page | no | host, when the match is decided |
| `again` | -- | host-&gt;page | no | host, returning the room to the lobby |
| `busy` | `BR_MSG_BUSY` 17 | ROM-&gt;page&lt;-&gt;page-&gt;ROM | yes | a seat's ROM, once its menu/battle state has settled; every peer's ROM keeps it so the engage skips a trainer mid-battle |
| `bstart` | `BR_MSG_BSTART` 18 | ROM-&gt;page-&gt;page-&gt;ROM | yes | the challenger's ROM, when a link battle begins; carries seed + both parties + names so a spectator replays it as a BATTLE_TYPE_RECORDED |
| `turn` | `BR_MSG_TURN` 19 | ROM-&gt;page-&gt;page-&gt;ROM | yes | the challenger's ROM, streaming the battle's new action bytes each turn so the spectator's replay stays a turn behind |
| `follow` | `BR_MSG_FOLLOW` 20 | page-&gt;ROM | yes | the spectator's own page, to put its camera on a seat's ghost; `seat` null (0xFF on the wire) stops. Never leaves the page that sent it -- the seat being watched is not told |
| `peek` | `BR_MSG_PEEK` 21 | page-&gt;ROM-&gt;page | yes | a spectator asking what the trainer they watch carries. Broadcast; only `target`'s ROM answers, with a `party` of its own. The re-ask is also the watcher tally the corner eye counts |
| `shot` | `BR_MSG_SHOT` 22 | ROM-&gt;page-&gt;page-&gt;ROM | yes | a fighter's own shot clock as each second turns over (0 once they have chosen), drawn on the replay of whoever is watching that seat |
| `trainer` | `BR_MSG_TRAINER` 23 | page-&gt;ROM | yes | the host, staging a bot's team in the challenged player's ROM just before the `challenge` that starts the fight. A bot has no ROM to link with, so the battle is an ordinary `BATTLE_TYPE_TRAINER` one built from this party instead of from `gTrainers`. The card also carries the up-to-four items the bot may spend out of its bag in this fight (POK-237), which is what Emerald's trainer AI is given. Sent to that one seat, never broadcast |
| `spent` | `BR_MSG_SPENT` 26 | ROM-&gt;page | yes | the ROM that fought a bot, naming the items out of the bot's own bag (POK-237) that the AI actually used. Carries the BOT's seat, not the sender's -- the bag lives on the host's page and the fight does not, so this is the only report of it, and the bridge deliberately does not stamp the sender's seat over it |
| `duel` | `BR_MSG_DUEL` 27 | page-&gt;ROM | yes | the host, handing two bot parties to its hidden proxy instance (POK-238). Only that instance ever receives one: it has no seat and is in no room, and both sides of the fight are played by the AI |
| `dresult` | `BR_MSG_DRESULT` 28 | ROM-&gt;page | yes | the proxy instance, when the duel resolves: who won and what each side has left, three bytes a mon. A timeout or a draw falls back to `bots/duel.ts`'s seeded resolver |
| `fled` | `BR_MSG_FLED` 29 | ROM-&gt;page&lt;-&gt;page-&gt;ROM | yes | the trainer who just ran, naming who they ran from (POK-266). Every ROM that has their ghost draws a boot over it. Deliberately not a fourth `busy` kind: `busy` means "cannot be challenged", and POK-231 holds only the fleer off the pursuer |
| `botout` | -- | page&lt;-&gt;page | no | whoever beat a bot |
| `botrec` | -- | page&lt;-&gt;page | no | whoever changed a bot's persistent record |
| `ticker` | `BR_MSG_TICKER` 15 | page/host-&gt;page&lt;-&gt;ROM | yes | kill feed, system lines, and chat (`say`), all one pipe |
| `ready` | -- | page-&gt;page | no | a seat in the HTML lobby, toggling ready |
| `result` | `BR_MSG_RESULT` 16 | ROM-&gt;page | yes | ROM, when a link/trainer battle this seat was in concludes |
| `ping`/`pong` | -- | page&lt;-&gt;page | no | either side, timing the other (distinct from the relay's own connection heartbeat) |

`BR_MSG_NONE` (0) and `BR_MSG_ECHO` (1) are unchanged from the mailbox bridge test.

## JSON fields (web/src/net/wire.ts)

Full field lists live as TSDoc on each interface in `wire.ts` -- one line per field,
kept in sync there rather than duplicated here. In summary, every message has `t`
(the discriminant) and every message but `win`/`late`/`ring`(host)/`again`(host)/
`start`/`clock`(host) has a mandatory `seat`; `place`/`step`/`face` carry `map` as
`{group, num}` (Emerald's MAP_GROUP/MAP_NUM, replacing Kanto's map-name string);
`ring`'s fog centre is `sx`/`sy` (region-map section coordinates, Hoenn's analogue
of Kanto's town-map `cx`/`cy` -- DESIGN.md §6); directions are Emerald's own
(`DIR_SOUTH`=1, `DIR_NORTH`=2, `DIR_WEST`=3, `DIR_EAST`=4, `include/constants/
global.h`).

## Binary layout (web/src/net/slots.ts, include/br/br_wire.h)

The exact byte-offset layout for every crossing message lives in
`include/br/br_wire.h` as a comment block above its `BR_MSG_*` define -- that
header is written to be sufficient on its own for the C side, and `slots.ts`
implements it field for field. A `PackedMon` (the `party` message's per-mon row) is
100 bytes, matching the size of the ROM's own `struct Pokemon` so that a full
6-mon party's continuation-slot math (600 bytes) lines up with a real party; it is
**not** that encrypted struct, just a fixed unencrypted shape carrying the fields
the wire needs. Strings (`nickname`, `ot`, `place`, ticker `text`, spill bag `name`)
are length-prefixed Gen 3 charmap text (`web/src/text/gen3.ts`): `[len: u8][bytes]`.

`tests/slots.test.ts` keeps its own `FIXED_LAYOUT_SIZES` table (packed size before
framing, per message) asserted against real `packSlot()` output, so a layout drift
between this doc, the header, and the code fails a test rather than surfacing at
runtime.

## What did not carry over from Kanto, and why

- **The drawn lobby room.** Hoenn's lobby is HTML (DESIGN.md §7); there is no
  lobby-room sprite state to synchronize, so nothing about it is on this wire. In
  its place: `ready`, new for the HTML lobby's ready-up flow.
- **`lockstep`/`channel`'s custom battle protocol.** PvP here is Emerald's own link
  battle over `br_netlink.c` (DESIGN.md §5); `bt` carries the actual link-block
  bytes the ROM's `SendBlock`/`gBlockRecvBuffer` already exchange, not a Lua
  lockstep message. `mirror`'s battle-frame replay is likewise replaced by Emerald's
  own `BATTLE_TYPE_RECORDED` given a seed and an action stream -- there is no
  frame-by-frame `bmir` message to port; a spectator's ROM does the replay.
  `peek`/`state` collapse into `peek` + a `party` reply, since Hoenn's party rows are
  already the shape the ROM needs rather than a display-only summary.
  `Wire.buildDiffers`'s engine/mod version fields stay as `place.build`, JSON only:
  Hoenn's version gate is a relay-side room check (`br-version.json`, DESIGN.md
  "facts that cost hours"), not a per-message field the ROM inspects.
- **String keys for ground items and object events.** `took`'s Lua string `key`
  becomes `pickup`'s numeric `key` (a u16): EWRAM has no room for arbitrary
  strings, and the ROM has to recognize a ground item by id, not by name. `npcout`
  went the same way when it joined the crossing set (POK-287): its `obj` string is a
  numeric `localId`.
- **Anything gen1recomp-engine-internal.** Kanto's `Wire.PROTOCOL` history mentions
  engine specifics (`src/link/Handshake.lua`, `Fingerprint`'s `modKey`) that have no
  Hoenn analogue; this wire's version gate lives entirely in the relay's room check
  above, not in per-message fields.
- **`botout`, `botrec`, `late`, `win`, `again` stayed JSON-only**:
  POK-217's scope named an explicit ROM-crossing subset ("place/step/face/map,
  challenge and the battle blocks, party, faint/out, pickup/spill, ring, clock,
  seed/start, ticker/say, result") and these are not in it.

  **`fame` is gone entirely (POK-303).** It carried the champion's party and a six-field
  `stat` block, had a decoder and a round-trip test, and was sent by nobody: the parade
  has always been drawn from `party`, which the winner's ROM already sends. The stats it
  was going to carry are counted page-side now (`match/record.ts`) off messages that
  already cross -- `npcout`, `dresult`, `pickup`, `ring` -- so nothing has to be sent and
  no ROM has to count. A decoder for a message nobody sends is a trap, not an asset.

  **`npcout` was on that list and is not any more (POK-287).** The reasoning for
  leaving it off was that each client's ROM keeps its own beaten-trainer flags -- true,
  for the trainers it beat. The spill was broadcast and the despawn was not, so
  everybody else saw the Poke Balls on the ground with the trainer still standing next
  to them, and could fight and loot the same one again. Kanto's rule is that beaten
  means gone: the world is a record of the match. The note above ("if a remote player's
  own map trainer needs to auto-hide on `npcout` in practice, that is a follow-up
  ticket") was right that it was a follow-up and wrong that it was hypothetical.
