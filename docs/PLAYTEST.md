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

This is separate from POK-273 (the bots eliminating each other too fast), which is real
and still parked on `pok-273-pacing`.

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

POK-256 gave the HUD Emerald windows with a frame, and it took the **bag's** frame. The
player's chosen text frame (`gSaveBlock2Ptr->optionsWindowFrameType`, the one the green and
cyan box uses) is the one to follow — `LoadMessageBoxAndBorderGfx` is already what the
message box uses, so the HUD should load the same pair rather than its own.

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

### A link battle that nobody answers has no way out

The fix above closes the way in that we know about. The shape underneath is still
there: once `gBrNetlink.active` is set, nothing in the ROM ever clears it on its own.
A peer that crashes, closes the tab or loses the relay mid-handshake leaves the other
side on a black screen with the controls locked until the page is reloaded.

Wanted: a watchdog in `BrNetlink_Tick` -- if the link has been active for N seconds
and the peer has sent nothing at all, unwind it and put the trainer back on the field
(Kanto has the same shape in its bag-stall watchdog). Nothing recovers a match, but a
player who can walk away is not a player who has to reload.

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

---

## What is left, 2026-09-17 (after the night's pass)

Everything above that is not marked **fixed**, plus:

* **A `-1` HP mon.** Needs one detail before it can be chased: was it one HP short of
  full, or did the screen literally read `-1`, and where -- party screen, health box or
  summary? The fog's bleed takes `maxHp/10` with a minimum of 1, which looks like "one
  short" the moment the ring goes active; a literal `-1` is a different bug.
* **"Found 0"** at ~11:00 of the first video, unexplained. Which line said it, and what
  had just happened.
* **A link battle nobody answers still has no way out.** The one way in that we knew
  about is closed (`4cc935d1c`), but `gBrNetlink.active` is never cleared by anything in
  the ROM: a peer that crashes or loses the relay mid-handshake leaves the other side on
  a black screen with the controls locked. Wanted: a watchdog in `BrNetlink_Tick`, the
  shape `BrPick_Wait`'s now has.
* **Rejoining a room after a dropped socket.** The relay hands out a new id on a rejoin
  and that id is the page's seat, so a mid-match rejoin would change who you are. Needs
  a relay-side resume before the page can do anything better than say so.
* **Six Zone areas is thin for a two-minute opening** (see above). A pacing decision,
  not a bug: worth measuring how often two contestants share an area first.
