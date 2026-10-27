// Ghosts: the roster of seats and their object events (POK-219).
// See include/br/br_ghosts.h for the model. The wire layer feeds Place/Step/Face from
// the mailbox and reads gBrOwnEvents/gBrOwnPos after each tick to tell the relay what
// the local player did.
#include "global.h"
#include "event_object_movement.h"
#include "fieldmap.h"
#include "metatile_behavior.h"
#include "sprite.h"
#include "field_player_avatar.h"
#include "main.h"
#include "overworld.h"
#include "field_effect.h"
#include "field_effect_helpers.h"
#include "constants/field_effects.h"
#include "constants/event_objects.h"
#include "constants/event_object_movement.h"
#include "constants/map_types.h"
#include "br/br_event.h"
#include "br/br_ghosts.h"
#include "br/br_loot.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "br/br_field.h"
#include "br/br_engage.h"
#include "br/br_spectate.h"

EWRAM_DATA struct BrSeat gBrSeats[BR_MAX_SEATS] = {0};
EWRAM_DATA u8 gBrSeatBusy[BR_MAX_SEATS] = {0};
EWRAM_DATA struct BrOwnPos gBrOwnPos = {0};
EWRAM_DATA u8 gBrOwnEvents = 0;
EWRAM_DATA u8 gBrMySeat = 0;
EWRAM_DATA u8 gBrMySkin = 0;
static EWRAM_DATA u8 sOwnValid = 0;
// Seats the match has put out, a bit each (BrGhosts_Out). A reboot is a new match.
STATIC_ASSERT(BR_MAX_SEATS <= 32, BrOutSeatsFitAWord)
static EWRAM_DATA u32 sOutSeats = 0;
#define SEAT_IS_OUT(seat) (sOutSeats & ((u32)1 << (seat)))
// How fast each ghost walks, and how long it has stood waiting for its next step: the
// pace in the low two bits, the idle frames above them (PaceWalk).
static EWRAM_DATA u8 sPace[BR_MAX_SEATS] = {0};
// The pace each seat says it is going at, off its last STEP (POK-376): BR_PACE_* or
// BR_GAIT_UNKNOWN for a sender that did not say. PaceWalk never walks a ghost slower.
// Two bits a seat, four seats a byte: EWRAM is down to its last hundred bytes.
static EWRAM_DATA u8 sGait[BR_MAX_SEATS / 4] = {0};
#define BR_GAIT_UNKNOWN 3

static u8 GaitOf(u8 seat)
{
    return (sGait[seat >> 2] >> ((seat & 3) * 2)) & 3;
}

static void SetGait(u8 seat, u8 gait)
{
    u8 shift = (seat & 3) * 2;

    sGait[seat >> 2] = (sGait[seat >> 2] & ~(3 << shift)) | (gait << shift);
}

// Skin -> object event graphics. Index 0 is the default; the shell's career picks.
// The wardrobe (POK-282). Cam: "I should be able to pick kind of like any sprites -- the
// way Kanto Battle Royale has it, the amount of wins you get means you get more sprites."
//
// EVEN IS MALE AND ODD IS FEMALE, and that is load-bearing rather than tidy: a skin index
// is the only thing on the wire that says which you are, and both ends read it as a
// parity -- br_netlink.c takes the peer's gender as `skin & 1` and app.ts takes your own
// avatar's as `skin % 2`. Append in pairs or people turn up as the wrong sprite in a link
// battle.
//
// All twelve of the new ones use sAnimTable_Standard, which is the ordinary four-way
// walking NPC table; a single-pose graphic would stand still and slide. This is
// `static const`, so it is ROM and costs no EWRAM at all.
//
// APPEND ONLY. A career file stores the index, so reordering renames everybody's sprite.
// And the C half has to be in a shipped ROM before the page offers the new ones, or they
// all draw as BRENDAN through the clamp in Spawn().
static const u8 sSkinGraphics[] =
{
    OBJ_EVENT_GFX_BRENDAN_NORMAL,
    OBJ_EVENT_GFX_MAY_NORMAL,
    OBJ_EVENT_GFX_RIVAL_BRENDAN_NORMAL,
    OBJ_EVENT_GFX_RIVAL_MAY_NORMAL,
    OBJ_EVENT_GFX_HIKER,
    OBJ_EVENT_GFX_BEAUTY,
    OBJ_EVENT_GFX_CAMPER,
    OBJ_EVENT_GFX_PICNICKER,
    OBJ_EVENT_GFX_SWIMMER_M,
    OBJ_EVENT_GFX_SWIMMER_F,
    OBJ_EVENT_GFX_EXPERT_M,
    OBJ_EVENT_GFX_EXPERT_F,
    OBJ_EVENT_GFX_POKEFAN_M,
    OBJ_EVENT_GFX_POKEFAN_F,
    OBJ_EVENT_GFX_YOUNGSTER,
    OBJ_EVENT_GFX_LASS,
};
#define BR_SKIN_COUNT (sizeof(sSkinGraphics) / sizeof(sSkinGraphics[0]))

