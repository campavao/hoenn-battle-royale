// The ring: geometry, fog weather, and the bleed (POK-224). See include/br/br_ring.h.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "field_weather.h"
#include "region_map.h"
#include "pokemon.h"
#include "constants/weather.h"
#include "constants/region_map_sections.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "br/br_ghosts.h"
#include "string_util.h"
#include "constants/characters.h"
#include "br/br_hud.h"
#include "br/br_match.h"
#include "fldeff_misc.h"
#include "br/br_ring.h"
#include "br/br_story.h"
#include "battle.h"
#include "br/br_netlink.h"
#include "br/br_bot.h"
#include "br/br_duel.h"
#include "br/br_field.h"
#include "br/br_battle.h"
#include "br/br_spectate.h"
#include "battle_util.h"
#include "recorded_battle.h"
#include "constants/battle_script_commands.h"
#include "constants/battle_string_ids.h"
#include "util.h"
#include "task.h"
#include "text.h"
#include "script.h"
#include "palette.h"
#include "field_message_box.h"
#include "field_player_avatar.h"

EWRAM_DATA struct BrRing gBrRing = {0};

// Does the fog's clock reach into this battle (POK-262)? A wild or route fight fought
// outside the ring drains the whole party on the clock, as on the field: without that, a
// battle is somewhere to hide from the fog -- step outside the ring, pick a fight with
// the grass, and the clock stops mattering.
//
// A fight between contestants is in the fog too (Cam, 2026-10-05 play-test: "players not
// taking fog damage if in a battle"), which reverses Kanto's v0.3.1 rule -- but not on
// this clock. Two ROMs fight a link battle and only the challenger's runs the engine, so
// each ROM bleeding its own party on its own clock would leave the two copies of every mon
// disagreeing. The engine does it instead, at the end of each turn (BrRing_FogEndTurn),
// where everything it changes reaches the other ROM and a replay the way a sandstorm does.
//
// And a fight this ROM runs alone that it is publishing -- a wild one, a gym's -- has the
// engine's fog too: somebody may be replaying it from its seed and its choices, and a
// bleed on the clock is neither, so the replay's mon would stand at an HP the fighter's
// never had. Decided at its start like a contest's (BrRing_DecideSoloFog).
static bool8 PublishedAlone(void)
{
    return !gBrNetlink.active && !gBrBotFight.fighting && !gBrDuel.running
        && BrSpectate_Publishing();
}

static bool8 FogReachesThisBattle(void)
{
    if (!gMain.inBattle)
        return FALSE;
    if (gBrNetlink.active || gBrBotFight.fighting || gBrDuel.running
     || RecordedBattle_IsSpectateLive() || PublishedAlone())
        return FALSE; // the engine's own turn does it (BrRing_FogEndTurn)
    return TRUE;
}

// Is a fight between contestants, on this ROM, one the end-of-turn fog belongs to? Not a
// duel: two bots fighting in the host's hidden instance are standing nowhere.
static bool8 ContestBattle(void)
{
    if (!gMain.inBattle || gBrDuel.running)
        return FALSE;
    return gBrNetlink.active || gBrBotFight.fighting || RecordedBattle_IsSpectateLive()
        || PublishedAlone();
}

// Distance from the centre to the nearest point of the section's rectangle, squared,
// against r squared. Integer maths only; sections are whole cells.
bool8 BrRing_SectionInside(u8 mapsec)
{
    const struct RegionMapLocation *loc;
    s16 nx, ny, dx, dy;

    if (!gBrRing.active)
        return TRUE;
    if (gBrRing.r < 0)
        return FALSE;
    if (mapsec >= MAPSEC_NONE)
        return FALSE;
    loc = &gRegionMapEntries[BrStory_Dock(mapsec)];
    nx = gBrRing.cx;
    if (nx < loc->x) nx = loc->x;
    if (nx > loc->x + loc->width - 1) nx = loc->x + loc->width - 1;
    ny = gBrRing.cy;
    if (ny < loc->y) ny = loc->y;
    if (ny > loc->y + loc->height - 1) ny = loc->y + loc->height - 1;
    dx = nx - gBrRing.cx;
    dy = ny - gBrRing.cy;
    return dx * dx + dy * dy <= (s16)gBrRing.r * gBrRing.r;
}

// Is this cell of the region-map grid inside the ring? The ring is a disc in exactly
// these coordinates (BrRing_SectionInside above measures the same way against a
// section's own rectangle), so this is that test with the rectangle shrunk to a point.
// The fog over the region map asks it of every cell (br_map.c).
bool8 BrRing_CellInside(s16 x, s16 y)
{
    s16 dx = x - gBrRing.cx;
    s16 dy = y - gBrRing.cy;

    if (gBrRing.r < 0)
        return FALSE;
    return dx * dx + dy * dy <= (s16)gBrRing.r * gBrRing.r;
}

