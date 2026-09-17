// Match phases, START and CLOCK, the Safari opening's end and the drop (POK-222).
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "field_screen_effect.h"
#include "safari_zone.h"
#include "script.h"
#include "pokemon.h"
#include "battle.h"
#include "constants/battle.h"
#include "constants/maps.h"
#include "random.h"
#include "hall_of_fame.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "br/br_ghosts.h"
#include "br/br_duel.h"
#include "br/br_match.h"
#include "br/br_ring.h"
#include "br/br_zone.h"
#include "br/br_pick.h"
#include "br/br_loot.h"
#include "br/br_spectate.h"
#include "br/br_hud.h"

EWRAM_DATA struct BrMatch gBrMatch = {0};
// START can span slots once there are more than six spawn rows.
static EWRAM_DATA u8 sStartBuf[10 + 8 * BR_MAX_SEATS] = {0};
static EWRAM_DATA struct BrAssembler sStartAsm = {0};
// START arrived while we were still standing on a map. The warp it asks for cannot be
// done from inside the mailbox pump, so the tick does it on the next quiet frame.
static EWRAM_DATA u8 sStartPending = 0;

static bool8 OverworldRunning(void)
{
    return gMain.callback2 == CB2_Overworld && !gMain.inBattle;
}

static void ParseStart(const u8 *d, u16 n)
{
    u8 i, count;

    if (n < 10)
        return;
    gBrMatch.seed = d[0] | (d[1] << 8) | (d[2] << 16) | ((u32)d[3] << 24);
    count = d[4];
    gBrMatch.safariSecs = BrWire_ReadU16(d + 5);
    gBrMatch.fogSecs = BrWire_ReadU16(d + 7);
    gBrMatch.pace = d[9];
    // The host's pace, applied (POK-241, Kanto's POK-186). Bit 0 says the host sent
    // any at all -- an older page sends a zero byte, and the options this save already
    // has are then the right answer. Bit 1 is battle animations, bits 2..3 the text
    // speed. Everybody in a room reads text at the same speed or the shot clock means
    // different things to different people.
    if (d[9] & 1)
    {
        gSaveBlock2Ptr->optionsBattleSceneOff = (d[9] & 2) ? 0 : 1;
        gSaveBlock2Ptr->optionsTextSpeed = (d[9] >> 2) & 3;
    }
    if (count > BR_MAX_SEATS)
        count = BR_MAX_SEATS;
    if (n < 10 + 8 * count)
        return;
    for (i = 0; i < count; i++)
    {
        const u8 *row = d + 10 + 8 * i;
        u8 seat = row[0];

        if (seat >= BR_MAX_SEATS)
            continue;
        gBrMatch.spawns[seat].mapGroup = row[1];
        gBrMatch.spawns[seat].mapNum = row[2];
        gBrMatch.spawns[seat].x = (s16)BrWire_ReadU16(row + 3);
        gBrMatch.spawns[seat].y = (s16)BrWire_ReadU16(row + 5);
        gBrMatch.haveSpawn[seat] = TRUE;
    }
    gBrMatch.spawnCount = count;
    gBrMatch.started = TRUE;
    if (gBrMatch.safariSecs > 0 && gBrMatch.phase == BR_PHASE_SAFARI)
    {
        gBrMatch.clockLeft = gBrMatch.safariSecs;
        gBrMatch.clockFrames = 60;
    }
    // Still on a map: this START is the match beginning under us. Booting straight
    // into the Safari Zone only ever happens to a driver (BR_BOOT_SAFARI) -- a real
    // room boots to Littleroot and waits in the lobby, so without this the opening
    // never begins, the clock runs out against a phase that is not SAFARI, and the
    // drop never fires. Which is to say: the match never actually started.
    else if (gBrMatch.phase == BR_PHASE_NONE)
    {
        sStartPending = TRUE;
    }
}

static void HandleStart(const u8 *payload, u8 len)
{
    if (BrWire_Assemble(&sStartAsm, BR_MSG_START, FALSE, payload, len))
        ParseStart(sStartAsm.buf, sStartAsm.total);
}

