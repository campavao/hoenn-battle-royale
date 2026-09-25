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
BR_OFFSET(BrBotFight, staged, 0)
BR_OFFSET(BrBotFight, seat, 1)
BR_OFFSET(BrBotFight, fighting, 2)
BR_OFFSET(BrBotFight, count, 3)
BR_OFFSET(BrBotFight, name, 4)
BR_OFFSET(BrBotFight, itemCount, 0xC)
BR_OFFSET(BrBotFight, spent, 0xD)
BR_OFFSET(BrBotFight, items, 0xE)
BR_SIZE(BrBotFight, 24)

extern struct BrBotFight gBrBotFight;

void BrBot_Init(void);
// One wire PackedMon row into a real mon. br_duel.c builds both of its parties with
// it, so a duel's mons are made exactly the way a staged bot's are. FALSE, and nothing
// built, when the row's species is not a real one (BrWire_Species).
bool8 BrBot_BuildMon(const u8 *row, struct Pokemon *mon);
// A card's hp/maxHp is a share of the real mon (POK-330 #30): its HP on the ROM's
// scale, and back onto the card's for a report that carries HP alone (the DRESULT).
u16 BrBot_HpFromCard(u16 cardHp, u16 cardMax, u16 realMax);
u16 BrBot_HpToCard(u16 hp, u16 realMax, u16 cardMax);
// Somebody in the first `count` of the party can still fight.
bool8 BrBot_AnyStanding(struct Pokemon *party, u8 count);
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
// The same from wherever we are, not only the field: the parked challenge's way in
// (br_netlink.c), which has seen the menu it is in settle, as a link battle's does.
bool8 BrBot_StartFightHere(u8 seat);
// CB2_InitBattleInternal: TRUE while a staged bot party is in gEnemyParty, so the
// engine must not overwrite it from gTrainers.
bool8 BrBot_PartyIsStaged(void);

#endif // GUARD_BR_BOT_H
