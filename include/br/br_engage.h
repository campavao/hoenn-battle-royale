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
    /* 6 */ u16 pad;
};

extern struct BrEngage gBrEngage;

void BrEngage_Init(void);
void BrEngage_Tick(void);

#endif // GUARD_BR_ENGAGE_H