static void HandleStartCont(const u8 *payload, u8 len)
{
    if (BrWire_Assemble(&sStartAsm, BR_MSG_START, TRUE, payload, len))
        ParseStart(sStartAsm.buf, sStartAsm.total);
}

static EWRAM_DATA u8 sWinPending = 0;

// RESULT {seat, outcome}: outcome 0 for our seat means we are the last one standing.
static void HandleResult(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);

    if (n < 2)
        return;
    BrSpectate_OnResult(d[0]);
    if (d[0] == gBrMySeat && d[1] == 0 && gBrMatch.phase != BR_PHASE_OUT)
        sWinPending = TRUE;
}

static void HandleClock(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);

    if (n < 3)
        return;
    gBrMatch.clockLeft = BrWire_ReadU16(d + 1);
    gBrMatch.clockFrames = 60;
}

// ---- closed doors ---------------------------------------------------------------

// Cam walked into Professor Birch's lab mid-match and found Birch, the rival and the
// aide standing in it, talking. They are there because we set FLAG_SYS_GAME_CLEAR to
// end the story (10eed13f9) -- prof_birch.inc:14 reads that flag and moves him home.
// Kanto's answer to the same thing is CLOSED_DOORS: the door is refused with a line,
// rather than the map being cut, so pret's data stays pret's.
//
// Unconditional, not gated on the phase: the lobby is Littleroot too, and the lab door
// is nine tiles from the boot cell. This ROM is only ever a Battle Royale ROM.
static const u8 sClosedDoors[][2] =
{
    { MAP_GROUP(MAP_LITTLEROOT_TOWN_PROFESSOR_BIRCHS_LAB), MAP_NUM(MAP_LITTLEROOT_TOWN_PROFESSOR_BIRCHS_LAB) },
};

static const u8 sText_LabClosed[] = _("PROF. BIRCH'S LAB\nIS CLOSED.");

bool8 BrMatch_DoorClosed(u8 mapGroup, u8 mapNum)
{
    u8 i;

    for (i = 0; i < ARRAY_COUNT(sClosedDoors); i++)
    {
        if (sClosedDoors[i][0] == mapGroup && sClosedDoors[i][1] == mapNum)
        {
            // Leaning on the door holds the direction, so this is asked every frame.
            // The box's own life is the throttle -- it re-says itself the moment the
            // last one has faded, and never re-dirties the window mid-display.
            if (gBrHud.boxFrames == 0)
                BrHud_Box(sText_LabClosed);
            return TRUE;
        }
    }
    return FALSE;
}

void BrMatch_Init(void)
{
    CpuFill32(0, &gBrMatch, sizeof(gBrMatch));
    sStartAsm.buf = sStartBuf;
    sStartAsm.cap = sizeof(sStartBuf);
    sStartAsm.type = 0;
    sStartPending = FALSE;
    BrNet_On(BR_MSG_START, HandleStart);
    BrNet_On(BR_MSG_START | BR_MSG_CONT, HandleStartCont);
    BrNet_On(BR_MSG_CLOCK, HandleClock);
    BrNet_On(BR_MSG_RESULT, HandleResult);
    sWinPending = FALSE;
}

// Where the opening starts you (POK-256), and which of the Zone's six areas you start
// in (POK-261). One cell for everybody put the whole room behind the gate building, in
// the one spot on the map with a wall on three sides -- and one AREA for everybody left
// five sixths of the Safari Zone unused for the whole match.
//
// Four cells per area, picked off the exported collision grid: open ground or tall
// grass with open ground on all eight sides, three tiles clear of every edge (a seam
// is a map away and a spawn on top of one is a warp nobody asked for), two clear of
// every warp, and spread within the area by farthest-point sampling. The areas are all
// connected by seams, so a trainer can walk the whole Zone from any of them.
static const u8 sSafariCells[][3] =   // mapNum, x, y -- all six are map group 26
{
    {  0,  6,  7 }, {  0, 36, 15 }, {  0, 13, 22 }, {  0, 29, 32 },  // NORTHWEST
    {  1,  5, 11 }, {  1, 29, 19 }, {  1, 19, 32 }, {  1,  3, 36 },  // NORTH
    { 12,  3,  3 }, { 12, 27,  9 }, { 12, 21, 26 }, { 12,  7, 36 },  // NORTHEAST
    {  2,  8,  5 }, {  2, 36,  7 }, {  2, 16, 25 }, {  2, 34, 36 },  // SOUTHWEST
    {  3, 29,  3 }, {  3,  5,  5 }, {  3, 24, 26 }, {  3,  4, 36 },  // SOUTH
    { 13, 31,  3 }, { 13, 15, 14 }, { 13, 14, 32 }, { 13, 31, 36 },  // SOUTHEAST
};

