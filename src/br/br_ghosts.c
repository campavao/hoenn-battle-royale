// Ghosts: the roster of seats and their object events (POK-219).
// See include/br/br_ghosts.h for the model. The wire layer feeds Place/Step/Face from
// the mailbox and reads gBrOwnEvents/gBrOwnPos after each tick to tell the relay what
// the local player did.
#include "global.h"
#include "event_object_movement.h"
#include "fieldmap.h"
#include "field_player_avatar.h"
#include "main.h"
#include "overworld.h"
#include "constants/event_objects.h"
#include "constants/event_object_movement.h"
#include "br/br_ghosts.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"

EWRAM_DATA struct BrSeat gBrSeats[BR_MAX_SEATS] = {0};
EWRAM_DATA u8 gBrSeatBusy[BR_MAX_SEATS] = {0};
EWRAM_DATA struct BrOwnPos gBrOwnPos = {0};
EWRAM_DATA u8 gBrOwnEvents = 0;
EWRAM_DATA u8 gBrMySeat = 0;
EWRAM_DATA u8 gBrMySkin = 0;
static EWRAM_DATA u8 sOwnValid = 0;

// Skin -> object event graphics. Index 0 is the default; the shell's career picks.
static const u8 sSkinGraphics[] =
{
    OBJ_EVENT_GFX_BRENDAN_NORMAL,
    OBJ_EVENT_GFX_MAY_NORMAL,
    OBJ_EVENT_GFX_RIVAL_BRENDAN_NORMAL,
    OBJ_EVENT_GFX_RIVAL_MAY_NORMAL,
};
#define BR_SKIN_COUNT (sizeof(sSkinGraphics) / sizeof(sSkinGraphics[0]))

static bool8 OverworldRunning(void)
{
    return gMain.callback2 == CB2_Overworld && !gMain.inBattle;
}

static bool8 OnCurrentMap(const struct BrSeat *s)
{
    return s->mapGroup == gSaveBlock1Ptr->location.mapGroup
        && s->mapNum == gSaveBlock1Ptr->location.mapNum;
}

static struct ObjectEvent *GhostObject(u8 seat)
{
    struct BrSeat *s = &gBrSeats[seat];
    struct ObjectEvent *obj;

    if (s->objId == BR_NO_OBJ)
        return NULL;
    obj = &gObjectEvents[s->objId];
    // A map load wipes the object table under us; the local id is the proof it is still ours.
    if (!obj->active || obj->localId != BR_GHOST_LOCAL_ID_BASE + seat)
    {
        s->objId = BR_NO_OBJ;
        return NULL;
    }
    return obj;
}

static u8 SpawnedCount(void)
{
    u8 i, n = 0;

    for (i = 0; i < BR_MAX_SEATS; i++)
        if (gBrSeats[i].objId != BR_NO_OBJ)
            n++;
    return n;
}

static void Despawn(u8 seat)
{
    struct ObjectEvent *obj = GhostObject(seat);

    if (obj != NULL)
        RemoveObjectEventByLocalIdAndMap(obj->localId, obj->mapNum, obj->mapGroup);
    gBrSeats[seat].objId = BR_NO_OBJ;
    gBrSeats[seat].queued = 0;
}

static void Spawn(u8 seat)
{
    struct BrSeat *s = &gBrSeats[seat];
    u8 gfx = sSkinGraphics[s->skin < BR_SKIN_COUNT ? s->skin : 0];
    u8 id;

    if (SpawnedCount() >= BR_MAX_GHOSTS)
        return;
    id = SpawnSpecialObjectEventParameterized(gfx, MOVEMENT_TYPE_NONE, BR_GHOST_LOCAL_ID_BASE + seat,
                                              s->x, s->y, MapGridGetElevationAt(s->x, s->y));
    if (id >= OBJECT_EVENTS_COUNT)
        return;
    s->objId = id;
    s->queued = 0;
    ObjectEventTurn(&gObjectEvents[id], s->dir);
}

// ---- wire glue: br_wire.h layouts for PLACE (11), STEP (8), FACE (4) -----------

static void HandleBusy(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);

    if (n < 2 || d[0] >= BR_MAX_SEATS)
        return;
    gBrSeatBusy[d[0]] = d[1];
}

static void HandlePlace(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);

    if (n < 11)
        return;
    if (d[1] == 0)
        BrGhosts_Remove(d[0]);
    else
        BrGhosts_Place(d[0], d[10], d[2], d[3], (s16)BrWire_ReadU16(d + 4), (s16)BrWire_ReadU16(d + 6), d[8]);
}

