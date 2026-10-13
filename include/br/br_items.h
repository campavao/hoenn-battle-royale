#ifndef GUARD_BR_ITEMS_H
#define GUARD_BR_ITEMS_H

// The item rework (2026-10-13, the speed-up redesign). In a match:
//   - a vitamin is used on the spot, on the whole party: that stat's EVs go to the top
//     (MAX_PER_STAT_EVS, past the 510 total) and never reach the bag;
//   - a sell item (NUGGET, PEARL, STARDUST, a shard...) is its sell price;
//   - a status heal is a FULL RESTORE;
//   - a ball off the ground is six of them (the MASTER BALL stays one);
//   - a medicine used from the bag works on the whole party.
// With no match running every item is pret's.

#define BR_ITEMS_TO_BAG 0 // put *item, *count in the bag (they may have changed)
#define BR_ITEMS_USED   1 // used or sold already; `text` says what happened

// Something off the ground: a map's item ball (Std_FindItem) or one of our own pieces.
// `text`, when not NULL, gets one line for BR_ITEMS_USED (at least 41 bytes).
u8 BrItems_Pickup(u16 *item, u16 *count, u8 *text);

// AddBagItem's own check, for whatever else arrives (a hidden item, a prize, a mart):
// TRUE when the item was used or sold and nothing goes in the bag; *item may change.
bool8 BrItems_Arrive(u16 *item, u16 count);

// Std_FindItem, by callnative: VAR_RESULT TRUE when the ball was used up here and
// gStringVar4 says how (BR_EventScript_FoundUsed; a pile of balls is bagged here too),
// else the script carries on with VAR_0x8000 and VAR_0x8001 as BrItems_Pickup left them.
void BrItems_FindItem(void);

// ItemUseOutOfBattle_Medicine: TRUE when the match took the use over and healed the
// whole party (or said it would do nothing).
bool8 BrItems_HealParty(u8 taskId);

#endif // GUARD_BR_ITEMS_H
