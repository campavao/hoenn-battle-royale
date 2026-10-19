// The walk-up before a fight (POK-373, POK-409). See include/br/br_walkup.h.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "task.h"
#include "field_effect.h"
#include "field_player_avatar.h"
#include "fieldmap.h"
#include "metatile_behavior.h"
#include "event_object_movement.h"
#include "constants/field_effects.h"
#include "br/br_ghosts.h"
#include "br/br_walkup.h"

#define tState data[BR_WALKUP_DATA]
#define tTimer data[BR_WALKUP_DATA + 1]
#define tWalker data[BR_WALKUP_DATA + 2]

// The ! bubble over the one who walks up: our own trainer, or their ghost (or ourselves
// if their ghost is not on this map).
static void StartExclamation(u8 seat, bool8 overMe)
{
    struct ObjectEvent *obj = &gObjectEvents[gPlayerAvatar.objectEventId];

    if (!overMe && gBrSeats[seat].objId != BR_NO_OBJ)
        obj = &gObjectEvents[gBrSeats[seat].objId];
    ObjectEventGetLocalIdAndMap(obj, &gFieldEffectArguments[0], &gFieldEffectArguments[1], &gFieldEffectArguments[2]);
    FieldEffectStart(FLDEFF_EXCLAMATION_MARK_ICON);
}

// The seat's ghost in a straight line from us, and which way. FALSE when it is not
// drawn on this map or not on our row or column (the eyeline always is; a snap is not).
static bool8 InLine(u8 seat, s16 *dist, u8 *dir)
{
    struct ObjectEvent *me = &gObjectEvents[gPlayerAvatar.objectEventId];
    struct ObjectEvent *them;
    s16 dx, dy;

    if (gBrSeats[seat].objId == BR_NO_OBJ)
        return FALSE;
    them = &gObjectEvents[gBrSeats[seat].objId];
    dx = them->currentCoords.x - me->currentCoords.x;
    dy = them->currentCoords.y - me->currentCoords.y;
    if ((dx != 0) == (dy != 0))
        return FALSE;
    if (dx > 0) { *dir = DIR_EAST; *dist = dx; }
    else if (dx < 0) { *dir = DIR_WEST; *dist = -dx; }
    else if (dy > 0) { *dir = DIR_SOUTH; *dist = dy; }
    else { *dir = DIR_NORTH; *dist = -dy; }
    return TRUE;
}

// A walk by `obj` one cell on is an ordinary step: nothing in the way, no ledge, and on
// water as it was on water. The eyeline sees across a pond and over a ledge; a walk
// does neither, so that is where the walk-up stops and the fight starts. The side that
// waits asks it of the walker's ghost, so both sides judge the same walker's steps.
static bool8 CanStep(struct ObjectEvent *obj, u8 dir)
{
    s16 x = obj->currentCoords.x, y = obj->currentCoords.y;
    bool8 surfing = MetatileBehavior_IsSurfableWaterOrUnderwater(MapGridGetMetatileBehaviorAt(x, y));

    MoveCoords(dir, &x, &y);
    if (GetCollisionAtCoords(obj, x, y, dir) != COLLISION_NONE || GetLedgeJumpDirection(x, y, dir) != DIR_NONE)
        return FALSE;
    return MetatileBehavior_IsSurfableWaterOrUnderwater(MapGridGetMetatileBehaviorAt(x, y)) == surfing;
}

// Each side reads the same facings once both are still (br_walkup.h has the rules), so
// both pick the same walker.
static bool8 IWalk(u8 seat, u8 rule)
{
    struct ObjectEvent *me = &gObjectEvents[gPlayerAvatar.objectEventId];
    struct ObjectEvent *them;
    bool8 meLooks, themLooks;
    s16 dist;
    u8 dir;

    if (!InLine(seat, &dist, &dir))
        return rule != BR_WALKUP_ANSWER;
    them = &gObjectEvents[gBrSeats[seat].objId];
    themLooks = them->facingDirection == GetOppositeDirection(dir);
    if (rule == BR_WALKUP_BOT)
        return !themLooks;
    meLooks = me->facingDirection == dir;
    if (meLooks != themLooks)
        return meLooks;
    return rule == BR_WALKUP_FIRST;
}

// One frame of the walk itself. TRUE once it is over, however it ended.
static bool8 Approach(struct Task *task, u8 seat)
{
    struct ObjectEvent *me = &gObjectEvents[gPlayerAvatar.objectEventId];
    s16 dist;
    u8 dir;

    if (gMain.callback2 != CB2_Overworld || ++task->tTimer > BR_APPROACH_FRAMES)
        return TRUE;
    if (ObjectEventIsMovementOverridden(me) && !ObjectEventClearHeldMovementIfFinished(me))
        return FALSE; // a walk or a turn is still playing
    if (!InLine(seat, &dist, &dir))
        return TRUE;
    if (!task->tWalker)
    {
        struct ObjectEvent *them = &gObjectEvents[gBrSeats[seat].objId];

        // The one who was seen waits for the walk to land -- or for it to stop where
        // their side stops it -- then turns to meet it.
        if (!BrGhosts_Idle(seat))
            return FALSE;
        if (dist > 1 && CanStep(them, GetOppositeDirection(dir)))
            return FALSE;
        if (me->facingDirection == dir)
            return TRUE;
        ObjectEventSetHeldMovement(me, GetFaceDirectionMovementAction(dir));
        return FALSE;
    }
    if (dist <= 1)
        return TRUE;
    if (!CanStep(me, dir))
        return TRUE; // fight from here
    ObjectEventSetHeldMovement(me, GetWalkNormalMovementAction(dir));
    return FALSE;
}

bool8 BrWalkup_Run(struct Task *task, u8 seat, u8 rule)
{
    struct ObjectEvent *me = &gObjectEvents[gPlayerAvatar.objectEventId];

    if (gMain.callback2 != CB2_Overworld)
        return TRUE;
    switch (task->tState)
    {
    case 0:
        // Both trainers still, then who walks, and the "!" goes up over them.
        if (++task->tTimer <= BR_APPROACH_SETTLE
         && ((ObjectEventIsMovementOverridden(me) && !ObjectEventClearHeldMovementIfFinished(me))
          || !BrGhosts_Idle(seat)))
            return FALSE;
        task->tWalker = IWalk(seat, rule);
        StartExclamation(seat, task->tWalker);
        task->tTimer = 0;
        task->tState++;
        return FALSE;
    case 1:
        if (!FieldEffectActiveListContains(FLDEFF_EXCLAMATION_MARK_ICON) || ++task->tTimer > 90)
        {
            task->tTimer = 0;
            task->tState++;
        }
        return FALSE;
    default:
        return Approach(task, seat);
    }
}