// The bottom box on a ring move: the place the fog is closing on, which the host
// already sends and nothing was reading. Two lines, 90 frames, above the ticker.
static const u8 sText_FogCloses[] = _("THE FOG CLOSES IN ON");
const u8 gBrText_FogEverywhere[] = _("FOG EVERYWHERE");

static void SayFog(const u8 *place, u8 len)
{
    u8 line[BR_HUD_LINE_MAX + 2];
    u8 *p = StringCopy(line, sText_FogCloses);
    u8 i;

    *p++ = CHAR_NEWLINE;
    if (len > 16)
        len = 16;
    for (i = 0; i < len; i++)
        *p++ = place[i];
    *p++ = CHAR_EXCL_MARK;
    *p = EOS;
    BrHud_Box(line);
}

static void HandleRing(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);
    u8 i, placeLen = 0;

    if (n < 5)
        return;
    if (n >= 6 && d[5] > 0 && (u16)(6 + d[5]) <= n)
        placeLen = d[5];
    // A new phase, with a place named: say where. The corner's FOG! flash is the
    // page's own (gBrHud.flashFog); this is the sentence that goes with it. Not on the
    // last phase, which has no inside -- naming the old centre would send the player
    // somewhere that is fog too -- and whose one line is the ticker's THE FOG COVERS ALL
    // OF HOENN! (br_levels.c): a box saying it again would be the ring's second (POK-324).
    if (d[1] != gBrRing.phase && (s8)d[4] >= 0 && placeLen > 0)
        SayFog(d + 6, placeLen);
    // ...and keep the name, from every RING and not just a new phase's, so a late
    // snapshot or a resync names it too. The box above is ninety frames and the play-test
    // missed it: "if you weren't paying attention to the beginning... it doesn't tell
    // you where it's actually closing in on" (POK-325). The corner says it from now on.
    if (placeLen > BR_RING_PLACE_MAX)
        placeLen = BR_RING_PLACE_MAX;
    for (i = 0; i < placeLen; i++)
        gBrRing.place[i] = d[6 + i];
    gBrRing.place[placeLen] = EOS;
    gBrHud.dirty |= BR_HUD_DIRTY_CORNER;
    gBrRing.active = TRUE;
    gBrRing.phase = d[1];
    gBrRing.cx = (s8)d[2];
    gBrRing.cy = (s8)d[3];
    gBrRing.r = (s8)d[4];
    gBrRing.applied = FALSE; // re-evaluate on the next frame
}

static void ApplyWeather(bool8 outside)
{
    u8 story = BrStory_Weather();

    if (outside)
        SetSavedWeather(WEATHER_FOG_HORIZONTAL);
    else if (story != WEATHER_NONE)
        SetSavedWeather(story);
    else
        SetSavedWeatherFromCurrMapHeader();
    DoCurrentWeather();
    gBrRing.applied = TRUE;
    gBrRing.appliedMapGroup = gSaveBlock1Ptr->location.mapGroup;
    gBrRing.appliedMapNum = gSaveBlock1Ptr->location.mapNum;
}

// The fog finished the team in the overworld: say so, the way a poison step does,
// before the camera goes (Cam's 2026-10-14 play-test, POK-358: "BARBOACH..." and the
// screen was already somebody else's). The OUT itself goes at once -- the room's order
// of elimination is the order OUTs arrive, and a team that went first must not outlast
// one that went later by sitting on a message (review of #43) -- and while the player is
// told, the watch that the OUT starts holds off (BrRing_Telling: FollowTick, a replay).
// A field that is busy -- a script, a message of its own -- is waited out, up to
// BR_FOG_OUT_WAIT frames. The message waits for A or B, but never for a player who has
// put the phone down: after BR_FOG_OUT_READ frames with no press it closes by itself.
#define BR_FOG_OUT_WAIT (60 * 10)
#define BR_FOG_OUT_READ (60 * 8)
static const u8 sText_FogOut[] = _("{STR_VAR_1} fainted in the fog…\p{PLAYER} is out of usable POKéMON!\pYou're out of the match!");

// Which mon fainted last: its name goes into gStringVar1 only as the line is shown, since
// that is every script's and every message's, and the field can be busy with one first.
// The high bit: the player has not been told yet.
static EWRAM_DATA u8 sFogMon = 0;
#define FOG_UNTOLD 0x80

