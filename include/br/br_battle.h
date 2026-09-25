#ifndef GUARD_BR_BATTLE_H
#define GUARD_BR_BATTLE_H

#include "br/br_config.h"

// In-battle rules (POK-231): the 30-second shot clock on every choice, and RUN that
// is allowed but hard against another trainer.

#define BR_SHOT_CLOCK_FRAMES (30 * 60)

// What a RUN action's return value carries, so both ROMs of a link battle agree on what
// kind of RUN it was without re-reading a bag or a clock neither can see (POK-231/292).
#define BR_RUN_ROLL 0    // the one-in-four roll
#define BR_RUN_DOLL 1    // a POKe DOLL: a sure getaway, and nobody is eliminated
#define BR_RUN_FORFEIT 2 // the shot clock ran out: a definite loser and a definite winner

// How often B is pressed once a screen the battle put up has held the clock past it.
// Kanto's BAG_BACKOUT_SECONDS: often enough to unwind a picker over a bag over a battle
// in about a second, slow enough to read as a press.
#define BR_BAG_BACKOUT_FRAMES 21

struct BrBattle
{
    /* 0 */ u16 shotFrames;  // frames spent on the current choice
    /* 2 */ u16 timedOut;    // choices the clock made for the player
    /* 4 */ u16 runRolls;    // RUN attempts against a trainer
    /* 6 */ u16 runEscapes;  // ...of which got away, which is one per POKe DOLL spent
    /* 8 */ u8 menu;          // BR_MENU_*: the choice menu the player's controller is on
                              // this frame. The page's tap-to-choose reads it; it is set
                              // by the three input handlers and cleared when a choice is
                              // made (was autoMove until POK-313).
    /* 9 */ u8 stalled;       // a sub-screen already ran this turn's clock out
    /* 10 */ u16 stallFrames; // frames a screen the battle put up has held the clock
};
// web/src/touch.ts reads `menu` (BATTLE_MENU).
BR_OFFSET(BrBattle, shotFrames, 0)
BR_OFFSET(BrBattle, timedOut, 2)
BR_OFFSET(BrBattle, runRolls, 4)
BR_OFFSET(BrBattle, runEscapes, 6)
BR_OFFSET(BrBattle, menu, 8)
BR_OFFSET(BrBattle, stalled, 9)
BR_OFFSET(BrBattle, stallFrames, 10)
BR_SIZE(BrBattle, 12)

extern struct BrBattle gBrBattle;

#define BR_MENU_NONE   0
#define BR_MENU_ACTION 1 // FIGHT / BAG / POKeMON / RUN, bottom right, 2x2
#define BR_MENU_MOVE   2 // the four moves, bottom left, 2x2
#define BR_MENU_SAFARI 3 // BALL / POKeBLOCK / GO NEAR / RUN, bottom right, 2x2

void BrBattle_Init(void);
// The player controller: reset when a choice opens, tick each frame it is open.
void BrBattle_ShotReset(void);
bool8 BrBattle_ShotTick(void);
// Every frame from BrFrame, whatever is on top: the same clock over the BAG and the
// party screen, which the two above cannot see (POK-292).
void BrBattle_TickStall(void);
// HandleAction_Run, link battles: TRUE when the runner gets away. Not a roll -- Cam's
// rule (POK-293) is that a POKe DOLL is the only way out of a fight with another
// trainer, and without one there is no way out. `doll` is what the RUN action carried,
// decided and spent on the runner's own machine and read back here on both.
bool8 BrBattle_TakeRun(bool8 doll);
// The drawn shot clock: the seconds left, top-right of the battle screen. Draw each
// frame a choice menu is open (it follows bg0's scroll so it stays top-right in both
// the action and move menus); hide it when selection ends.
void BrBattle_DrawClock(void);
// The same clock with the seconds handed in: what a spectator draws, since a replay
// has no choice menu of its own to count down (POK-231's `clock` for spectators).
void BrBattle_DrawClockSecs(u8 secs);
void BrBattle_HideClock(void);
// battle_main.c: tear a battle down that the engine cannot end on its own, and hand
// the trainer back to gMain.savedCallback. Only br_netlink.c calls it: a peer that
// never answered, or one that went out mid-fight.
void BrBattle_Unwind(void);

// The spectator's replay (POK-330 #12) reads a fight off its record, so what the record
// did not carry, the replay could not do. A bag item goes on it as four bytes after its
// action, none of them 0xFF, which is the record's "not here yet":
//   [item & 0x7F][item >> 7][a][b]
// For a battler on the player's side, a is the party slot the bag's item went to
// (PARTY_SIZE for none: a ball, a doll, the AI's) and b the move slot a PP item chose;
// on the opponent's side they are the AI's item type and flags, which its script reads.
#define BR_ITEM_RECORD_BYTES 4
// battle_main.c: the bag works in our link battles, and so in a replay of one.
bool8 BrBattle_ItemsAllowed(void);
// battle_main.c, as the choices go on the record: RUN's kind after it, a bag item's bytes.
void BrBattle_RecordChoice(u8 battler);
void BrBattle_RecordItem(u8 battler);
// pokemon.c's ExecuteTableBasedItemEffect: which party slot, and move, a bag item went to.
void BrBattle_NoteItemTarget(u8 partyIndex, u8 moveIndex);
// recorded_battle.c: a recorded item played onto the replay. Returns its id.
u16 BrBattle_ReplayItem(u8 battler, const u8 *rec);
// battle_main.c: TRUE while the battlers are still choosing, when the engine may yet take
// a recorded byte back off the record.
bool8 BrBattle_Choosing(void);

#endif // GUARD_BR_BATTLE_H