static bool8 OnCurrentMap(const struct BrSeat *s)
{
    return s->mapGroup == gSaveBlock1Ptr->location.mapGroup
        && s->mapNum == gSaveBlock1Ptr->location.mapNum;
}

static void DropBlobOf(u8 objId);

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
        // ...and the camera's cull (RemoveObjectEventsOutsideView) takes the object off
        // before we hear it left the view, but not the SURF blob it rode: that floated on
        // the sea, and the ghost's next spawn got a second (Cam's 10-27 play-test).
        if (s->objId != gPlayerAvatar.objectEventId)
            DropBlobOf(s->objId);
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

// A cell on another map, in this map's coordinates, when that map is one of this one's
// N/S/E/W connections (object coords both ways, MAP_OFFSET included). Cell (0,0) of a
// map to the NORTH sits `offset` tiles along and its own height above ours; the rest
// follow from that.
static bool8 AcrossConnection(u8 mapGroup, u8 mapNum, s16 *x, s16 *y)
{
    const struct MapConnections *all = gMapHeader.connections;
    const struct MapConnection *c;
    const struct MapLayout *theirs;
    s32 i;

    if (all == NULL || all->connections == NULL)
        return FALSE;
    for (i = 0, c = all->connections; i < all->count; i++, c++)
    {
        if (c->mapGroup != mapGroup || c->mapNum != mapNum)
            continue;
        theirs = Overworld_GetMapHeaderByGroupAndId(mapGroup, mapNum)->mapLayout;
        switch (c->direction)
        {
        case CONNECTION_NORTH:
            *x += c->offset;
            *y -= theirs->height;
            return TRUE;
        case CONNECTION_SOUTH:
            *x += c->offset;
            *y += gMapHeader.mapLayout->height;
            return TRUE;
        case CONNECTION_EAST:
            *x += gMapHeader.mapLayout->width;
            *y += c->offset;
            return TRUE;
        case CONNECTION_WEST:
            *x -= theirs->width;
            *y += c->offset;
            return TRUE;
        }
    }
    return FALSE;
}

// Where a seat stands in this map's coordinates. Its own, on this map; and while
// spectating, everybody across a seam too. The seat a spectator rides walks over the seam
// the way a player does, the camera with it, and the camera's own crossing loads the next
// map (2026-10-06 play-test: a bot walking out of Rustboro "teleported" into Route 116);
// the rest are drawn where the screen shows them (HBR-42, 10-20 play-test: one just below
// the watched player, on the next map, was drawn by nobody). A spectator fights nobody,
// so a ghost on another map's cell engages nothing.
static bool8 Spectating(void)
{
    return gBrSpectate.follow != BR_NO_SEAT;
}

static bool8 LocalPos(u8 seat, s16 *x, s16 *y)
{
    const struct BrSeat *s = &gBrSeats[seat];

    *x = s->x;
    *y = s->y;
    if (OnCurrentMap(s))
        return TRUE;
    return Spectating() && AcrossConnection(s->mapGroup, s->mapNum, x, y);
}

bool8 BrGhosts_LocalPos(u8 seat, s16 *x, s16 *y)
{
    if (seat >= BR_MAX_SEATS || !gBrSeats[seat].present)
        return FALSE;
    return LocalPos(seat, x, y);
}

// Where this map is drawn: on it, and inside the box the engine keeps objects in.
static bool8 InView(u8 seat)
{
    s16 x, y;

    return gBrSeats[seat].present && LocalPos(seat, &x, &y) && BrField_InObjectView(x, y);
}

static u16 Distance(u8 seat)
{
    s16 x, y;

    LocalPos(seat, &x, &y);
    return BrField_ViewDistance(x, y);
}

u8 BrGhosts_Wanted(void)
{
    u8 seat, n = 0;

    for (seat = 0; seat < BR_MAX_SEATS; seat++)
        if (InView(seat))
            n++;
    return n;
}

u8 BrGhosts_WantedNear(void)
{
    u8 seat, n = 0;

    for (seat = 0; seat < BR_MAX_SEATS; seat++)
    {
        if (InView(seat) && Distance(seat) <= BR_SIGHT_RANGE)
            n++;
    }
    return n;
}

