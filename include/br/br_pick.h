#ifndef GUARD_BR_PICK_H
#define GUARD_BR_PICK_H

#include "br/br_config.h"

// The drop (POK-223).
//
// Kanto put the TOWN MAP cursor in front of you at the gate and let you choose where
// the match started for you. Emerald has the same screen already -- the fly map -- with
// a cursor, the section names, and every icon drawn. So the opening ends by opening it
// in "pick" mode: every section selectable, whether or not this save has ever been
// there, because a battle royale is not a playthrough.
//
// The ROM does not know where in a section a trainer can stand -- the walkability is
// the page's (world.json, POK-235) -- so the choice goes out as `pick {seat, section}`
// and the host deals a cell nobody else has and sends `land {seat, map, x, y}` back.
// That is also what stops two trainers landing on the same tile.

struct BrPick
{
    /* 0 */ u8 active;    // the fly map is open, or we are waiting for a `land`
    /* 1 */ u8 landed;    // a `land` has arrived and is waiting for a quiet frame
    /* 2 */ u8 mapGroup;
    /* 3 */ u8 mapNum;
    /* 4 */ s16 x;
    /* 6 */ s16 y;
    /* 8 */ u16 timer;    // frames left to choose; 0 means the map chose for you
};                        // 10 bytes

extern struct BrPick gBrPick;
extern const u8 gBrText_DropWhere[];

void BrPick_Init(void);
void BrPick_Tick(void);
// The opening is over: put the map in front of them. TRUE when it took the drop, so
// br_match leaves the warp alone.
bool8 BrPick_Start(void);
// region_map.c, on the A press: this is our choice. Sends `pick`.
void BrPick_Chose(u16 mapSec);
// region_map.c: is the fly map being used as the drop picker right now? In pick mode
// every section is selectable and choosing one does not warp.
bool8 BrPick_Picking(void);
// region_map.c, once the map has closed: hold a black screen until `land` arrives.
void BrPick_Wait(void);
// region_map.c, every frame the map is up: has the clock run out? A trainer who does
// not choose still has to land somewhere, or they hold up nothing but themselves --
// and a match cannot wait on a tab nobody is looking at.
bool8 BrPick_TimedOut(void);

#endif // GUARD_BR_PICK_H
