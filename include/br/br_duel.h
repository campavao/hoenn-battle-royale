#ifndef GUARD_BR_DUEL_H
#define GUARD_BR_DUEL_H

#include "br/br_config.h"
// BR_BOT_ITEMS: a duel's bags are the same four units a bot stakes on a fight with a
// player (POK-237), so the two read the same constant.
#include "br/br_bot.h"

// Two bots fighting, for real (POK-238, Kanto BR-28).
//
// A bot-vs-bot meeting is settled on the page today by weighing the two teams against
// the seed (web/src/bots/duel.ts). That resolves matches and is fair, but it is a coin
// flip with arithmetic in front of it: nobody can watch it, and the result owes nothing
// to type, level-up moves or the items either side is carrying.
//
// So the host's tab boots a SECOND, hidden copy of this ROM and makes it fight the duel
// properly. That instance is not in anybody's room -- it has no seat, no ghosts and no
// relay -- it exists to be handed two parties and asked who wins.
//
// The entry path is deliberately the bot fight's (br_bot.c), not a new boot mode: an
// earlier attempt entered the battle from a fresh boot and stalled forever on "TRAINER
// would like to battle!" with battler 1's controller flag never clearing, while the
// same battle type entered from BrBot_StartFight worked. Same task, same fade, same
// CB2_InitBattle, mid-match phase -- the only thing this adds is that BOTH sides are
// played by the AI.

#define BR_DUEL_MAX_MONS 6

struct BrDuel
{
    /* 0 */ u8 staged;   // two parties are in, waiting for the fade
    /* 1 */ u8 running;  // the battle is on, and battler 0 is an AI too
    /* 2 */ u8 seatA;    // whose party is in gPlayerParty
    /* 3 */ u8 seatB;    // whose is in gEnemyParty
    /* 4 */ u8 countA;
    /* 5 */ u8 countB;
    /* 6 */ u8 proxy;    // a DUEL has arrived here at least once: this ROM is the
                         // hidden instance, not somebody's game
    /* 7 */ u8 itemCount[2];  // [0] side A, [1] side B (POK-237's bags, POK-238's fight)
    /* 9 */ u8 spent[2];      // bit i: that side's item i was used
    /* B */ u8 pad;
    /* C */ u16 items[2][BR_BOT_ITEMS];
};                       // 28 bytes

extern struct BrDuel gBrDuel;

// Which party the opponent controller is speaking for. Both battlers are on that
// controller in a duel, and the one standing in the player's position owns gPlayerParty
// -- so battle_controller_opponent.c reads and writes through this instead of a fixed
// array. Always gEnemyParty outside a duel, which is what it has always been.
struct Pokemon *BrDuel_ControllerParty(void);

// Emerald keeps ONE trainer's worth of items in BATTLE_HISTORY, and a duel has two
// trainers in it (POK-237). So the side about to decide gets its own bag loaded in
// first: called before every AI item decision, a no-op outside a duel.
void BrDuel_LoadItems(u8 battler);
// The AI reached for one. Recorded per side, so the page can spend the right bag.
void BrDuel_NoteItemUsed(u16 item);

void BrDuel_Init(void);
void BrDuel_HeapReset(void);
void BrDuel_Tick(void);
// battle_controllers.c: TRUE while a duel is running, so battler 0 -- the side that is
// normally the person holding the GBA -- is played by the same AI as battler 1.
bool8 BrDuel_Running(void);
// TRUE once this ROM has been asked to fight a duel. The instance is nobody's game --
// it has no seat in the room -- so the things a match does to a player who loses (the
// whiteout, going OUT) must not happen here.
bool8 BrDuel_IsProxy(void);

#endif // GUARD_BR_DUEL_H
