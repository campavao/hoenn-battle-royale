// The shot clock and the RUN roll (POK-231). See include/br/br_battle.h.
#include "global.h"
#include "random.h"
#include "br/br_battle.h"

EWRAM_DATA struct BrBattle gBrBattle = {0};

void BrBattle_Init(void)
{
    CpuFill32(0, &gBrBattle, sizeof(gBrBattle));
}

void BrBattle_ShotReset(void)
{
    gBrBattle.shotFrames = 0;
    gBrBattle.autoMove = FALSE;
}

bool8 BrBattle_TakeAutoMove(void)
{
    if (!gBrBattle.autoMove)
        return FALSE;
    gBrBattle.autoMove = FALSE;
    return TRUE;
}

bool8 BrBattle_ShotTick(void)
{
    if (gBrBattle.shotFrames < BR_SHOT_CLOCK_FRAMES)
    {
        gBrBattle.shotFrames++;
        return FALSE;
    }
    gBrBattle.shotFrames = 0;
    gBrBattle.timedOut++;
    return TRUE;
}

bool8 BrBattle_RollRun(void)
{
    gBrBattle.runRolls++;
    // The battle RNG is in step on both sides of a link battle, so both agree.
    if (Random() % 4 == 0)
    {
        gBrBattle.runEscapes++;
        return TRUE;
    }
    return FALSE;
}