// Which seats in view get an object, as a bit a seat: all of them when there is room,
// else the `limit` nearest the middle of the view, the lower seat first on a tie. The
// ones close enough to engage (BR_SIGHT_RANGE) are the last to go.
static u32 Keep(u8 limit)
{
    u8 seat, other, nearer;
    u16 d, e;
    u32 keep = 0;

    for (seat = 0; seat < BR_MAX_SEATS; seat++)
    {
        if (!InView(seat))
            continue;
        d = Distance(seat);
        for (other = 0, nearer = 0; other < BR_MAX_SEATS && nearer < limit; other++)
        {
            if (other == seat || !InView(other))
                continue;
            e = Distance(other);
            if (e < d || (e == d && other < seat))
                nearer++;
        }
        if (nearer < limit)
            keep |= 1u << seat;
    }
    return keep;
}

// A PLACE, an OUT or a GONE is heard in a battle as often as on the field -- somebody is
// always changing maps -- and off the field the ghost's object is held rather than
// removed under a battle sprite's feet (BrField_RemoveObject, POK-328).
static void DropBlob(u8 seat);

static void Despawn(u8 seat)
{
    struct ObjectEvent *obj = GhostObject(seat);

    // The camera rides this sprite's movement: off it first, or the freed sprite's
    // jump to (0,0) is a jump the camera makes too.
    if (obj != NULL && seat == gBrSpectate.follow)
        BrSpectate_LetGo();
    // The blob reads its rider every frame: gone first, or it reads a freed object.
    DropBlob(seat);
    if (obj != NULL)
        BrField_RemoveObject(obj->localId, obj->mapNum, obj->mapGroup);
    gBrSeats[seat].objId = BR_NO_OBJ;
    gBrSeats[seat].queued = 0;
    sPace[seat] = 0;
}

// BRENDAN and MAY draw from the player's own palette slot, 0, and a ghost of the other
// one loaded its colours there over ours: whichever was loaded last coloured both, so a
// MAY beside a BRENDAN went dark-haired every time either was drawn again -- "May
// sometimes has her hat go black" (2026-10-05 play-test). The RIVAL graphics are the
// same pictures from slot 10, so a ghost of the other gender wears those, and one of
// ours the player's own, which slot 0 already holds.
u8 BrGhosts_WalkGraphic(u8 skin)
{
    return sSkinGraphics[skin < BR_SKIN_COUNT ? skin : 0];
}

static u8 SkinGraphic(u8 skin)
{
    u8 gfx = BrGhosts_WalkGraphic(skin);
    bool8 male;

    if (skin >= 4)
        return gfx;
    male = (skin & 1) == 0;
    if (male == (gSaveBlock2Ptr->playerGender == MALE))
        return male ? OBJ_EVENT_GFX_BRENDAN_NORMAL : OBJ_EVENT_GFX_MAY_NORMAL;
    return male ? OBJ_EVENT_GFX_RIVAL_BRENDAN_NORMAL : OBJ_EVENT_GFX_RIVAL_MAY_NORMAL;
}

// ---- SURF for ghosts (Cam's 2026-10-14 play-test, POK-360: "for bots their surf you can
// see it's not quite showing correctly") -----------------------------------------------
// A ghost on the water rides pret's own SURF blob, the one the player gets (FldEff_SurfBlob
// takes any object), and BRENDAN or MAY sit down on it as the player does. Everybody else
// has no seated picture and rides it as they stand.

static u8 SurfGraphic(u8 gfx)
{
    switch (gfx)
    {
    case OBJ_EVENT_GFX_BRENDAN_NORMAL:       return OBJ_EVENT_GFX_BRENDAN_SURFING;
    case OBJ_EVENT_GFX_MAY_NORMAL:           return OBJ_EVENT_GFX_MAY_SURFING;
    case OBJ_EVENT_GFX_RIVAL_BRENDAN_NORMAL: return OBJ_EVENT_GFX_RIVAL_BRENDAN_SURFING;
    case OBJ_EVENT_GFX_RIVAL_MAY_NORMAL:     return OBJ_EVENT_GFX_RIVAL_MAY_SURFING;
    }
    return gfx;
}

// A ghost's SURF blob, found rather than kept: the blob's own sprite says whose it is
// (data[2], the object it carries), and EWRAM has no room for a table of them.
static struct Sprite *SurfBlob(u8 objId)
{
    u8 i;

    for (i = 0; i < MAX_SPRITES; i++)
    {
        struct Sprite *sprite = &gSprites[i];

        if (sprite->inUse && sprite->callback == UpdateSurfBlobFieldEffect && sprite->data[2] == objId)
            return sprite;
    }
    return NULL;
}

