#ifndef GUARD_BR_ENGAGE_H
#define GUARD_BR_ENGAGE_H

// The forced eyeline engage (POK-230): walk into another trainer's line of sight, or
// look down theirs, and the fight starts. No consent step. The lower seat initiates
// on a tie so both sides never challenge at once; the higher seat only ever answers
// the CHALLENGE the page relays to it.

#define BR_SIGHT_RANGE 5

struct BrEngage
{
    /* 0 */ u8 lastTarget;   // seat we last challenged, 0xFF none
    /* 1 */ u8 cooldown;     // frames before another challenge may go out
    /* 2 */ u16 nonce;
    /* 4 */ u16 challenges;  // sent so far, for drivers
    /* 6 */ u8 fledFrom;     // a seat we fled from: no re-challenge while fledLockout > 0, 0xFF none
    /* 7 */ u8 pad;
    /* 8 */ u16 fledLockout; // frames left on the fled-from lockout
};

extern struct BrEngage gBrEngage;

void BrEngage_Init(void);
void BrEngage_Tick(void);
// Called when a link battle returns to the field: a grace on both sides, and a longer
// lockout on the seat we fled from (fleeing is not a way to pick when the fight
// restarts -- the pursuer keeps coming, but we do not turn and re-engage them).
void BrEngage_OnBattleEnd(u8 peerSeat, u8 outcome);

#endif // GUARD_BR_ENGAGE_H
