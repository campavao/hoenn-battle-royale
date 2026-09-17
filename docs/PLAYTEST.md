# Play-test findings

Linear hit its free-issue cap on 2026-09-16 (POK-279 was the last one it took), so
findings live here until there is room again. Each entry is written to be actionable on
its own: what was seen, what is suspected, and where to look. When a ticket exists it is
named; when one is created later, put its id at the top of the entry and leave the rest.

---

## 2026-09-16, Cam, solo and quick play

### Freeze: throwing a Safari Ball at a Makuhita ends with both sprites gone and no input -- **fixed** (`f514e0299`)

**Critical.** Video at ~2:50. First mon of the match, a Makuhita, Safari Ball thrown;
"we both just disappeared, and then I was frozen here, I couldn't do anything."

Reproduced in `catch-buzzer.txt`: catch-pages.txt's catch with the ring already up,
which is what 2:50 of that match was. The throw is pre-empted -- `BrMatch_BuzzerClosing`
turns the turn into a RUN (POK-261, and the right call) -- so the ball animation cuts
short, which is the sprites going. The battle then printed "Got away safely!" and sat
there: fifteen seconds of driver time, moving only when something pressed A. Nobody
chose that exit and nothing on screen said a button was what it wanted.

A forced exit does not ask now: while the buzzer is closing, the safari controller's
text-printer wait completes on its own. The driver presses nothing after the throw and
reaches the drop map by itself.

Two things found on the way there, both fixed and both their own escape hatch:

* The drop's own black screen (`BrPick_Wait`) held for ever if the host's `land` never
  came. It re-asks at five seconds and drops itself on the START's cell at fifteen
  (`ba5d153d1`, `land-lost.txt`).
* The `#quick` pace collision is why the buzzer was at 2:50 at all (`3ef373a8c`).

### The new-game intro plays: the truck, not the Safari

**Critical.** Video at ~2:29, start of a game. "It looks like I'm doing the weird intro
screen with the cars. We should be starting in the Safari. I should never see this
screen."

`BrBoot_Tick` consumes the boot block and starts the game at the dealt map with no intro
(POK-221, drivers `br-boot`/`boot-littleroot`). Something let a boot through without it —
a quick-play join where the block is written after the ROM has already begun the intro, or
a second boot (PLAY AGAIN reboots the emulator: POK-258) where nothing writes the block
the second time.

### No other trainers in the Safari, in a room with bots -- partly explained

Video, and the earlier solo report. "I still did not see any other players in the Safari.
I think I saw an NPC that was just a normal NPC, but I would expect to see other players
running around too."

Solo had no bots at all — fixed, POK-275 — but this was **quick play**, where the host
does deal them (POK-257 put them in the Zone deliberately). So either the room never
started its bots, or they are in the Zone's other areas: `BrMatch_SafariCell` spreads the
field across all six maps (POK-261), and six areas over a two-minute opening is thin.
Worth measuring how often two contestants share an area before changing anything.

**The video answers half of it:** the room strip reads `SAFARI · 12 left` with `CAM (you)`
and P21..P31 beside it, so eleven bots were in that match and in the Zone. Six areas over
a two-minute opening is simply thin. The question is whether the opening should deal
everybody into fewer areas, which is a pacing decision rather than a bug.

### Eliminated in the Safari does not put you into spectating -- **fixed** (`1f57d8571`)

"When I got out in the Safari, it should have brought me to spectating the other players."

It was not the Safari: our own `out` never comes back over the relay, and the WATCH
strip was only ever drawn from a relay message or a roster event -- so on a host
walking a room of bots, where no relay traffic arrives at all, it was never drawn at
any point in a match. `autoWatch` draws it on our own elimination and puts us on the
first trainer still standing, then moves us on when that one goes out too.

### The fog closes too fast, and the match is over in about two minutes -- **fixed**

