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

// A bot's bag rides on the card too (POK-237). The page deals it items, hands over the
// few it may spend in THIS fight, and the AI here is given exactly those instead of the
// rung's potion conjured out of nothing -- Emerald's trainer AI reads MAX_TRAINER_ITEMS
// of them, so four is the whole allowance. What it spends goes back as BR_MSG_SPENT,
// because the bag lives on the host's page and this is the only thing that saw the
// fight: what is left is what hits the ground when the bot falls.
#define BR_BOT_ITEMS 4

struct BrBotFight
{
    /* 0 */ u8 staged;    // a party is sitting in gEnemyParty waiting for its challenge
    /* 1 */ u8 seat;      // whose it is
    /* 2 */ u8 fighting;  // the battle is running
    /* 3 */ u8 count;     // mons staged, 1..6
    /* 4 */ u8 name[8];   // the bot's name, Gen 3 charmap, EOS-terminated
    /* C */ u8 itemCount; // items on the card, 0..BR_BOT_ITEMS
    /* D */ u8 spent;     // bit i: item i was used in this battle
    /* E */ u16 items[BR_BOT_ITEMS];
    /* 16*/ u8 pad[2];    // BrBot_Init clears this with CpuFill32, which moves whole
                          // words: without the pad the last two bytes of items[] are
                          // never zeroed and a stale bag survives into the next match.
};                        // 24 bytes

extern struct BrBotFight gBrBotFight;

void BrBot_Init(void);
// The heap was re-initialised: anything this module was holding there is gone.
void BrBot_HeapReset(void);
void BrBot_Tick(void);
// The engage asks before it opens a netlink: is this seat a bot with a party staged?
bool8 BrBot_IsStaged(u8 seat);
// The AI's setup asks what this bot is carrying (battle_ai_script_commands.c) and the
// fight tells us back which of them it used.
void BrBot_NoteItemUsed(u16 item);
// Starts the trainer battle against the staged party. TRUE when it took the fight.
bool8 BrBot_StartFight(u8 seat);
// CB2_InitBattleInternal: TRUE while a staged bot party is in gEnemyParty, so the
// engine must not overwrite it from gTrainers.
bool8 BrBot_PartyIsStaged(void);

#endif // GUARD_BR_BOT_H
