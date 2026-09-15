#ifndef GUARD_BR_LEVELS_H
#define GUARD_BR_LEVELS_H

// One clock, not two (POK-225): the ring phase is the level rung. Wild Pokemon spawn
// at the rung, the party is lifted to the rung when it rises (outside battle: the
// rung you start a fight at is the rung you fight at), and nothing ever earns EXP.

struct BrLevels
{
    /* 0 */ u8 rung;        // current level for wild mons and the party
    /* 1 */ u8 phaseSeen;   // last ring phase applied
    /* 2 */ u8 pad[2];
};

extern struct BrLevels gBrLevels;

void BrLevels_Init(void);
void BrLevels_Tick(void);
u8 BrLevels_WildLevel(void);
bool8 BrLevels_NoExp(void);

#endif // GUARD_BR_LEVELS_H
