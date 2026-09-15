// The eyeline engage (POK-230). See include/br/br_engage.h.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "fieldmap.h"
#include "script.h"
#include "constants/battle.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "br/br_ghosts.h"
#include "br/br_match.h"
#include "br/br_netlink.h"
#include "br/br_engage.h"

EWRAM_DATA struct BrEngage gBrEngage = {0};
static EWRAM_DATA u8 sOwnBusy = 0xFF;  // last BR_MSG_BUSY kind sent, 0xFF nothing yet
static EWRAM_DATA u8 sBusyKind = 0;    // the kind we are settling on
static EWRAM_DATA u8 sBusyStable = 0;  // frames it has held

#define BR_BUSY_SETTLE 20

// After a fight ends, neither of the pair re-engages for a grace so the escape a flee
// promises is real; the fleer stays off the seat it fled from far longer (POK-231).
#define BR_ENGAGE_GRACE 120     // 2 s, both sides, any re-challenge
#define BR_ENGAGE_LOCKOUT 600   // 10 s, the fleer will not initiate on that pursuer

// Tell the room what we are doing, once it has held long enough to be a state and
// not a transition (a warp's map load is a menu for a few frames). Nothing is said
// before the first map: the boot is not a menu.
static void ReportBusy(void)
{
    u8 kind, buf[2];

    if (gMain.inBattle)
        kind = BR_BUSY_BATTLE;
    else if (gMain.callback2 != CB2_Overworld || ArePlayerFieldControlsLocked())
        kind = BR_BUSY_MENU;
    else
        kind = BR_BUSY_MAP;
    if (kind != sBusyKind)
    {
        sBusyKind = kind;
        sBusyStable = 0;
        return;
    }
    if (sBusyStable < BR_BUSY_SETTLE)
    {
        sBusyStable++;
        return;
    }
    // Say nothing until we have first settled on the map: the boot's transitions are a
    // menu for a few frames, and peers already assume the map, so it arms silently.
    if (sOwnBusy == 0xFF)
    {
        if (kind == BR_BUSY_MAP)
            sOwnBusy = BR_BUSY_MAP;
        return;
    }
    if (kind == sOwnBusy)
        return;
    buf[0] = gBrMySeat;
    buf[1] = kind;
    if (BrWire_Send(BR_MSG_BUSY, buf, 2))
        sOwnBusy = kind;
}

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
    gBrEngage.fledFrom = 0xFF;
    gBrEngage.fledLockout = 0;
    sOwnBusy = 0xFF;
    sBusyKind = 0;
    sBusyStable = 0;
}

void BrEngage_OnBattleEnd(u8 peerSeat, u8 outcome)
{
    gBrEngage.cooldown = BR_ENGAGE_GRACE;
    // B_OUTCOME_RAN is our own trainer running; MON_FLED is the peer running from us.
    // Only the fleer is held off the pursuer; the pursuer is free after the grace.
    if (outcome == B_OUTCOME_RAN)
    {
        gBrEngage.fledFrom = peerSeat;
        gBrEngage.fledLockout = BR_ENGAGE_LOCKOUT;
    }
}

void BrEngage_Tick(void)
{
    u8 seat;

    if (gBrEngage.cooldown)
        gBrEngage.cooldown--;
    if (gBrEngage.fledLockout && --gBrEngage.fledLockout == 0)
        gBrEngage.fledFrom = 0xFF;
    ReportBusy();
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
        if (gBrSeatBusy[seat] == BR_BUSY_BATTLE)
            continue; // already fighting someone; a menu is not a hiding place though
        if (seat == gBrEngage.fledFrom)
            continue; // we fled this one: no turning around to re-engage yet
        if (Sees(gBrOwnPos.x, gBrOwnPos.y, gBrOwnPos.dir, s->x, s->y)
         || Sees(s->x, s->y, s->dir, gBrOwnPos.x, gBrOwnPos.y))
        {
            Challenge(seat);
            return;
        }
    }
}
