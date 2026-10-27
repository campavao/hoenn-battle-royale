#ifndef GUARD_BR_PATCH_H
#define GUARD_BR_PATCH_H

#include "br/br_config.h"

// Visible encounters (Cam, 2026-10-13: "no step encounters anywhere (grass, caves, water).
// Darkened indicators you can see instead"). Walking through grass meets nothing; a few
// cells on each map stir instead -- the grass's own rustle, darkened, and on water, a
// cave floor or sand a drifting dark shadow -- and stepping on one starts a battle from
// that map's own table. The first trainer there has it: the cell is gone for everybody,
// the way a ball on the ground is, until the ring moves on a phase and every taken patch
// grows back (Cam, 2026-10-14). Two who step on it in the same frame both get their
// battle; the PICKUPs cross, and each takes it off the other's map.
//
// Nothing goes over the wire to place them. The cells are dealt from the match seed and
// the map's own tiles, so every ROM in the room finds the same ones; only taking one is
// sent, as a PICKUP under a key of its own (br_loot.h's 0x2000 space).

// At most this many on a map: one for every BR_PATCH_CELLS cells a battle could start
// on, and never fewer than one on a map that has any.
#define BR_PATCH_MAX 8
#define BR_PATCH_CELLS 16

// A patch's key, `0x2000 | (header << 3) | i`: the map's row in gWildMonHeaders (124 of
// them) and its index on the map, in the key space nothing else uses.
#define BR_PATCH_KEY_BASE 0x2000
#define BR_PATCH_KEY(header, i) ((u16)(BR_PATCH_KEY_BASE | ((header) << 3) | (i)))
#define BR_PATCH_IS_KEY(key) (((key) & 0xE000) == BR_PATCH_KEY_BASE)

struct BrPatch
{
    /*  0 */ u16 map;                       // (group << 8) | num these are for; 0xFFFF none
    /*  2 */ u16 header;                    // its row in gWildMonHeaders
    /*  4 */ u8 count;
    /*  5 */ u8 spriteIds[BR_PATCH_MAX];    // MAX_SPRITES when not drawn
    /* 13 */ u8 pad[3];
    /* 16 */ s16 x[BR_PATCH_MAX];           // map coordinates, +7 like the rest
    /* 32 */ s16 y[BR_PATCH_MAX];
};                                           // 48 bytes
// A driver puts a patch where it wants one (encounter drivers).
BR_OFFSET(BrPatch, map, 0)
BR_OFFSET(BrPatch, count, 4)
BR_OFFSET(BrPatch, x, 16)
BR_OFFSET(BrPatch, y, 32)
BR_SIZE(BrPatch, 48)

extern struct BrPatch gBrPatch;
extern u8 gBrPatchTaken[];
// The pictures (16x16 frames, 4bpp): spike B draws them from the player's ROM too.
extern const u32 gBrPatchTallGrassPic[];
extern const u32 gBrPatchLongGrassPic[];
extern const u32 gBrPatchWaterPic[];
extern const u16 gBrPatchWaterColors[16];

void BrPatch_Init(void);
// Deals this map's patches when we have walked onto a new one, grows the taken ones back
// on a new ring phase, and draws the ones in view. Every frame.
void BrPatch_Tick(void);
// Is the player standing on a patch nobody has taken: the whole of the wild encounter
// check now (wild_encounter.c's WildEncounterCheck).
bool8 BrPatch_Here(void);
// A wild battle is starting: the patch under the player, if there is one, is taken, here
// and for everybody.
void BrPatch_Take(void);
// Somebody's PICKUP, ours included: a patch under that key is gone.
void BrPatch_NoteTaken(u16 key);

#endif // GUARD_BR_PATCH_H
