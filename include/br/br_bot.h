#ifndef GUARD_BR_BOT_H
#define GUARD_BR_BOT_H

#include "br/br_config.h"

// Fighting a bot (POK-238, the bot-vs-player half).
//
// A bot has no ROM, so there is nothing on the other end of a link battle -- it is a
// seat the host's tab walks around. What it does have is a party, and Emerald already
// knows how to fight a party it is handed: an ordinary trainer battle.
//
// So the page stages one. BR_MSG_TRAINER carries the bot's team (the wire's PackedMon
// rows) and its name; the ROM builds them into gEnemyParty there and then, the way a
// link battle fills it from the exchange, and CB2_InitBattleInternal leaves them alone
// instead of asking gTrainers for a party. The CHALLENGE that follows starts an
// ordinary BATTLE_TYPE_TRAINER fight. Nothing about the battle itself is special --
// which is the point, because everything downstream (the shot clock, RUN, the spill on
// a loss, the result) already works.

struct BrBotFight
{
    /* 0 */ u8 staged;    // a party is sitting in gEnemyParty waiting for its challenge
    /* 1 */ u8 seat;      // whose it is
    /* 2 */ u8 fighting;  // the battle is running
    /* 3 */ u8 count;     // mons staged, 1..6
    /* 4 */ u8 name[8];   // the bot's name, Gen 3 charmap, EOS-terminated
};                        // 12 bytes

extern struct BrBotFight gBrBotFight;

void BrBot_Init(void);
// The heap was re-initialised: anything this module was holding there is gone.
void BrBot_HeapReset(void);
void BrBot_Tick(void);
// The engage asks before it opens a netlink: is this seat a bot with a party staged?
bool8 BrBot_IsStaged(u8 seat);
// Starts the trainer battle against the staged party. TRUE when it took the fight.
bool8 BrBot_StartFight(u8 seat);
// CB2_InitBattleInternal: TRUE while a staged bot party is in gEnemyParty, so the
// engine must not overwrite it from gTrainers.
bool8 BrBot_PartyIsStaged(void);

#endif // GUARD_BR_BOT_H