static void DropBlobOf(u8 objId)
{
    struct Sprite *blob = SurfBlob(objId);

    if (blob != NULL)
        DestroySprite(blob);
}

static void DropBlob(u8 seat)
{
    struct ObjectEvent *obj = GhostObject(seat);

    if (obj == NULL)
        return;
    DropBlobOf(gBrSeats[seat].objId);
    gSprites[obj->spriteId].y2 = 0;
}

static void SurfGhost(u8 seat)
{
    struct BrSeat *s = &gBrSeats[seat];
    struct ObjectEvent *obj = GhostObject(seat);
    u8 walk, gfx, id;
    bool8 wet, changed;

    if (obj == NULL)
        return;
    // Under the sea every cell is water, as it is for the player (who dives as one
    // picture): by the tile alone, the seabed stood them up and the seaweed sat them
    // down, swapping picture and blob at every step (Cam's 10-27 play-test, "artifacting
    // around the head" underwater).
    wet = gMapHeader.mapType == MAP_TYPE_UNDERWATER
       || MetatileBehavior_IsSurfableWaterOrUnderwater(
            MapGridGetMetatileBehaviorAt(obj->currentCoords.x, obj->currentCoords.y));
    walk = SkinGraphic(s->skin);
    gfx = wet ? SurfGraphic(walk) : walk;
    changed = obj->graphicsId != gfx;
    if (changed)
        ObjectEventSetGraphicsId(obj, gfx);
    if (!wet)
    {
        // Only a ghost that just came ashore can have one to drop: the search is not
        // for every dry ghost every frame.
        if (changed)
            DropBlob(seat);
        return;
    }
    if (SurfBlob(s->objId) != NULL)
        return;
    gFieldEffectArguments[0] = obj->currentCoords.x;
    gFieldEffectArguments[1] = obj->currentCoords.y;
    gFieldEffectArguments[2] = s->objId;
    id = FieldEffectStart(FLDEFF_SURF_BLOB);
    if (id < MAX_SPRITES)
        SetSurfBlob_BobState(id, BOB_PLAYER_AND_MON);
}

static void Spawn(u8 seat)
{
    struct BrSeat *s = &gBrSeats[seat];
    u8 gfx = SkinGraphic(s->skin);
    u8 id;
    s16 x, y;

    if (SpawnedCount() >= BR_MAX_GHOSTS || !LocalPos(seat, &x, &y))
        return;
    id = SpawnSpecialObjectEventParameterized(gfx, MOVEMENT_TYPE_NONE, BR_GHOST_LOCAL_ID_BASE + seat,
                                              x, y, MapGridGetElevationAt(x, y));
    if (id >= OBJECT_EVENTS_COUNT)
        return;
    s->objId = id;
    s->queued = 0;
    sPace[seat] = 0;
    ObjectEventTurn(&gObjectEvents[id], s->dir);
}

// ---- wire glue: br_wire.h layouts for PLACE (11), STEP (9), FACE (4) -----------

static void HandleBusy(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);

    if (n < 2 || d[0] >= BR_MAX_SEATS)
        return;
    if (gBrSeatBusy[d[0]] != d[1])
    {
        gBrSeatBusy[d[0]] = d[1];
        // Say so now, not up to three seconds from now: the moment somebody steps into
        // a fight is exactly the moment the trainer walking towards them needs it.
        BrGhosts_Emote(d[0]);
        BrSpectate_OnBusy(d[0]);
        return;
    }
    gBrSeatBusy[d[0]] = d[1];
}

// Somebody ran from somebody (POK-266). Nothing about the engage changes here -- the
// lockout is the fleer's own ROM's business (br_engage.c) -- this is only the picture.
static void HandleFled(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);

    if (n < 1 || d[0] >= BR_MAX_SEATS)
        return;
    BrGhosts_Fled(d[0]);
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
    SetGait(d[0], (n >= 9 && d[8] <= BR_PACE_FASTER) ? d[8] : BR_GAIT_UNKNOWN);
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
        gBrJank.lost++;
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

static u8 OwnPace(void);

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
        buf[8] = OwnPace();
        BrWire_Send(BR_MSG_STEP, buf, 9);
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
    BrNet_On(BR_MSG_FLED, HandleFled);
    BrNet_On(BR_MSG_STEP, HandleStep);
    BrNet_On(BR_MSG_FACE, HandleFace);

    for (i = 0; i < BR_MAX_SEATS; i++)
    {
        gBrSeats[i].present = FALSE;
        gBrSeats[i].objId = BR_NO_OBJ;
        gBrSeats[i].queued = 0;
        gBrSeatBusy[i] = BR_BUSY_MAP;
        sPace[i] = 0;
        SetGait(i, BR_GAIT_UNKNOWN);
    }
    gBrOwnEvents = 0;
    sOwnValid = FALSE;
    sOutSeats = 0;
}

