#ifndef GUARD_BR_CATCH_H
#define GUARD_BR_CATCH_H

// Catch rules (POK-227). No nickname prompt (the battle script skips it under BR). A
// catch with a full party is not sent to a PC: the mon waits here, and back in the
// overworld the player picks who to release for it (the "Fortnite rule"), or cancels
// and the catch is gone.

struct BrCatch
{
    /* 0 */ u8 pending;   // gBrPendingCatch holds a mon waiting for a slot
    /* 1 */ u8 asked;     // the release script has been started for it
    /* 2 */ u8 movesSlot; // party slot waiting for the move relearner, 0xFF none
    /* 3 */ u8 pad;
    /* 4 */ u16 fromKey;  // the piece on the ground this catch came out of, so cancelling
                          // the release puts it back rather than destroying it (POK-294).
                          // BR_HELD_NONE when the catch came from a ball thrown in a fight.
};

extern struct BrCatch gBrCatch;
extern struct Pokemon gBrPendingCatch;

void BrCatch_Init(void);
void BrCatch_Tick(void);
// From Cmd_givecaughtmon: TRUE when the party is full and the mon was parked here.
bool8 BrCatch_TryPark(struct Pokemon *mon);
// The same park, for a mon picked up off the ground: `key` is the piece it came out of,
// which stays where it is until a slot is actually chosen (POK-294).
bool8 BrCatch_TryParkFrom(struct Pokemon *mon, u16 key);
// Special: after ChoosePartyMon, VAR_0x8004 says which slot gives way (or nothing).
void BrCatch_Apply(void);
// From the party menu's MOVES row: open the relearner for the slot once back in the field.
void BrCatch_RequestMoves(u8 slot);

#endif // GUARD_BR_CATCH_H