// The match seed and the seat, so every ROM in the room lands somewhere different and
// the same match starts the same way twice. Before a START there is no seed -- that is
// a driver or a solo boot going straight into the Zone -- and then anywhere will do.
void BrMatch_SafariCell(u8 *mapNum, u8 *x, u8 *y)
{
    u32 pick = gBrMatch.seed != 0 ? gBrMatch.seed + gBrMySeat * 2654435761u : Random32();
    const u8 *cell = sSafariCells[(pick >> 8) % ARRAY_COUNT(sSafariCells)];

    *mapNum = cell[0];
    *x = cell[1];
    *y = cell[2];
}

void BrMatch_BeginSafari(void)
{
    EnterSafariMode();
    // The catch pool belongs to the opening, so it is dealt when the opening starts
    // rather than on the first encounter that asks (POK-255).
    BrZone_Ensure();
    gBrMatch.phase = BR_PHASE_SAFARI;
    gBrMatch.clockLeft = gBrMatch.safariSecs;
    gBrMatch.clockFrames = 60;
}

void BrMatch_Out(void)
{
    u8 seat = gBrMySeat;

    if (gBrMatch.phase == BR_PHASE_OUT)
        return;
    gBrMatch.phase = BR_PHASE_OUT;
    BrWire_Send(BR_MSG_OUT, &seat, 1);
    // Then what we were carrying: the room hears the elimination first, and the spill
    // that goes with it right behind (POK-232).
    BrLoot_SpillOwn();
}

static void SendOut(void)
{
    BrMatch_Out();
}

void BrMatch_SafariOver(void)
{
    struct BrSpawn *sp;

    if (gBrMatch.phase != BR_PHASE_SAFARI)
        return;
    ExitSafariMode();
    if (CalculatePlayerPartyCount() == 0)
    {
        // Caught nothing: eliminated at the buzzer (Kanto rule). The page takes over.
        SendOut();
        return;
    }
    gBrMatch.phase = BR_PHASE_PLAY;
    // Where you land is yours to choose (POK-223): the fly map goes up, the section
    // goes out as `pick`, and the host deals a cell inside it. The START's own spawn is
    // the fallback -- for a driver, and for anyone the page never answers.
    if (BrPick_Start())
        return;
    if (!gBrMatch.haveSpawn[gBrMySeat])
        return; // no deal yet; the page will place us with a later START
    sp = &gBrMatch.spawns[gBrMySeat];
    SetWarpDestination(sp->mapGroup, sp->mapNum, WARP_ID_NONE, sp->x, sp->y);
    DoWarp();
}

void BrMatch_WhiteOut(void)
{
    // The proxy instance is not in the match it is simulating (POK-238): a duel side
    // losing is the duel's result, not this ROM going out of anything.
    if (BrDuel_IsProxy())
        return;
    if (gBrMatch.phase != BR_PHASE_OUT)
        SendOut();
}

void BrMatch_HallOfFameDone(void)
{
    SetWarpDestination(gSaveBlock1Ptr->location.mapGroup, gSaveBlock1Ptr->location.mapNum, WARP_ID_NONE,
                       gSaveBlock1Ptr->pos.x, gSaveBlock1Ptr->pos.y);
    WarpIntoMap();
    gMain.state = 0;
    SetMainCallback2(CB2_LoadMap);
}

