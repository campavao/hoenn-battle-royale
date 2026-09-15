// The eyeline engage (POK-230). See include/br/br_engage.h.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "fieldmap.h"
#include "script.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "br/br_ghosts.h"
#include "br/br_match.h"
#include "br/br_netlink.h"
#include "br/br_engage.h"

EWRAM_DATA struct BrEngage gBrEngage = {0};

// Does a straight look from (x, y) facing dir reach (tx, ty) within range, with no
// blocking tile in between? Ledges, water and walls all count as collision.
static bool8 Sees(s16 x, s16 y, u8 dir, s16 tx, s16 ty)
{
    s16 dx = 0, dy = 0, i;

    switch (dir)
    {
    case DIR_SOUTH: dy = 1; break;
    case DIR_NORTH: dy = -1; break;
    case DIR_WEST: dx = -1; break;
    case DIR_EAST: dx = 1; break;
    default: return FALSE;
    }
    for (i = 1; i <= BR_SIGHT_RANGE; i++)
    {
        x += dx;
        y += dy;
        if (x == tx && y == ty)
            return TRUE;
        if (MapGridGetCollisionAt(x, y) != 0)
            return FALSE;
    }
    return FALSE;
}

static bool8 CanEngage(void)
{
    if (gMain.callback2 != CB2_Overworld || gMain.inBattle)
        return FALSE;
    if (gBrNetlink.active || gBrEngage.cooldown)
        return FALSE;
    if (gBrMatch.phase != BR_PHASE_PLAY && gBrMatch.phase != BR_PHASE_NONE)
        return FALSE; // no fighting in the Safari opening, none once out
    if (ScriptContext_IsEnabled() || ArePlayerFieldControlsLocked())
        return FALSE;
    return TRUE;
}

static void Challenge(u8 target)
{
    u8 buf[4];

    gBrEngage.nonce++;
    buf[0] = gBrMySeat;
    buf[1] = target;
    BrWire_WriteU16(buf + 2, gBrEngage.nonce);
    if (!BrWire_Send(BR_MSG_CHALLENGE, buf, 4))
        return;
    gBrEngage.lastTarget = target;
    gBrEngage.cooldown = 120;
    gBrEngage.challenges++;
    // The page relays it to the target; our own side starts now.
    BrNetlink_StartBattle(0, target);
}

void BrEngage_Init(void)
{
    gBrEngage.lastTarget = 0xFF;
    gBrEngage.cooldown = 0;
    gBrEngage.nonce = 0;
    gBrEngage.challenges = 0;
}

void BrEngage_Tick(void)
{
    u8 seat;

    if (gBrEngage.cooldown)
        gBrEngage.cooldown--;
    if (!CanEngage())
        return;
    for (seat = 0; seat < BR_MAX_SEATS; seat++)
    {
        const struct BrSeat *s = &gBrSeats[seat];

        if (!s->present || seat == gBrMySeat || seat < gBrMySeat)
            continue; // the lower seat initiates; if that is them, they will
        if (s->mapGroup != gBrOwnPos.mapGroup || s->mapNum != gBrOwnPos.mapNum)
            continue;
        if (s->objId == BR_NO_OBJ)
            continue; // not spawned here (too many ghosts): not in sight either
        if (Sees(gBrOwnPos.x, gBrOwnPos.y, gBrOwnPos.dir, s->x, s->y)
         || Sees(s->x, s->y, s->dir, gBrOwnPos.x, gBrOwnPos.y))
        {
            Challenge(seat);
            return;
        }
    }
}
