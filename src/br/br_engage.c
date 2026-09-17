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
#include "br/br_bot.h"
#include "br/br_hud.h"
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

// How long a challenge we sent waits to learn what kind of fight it is (POK-238, and
// the play-test black screen). A bot's card is staged by the page, and when the BOT
// spots US it lands before the challenge does, so Challenge() can decide on the spot.
// When WE spot IT, nothing has staged anything yet -- the page has not even heard the
// challenge. Starting a link battle there is a screen that never comes back:
// BrNetlink_StartBattle has no timeout, so a link with no ROM behind it waits for
// blocks that never arrive, for the rest of the match.
//
// Nothing answers a challenge to a person -- the peer just starts its own side -- so
// the wait is short and its end is the link battle exactly as before.
#define BR_ENGAGE_WAIT 90       // 1.5 s for a card, or for the seat to say it cannot

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

// Walking up to somebody in the Zone (POK-222). The eyeline is a match rule and the
// opening is not the match, so nothing happened at all -- which looks exactly like a
// bug from the inside: two contestants stand face to face and neither one's game
// reacts. Now it says so, once in a while rather than every frame the pair are looking
// at each other.
static const u8 sText_NoBattlesHere[] = _("NO BATTLES IN THE\nSAFARI ZONE!");
#define BR_SAFARI_SAY_FRAMES (8 * 60)
static EWRAM_DATA u16 sSafariSaid = 0;

// Anybody at all standing in our eyeline on this map. Deliberately not the engage's
// own scan: that one has the seat ordering, the busy check and the flee lockout in it,
// and none of those decide whether to say a sentence.
static bool8 LookingAtSomebody(void)
{
    u8 seat;

    for (seat = 0; seat < BR_MAX_SEATS; seat++)
    {
        const struct BrSeat *s = &gBrSeats[seat];

        if (!s->present || seat == gBrMySeat)
            continue;
        if (s->mapGroup != gBrOwnPos.mapGroup || s->mapNum != gBrOwnPos.mapNum)
            continue;
        if (Sees(gBrOwnPos.x, gBrOwnPos.y, gBrOwnPos.dir, s->x, s->y)
         || Sees(s->x, s->y, s->dir, gBrOwnPos.x, gBrOwnPos.y))
            return TRUE;
    }
    return FALSE;
}

static void SayNoBattlesHere(void)
{
    if (sSafariSaid != 0)
        return;
    sSafariSaid = BR_SAFARI_SAY_FRAMES;
    BrHud_Box(sText_NoBattlesHere);
}

static bool8 CanEngage(void)
{
    if (gMain.callback2 != CB2_Overworld || gMain.inBattle)
        return FALSE;
    if (gBrNetlink.active || gBrEngage.cooldown)
        return FALSE;
    if (gBrEngage.waitSeat != 0xFF)
        return FALSE; // one is already out and waiting for its answer
    if (gBrMatch.phase != BR_PHASE_PLAY)
        return FALSE; // the eyeline is a match rule: not in the lobby, not in the
                      // Safari opening, and not once you are out
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
    // A bot has no ROM on the other end of a link. If the page has staged its party
    // (POK-238), this is a trainer battle instead -- the same engage, a different
    // kind of fight. The CHALLENGE still goes out so the room sees the pair engage.
    if (BrBot_StartFight(target))
        return;
    // Nothing staged: this is a person, or it is a bot whose card is still on its
    // way. TickWait decides which, and only then does anything start.
    gBrEngage.waitSeat = target;
    gBrEngage.waitFrames = BR_ENGAGE_WAIT;
}

// The parked challenge, one frame at a time.
static void TickWait(void)
{
    u8 seat = gBrEngage.waitSeat;

    if (seat == 0xFF)
        return;
    if (gBrNetlink.active || gMain.inBattle)
    {
        gBrEngage.waitSeat = 0xFF; // a fight already started; it was not this one's to start
        return;
    }
    // The card landed: a bot, and an ordinary trainer battle (POK-238).
    if (BrBot_IsStaged(seat) && BrBot_StartFight(seat))
    {
        gBrEngage.waitSeat = 0xFF;
        return;
    }
    // ...or the seat answered that it cannot: it left the match, or it is already in
    // somebody else's fight. Either way there is nothing here to link with.
    if (!gBrSeats[seat].present || gBrSeatBusy[seat] == BR_BUSY_BATTLE)
    {
        gBrEngage.waitSeat = 0xFF;
        return;
    }
    if (gBrEngage.waitFrames > 0 && --gBrEngage.waitFrames > 0)
        return;
    gBrEngage.waitSeat = 0xFF;
    BrNetlink_StartBattle(0, seat);
}

void BrEngage_Init(void)
{
    gBrEngage.lastTarget = 0xFF;
    gBrEngage.cooldown = 0;
    gBrEngage.nonce = 0;
    gBrEngage.challenges = 0;
    gBrEngage.fledFrom = 0xFF;
    gBrEngage.fledLockout = 0;
    gBrEngage.waitSeat = 0xFF;
    gBrEngage.waitFrames = 0;
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
        u8 buf[2];

        gBrEngage.fledFrom = peerSeat;
        gBrEngage.fledLockout = BR_ENGAGE_LOCKOUT;
        // And everybody sees it happen (POK-266): a boot over our head on their screen,
        // which is the only way a room learns that somebody ran rather than won.
        buf[0] = gBrMySeat;
        buf[1] = peerSeat;
        BrWire_Send(BR_MSG_FLED, buf, 2);
    }
}

// A challenge nobody ever answered (br_netlink.c's watchdog). The seat goes on the
// same lockout a fleer gets, for the same reason: the ghost is still standing in our
// eyeline, and re-challenging a peer that did not answer the first time turns the rest
// of the match into that loop. Nothing is said to the room -- nobody ran.
void BrEngage_NoAnswer(u8 peerSeat)
{
    gBrEngage.cooldown = BR_ENGAGE_GRACE;
    gBrEngage.fledFrom = peerSeat;
    gBrEngage.fledLockout = BR_ENGAGE_LOCKOUT;
}

void BrEngage_Tick(void)
{
    u8 seat;

    if (gBrEngage.cooldown)
        gBrEngage.cooldown--;
    if (gBrEngage.fledLockout && --gBrEngage.fledLockout == 0)
        gBrEngage.fledFrom = 0xFF;
    ReportBusy();
    TickWait();
    if (sSafariSaid != 0)
        sSafariSaid--;
    // In the Zone the eyeline does nothing, so this is the only thing that tells you
    // why (POK-222).
    if (gBrMatch.phase == BR_PHASE_SAFARI && gMain.callback2 == CB2_Overworld && !gMain.inBattle
     && !ScriptContext_IsEnabled() && LookingAtSomebody())
        SayNoBattlesHere();
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