static void HandleStep(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);
    struct BrSeat *s;
    s16 x, y;

    if (n < 8 || d[0] >= BR_MAX_SEATS)
        return;
    s = &gBrSeats[d[0]];
    x = (s16)BrWire_ReadU16(d + 2);
    y = (s16)BrWire_ReadU16(d + 4);
    if (!s->present || s->mapGroup != d[6] || s->mapNum != d[7])
    {
        // A step we cannot follow: treat it as a place so the ghost still appears.
        BrGhosts_Place(d[0], s->present ? s->skin : 0, d[6], d[7], x, y, d[1]);
        return;
    }
    BrGhosts_Step(d[0], d[1]);
    if (s->x != x || s->y != y)
    {
        // Lost a step somewhere; the sender's coordinates win, snap on the next tick.
        s->x = x;
        s->y = y;
        s->queued = BR_STEP_QUEUE + 1;
    }
}

static void HandleFace(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);

    if (n < 4)
        return;
    BrGhosts_Face(d[0], d[1]);
}

// Own place/step/face for the page to forward. The seat byte is what the page
// overwrites with the real seat, so it only has to be plausible here.
static void EmitOwn(void)
{
    u8 buf[11];

    if (gBrOwnEvents & BR_OWN_PLACED)
    {
        buf[0] = gBrMySeat;
        buf[1] = 1;
        buf[2] = gBrOwnPos.mapGroup;
        buf[3] = gBrOwnPos.mapNum;
        BrWire_WriteU16(buf + 4, (u16)gBrOwnPos.x);
        BrWire_WriteU16(buf + 6, (u16)gBrOwnPos.y);
        buf[8] = gBrOwnPos.dir;
        buf[9] = 1;
        buf[10] = gBrMySkin;
        BrWire_Send(BR_MSG_PLACE, buf, 11);
    }
    else if (gBrOwnEvents & BR_OWN_STEPPED)
    {
        buf[0] = gBrMySeat;
        buf[1] = gBrOwnPos.dir;
        BrWire_WriteU16(buf + 2, (u16)gBrOwnPos.x);
        BrWire_WriteU16(buf + 4, (u16)gBrOwnPos.y);
        buf[6] = gBrOwnPos.mapGroup;
        buf[7] = gBrOwnPos.mapNum;
        BrWire_Send(BR_MSG_STEP, buf, 8);
    }
    else if (gBrOwnEvents & BR_OWN_FACED)
    {
        buf[0] = gBrMySeat;
        buf[1] = gBrOwnPos.dir;
        buf[2] = gBrOwnPos.mapGroup;
        buf[3] = gBrOwnPos.mapNum;
        BrWire_Send(BR_MSG_FACE, buf, 4);
    }
    gBrOwnEvents = 0;
}

void BrGhosts_Init(void)
{
    u8 i;

    BrNet_On(BR_MSG_PLACE, HandlePlace);
    BrNet_On(BR_MSG_BUSY, HandleBusy);
    BrNet_On(BR_MSG_STEP, HandleStep);
    BrNet_On(BR_MSG_FACE, HandleFace);

    for (i = 0; i < BR_MAX_SEATS; i++)
    {
        gBrSeats[i].present = FALSE;
        gBrSeats[i].objId = BR_NO_OBJ;
        gBrSeats[i].queued = 0;
        gBrSeatBusy[i] = BR_BUSY_MAP;
    }
    gBrOwnEvents = 0;
    sOwnValid = FALSE;
}

void BrGhosts_Place(u8 seat, u8 skin, u8 mapGroup, u8 mapNum, s16 x, s16 y, u8 dir)
{
    struct BrSeat *s;

    if (seat >= BR_MAX_SEATS)
        return;
    s = &gBrSeats[seat];
    // A place is authoritative: drop whatever the object was doing and put it there.
    Despawn(seat);
    s->present = TRUE;
    s->skin = skin;
    s->mapGroup = mapGroup;
    s->mapNum = mapNum;
    s->x = x;
    s->y = y;
    s->dir = (dir >= DIR_SOUTH && dir <= DIR_EAST) ? dir : DIR_SOUTH;
    // Spawning waits for the tick so a place that arrives mid-map-load is not lost.
}

void BrGhosts_Step(u8 seat, u8 dir)
{
    struct BrSeat *s;

    if (seat >= BR_MAX_SEATS || dir < DIR_SOUTH || dir > DIR_EAST)
        return;
    s = &gBrSeats[seat];
    if (!s->present)
        return;
    // The roster moves now; the object catches up in the tick, one tile per walk.
    s->dir = dir;
    switch (dir)
    {
    case DIR_SOUTH: s->y++; break;
    case DIR_NORTH: s->y--; break;
    case DIR_WEST:  s->x--; break;
    case DIR_EAST:  s->x++; break;
    }
    if (s->queued < BR_STEP_QUEUE)
        s->queue[s->queued++] = dir;
    else
        s->queued = BR_STEP_QUEUE + 1; // overflow: the tick snaps to the roster
}