// Is the opening's buzzer going off while we are still in a battle (POK-261)? The
// battle controllers ask, because an outcome poked in from outside is inert until the
// engine next looks at one -- and it only looks at a turn boundary, which a battle
// sitting on its action menu never reaches. The buzzer presses RUN instead: the same
// door the player would use, and the engine finishes the turn it is in on the way out,
// which is the grace a ball already in the air needs.
bool8 BrMatch_BuzzerClosing(void)
{
    if (gBrMatch.phase != BR_PHASE_SAFARI || !gMain.inBattle)
        return FALSE;
    return gBrRing.active || (gBrMatch.started && gBrMatch.clockLeft == 0);
}

void BrMatch_Tick(void)
{
    if (sWinPending && OverworldRunning() && !ScriptContext_IsEnabled() && !ArePlayerFieldControlsLocked())
    {
        // The winner's parade: Emerald's own Hall of Fame, no save, no credits.
        sWinPending = FALSE;
        gBrMatch.phase = BR_PHASE_WIN;
        // ...and the room gets to see the team that took it (POK-243). Nobody else
        // knows what the champion is carrying: a party only crosses the wire when a
        // spectator asks, and by now the asking is over. The page keeps it for the
        // results screen, which is the shell's half of the same parade.
        BrSpectate_SendParty();
        SetMainCallback2(CB2_DoHallOfFameScreenDontSaveData);
        return;
    }
    if (sStartPending && OverworldRunning() && !ScriptContext_IsEnabled() && !ArePlayerFieldControlsLocked())
    {
        sStartPending = FALSE;
        if (gBrMatch.safariSecs > 0)
        {
            // Somewhere in the Zone, dealt from the seed -- the same way BR_BOOT_SAFARI
            // does it, so both ways in are the same opening.
            u8 area, sx, sy;

            BrMatch_SafariCell(&area, &sx, &sy);
            SetWarpDestination(MAP_GROUP(MAP_SAFARI_ZONE_SOUTH), area, WARP_ID_NONE, sx, sy);
            DoWarp();
            BrMatch_BeginSafari();
        }
        else if (gBrMatch.haveSpawn[gBrMySeat])
        {
            // No opening: straight to the drop.
            struct BrSpawn *sp = &gBrMatch.spawns[gBrMySeat];

            gBrMatch.phase = BR_PHASE_PLAY;
            SetWarpDestination(sp->mapGroup, sp->mapNum, WARP_ID_NONE, sp->x, sp->y);
            DoWarp();
        }
        return;
    }
    if (gBrMatch.phase != BR_PHASE_SAFARI)
        return;
    // The catch pool belongs to the opening (POK-255). Dealt here rather than in
    // BrMatch_BeginSafari because the boot can enter the Zone before the START that
    // carries the seed arrives -- and a pool dealt from a seed of zero is no pool.
    // Ensure is a no-op once the seed it was dealt for still matches.
    BrZone_Ensure();
    // And the balls it dealt go on the ground, once (POK-261).
    BrZone_PlaceItems();
    if (!OverworldRunning())
        return;
    // The fog is up: the opening is over whatever our own clock says. It has to be
    // this way round, because the CLOCK the page sends during the ring phases is the
    // ring's countdown and HandleClock cannot tell the two apart -- so a ring clock
    // arriving before our own hit zero used to reset it to 55 and the drop never
    // happened at all. The opening ending is an event, not an arithmetic result.
    if (gBrRing.active)
    {
        BrMatch_SafariOver();
        return;
    }
    // Balls gone mid-opening: the scripts that would warp out are stubbed under BR,
    // so this is where the opening ends for the ball-less.
    if (gNumSafariBalls == 0 && gBrMatch.started)
    {
        BrMatch_SafariOver();
        return;
    }
    if (!gBrMatch.started)
        return;
    if (gBrMatch.clockFrames > 0 && --gBrMatch.clockFrames == 0)
    {
        gBrMatch.clockFrames = 60;
        if (gBrMatch.clockLeft > 0)
            gBrMatch.clockLeft--;
    }
    if (gBrMatch.clockLeft == 0)
        BrMatch_SafariOver();
}
