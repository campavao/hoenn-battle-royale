#ifndef GUARD_BR_GHOSTS_H
#define GUARD_BR_GHOSTS_H

#include "br/br_config.h"

// Ghosts: every other seat in the match, drawn as a real object event on whichever
// map they are on (POK-219). The roster is the ROM's own copy of where everyone is;
// place/step/face messages update it, and each frame BrGhosts_Tick makes the object
// events on the current map agree with it. Spawning is per map: a seat on another map
// has no object event, only a roster row.
//
// Coordinates are map-grid coords the way ObjectEvent.currentCoords holds them
// (MAP_OFFSET included), so a ghost's x,y is the same number the owner's ROM read
// from its own player object. Directions are DIR_SOUTH..DIR_EAST.

struct BrSeat
{
    /* 0 */ u8 present;   // seat is in the match (a row can exist without a ghost)
    /* 1 */ u8 skin;      // index into the graphics table
    /* 2 */ u8 mapGroup;
    /* 3 */ u8 mapNum;
    /* 4 */ s16 x;
    /* 6 */ s16 y;
    /* 8 */ u8 dir;       // facing, DIR_*
    /* 9 */ u8 objId;     // object event id while spawned, else BR_NO_OBJ
    /* 10 */ u8 queued;   // steps received while one was still playing (0..BR_STEP_QUEUE)
    /* 11 */ u8 queue[5]; // the queued directions, FIFO
};                        // 16 bytes

#define BR_NO_OBJ 0xFF

// BR_MSG_BUSY kinds, per seat (POK-230). The engage leaves a seat in a battle alone.
#define BR_BUSY_MAP 0
#define BR_BUSY_MENU 1
#define BR_BUSY_BATTLE 2
extern u8 gBrSeatBusy[BR_MAX_SEATS];
#define BR_STEP_QUEUE 5
// OBJECT_EVENTS_COUNT is 16; the player, loot and map NPCs need the rest.
#define BR_MAX_GHOSTS 12

extern struct BrSeat gBrSeats[BR_MAX_SEATS];

void BrGhosts_Init(void);
void BrGhosts_Place(u8 seat, u8 skin, u8 mapGroup, u8 mapNum, s16 x, s16 y, u8 dir);
void BrGhosts_Step(u8 seat, u8 dir);
void BrGhosts_Face(u8 seat, u8 dir);
void BrGhosts_Remove(u8 seat);
// The busy bubble over one seat's ghost (POK-266): "!" in a fight, "?" in a menu.
// TRUE when one fired.
bool8 BrGhosts_Emote(u8 seat);
// Called every frame from BrFrame; only acts while the overworld is running.
void BrGhosts_Tick(void);
// The seat whose ghost is the given object event, or BR_NO_OBJ.
u8 BrGhosts_SeatOfObject(u8 objId);

// Own movement, reported by the same tick: the page forwards these to the relay.
// Each callback fires at most once per frame.
struct BrOwnPos
{
    u8 mapGroup;
    u8 mapNum;
    s16 x;
    s16 y;
    u8 dir;
};
// What the local player's object looked like at the end of the last tick; the wire
// layer compares and emits place/step/face.
extern struct BrOwnPos gBrOwnPos;
// Bit flags set by BrGhosts_Tick for the wire layer to consume and clear.
#define BR_OWN_PLACED 1   // map changed or a non-adjacent jump: send place
#define BR_OWN_STEPPED 2  // moved one tile: send step with gBrOwnPos.dir
#define BR_OWN_FACED 4    // turned in place: send face
extern u8 gBrOwnEvents;
// This ROM's seat and skin; the page sets them from the roster (0 until then).
extern u8 gBrMySeat;
extern u8 gBrMySkin;

#endif // GUARD_BR_GHOSTS_H