void BrGhosts_Face(u8 seat, u8 dir)
{
    struct BrSeat *s;

    if (seat >= BR_MAX_SEATS || dir < DIR_SOUTH || dir > DIR_EAST)
        return;
    s = &gBrSeats[seat];
    s->dir = dir;
}

void BrGhosts_Remove(u8 seat)
{
    gBrSeatBusy[seat] = BR_BUSY_MAP;
    if (seat >= BR_MAX_SEATS)
        return;
    Despawn(seat);
    gBrSeats[seat].present = FALSE;
}

u8 BrGhosts_SeatOfObject(u8 objId)
{
    u8 i;

    for (i = 0; i < BR_MAX_SEATS; i++)
        if (gBrSeats[i].objId == objId && GhostObject(i) != NULL)
            return i;
    return BR_NO_OBJ;
}

// Feed one queued walk to the object, or snap it when it fell too far behind.
static void DriveGhost(u8 seat)
{
    struct BrSeat *s = &gBrSeats[seat];
    struct ObjectEvent *obj = GhostObject(seat);
    u8 i;

    if (obj == NULL)
        return;
    if (s->queued > BR_STEP_QUEUE)
    {
        // Overflowed: teleport to the roster position and start clean.
        ObjectEventClearHeldMovementIfActive(obj);
        MoveObjectEventToMapCoords(obj, s->x, s->y);
        ObjectEventTurn(obj, s->dir);
        s->queued = 0;
        return;
    }
    if (ObjectEventIsMovementOverridden(obj))
    {
        if (!ObjectEventClearHeldMovementIfFinished(obj))
            return; // still walking
    }
    if (s->queued > 0)
    {
        u8 dir = s->queue[0];
        for (i = 1; i < s->queued; i++)
            s->queue[i - 1] = s->queue[i];
        s->queued--;
        ObjectEventSetHeldMovement(obj, GetWalkNormalMovementAction(dir));
    }
    else if (obj->facingDirection != s->dir)
    {
        ObjectEventSetHeldMovement(obj, GetFaceDirectionMovementAction(s->dir));
    }
}

static void WatchOwn(void)
{
    struct ObjectEvent *me = &gObjectEvents[gPlayerAvatar.objectEventId];
    struct BrOwnPos now;
    s16 dx, dy;

    now.mapGroup = gSaveBlock1Ptr->location.mapGroup;
    now.mapNum = gSaveBlock1Ptr->location.mapNum;
    now.x = me->currentCoords.x;
    now.y = me->currentCoords.y;
    now.dir = me->facingDirection;

    if (!sOwnValid || now.mapGroup != gBrOwnPos.mapGroup || now.mapNum != gBrOwnPos.mapNum)
    {
        gBrOwnEvents |= BR_OWN_PLACED;
    }
    else if (now.x != gBrOwnPos.x || now.y != gBrOwnPos.y)
    {
        dx = now.x - gBrOwnPos.x;
        dy = now.y - gBrOwnPos.y;
        if ((dx == 0 && (dy == 1 || dy == -1)) || (dy == 0 && (dx == 1 || dx == -1)))
        {
            gBrOwnEvents |= BR_OWN_STEPPED;
            now.dir = dy == 1 ? DIR_SOUTH : dy == -1 ? DIR_NORTH : dx == -1 ? DIR_WEST : DIR_EAST;
        }
        else
        {
            gBrOwnEvents |= BR_OWN_PLACED; // ledge hop, warp within a map, surf mount
        }
    }
    else if (now.dir != gBrOwnPos.dir)
    {
        gBrOwnEvents |= BR_OWN_FACED;
    }
    gBrOwnPos = now;
    sOwnValid = TRUE;
}

void BrGhosts_Tick(void)
{
    u8 seat;

    if (!OverworldRunning())
    {
        sOwnValid = FALSE; // the next overworld frame re-places us (map load, battle end)
        return;
    }
    for (seat = 0; seat < BR_MAX_SEATS; seat++)
    {
        struct BrSeat *s = &gBrSeats[seat];

        if (!s->present)
            continue;
        if (OnCurrentMap(s))
        {
            if (GhostObject(seat) == NULL)
                Spawn(seat);
            DriveGhost(seat);
        }
        else if (s->objId != BR_NO_OBJ)
        {
            Despawn(seat);
        }
    }
    WatchOwn();
    EmitOwn();
}
