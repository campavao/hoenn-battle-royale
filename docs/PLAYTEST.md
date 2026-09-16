# Play-test findings

Linear hit its free-issue cap on 2026-09-16 (POK-279 was the last one it took), so
findings live here until there is room again. Each entry is written to be actionable on
its own: what was seen, what is suspected, and where to look. When a ticket exists it is
named; when one is created later, put its id at the top of the entry and leave the rest.

---

## 2026-09-16, Cam, solo and quick play

### Freeze: throwing a Safari Ball at a Makuhita ends with both sprites gone and no input

**Critical.** Video at ~2:50. First mon of the match, a Makuhita, Safari Ball thrown;
"we both just disappeared, and then I was frozen here, I couldn't do anything."

Where to look: `src/br/br_catch.c` (the catch flow: SET style, no nickname, the full-party
release, the trade-evolution on a loot ball) and `battle_controller_safari.c`'s BR hooks.
POK-269's rule is the shape of it — a Safari battle wants *tapped* presses, and a box
waiting for one looks exactly like a freeze. A ball thrown at the buzzer is also a known
edge (POK-261 made the buzzer close a battle in flight); if the opening ended during the
throw, the battle may be being closed underneath the catch.

Reproduce first: `catch-pages.txt` drives a real catch and passes, so this is either a
specific species/ball combination or the buzzer overlapping the throw.

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

### Eliminated in the Safari does not put you into spectating

"When I got out in the Safari, it should have brought me to spectating the other players."

`BrMatch_SafariOver` sends OUT with an empty party (POK-222) and the page has the whole
spectator path (POK-233/POK-260). Nothing joins the two: going out should hand you to a
seat worth watching. Check what the results/spectate flow does on an `out` for our own
seat during `BR_PHASE_SAFARI`, as opposed to during PLAY.

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

### HUD: the second window (the party/ball blobs) is not wanted

"Under the seven left and time display there's an empty looking box... I think it shows
the amount of pokeballs you have or Pokemon you have. I don't think we need that, let's
get rid of it."

That is the wound bar (POK-226): one blob per party mon, green while it is standing. Cam's
call is to remove it. It is `BrHud`'s `winWound` and its draw; taking it out frees BG0
tiles and a window slot, both of which are scarce.

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

---

## 2026-09-16, Cam, earlier session (Linear was full)

### A beaten route trainer drops nothing

"An NPC trainer didn't drop their Pokémon after defeat. What's funny is I did after I lost
to Roxanne, so maybe it's just hooked up to players/bots and not NPCs yet."

It is hooked up: `BrLoot_TrainerBeaten` is called from `battle_setup.c`'s end-of-trainer-
battle path (POK-232). Ruled out so far: `sTrainerObjectEventLocalId` is loaded from the
script's own parameters and `InitTrainerBattleVariables` only clears it when a battle is
*configured*, so it still holds at the end callback.

Left to check: that the object is still in `gObjectEvents` at that moment (the guard
returns early if the lookup fails), and whether the ball is spawned but invisible because
the map's object slots are full. **No driver has ever exercised the real path** —
`trainer-despawn.txt` pokes the despawn list and tests the sweep, not the beating. A
driver that boots next to a route trainer, wins, and asserts a ball on their tile is the
missing test.

### A Pokémon started the match on -1 HP

Needs one detail before it can be chased: was it one HP short of full, or did the screen
literally read `-1`? And where — the party screen, the battle's health box, or the
summary? The fog's bleed takes `maxHp/10` with a minimum of 1, which would look like "one
short" the moment the ring goes active; a literal `-1` is a different bug entirely.

### The analog stick does nothing — **fixed** (`f4c46852c`)

The poll read axes 0 and 1 only, which is where a *standard* pad puts its left stick.
Every axis counts now (even = horizontal, odd = vertical, axis 9 is the DirectInput hat),
and the pad readout names the axes that moved, so the next pad that misbehaves says so.