#define tState data[0]
#define tWait data[1]

static void CloseFogOut(void)
{
    DeactivateAllTextPrinters(); // a page still waiting for A prints nothing more
    HideFieldMessageBox();
    UnlockPlayerFieldControls();
}

static void Task_FogOut(u8 taskId)
{
    s16 *data = gTasks[taskId].data;

    switch (tState)
    {
    case 0:
        // Off the field (the BAG, a fight) it waits for the field: that is where it is
        // said, and the time it waits for a quiet one is the field's.
        if (!BrField_OverworldRunning())
            return;
        if (++tWait > BR_FOG_OUT_WAIT)
            break;
        if (ScriptContext_IsEnabled() || !IsFieldMessageBoxHidden() || gPaletteFade.active
         || ArePlayerFieldControlsLocked())
            return;
        LockPlayerFieldControls();
        GetMonData(&gPlayerParty[sFogMon & ~FOG_UNTOLD], MON_DATA_NICKNAME, gStringVar1);
        StringGet_Nickname(gStringVar1);
        ShowFieldMessage(sText_FogOut);
        tWait = 0;
        tState++;
        return;
    case 1:
        // Printing: each page waits for A. The last one is still on screen when the
        // printer is done, so it is read once more below, on a clock of its own.
        if (IsFieldMessageBoxHidden())
        {
            tWait = 0;
            tState++;
            return;
        }
        if (JOY_NEW(A_BUTTON | B_BUTTON))
            tWait = 0; // a page turned: somebody is reading
        if (++tWait <= BR_FOG_OUT_READ)
            return;
        CloseFogOut();
        break;
    case 2:
        if (++tWait <= BR_FOG_OUT_READ && !JOY_NEW(A_BUTTON | B_BUTTON))
            return;
        CloseFogOut();
        break;
    }
    sFogMon &= ~FOG_UNTOLD;
    DestroyTask(taskId);
}

#undef tState
#undef tWait

bool8 BrRing_Telling(void)
{
    return (sFogMon & FOG_UNTOLD) != 0;
}

static void StartFogOut(u8 partyIdx)
{
    BrMatch_Out();
    // A script already running (a gym leader mid-line, a trainer's walk) has the field:
    // out, untold, as before.
    if (ScriptContext_IsEnabled())
        return;
    sFogMon = partyIdx | FOG_UNTOLD;
    CreateTask(Task_FogOut, 80);
}

// The telling is never lost with its task: a BAG or POKeMON opened from the menu that
// was up when the team went resets every task on its way in. Back on the field, the
// task starts again and the player is told then.
static void OweFogOut(void)
{
    if (BrRing_Telling() && !FuncIsActiveTask(Task_FogOut) && BrField_OverworldRunning())
        CreateTask(Task_FogOut, 80);
}

static void Bleed(void)
{
    u8 i, count = CalculatePlayerPartyCount();
    u8 alive = 0;
    bool8 dealt = FALSE;
    u8 last = PARTY_SIZE;
    // In a battle the fog hurts but never finishes anybody. A team that fainted to the
    // weather mid-turn would take the elimination -- and the spill, and the OUT -- out
    // of the battle engine's hands while it was still running a turn, so it waits at
    // 1 HP and the next tick in the overworld does the rest.
    //
    // And a fight that is on its way in is as good as started: the challenge's "!", the
    // walk and the fade off the field (BrField_Leave) are still the overworld's frames,
    // and a team the fog finished there went into the battle with nobody standing -- the
    // lead at 0 HP, the screen hung on its send-out (2026-10-05 play-test).
    bool8 floorAtOne = FogReachesThisBattle() || BrField_Leaving()
                    || gBrNetlink.active || gBrBotFight.fighting;

    for (i = 0; i < count; i++)
    {
        struct Pokemon *mon = &gPlayerParty[i];
        u16 hp = GetMonData(mon, MON_DATA_HP);
        u16 maxHp = GetMonData(mon, MON_DATA_MAX_HP);
        u16 dmg = maxHp / 10;

        if (hp == 0 || GetMonData(mon, MON_DATA_SPECIES) == SPECIES_NONE)
            continue;
        if (dmg == 0)
            dmg = 1;
        if (dmg > hp)
            dmg = hp;
        if (floorAtOne && dmg >= hp)
            dmg = hp - 1;
        if (dmg == 0)
            continue;
        hp -= dmg;
        dealt = TRUE;
        if (hp == 0)
        {
            // A fainted POKeMON has no status, and a PSN one left on would faint again on
            // the next poison step, with its own line (field_poison.c) over ours.
            u32 none = STATUS1_NONE;

            SetMonData(mon, MON_DATA_STATUS, &none);
            last = i;
        }
        gBrRing.damageDealt += dmg;
        SetMonData(mon, MON_DATA_HP, &hp);
        // The battle is looking at its own copy, so the bar only moves if that moves
        // with it. Singles only, which is every battle this game has.
        if (floorAtOne && gBattlersCount > 0 && gBattlerPartyIndexes[0] == i)
            gBattleMons[0].hp = hp;
        if (hp > 0)
            alive++;
    }
    // Felt on the field the way a poison step is (POK-358): its mosaic and its sound.
    if (dealt && BrField_OverworldRunning() && !FldEffPoison_IsActive())
        FldEffPoison_Start();
    if (dealt)
        gBrHud.dirty |= BR_HUD_DIRTY_CORNER; // its HP line (br_hud.c's LeadHp)
    if (count > 0 && alive == 0 && !gBrRing.out)
    {
        // Through br_match's one door, so the fog drops a team on the ground like any
        // other way out (POK-232) instead of quietly sending its own OUT -- once the
        // player has been told, on the field (FogOut).
        gBrRing.out = TRUE;
        if (BrField_OverworldRunning() && last < PARTY_SIZE)
            StartFogOut(last);
        else
            BrMatch_Out();
    }
}