// A walker's first step onto the next map is a PLACE (a ROM's own WatchOwn says so on any
// map change, and so does the bot brain): it cannot be a STEP, because the cell is in
// another map's numbers. For the seat being watched that despawned the ghost and warped
// the spectator after it. When the new cell is one step from where the ghost stands,
// across a connection of this map, it is that step, and the ghost walks it.
static bool8 CrossedSeam(u8 seat, u8 mapGroup, u8 mapNum, s16 x, s16 y)
{
    struct BrSeat *s = &gBrSeats[seat];
    s16 ox, oy, nx = x, ny = y;
    u8 dir;

    if (!Spectating() || !s->present || GhostObject(seat) == NULL)
        return FALSE;
    if (mapGroup == s->mapGroup && mapNum == s->mapNum)
        return FALSE;
    if (!LocalPos(seat, &ox, &oy))
        return FALSE;
    if (!(mapGroup == gSaveBlock1Ptr->location.mapGroup && mapNum == gSaveBlock1Ptr->location.mapNum)
     && !AcrossConnection(mapGroup, mapNum, &nx, &ny))
        return FALSE;
    if (nx == ox && ny == oy + 1)
        dir = DIR_SOUTH;
    else if (nx == ox && ny == oy - 1)
        dir = DIR_NORTH;
    else if (ny == oy && nx == ox - 1)
        dir = DIR_WEST;
    else if (ny == oy && nx == ox + 1)
        dir = DIR_EAST;
    else
        return FALSE;
    s->mapGroup = mapGroup;
    s->mapNum = mapNum;
    s->x = x;
    s->y = y;
    s->dir = dir;
    if (s->queued < BR_STEP_QUEUE)
        s->queue[s->queued++] = dir;
    else
        s->queued = BR_STEP_QUEUE + 1;
    return TRUE;
}

void BrGhosts_Place(u8 seat, u8 skin, u8 mapGroup, u8 mapNum, s16 x, s16 y, u8 dir)
{
    struct BrSeat *s;

    // A map gMapGroups does not have is nowhere: following that seat would warp there
    // (br_spectate.c's FollowTick), so it is not placed at all (POK-330 #43).
    if (seat >= BR_MAX_SEATS || !BrWire_MapOk(mapGroup, mapNum))
        return;
    // Out is out: an eliminated seat still walks, as a spectator, and nobody sees it.
    if (SEAT_IS_OUT(seat))
        return;
    s = &gBrSeats[seat];
    if (CrossedSeam(seat, mapGroup, mapNum, x, y))
        return;
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
    // The bound comes first. It came after the write, and a PLACE for seat 41 with no
    // map zeroed gBrMySeat, which sits 41 bytes past gBrSeatBusy (POK-330 #6).
    if (seat >= BR_MAX_SEATS)
        return;
    gBrSeatBusy[seat] = BR_BUSY_MAP;
    Despawn(seat);
    gBrSeats[seat].present = FALSE;
}

void BrGhosts_Out(u8 seat)
{
    if (seat >= BR_MAX_SEATS)
        return;
    sOutSeats |= (u32)1 << seat;
    BrGhosts_Remove(seat);
}

// A ghost walks at the pace its trainer does (2026-10-13 play-test: "players are
// teleporting while watching"). Running is the default in a match (field_player_avatar.c),
// a step every eight frames, and every ghost walked at sixteen: it fell a tile behind
// every sixteen frames, overflowed BR_STEP_QUEUE after about a second and a half, and
// DriveGhost snapped it -- two to four tiles at a jump, over and over, and the camera of
// whoever was watching jumped with it. A bot steps every 267 ms, exactly the walking pace,
// so its backlog never drained either: any burst the network bunched up stayed until the
// queue overflowed.
//
// The backlog says how far behind a ghost is: two steps waiting is a trainer outrunning
// their ghost, and it goes up a pace, again on every step that
// still finds two waiting -- one pace that only matches the trainer's would never work
// the backlog off, and the ghost would trail them two tiles with two slots to spare
// before a snap. Four waiting is straight to the top. And a ghost that stood idle for
// a whole walk of its own between two steps is outrunning its trainer, so it slows down a
// pace. Running, walking and biking each settle on their own pace, and a bunched-up burst
// is walked off at speed instead of piling up. The Mach Bike flat out is the one pace
// with none above it: a long stall there can still overflow the queue.
//
// A STEP also says how fast its sender took it (POK-376, OwnPace): a ghost never walks
// slower than that, and once it has caught up it walks at exactly that. Inferred alone, a runner's ghost walked its first two steps at a walk
// and spent the next ones catching up, and a cyclist's took four to find the bike's
// pace: a lurch at the start of every run that a watcher's camera lurched with. The
// backlog still raises the pace above the sender's to work a bunched-up burst off; a
// bot's page and an older ROM say nothing, and for them the backlog is all there is.
#define BR_PACE_MASK 3
#define BR_PACE_IDLE_MAX 63
#define BR_PACE_FAST_AT 2
#define BR_PACE_FASTER_AT 4

