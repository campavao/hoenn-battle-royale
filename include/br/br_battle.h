#ifndef GUARD_BR_BATTLE_H
#define GUARD_BR_BATTLE_H

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
    /* 8 */ u8 pad;           // was autoMove, until POK-313: the clock no longer chooses FIGHT
    /* 9 */ u8 stalled;       // a sub-screen already ran this turn's clock out
    /* 10 */ u16 stallFrames; // frames a screen the battle put up has held the clock
};

extern struct BrBattle gBrBattle;

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
// the trainer back to gMain.savedCallback. Only br_netlink.c's watchdog calls it.
void BrBattle_Unwind(void);

#endif // GUARD_BR_BATTLE_H