// ---- the fog in a fight between contestants -------------------------------------------

// Where the turn's fog has got to: the turn it is for and the next battler to look at.
static EWRAM_DATA u8 sFogTurn = 0;
static EWRAM_DATA u8 sFogNext = 0;

void BrRing_SetBattleFog(bool8 fog)
{
    gBrRing.battleFog = fog ? TRUE : FALSE;
    sFogTurn = 0xFF;
    sFogNext = 0;
}

// The two trainers of a link battle stand on one map (a challenge is only taken from a
// ghost on our own), so the challenger's answer is both of theirs; a bot stands where
// we do. Decided once, at the start: the replay has to be told it, in the bstart.
void BrRing_DecideBattleFog(void)
{
    BrRing_SetBattleFog(gBrRing.active && !BrRing_SectionInside(gMapHeader.regionMapSectionId));
}

// The same for a fight this ROM runs alone and publishes (PublishedAlone), asked by the
// publisher before its bstart: a contest decides where it starts, this has no such door.
void BrRing_DecideSoloFog(void)
{
    if (PublishedAlone())
        BrRing_DecideBattleFog();
}

// "<MON> is hurt by the fog!", the bar, the HP. Like the sandstorm's, minus the faint: in
// a battle the fog hurts but never finishes anybody (see Bleed), so there is nothing to
// faint and nobody's team to lose here.
static const u8 sScript_FogHurts[] =
{
    B_SCR_OP_PRINTSTRING, BR_STRINGID_FOG_HURT & 0xFF, BR_STRINGID_FOG_HURT >> 8,
    B_SCR_OP_WAITMESSAGE, B_WAIT_TIME_LONG & 0xFF, B_WAIT_TIME_LONG >> 8,
    B_SCR_OP_HEALTHBARUPDATE, BS_ATTACKER,
    B_SCR_OP_DATAHPUPDATE, BS_ATTACKER,
    B_SCR_OP_END2,
};

// A frame's wait, for a replay whose fighter has not got this far yet (TurnFog).
static const u8 sScript_FogWait[] =
{
    B_SCR_OP_PAUSE, 1, 0,
    B_SCR_OP_END2,
};

#define FOG_HIT_MARKERS (HITMARKER_IGNORE_SUBSTITUTE | HITMARKER_PASSIVE_HP_UPDATE | HITMARKER_IGNORE_BIDE)

// Is this turn fought in the fog? Asked at the end of every turn, not only at the start
// (2026-10-13 play-test: "against bots and players it doesn't trigger when it should"):
// a fight that began inside the ring stayed out of the fog however long it ran with the
// fog all round it. Once in, always in; the ring never grows.
//
// The fighter asks the map and writes the answer into its own record (battler 0's, the
// side every replay has), where the engine reached the end of the turn; a replay reads
// it back from there at the same point, so it plays the fog's turns as the fighter's
// engine did, whatever the ring looks like from where the watcher stands. FALSE while a
// replay's answer has not arrived.
static bool8 TurnFog(void)
{
    u8 fog;

    if (RecordedBattle_IsSpectateLive())
    {
        if (!RecordedBattle_TakeSpectateByte(0, &fog))
            return FALSE;
        gBrRing.battleFog = fog ? TRUE : FALSE;
        return TRUE;
    }
    if (gBrRing.active && !BrRing_SectionInside(gMapHeader.regionMapSectionId))
        gBrRing.battleFog = TRUE;
    RecordedBattle_SetBattlerAction(0, gBrRing.battleFog);
    return TRUE;
}