static u8 PaceWalk(u8 seat, u8 dir)
{
    // A walk's frames at each pace: walk_normal, walk_fast (running), walk_faster (the
    // Mach Bike flat out).
    static const u8 sFrames[] = {16, 8, 4};
    u8 pace = sPace[seat] & BR_PACE_MASK;
    u8 idle = sPace[seat] >> 2;
    u8 behind = gBrSeats[seat].queued;
    u8 gait = GaitOf(seat);

    if (behind >= BR_PACE_FASTER_AT)
        pace = BR_PACE_FASTER;
    else if (behind >= BR_PACE_FAST_AT && pace < BR_PACE_FASTER)
        pace++;
    else if (behind == 0 && gait != BR_GAIT_UNKNOWN)
        pace = gait; // caught up: the pace its trainer says, not a step at a time down to it
    else if (behind == 0 && pace != BR_PACE_NORMAL && idle >= sFrames[pace])
        pace--;
    if (gait != BR_GAIT_UNKNOWN && pace < gait)
        pace = gait;
    sPace[seat] = pace;
    if (pace == BR_PACE_FASTER)
        return GetWalkFasterMovementAction(dir);
    if (pace == BR_PACE_FAST)
        return GetWalkFastMovementAction(dir);
    return GetWalkNormalMovementAction(dir);
}

// Feed one queued walk to the object, or snap it when it fell too far behind.
static void DriveGhost(u8 seat)
{
    struct BrSeat *s = &gBrSeats[seat];
    struct ObjectEvent *obj = GhostObject(seat);
    u8 i;
    s16 x, y;

    if (obj == NULL)
        return;
    if (s->queued > BR_STEP_QUEUE)
    {
        // Overflowed: teleport to the roster position and start clean -- with the camera
        // let go of first, if it rides this one (FollowTick takes it back, centred).
        gBrJank.snaps++;
        if (seat == gBrSpectate.follow)
        {
            gBrJank.camSnaps++;
            BrSpectate_LetGo();
        }
        LocalPos(seat, &x, &y);
        ObjectEventClearHeldMovementIfActive(obj);
        MoveObjectEventToMapCoords(obj, x, y);
        ObjectEventTurn(obj, s->dir);
        s->queued = 0;
        sPace[seat] = 0;
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
        ObjectEventSetHeldMovement(obj, PaceWalk(seat, dir));
        return;
    }
    if ((sPace[seat] >> 2) < BR_PACE_IDLE_MAX)
        sPace[seat] += 1 << 2;
    if (obj->facingDirection != s->dir)
        ObjectEventSetHeldMovement(obj, GetFaceDirectionMovementAction(s->dir));
}

