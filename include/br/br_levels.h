#ifndef GUARD_BR_LEVELS_H
#define GUARD_BR_LEVELS_H

// One clock, not two (POK-225): the ring phase is the level rung. Wild Pokemon spawn
// at the rung, the party is lifted to the rung when it rises (outside battle: the
// rung you start a fight at is the rung you fight at), and nothing ever earns EXP.

struct BrLevels
{
    /* 0 */ u8 rung;        // current level for wild mons and the party
    /* 1 */ u8 phaseSeen;   // last ring phase applied
    /* 2 */ u8 tier;        // ladder index 0..5: the Mart shelf and the rod
    /* 3 */ u8 pad;
    /* 4 */ u16 rod;        // the rod item in the bag right now
    /* 6 */ u16 pad2;
};

extern struct BrLevels gBrLevels;

void BrLevels_Init(void);
void BrLevels_Tick(void);
u8 BrLevels_WildLevel(void);
// The Mart's shelf for the current tier (ITEM_NONE-terminated), for CreatePokemartMenu.
const u16 *BrLevels_MartItems(void);
// What an item costs, for GetItemPrice: the match's own price for the few Emerald
// never sells, else `price`, the item table's.
u16 BrLevels_ItemPrice(u16 itemId, u16 price);
// The potion a trainer's AI carries at a lead of `level` when there is no bag to give
// it: a bot whose card came without one (br_bot.c).
u16 BrLevels_RungPotion(u8 level);
// The starting bag: an OLD ROD and a few balls. Called once by the boot.
void BrLevels_GiveStartingBag(void);
bool8 BrLevels_NoExp(void);
// One clock for Hoenn's own trainers too: their team at the rung the match is at,
// rather than the levels the game shipped them with (POK-234).
void BrLevels_LiftTrainer(struct Pokemon *party, u8 count);
// Every move its learnset would have taught it by `level`, the walk the party and the
// trainers get on a rung (POK-311): how a bot's mon, built from a card, gets its moves.
void BrLevels_TeachUpTo(struct Pokemon *mon, u8 level);

#endif // GUARD_BR_LEVELS_H