// A tenth of each fighter's max HP at the end of every turn, on whoever is on the field,
// down to 1. The bench is the field's to bleed afterwards: the other trainer's bench on
// a link battle is a copy the engine never sends back.
bool8 BrRing_FogEndTurn(void)
{
    u8 turn = gBattleResults.battleTurnCounter;
    u8 b;

    // A duel (the host's hidden instance, two bots) has no fog, but it is published, and
    // a replay of it is a contest's replay: it reads a fog answer off every turn. Without
    // this one, battler 0's next choice was read as the answer and the replay ran one
    // byte out of step for the rest of the fight.
    if (gMain.inBattle && gBrDuel.running && gBattleOutcome == 0)
    {
        if (sFogTurn != turn)
        {
            RecordedBattle_SetBattlerAction(0, FALSE);
            sFogTurn = turn;
        }
        return FALSE;
    }
    if (!ContestBattle() || gBattleOutcome != 0)
        return FALSE;
    // The slave of a link battle runs no engine; this is never reached there.
    if (sFogTurn != turn)
    {
        if (!TurnFog())
        {
            BattleScriptExecute(sScript_FogWait);
            return TRUE;
        }
        sFogTurn = turn;
        sFogNext = 0;
    }
    if (!gBrRing.battleFog)
        return FALSE;
    gHitMarker &= ~FOG_HIT_MARKERS;
    for (b = sFogNext; b < gBattlersCount; b++)
    {
        u16 hp = gBattleMons[b].hp;
        s32 dmg = gBattleMons[b].maxHP / 10;

        if (gAbsentBattlerFlags & gBitTable[b])
            continue;
        if (hp <= 1)
            continue;
        if (dmg < 1)
            dmg = 1;
        if (dmg >= hp)
            dmg = hp - 1;
        sFogNext = b + 1;
        gBattlerAttacker = b;
        gBattleMoveDamage = dmg;
        gBrRing.damageDealt += dmg;
        gHitMarker |= FOG_HIT_MARKERS;
        BattleScriptExecute(sScript_FogHurts);
        return TRUE;
    }
    sFogNext = gBattlersCount;
    return FALSE;
}

u16 BrRing_Outside(void)
{
    return gBrRing.active && gBrRing.outside ? 1 : 0;
}

void BrRing_Init(void)
{
    CpuFill32(0, &gBrRing, sizeof(gBrRing));
    sFogMon = 0;
    gBrRing.damageTimer = BR_FOG_TICK_FRAMES;
    BrNet_On(BR_MSG_RING, HandleRing);
}

void BrRing_Tick(void)
{
    bool8 outside;

    // The fog does not stop at the battle door (POK-262). Outside the overworld the
    // only thing it can do is bleed -- the weather and the FOG! flash belong to a map --
    // so a battle it reaches takes the damage and nothing else.
    if (!gBrRing.active)
        return;
    OweFogOut();
    if (!BrField_OverworldRunning())
    {
        if (!FogReachesThisBattle())
            return;
        // Asked of the map, not of gBrRing.outside: that flag is worked out by the
        // overworld branch below, so in a battle it is whatever it was when the battle
        // started -- and a ring that closed on you mid-fight would never be noticed.
        // The map header does not change for a battle, so this is still where we stand.
        if (BrRing_SectionInside(gMapHeader.regionMapSectionId))
            return;
        gBrRing.outside = TRUE;
        if (--gBrRing.damageTimer == 0)
        {
            gBrRing.damageTimer = BR_FOG_TICK_FRAMES;
            Bleed();
        }
        return;
    }
    outside = !BrRing_SectionInside(gMapHeader.regionMapSectionId);
    if (outside && !gBrRing.outside)
        gBrHud.flashFog = 1; // just went outside: the corner flashes FOG!
    gBrRing.outside = outside;
    // A map load resets the weather to the map's own; re-apply when the map changed.
    if (!gBrRing.applied
     || gBrRing.appliedMapGroup != gSaveBlock1Ptr->location.mapGroup
     || gBrRing.appliedMapNum != gSaveBlock1Ptr->location.mapNum)
        ApplyWeather(outside);
    if (!outside)
    {
        gBrRing.damageTimer = BR_FOG_TICK_FRAMES;
        return;
    }
    if (--gBrRing.damageTimer == 0)
    {
        gBrRing.damageTimer = BR_FOG_TICK_FRAMES;
        Bleed();
    }
}