// How fast our own step is going, for the STEP that says so: the walk the player's
// object was just handed (field_player_avatar.c). Running and surfing are walk_fast's
// eight frames a tile and a water current's too; the Mach Bike flat out is walk_faster's
// four, and it gets there through the other two (bike.c's sMachBikeSpeedCallbacks).
static u8 OwnPace(void)
{
    u8 action = gObjectEvents[gPlayerAvatar.objectEventId].movementActionId;

    if (action >= MOVEMENT_ACTION_WALK_FASTER_DOWN && action <= MOVEMENT_ACTION_WALK_FASTER_RIGHT)
        return BR_PACE_FASTER;
    if ((action >= MOVEMENT_ACTION_WALK_FAST_DOWN && action <= MOVEMENT_ACTION_WALK_FAST_RIGHT)
     || (action >= MOVEMENT_ACTION_RIDE_WATER_CURRENT_DOWN && action <= MOVEMENT_ACTION_RIDE_WATER_CURRENT_RIGHT)
     || (action >= MOVEMENT_ACTION_PLAYER_RUN_DOWN && action <= MOVEMENT_ACTION_PLAYER_RUN_RIGHT))
        return BR_PACE_FAST;
    return BR_PACE_NORMAL;
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

// How often the busy marks are looked over (POK-266). A mark stays up for as long as its
// trainer is busy (2026-10-05 play-test: "it pops up, fades out, then pops back up after
// a few seconds; it should persist until the user is done"), so this only puts one over a
// ghost that has none: one that walked into view busy, or came back after a map load.
#define BR_EMOTE_FRAMES 30
static EWRAM_DATA u16 sEmoteTimer = 0;
// The mark over each seat's ghost, as its sprite id + 1; 0 for none. Checked against the
// sprite itself before it is believed: a map load frees every sprite without asking.
EWRAM_DATA u8 gBrGhostMark[BR_MAX_SEATS] = {0}; // named for the drivers (emote-busy.txt)

// What everybody else is doing, over their head (POK-266, Kanto v0.29.0). The engage
// already refuses a trainer who is in a menu or a battle -- that is POK-230's rule --
// and nothing showed it, so a trainer standing still in a fight looked exactly like one
// standing still waiting to take yours. Emerald's own trainer-sight icons do the job:
// "?" for a menu, and "VS" for a fight with another trainer (POK-372: the "!" is
// the spotter's alone, as Emerald's is).
//
// trainer_see.c's icon sprite keeps the field effect's id in data[7] and the object's
// local id in data[0]; data[6] is free, and says a mark is being held past its end.
#define MARK_LOCAL_ID(sprite) ((sprite)->data[0])
#define MARK_HELD(sprite)     ((sprite)->data[6])
#define MARK_EFFECT(sprite)   ((sprite)->data[7])

static u8 MarkFor(u8 busy)
{
    if (busy == BR_BUSY_BATTLE)
        return FLDEFF_BR_VS_ICON;
    if (busy == BR_BUSY_MENU)
        return FLDEFF_QUESTION_MARK_ICON;
    return 0xFF;
}

// The mark a seat's ghost wears now. None over the trainer we are watching (Cam's 10-27
// play-test: "tooltips appearing constantly when a player I'm spectating is doing
// something"): the mark tells somebody walking up that they cannot engage, and a watcher
// sees what that trainer is doing anyway -- every menu, sign and fight popped one.
static u8 SeatMark(u8 seat)
{
    if (seat == gBrSpectate.follow)
        return 0xFF;
    return MarkFor(gBrSeatBusy[seat]);
}

// The seat's ghost already wears this mark.
static bool8 Marked(u8 seat, u8 effect)
{
    struct Sprite *sprite;

    if (gBrGhostMark[seat] == 0)
        return FALSE;
    sprite = &gSprites[gBrGhostMark[seat] - 1];
    if (sprite->inUse && MARK_LOCAL_ID(sprite) == BR_GHOST_LOCAL_ID_BASE + seat && MARK_EFFECT(sprite) == effect)
        return TRUE;
    gBrGhostMark[seat] = 0;
    return FALSE;
}

bool8 BrGhosts_DropMark(struct Sprite *sprite, bool8 objectGone)
{
    s16 localId = MARK_LOCAL_ID(sprite);
    u8 seat;

    // Anybody else's mark, and the runner's boot, are pret's: up, bob, gone.
    if (localId < BR_GHOST_LOCAL_ID_BASE || localId >= BR_GHOST_LOCAL_ID_BASE + BR_MAX_SEATS
     || (MARK_EFFECT(sprite) != FLDEFF_BR_VS_ICON && MARK_EFFECT(sprite) != FLDEFF_QUESTION_MARK_ICON))
        return objectGone || sprite->animEnded;
    seat = localId - BR_GHOST_LOCAL_ID_BASE;
    if (objectGone || MARK_EFFECT(sprite) != SeatMark(seat))
    {
        if (gBrGhostMark[seat] == sprite - gSprites + 1)
            gBrGhostMark[seat] = 0;
        // Back on the list for the FieldEffectStop that follows to take off again.
        if (MARK_HELD(sprite))
            FieldEffectActiveListAdd(MARK_EFFECT(sprite));
        return TRUE;
    }
    // Still busy, and still this kind of busy: held on its last frame, over their head.
    // Off the active list once the bounce is done, though: a trainer who spots the player
    // waits for no "!" on that list before walking over (trainer_see.c), and a held one
    // would keep him standing there for as long as somebody else's fight went on.
    if (sprite->animEnded && !MARK_HELD(sprite))
    {
        MARK_HELD(sprite) = TRUE;
        FieldEffectActiveListRemove(MARK_EFFECT(sprite));
    }
    gBrGhostMark[seat] = sprite - gSprites + 1;
    return FALSE;
}

// Points the field-effect arguments at a seat's ghost. FALSE when it has none here.
static bool8 AimAtGhost(u8 seat)
{
    struct ObjectEvent *obj;

    if (seat >= BR_MAX_SEATS || !BrField_OverworldRunning())
        return FALSE;
    obj = GhostObject(seat);
    if (obj == NULL)
        return FALSE;
    ObjectEventGetLocalIdAndMap(obj, &gFieldEffectArguments[0], &gFieldEffectArguments[1],
                                &gFieldEffectArguments[2]);
    return TRUE;
}

bool8 BrGhosts_Emote(u8 seat)
{
    u8 effect = seat < BR_MAX_SEATS ? SeatMark(seat) : 0xFF;

    if (effect == 0xFF || Marked(seat, effect) || !AimAtGhost(seat))
        return FALSE;
    FieldEffectStart(effect);
    return TRUE;
}

// Somebody ran (POK-266). Unlike the busy marks this is an event, not a state: it fires
// once, where they were standing when the news arrived, and nothing repeats it.
bool8 BrGhosts_Fled(u8 seat)
{
    if (!AimAtGhost(seat))
        return FALSE;
    FieldEffectStart(FLDEFF_BR_BOOT_ICON);
    return TRUE;
}

bool8 BrGhosts_Idle(u8 seat)
{
    const struct BrSeat *s;
    struct ObjectEvent *obj;

    if (seat >= BR_MAX_SEATS)
        return TRUE;
    s = &gBrSeats[seat];
    obj = GhostObject(seat);
    if (obj == NULL)
        return TRUE;
    if (s->queued != 0)
        return FALSE;
    if (ObjectEventIsMovementOverridden(obj) && ObjectEventCheckHeldMovementStatus(obj) == 0)
        return FALSE; // its last walk or turn is still playing
    return obj->currentCoords.x == s->x && obj->currentCoords.y == s->y
        && obj->facingDirection == s->dir;
}

static void EmoteBusyGhosts(void)
{
    u8 seat;

    if (++sEmoteTimer < BR_EMOTE_FRAMES)
        return;
    sEmoteTimer = 0;
    // One new mark a pass is plenty: a pass is half a second.
    for (seat = 0; seat < BR_MAX_SEATS; seat++)
    {
        if (BrGhosts_Emote(seat))
            return;
    }
}

// The ranges are BR's own: an event's traders at 0xBC, loot at 0xC0 and ghosts at 0xC8,
// one run from 0xBC to the last seat's 0xE7 (br_event.c asserts the traders' end). No
// map's own people come near 0xBC. LOCALID_PLAYER is 255 and above it all, so the player
// is never mistaken for one -- which matters, because this is asked about every object on the map,
// the player included, whenever anything else tries to move. It ran to 254, which took
// in the berry blender's 236..240 as well (POK-330 #28).
STATIC_ASSERT(BR_LOOT_LOCAL_ID_BASE + BR_MAX_LOOT == BR_GHOST_LOCAL_ID_BASE, BrLootAndGhostLocalIdsAreOneRun)
bool8 BrGhosts_Ours(u8 localId)
{
    return localId >= BR_EVENT_LOCAL_ID_BASE && localId < BR_GHOST_LOCAL_ID_BASE + BR_MAX_SEATS;
}

// A ghost never stops a step, loot does while A would take it, a trader always does. See
// the header for why.
bool8 BrGhosts_Passable(u8 localId)
{
    if (localId >= BR_GHOST_LOCAL_ID_BASE && localId < BR_GHOST_LOCAL_ID_BASE + BR_MAX_SEATS)
        return TRUE;
    if (localId >= BR_LOOT_LOCAL_ID_BASE && localId < BR_GHOST_LOCAL_ID_BASE)
        return !BrLoot_Solid(localId);
    return FALSE;
}

void BrGhosts_Tick(void)
{
    u8 seat, limit, loot;
    u32 keep;

    if (!BrField_OverworldRunning())
    {
        sOwnValid = FALSE; // the next overworld frame re-places us (map load, battle end)
        return;
    }
    BrField_ShareObjects(&limit, &loot);
    keep = BrGhosts_Wanted() <= limit ? 0xFFFFFFFF : Keep(limit);
    // Out of view, off this map or past the share: let go first, so a nearer seat has
    // the slot this frame (POK-330 #48).
    for (seat = 0; seat < BR_MAX_SEATS; seat++)
    {
        if (gBrSeats[seat].objId != BR_NO_OBJ && !(InView(seat) && (keep & (1u << seat))))
            Despawn(seat);
    }
    for (seat = 0; seat < BR_MAX_SEATS; seat++)
    {
        if (!InView(seat) || !(keep & (1u << seat)))
            continue;
        if (GhostObject(seat) == NULL)
            Spawn(seat);
        DriveGhost(seat);
        SurfGhost(seat);
    }
    EmoteBusyGhosts();
    WatchOwn();
    EmitOwn();
}