"Once the fog was coming in, it was like every minute or 45 seconds, which feels like not
enough."

**`#quick` meant two different things.** It was the dev pace flag (25-second opening,
15-second fog phases, so a whole match fits in three minutes) *and* what QUICK PLAY puts
in the hash. So every quick-play game in dev ran at the dev pace: the video's own frame
shows the room's controls reading `FOG 120s` while the strip says `RING -1 (MAUVILLE
CITY)` -- the last of eight phases -- two and a half minutes in. There was no time to
catch anything because there was no Safari to speak of, either.

The dev pace is `#fast` now and `#quick` means quick play. The e2e specs that wanted the
pace say `#fast`; the one that clicks the QUICK PLAY row is unchanged.

This is separate from POK-273 (the bots eliminating each other too fast), which shipped in
`ed24169f1` on 2026-09-16 -- the twelve-second bot-duel cooldown at `bots/brain.ts:36`.
There is no `pok-273-pacing` branch any more; this line used to say there was.

### HUD: the second window (the party/ball blobs) is not wanted -- **fixed** (`1ef860e77`)

"Under the seven left and time display there's an empty looking box... I think it shows
the amount of pokeballs you have or Pokemon you have. I don't think we need that, let's
get rid of it."

That was the wound bar (POK-226): one blob per party mon, green while it is standing. It
is out, along with its window slot and its tiles -- both scarce on BG0.

### HUD: the window borders should match the game's own dialogue frame

"There's a border on this that comes up with the normal dialogue — it's kind of green and
cyan. We should be matching that style, or whatever that style is derived from, like a
user setting. We should be applying that same style to the dialogue boxes and the UI
pieces that we make."

**Closed 2026-09-17 by Cam's decision, and the diagnosis above was wrong.** The HUD does
not wear "the bag's frame": `LoadMessageBoxAndBorderGfx` at `br_hud.c:70`/`:101` routes
through `LoadUserWindowBorderGfx`, which reads `gSaveBlock2Ptr->optionsWindowFrameType`
(`text_window.c:110`) -- so the HUD has been wearing the player's own FRAME setting all
along, the same one the bag and the START menu wear.

The green and cyan box is a different asset: `gMessageBox_Gfx` at tile 0x200 with
`gMessageBox_Pal` in palette 15 (`text_window.c:93`, `:187`), fixed, not selectable. The
two are mutually exclusive -- matching the dialogue box means the FRAME option stops moving
the HUD. Asked, and **Cam chose to keep FRAME.** A drawer that takes the dialogue frame
instead was written and reverted; if it is ever wanted, the shape is a BR-local window func
with the real height and one-column side fills (upstream's hardcodes height 5 and fills
tile +9 across `width + 1`, straight over the window's interior, which only survives
because `DrawDialogueFrame` re-puts the tilemap immediately after -- the HUD does not).

### Graphical: borders wrong until you move -- **fixed**

Three sightings, all the same shape — the window is drawn before the palette or tilemap it
wants has settled, and a step fixes it:

* ~2:44 "the border now has a weird red border within it too".
* ~2:29, start of a match: the top-right counter "looks a little bit transparent and
  showing weird borders within it. It goes away once you move."
* ~1:45, as the FOG message arrives: "at the top of the screen there's orange and red
  bars", also gone after moving.

The palette is the suspect: POK-231's shot clock hit exactly this — *the ambient battle
bg-palette 0 has RED at index 1, not white*, and a window drawn against the wrong palette
reads as red bars. The HUD draws on a map load and on a ring message, both of which are
moments when the overworld's palettes are mid-fade.

### "Found 0"

~11:00 in the video, unexplained. Needs another look at the recording or a repeat: which
line said it, and what had just happened.

## 2026-09-16, Cam, second sitting (the room strip and the freeze)

### Walking into a bot froze the game on a black screen -- **fixed** (`4cc935d1c`)

