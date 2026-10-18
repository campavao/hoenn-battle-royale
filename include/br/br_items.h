#ifndef GUARD_BR_ITEMS_H
#define GUARD_BR_ITEMS_H

#include "constants/items.h"

// The item rework (2026-10-13, the speed-up redesign). In a match:
//   - a vitamin is used on the spot, on the whole party: that stat's EVs go to the top
//     (MAX_PER_STAT_EVS, past the 510 total) and never reach the bag;
//   - a sell item (NUGGET, PEARL, STARDUST, a shard...) is its sell price;
//   - a status heal is a FULL RESTORE;
//   - every ball but the MASTER BALL is a ROYALE BALL (below), and one off the ground is
//     six of them (the MASTER BALL stays one);
//   - a medicine used from the bag works on the whole party (a revive still on one mon).
// With no match running every item is pret's, but for the ROYALE BALL's name, look and
// odds, which are the cartridge's own now.

#define BR_ITEMS_TO_BAG 0 // put *item, *count in the bag (they may have changed)
#define BR_ITEMS_USED   1 // used or sold already; `text` says what happened

// Something off the ground: a map's item ball (Std_FindItem) or one of our own pieces.
// `text`, when not NULL, gets one line for BR_ITEMS_USED (at least 41 bytes).
u8 BrItems_Pickup(u16 *item, u16 *count, u8 *text);

// AddBagItem's own check, for whatever else arrives (a held item TAKEn, a spilled bag's
// GIVE, a prize): TRUE when the item was used or sold, the ticker saying so, and nothing
// goes in the bag; *item may change.
bool8 BrItems_Arrive(u16 *item, u16 count);

// A TM wears its move's name for the length of a match (POK-264, GetItemName), so
// pret's "found one TM22\nSOLARBEAM" line would say the move twice: BufferTMHMMoveName
// says FALSE and the script takes the plain "found one SOLARBEAM" instead.
bool8 BrItems_TmNamedForMove(void);

// Std_FindItem, by callnative: VAR_RESULT TRUE when the ball was used up here and
// gStringVar4 says how (BR_EventScript_FoundUsed; a pile of balls is bagged here too),
// else the script carries on with VAR_0x8000 and VAR_0x8001 as BrItems_Pickup left them.
void BrItems_FindItem(void);

// EventScript_HiddenItemScript, by callnative, the same for a hidden item in VAR_0x8005:
// VAR_RESULT TRUE when it was used here (BR_EventScript_FoundHiddenUsed), else the
// script goes on with VAR_0x8005 as the item to add (a status heal is a FULL RESTORE).
void BrItems_FindHidden(void);

// ItemUseOutOfBattle_Medicine: TRUE when the match took the use over and healed the
// whole party (or said it would do nothing).
bool8 BrItems_HealParty(u8 taskId);

// The LINK CABLE (Cam, 2026-10-13: "so folks could evolve pokemon that can today only
// evolve via trade"). One of pret's unused item ids, made a stone: same pocket, same
// party menu with its ABLE / NOT ABLE, same evolution scene, used up the same way. What
// it evolves into is the trade's own target (BrItems_CableTarget). Red ball loot in the
// maps' item balls (br_balls.c) and on the LILYCOVE DEPARTMENT STORE's shelf with the
// stones (br_levels.c).
#define BR_ITEM_LINK_CABLE ITEM_034

extern const u8 gBrText_LinkCableDesc[];
extern const u32 gBrItemIcon_LinkCable[];
extern const u32 gBrItemIconPalette_LinkCable[];

// The ROYALE BALL (POK-408). Cam, 2026-10-18: "get rid of all pokeballs and make royale
// balls which are like Ultra balls mixed with quick ball. Catching pokemon outside of the
// safari does not feel fun." The POKe BALL's id under another name and description, in
// the SAFARI BALL's picture (Cam: "we can even re-use the safari ball as the royale ball
// sprite"), so the four bits a mon keeps for its ball and every throw, send-out and
// summary page that reads them still work; the ULTRA BALL's odds, twice those on a
// battle's first turn (BrCatch_BallMultiplier). Any other ball arriving in a match
// becomes one (Apply). The MASTER BALL stays itself, the prize it is in gold caches,
// events and the top shelf (Cam: "let's keep master balls"). The SAFARI BALL is a ROYALE
// BALL too ("change safari balls to be royale balls"): the Zone's thirty are still a
// count of their own, not bag items, but they are called ROYALE BALLs and catch at its
// odds on top of the Zone's bait and rocks.
#define BR_ITEM_ROYALE_BALL ITEM_POKE_BALL

extern const u8 gBrText_RoyaleBallDesc[];

struct Pokemon;

// GetEvolutionTargetSpecies for the cable, in EVO_MODE_ITEM_USE or EVO_MODE_ITEM_CHECK:
// what a trade would make of this mon, the held item counting (an ONIX holding a METAL
// COAT is a STEELIX). On a use the held item is spent, as the trade would spend it; a
// check changes nothing.
u16 BrItems_CableTarget(struct Pokemon *mon, u8 mode);

#endif // GUARD_BR_ITEMS_H
