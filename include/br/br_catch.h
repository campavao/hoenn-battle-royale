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
    /* 2 */ u8 pad[2];
};

extern struct BrCatch gBrCatch;
extern struct Pokemon gBrPendingCatch;

void BrCatch_Init(void);
void BrCatch_Tick(void);
// From Cmd_givecaughtmon: TRUE when the party is full and the mon was parked here.
bool8 BrCatch_TryPark(struct Pokemon *mon);
// Special: after ChoosePartyMon, VAR_0x8004 says which slot gives way (or nothing).
void BrCatch_Apply(void);

#endif // GUARD_BR_CATCH_H