When the player is the one who spots the bot, the ROM's challenge fell through to a
link battle against a seat with no ROM behind it, and `BrNetlink_StartBattle` has no
timeout. The challenge parks for 90 frames now and the page answers it with the bot's
card. Driver `bot-spotted.txt`.

### A link battle that nobody answers has no way out -- **fixed** (`9fdd7ffb9`)

Ten seconds with nothing heard at all and the session ends: B_OUTCOME_FORFEITED (no
white-out, no boot over anybody's head), the seat on the fleer's lockout so the engage
does not immediately try again, and the battle torn down by `BrBattle_Unwind`. Only a
session that has heard nothing *at all* is touched -- a real peer's first block lands
in the start exchange -- so a long turn is nobody's business but the players'.
Driver `netlink-silent.txt`.

### `Disconnected: closed` stays on the room strip for the rest of the match -- **half fixed** (`1004a6cd2`)

Seen throughout the second video. `RelayClient` reconnects with backoff, but
`app.ts:2208` writes the line and nothing ever un-writes it: there is no `open` event
to hang the recovery on (the lobby's own list works around this by polling
`relay.isOpen()` on its refresh tick). Worse, a reconnect does NOT re-host or re-join
-- `handleClose` nulls `id`/`code` and the module's own comment hands that decision to
`app.ts`, which does not make it. So the socket comes back and the room does not.

There is an `open` event now and the line is replaced when the socket comes back: the
host hosts again, a guest is told the room carried on without them. Rejoining a room
mid-match is still not possible -- the relay hands out a new id, which is this page's
seat -- and that is what is left of this one.

What the relay logged tonight says most of these were the page's own reloads
(`drop CAM#1 room ... (closed) after 17s`), plus one `(idle) after 66s` which was the
black-screen freeze above. Two things to do: clear the line when the socket is up
again, and rejoin the room we were in.

### The host tabbing out must not pause the match -- **fixed** (`1f1c81a63`)

POK-247 put a warning in the title bar and a note on the room panel: "This tab was
hidden for 3s -- you are the host, so the match was waiting on it." Cam: *"we cannot
pause the game if the host tabs out. If that happens it should swap hosts. No alert is
needed."*

The freeze is real and not fixable in place: a hidden tab's `requestAnimationFrame`
stops, so the host's own emulator stops, and `setInterval` (the director's clock, the
bots' walking) is throttled to about once a second. Kanto never solved this either --
its relay comment says a host dropped for flooding "ended the match" because there is
no host migration.

Done as described: `can_host false` on `visibilitychange`, the relay re-elects, the
old host keeps its seat and plays on. The alert went with it.

The relay half is deployed (`railway up`, 2026-09-16 23:31Z).

---
---

## 2026-09-16, Cam, earlier session (Linear was full)

### A beaten route trainer drops nothing -- **fixed** (`41812fe38`)

"An NPC trainer didn't drop their Pokémon after defeat. What's funny is I did after I
lost to Roxanne, so maybe it's just hooked up to players/bots and not NPCs yet."

It was hooked up, and called with a local id of zero every time.
`BrLoot_TrainerBeaten` read `sTrainerObjectEventLocalId` -- the script's own parameter
for the trainer's object -- and `trainerbattle_single` passes a literal `0` there for
every ordinary trainer in Hoenn. The engine never depended on it either: where it reads
that field it falls back to `gSpecialVar_LastTalked`, which the approach has held since
the eye met ours. Our call hit the guard and returned.

`trainer-drop.txt` is the driver that was missing: boot into the gym, beat a trainer
for real, read the tile they were standing on.

### The Zone's START menu was still Emerald's -- **fixed** (`0d27d1c60`)

From the video's frames: RETIRE, POKéDEX, POKéMON, BAG, CAM. POK-221 pruned the START
menu and POK-222 made the Zone the opening, but `BuildSafariZoneStartMenu` is a
different function and nothing had touched it. Driver `safari-menu.txt`.

### A Pokémon started the match on -1 HP

Needs one detail before it can be chased: was it one HP short of full, or did the screen
literally read `-1`? And where — the party screen, the battle's health box, or the
summary? The fog's bleed takes `maxHp/10` with a minimum of 1, which would look like "one
short" the moment the ring goes active; a literal `-1` is a different bug entirely.

### The analog stick does nothing — **fixed** (`f4c46852c`)

The poll read axes 0 and 1 only, which is where a *standard* pad puts its left stick.
Every axis counts now (even = horizontal, odd = vertical, axis 9 is the DirectInput hat),
and the pad readout names the axes that moved, so the next pad that misbehaves says so.

## 2026-09-17, Cam, the profile screen (recorded, to do in a later batch)

### The wardrobe is four sprites, and you cannot see the ones you have not earned

"For the sprite, I can only ever pick May / Brendan / Rival May / Rival Brendan. I
should be able to pick kind of like any sprites -- the way Kanto Battle Royale has it,
the amount of wins you get means you get more sprites. Maybe that is how this works; I
see RIVAL BRENDAN is at one win. But in Kanto you're able to preview all the different
skins even if you don't have all the wins yet."

Two separate things, and the second is the smaller one.

**The ladder exists.** `SKIN_UNLOCK_WINS = [0, 0, 1, 3]` in `web/src/match/career.ts`,
and `updateCareer` refuses a locked skin rather than wearing it. So the mechanic is
there; what is missing is everything for it to be a mechanic *about*.

**Four is the whole wardrobe**, because `sSkinGraphics` in `src/br/br_ghosts.c` has four
entries -- BRENDAN, MAY, RIVAL_BRENDAN, RIVAL_MAY -- and a skin on the wire is an index
into it. Kanto unlocks nine trainer *classes* (`lib/skins.lua`). Emerald has the same
kind of thing sitting there unused: `OBJ_EVENT_GFX_HIKER`, `_BEAUTY`, `_YOUNGSTER`,
`_FISHERMAN`, `_BLACK_BELT`, `_CAMPER`, `_PICNICKER` and the rest, all already in the
ROM's object-event graphics table. Adding them is appending to `sSkinGraphics` and
extending `SKINS`/`SKIN_UNLOCK_WINS` to match, index for index -- the wire, the ghosts
and the lobby all read the same index and need no other change.

Worth checking before picking the list: a skin has to work as a walking overworld
sprite in all four directions, and some object-event graphics are single-pose.

**The preview.** `nextSkin(skin, wins)` skips locked entries, so the lobby's cycle never
shows one. Kanto's does, greyed or captioned with what it costs. That is a change to the
cycle and one line of caption -- `nextLockedSkin` already works out which is next and
how many wins it takes, and nothing reads it yet.

### MY VOICE should be three lists, and the lists should be the game's own words

"For the my voice section it should have three voices: your intro text, your win text
-- what you say when you win -- and your lose text, what you say when you lose. And
these should be a big list of essentially any NPC text in the game, so that you can use
them however you want. But it's not like free text or anything."

**Today it is one choice for all three.** `career.voice` is a single index and
`voiceOf(i)` returns `{ intro: INTRO[i % 12], win: WIN[i % 8], lose: LOSE[i % n] }` --
so picking a different intro changes your win and lose lines with it, and the profile
screen only has one row to cycle. Cam wants three independent picks.

That is three fields in the career file (`intro`, `win`, `lose` instead of `voice`),
three rows on the profile, and the same three in `myVoice` -- the wire already carries
nothing here, because a line is said as a ticker `say` by whoever announces the fight.
Keep a migration for an old file's single `voice`.

**The pool.** `web/src/bots/lines.ts` is twelve intros, eight wins and a handful of
loses, written by hand for Hoenn. Cam wants the game's own NPC text instead -- a big
list, picked from, never typed. The text is all in the repo: `data/maps/*/scripts.inc`
and `data/text/*.inc` hold every line every NPC says, and `tools/` already has exporters
that read the repo and emit JSON for the page (`export-encounters.py`, `export-world.py`).
A third one that pulls single-box NPC lines short enough for the ticker
(`BR_HUD_LINE_MAX` is 40, minus a name and a colon, so under about 30 characters) would
give a pool of hundreds without anybody writing them.

Decide when it is picked up: whether bots draw from the same pool (they do today, which
is what makes a room feel like people), and whether an intro/win/lose split makes sense
for text that was written as neither.

---
---

## 2026-09-17, the two answers Cam gave, and what they turned up

### "Found 0" -- **fixed**, and it was every bag in the game

`br_loot.c`'s `Take()` prints `FOUND ` + the bag's money, so `FOUND 0!` is a bag that
arrived worth nothing. It was every bag: `ParseSpill` read the bag's item count one byte
late.

`BrLoot_SpillOwn` and the page's `encodeSpill` (`web/src/net/slots.ts:597`) agree on the
layout -- flag, key, x, y, **itemCount at off+7**, money, name -- and `ParseSpill` read
the count at `off+8`, which is the low byte of the money. For ¥3000 that byte is 0xB8, so
`at` landed 561 bytes past a 96-byte buffer, the bounds guard caught it, and `money` kept
its `0` fallback. The only way it could ever have read right was a purse that was an exact
multiple of 256, and then it read the wrong bytes anyway.

One character: `cash = off + 7`. The `cash < n` guard below it is then exactly the bounds
check the read needs, so nothing else moves.

### A bag gives its money and drops its items on the floor

Found on the way there, and not fixed. Kanto's rule (README, "Knock someone out and their
BAG hits the ground"): *items and money, the whole bag in one press.* Ours is money only.

`ParseSpill` skips the item rows on purpose -- "the bag's contents are the picker's
business and are not kept here" -- and `Take()`'s `BR_LOOT_BAG` branch does `AddMoney` and
nothing else. A bot that died holding three X ATTACKs leaves them in a bag that hands over
cash. Bots do not lose out: `bag.ts:117` folds a bag found on the ground into their own.

**The fix is blocked on EWRAM, which is the real finding below.** `struct BrLootItem` has
six free bytes on a bag (`pad[3]`, plus `species` and `level`, which are 0 for one) -- two
stacks of (id u16, n u8), at zero cost. Anything more grows `gBrLoot` and will not link.

### EWRAM is full: 80 bytes on modern, 140 on agbcc

Measured from the link maps, not estimated:

```
modern  highest EWRAM symbol 0x0203ffb0   262064 / 262144   80 bytes free
agbcc   highest EWRAM symbol 0x0203ff74   262004 / 262144  140 bytes free
```

The dev build is the tighter one, and it is the build every driver runs. BR's own state is
12424 bytes of that, and `gBrMailbox` is 9256 of the 12424 -- two 64x64 rings
(`BR_RING_SLOTS`, `BR_SLOT_BYTES` in `include/br/br_config.h`) plus the boot block.

**Cost every new piece of state before designing it** -- but check where it actually lands
first, because the obvious candidates are free: `sSkinGraphics` is `static const`
(`br_ghosts.c:30`), so eight more skins cost eight ROM bytes and no EWRAM, and
`sMoveRelearnerStruct` is `AllocZeroed` (`move_relearner.c:397`), so a longer list spends
gHeap, which is already reserved. The bag's items above are the one open item the ceiling
genuinely blocks.

When something does need EWRAM, the only large thing to sell is the mailbox: dropping
`BR_RING_SLOTS` to 48 frees 2048 bytes and risks dropping messages in a twelve-player
room. That is a measurement somebody has to make before it is a decision.

### The `-1` HP mon -- **answered, not a bug**

Cam: one short of full, on the battle health box. That is the fog's bleed
(`br_ring.c:136`, `maxHp / 10` with a minimum of 1) doing exactly what POK-224 says. It
read as "started the match" because `#quick` was the dev pace at the time, so the ring went
active about 25 seconds in; `3ef373a8c` split the pace flag off and that is already gone.

---

## 2026-09-17, the morning: the exit, and the last way to the truck

### The match ends and the player is still in it -- **fixed**

"If the game is over I should be kicked back to the main menu."

Every client already knew: `director.ts:400` sends `{t:'win'}` and `results.ts` flips
`ended` on all of them. Nothing acted on it. The room drew `#results-panel` over a ROM
that went on walking Hoenn, SOLO VS BOTS did not even do that (`app.ts` saved the round
log and stopped), and the host was the one person in the room with no LEAVE button at all
(`leave.hidden = isHost`, re-run on every roster tick).

Kanto's shape, and this follows it: everybody reads the result for a moment, then **one
funnel** takes them out. `returnToRoom()` is that funnel -- the old PLAY AGAIN body,
extracted -- and PLAY AGAIN is now a press of it rather than the only thing that ends a
match. A four-second grace arms on `win` on every client and calls the same function.

* **The room is kept**, which is the whole point of POK-258: `backToLobby()` reloads, and
  a reload scatters the eight people you just played with. The exit from a room is never
  a reload; only solo, which has no socket to lose, goes to the lobby (after eight
  seconds -- there is no PLAY AGAIN there, so it is the only time to read the result).
* **Solo gets a results screen.** `renderResults`/`renderFame` took a `Bridge`, which solo
  has never had; they take a seat and a roster now, which solo does have.
* **The host's LEAVE appears when the match is over** and not before: a host leaving
  mid-match closes the room on everybody, which is what migration is for.
* **`again` is finally sent.** It has been in the wire since POK-258 and sent by nobody.
  The host broadcasts it beside the unlock, as the recovery path for a client whose socket
  blinked over the last fight and never saw the `win`. It is not the mechanism -- each
  client's own grace is -- so a room of older clients still ends properly.

`returnToRoom` is idempotent (a `returning` latch, and it cancels the grace), so a press
and the timer cannot both reboot.

### The truck, on the one path 784567b31 missed -- **fixed**

`784567b31` put the hold around every way in "hash or no hash", and its own commit message
named PLAY AGAIN as one of them. Its diff is sixteen lines, all inside `main()`.

PLAY AGAIN rebooted the emulator with no pause anywhere, and the `waitForMailbox` after it
resolved on the magic alone -- which on a reboot can be **the previous run's magic still
sitting in EWRAM**, because nothing in the repo asserts that mGBA's `loadGame` clears WRAM.
When it is, the boot block goes in before `BrInit` has run, `BrMailbox_Init`'s `CpuFill32`
wipes it, nothing boots, and the ROM sits on the title screen with live input -- where the
first A press is NEW GAME, `CB2_NewGame`, and the moving van. And once the player has
reached the overworld by hand, `br_boot.c:156`'s `PreGame()` is false for the rest of the
page session, so no later block is ever consumed: that is why Cam stayed in the story game.

`rebootIntoBr()` is the same shape `main()` uses: zero the magic (inert if WRAM is cleared,
decisive if it is not), reboot, wait for a mailbox whose **frame counter has gone
backwards**, then pause, write, resume. The pause has to come after the wait -- that wait
counts emulated frames both to resolve and to time out, so pausing first deadlocks it.

It also stopped hardcoding `BR_BOOT_MAP`, which silently dropped the testmon flag and with
it the e2e harness's party on every replay; `bootModeFor()` is hoisted out of `main()`.

`play-again.spec.ts` is rewritten around both: it presses nothing, waits for the grace to
take it out, and then asserts the second boot block was **consumed** rather than wiped and
that the map is Littleroot (0,9) and not `MAP_INSIDE_OF_TRUCK` (25,40).

### Found on the way: the champion's parade is unreachable in real play

Not fixed, not reported by Cam, and worth its own pass. `sWinPending` wants an inbound
`result` naming our own seat before the ROM will run the Hall of Fame, and nothing
page-side ever sends one -- `win-parade.txt` passes because it pokes the RESULT slot by
hand, which is itself the evidence. The fix is one push at the `win` handler when
`msg.seat === bridge.seat`; `result` already has an encoder, so there is no codec work.
The reason it is not in this change: the four-second grace would reboot the ROM out from
under the parade, so the two have to be designed together -- Kanto's own tick defers the
ending while the parade is on screen.

---

## What is left, 2026-09-17 (re-cut after the morning pass)

Everything above that is not marked **fixed** or **closed**, which is now:

* **MOVES as a real menu.** Cam decided POK-279's second option: the relearner list *plus*
  every TM/HM in the bag this species can learn, taught from there. What shipped
  (`44355109c`) is only the hint. `br_catch.c:96` still opens the relearner only when
  `GetNumberOfRelearnableMoves() > 0`, and `move_relearner.c:903` still builds its list
  from `GetMoveRelearnerMoves` alone. Watch `move_relearner.c:160`: the list is sized
  `max(MAX_LEVEL_UP_MOVES, 25)` and MAX_LEVEL_UP_MOVES is 20, so eight HMs alone overflow
  it -- the struct is `AllocZeroed`, so growing it is gHeap, not EWRAM.
  **Cam also decided the content question:** a match grants only the eight HMs today, no
  mart sells a TM and the Zone deals none, so TMs go into the world in the same batch
  rather than shipping a menu with half of it empty.
* **The champion's parade is unreachable in real play.** Above -- one push at the `win`
  handler, designed together with the ending's grace so the reboot does not cut the parade
  off.
* **A bag gives its money and drops its items.** Above. The one item EWRAM genuinely gates.
* **The wardrobe** -- more skins and a preview of the locked ones. Not EWRAM-gated after
  all. Two index-parity traps the entry above does not name: `br_netlink.c:258` takes the
  peer's gender as `skin & 1` and `app.ts:813` takes your own avatar's as `skin % 2`, so
  the appended list has to keep male/female alternating. The C half must be in a ROM
  before the page half merges, or every new skin draws as BRENDAN through the clamp at
  `br_ghosts.c:90`.
* **MY VOICE** -- three independent picks from the game's own NPC text. Two constraints
  the entry above does not name: the ticker's encoder throws on anything outside a
  96-entry charmap subset (`web/src/text/gen3.ts:15`, no apostrophe), and Emerald's own
  intro/defeat split is 6 usable intro lines against 75 defeat lines at 30 characters --
  so a source-tagged three-way split does not exist in the ROM and the pool has to be
  assigned rather than derived.
* **Rejoining a room after a dropped socket.** Half fixed (`1004a6cd2`). The rest needs a
  relay-side resume token: the relay hands out a new id on a rejoin and that id is the
  page's seat, so a mid-match rejoin would change who you are. The only leftover that
  lives in the relay rather than here.
* **Six Zone areas is thin for a two-minute opening.** Still unmeasured, and the cheapest
  thing on this list: `tools/br/bots-replay.ts` already runs the real brain headless over
  `world.json` for a seeded sixteen minutes, so an area-occupancy histogram over
  `BrMatch_SafariCell`'s six maps is a page-lane change with no ROM build at all. Measure
  before changing anything -- it is a pacing decision, not a bug.

Answered and closed this pass: the `-1` HP mon (the fog's bleed, working as designed),
"found 0" (the bag-money off-by-one), the HUD frame (Cam keeps OPTIONS > FRAME),
Professor Birch's lab (closed, `lab-closed.txt`), the end-of-match exit, and the last
path to the truck.
