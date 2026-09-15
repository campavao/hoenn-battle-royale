#ifndef GUARD_BR_BATTLE_H
#define GUARD_BR_BATTLE_H

// In-battle rules (POK-231): the 30-second shot clock on every choice, and RUN that
// is allowed but hard against another trainer.

#define BR_SHOT_CLOCK_FRAMES (30 * 60)

struct BrBattle
{
    /* 0 */ u16 shotFrames;  // frames spent on the current choice
    /* 2 */ u16 timedOut;    // choices the clock made for the player
    /* 4 */ u16 runRolls;    // RUN attempts against a trainer
    /* 6 */ u16 runEscapes;
    /* 8 */ u8 autoMove;     // the clock chose FIGHT: pick the move at once too
    /* 9 */ u8 pad[3];
};

extern struct BrBattle gBrBattle;

void BrBattle_Init(void);
// The player controller: reset when a choice opens, tick each frame it is open.
void BrBattle_ShotReset(void);
bool8 BrBattle_ShotTick(void);
// The move menu after a timed-out FIGHT: TRUE once, so the move is picked at once.
bool8 BrBattle_TakeAutoMove(void);
// HandleAction_Run, link battles: TRUE when the runner gets away (one in four).
bool8 BrBattle_RollRun(void);

#endif // GUARD_BR_BATTLE_H
