// Story events' places. See include/br/br_story.h.
#include "global.h"
#include "battle_setup.h"
#include "event_data.h"
#include "event_object_movement.h"
#include "field_camera.h"
#include "field_player_avatar.h"
#include "fieldmap.h"
#include "item.h"
#include "main.h"
#include "party_menu.h"
#include "pokemon.h"
#include "script.h"
#include "sound.h"
#include "string_util.h"
#include "constants/event_objects.h"
#include "constants/flags.h"
#include "constants/items.h"
#include "constants/map_groups.h"
#include "constants/metatile_labels.h"
#include "constants/moves.h"
#include "constants/opponents.h"
#include "constants/region_map_sections.h"
#include "constants/songs.h"
#include "br/br_event.h"
#include "br/br_field.h"
#include "br/br_hud.h"
#include "br/br_loot.h"
#include "br/br_match.h"
#include "br/br_ring.h"
#include "br/br_story.h"

bool8 BrStory_Tide(void)
{
    if (gBrMatch.seed == 0)
        return FALSE;
    FlagClear(FLAG_SYS_SHOAL_TIDE); // clear is low: the layouts' own LOW_TIDE rooms
    return TRUE;
}

// ---- the REGI doors ------------------------------------------------------------------

enum
{
    BR_DOOR_SMASH, // A at the wall
    BR_DOOR_FLY,   // A at the wall, a Flying-type in the party
    BR_DOOR_WAIT,  // the ring has moved on a phase since the event dropped
};

struct BrStoryDoor
{
    u16 flag; // the map's own: its OnLoad seals the door while this is clear
    u8 mapGroup;
    u8 mapNum;
    u8 rule;
};

static const struct BrStoryDoor sDoors[] =
{
    {FLAG_SYS_REGIROCK_PUZZLE_COMPLETED,  MAP_GROUP(MAP_DESERT_RUINS), MAP_NUM(MAP_DESERT_RUINS), BR_DOOR_SMASH},
    {FLAG_SYS_REGISTEEL_PUZZLE_COMPLETED, MAP_GROUP(MAP_ANCIENT_TOMB), MAP_NUM(MAP_ANCIENT_TOMB), BR_DOOR_FLY},
    {FLAG_SYS_BRAILLE_REGICE_COMPLETED,   MAP_GROUP(MAP_ISLAND_CAVE),  MAP_NUM(MAP_ISLAND_CAVE),  BR_DOOR_WAIT},
};

// All three chambers are one layout: the wall is (7..9, 19..20), and its middle bottom
// cell is the warp up into the chamber once it is open.
#define BR_DOOR_X 8
#define BR_DOOR_Y 20

static const struct BrStoryDoor *DoorHere(void)
{
    u8 i;

    for (i = 0; i < ARRAY_COUNT(sDoors); i++)
    {
        if (sDoors[i].mapGroup == gSaveBlock1Ptr->location.mapGroup
         && sDoors[i].mapNum == gSaveBlock1Ptr->location.mapNum)
            return &sDoors[i];
    }
    return NULL;
}

// IslandCave_EventScript_OpenRegiEntrance, which is the other two's effect as well.
static void Open(const struct BrStoryDoor *door)
{
    MapGridSetMetatileIdAt(7 + MAP_OFFSET, 19 + MAP_OFFSET, METATILE_Cave_SealedChamberEntrance_TopLeft | MAPGRID_IMPASSABLE);
    MapGridSetMetatileIdAt(8 + MAP_OFFSET, 19 + MAP_OFFSET, METATILE_Cave_SealedChamberEntrance_TopMid | MAPGRID_IMPASSABLE);
    MapGridSetMetatileIdAt(9 + MAP_OFFSET, 19 + MAP_OFFSET, METATILE_Cave_SealedChamberEntrance_TopRight | MAPGRID_IMPASSABLE);
    MapGridSetMetatileIdAt(7 + MAP_OFFSET, 20 + MAP_OFFSET, METATILE_Cave_SealedChamberEntrance_BottomLeft | MAPGRID_IMPASSABLE);
    MapGridSetMetatileIdAt(8 + MAP_OFFSET, 20 + MAP_OFFSET, METATILE_Cave_SealedChamberEntrance_BottomMid);
    MapGridSetMetatileIdAt(9 + MAP_OFFSET, 20 + MAP_OFFSET, METATILE_Cave_SealedChamberEntrance_BottomRight | MAPGRID_IMPASSABLE);
    DrawWholeMapView();
    PlaySE(SE_BANG);
    FlagSet(door->flag);
}

// A Flying-type in the party, not a mon that knows FLY: the HMs are out of the match
// (br_balls.c and br_moves.c stop at ITEM_HM01) and FLY is level-up for nobody a match
// deals early, so "knows FLY" was a door almost nobody could open. web/src/match/story.ts's
// FLYING is the same rule for the bots, pinned to gSpeciesInfo by parity.test.ts.
static bool8 HasFlier(void)
{
    u16 species;
    u8 slot;

    for (slot = 0; slot < gPlayerPartyCount && slot < PARTY_SIZE; slot++)
    {
        if (GetMonData(&gPlayerParty[slot], MON_DATA_IS_EGG))
            continue;
        species = GetMonData(&gPlayerParty[slot], MON_DATA_SPECIES);
        if (gSpeciesInfo[species].types[0] == TYPE_FLYING || gSpeciesInfo[species].types[1] == TYPE_FLYING)
            return TRUE;
    }
    return FALSE;
}

// The phase the event whose pieces lie on this map dropped on, or 0 for none: event n
// drops on phase 2n + 2 (web/src/match/events.ts eventForRing).
static u8 EventPhaseHere(void)
{
    const struct BrLootItem *it;
    u8 i;

    for (i = 0; i < BR_MAX_LOOT; i++)
    {
        it = &gBrLoot.items[i];
        if (it->kind == BR_LOOT_NONE || (it->key & 0xF000) != BR_EVENT_KEY_BASE)
            continue;
        if (it->mapGroup == gSaveBlock1Ptr->location.mapGroup && it->mapNum == gSaveBlock1Ptr->location.mapNum)
            return ((it->key >> 4) & 0xF) * 2 + 2;
    }
    return 0;
}

// A, facing the wall's middle from the cell under it, the way the braille is read.
static bool8 PressedAtWall(void)
{
    struct ObjectEvent *self;

    if (!JOY_NEW(A_BUTTON) || ScriptContext_IsEnabled() || ArePlayerFieldControlsLocked())
        return FALSE;
    self = &gObjectEvents[gPlayerAvatar.objectEventId];
    return self->facingDirection == DIR_NORTH
        && self->currentCoords.x == BR_DOOR_X + MAP_OFFSET && self->currentCoords.y == BR_DOOR_Y + 1 + MAP_OFFSET;
}

// ---- the ferry -----------------------------------------------------------------------

struct BrStoryIsland
{
    u8 mapsec;
    u16 flag;
};

// Each island the ferry can sail to, and the flag its menu row asks (script_menu.c's
// CreateLilycoveSSTidalMultichoice, beside the ticket the boot gave).
static const struct BrStoryIsland sIslands[] =
{
    { MAPSEC_SOUTHERN_ISLAND, FLAG_ENABLE_SHIP_SOUTHERN_ISLAND },
    { MAPSEC_BIRTH_ISLAND, FLAG_ENABLE_SHIP_BIRTH_ISLAND },
    { MAPSEC_FARAWAY_ISLAND, FLAG_ENABLE_SHIP_FARAWAY_ISLAND },
    { MAPSEC_NAVEL_ROCK, FLAG_ENABLE_SHIP_NAVEL_ROCK },
};

u8 BrStory_Dock(u8 mapsec)
{
    u8 i;

    for (i = 0; i < ARRAY_COUNT(sIslands); i++)
    {
        if (sIslands[i].mapsec == mapsec)
            return MAPSEC_LILYCOVE_CITY;
    }
    return mapsec;
}

// The ferry sails to an island while an event that dropped there still has its
// legendary, and not before or after.
static void Ferry(void)
{
    u8 i, n;
    bool8 on;

    for (i = 0; i < ARRAY_COUNT(sIslands); i++)
    {
        on = FALSE;
        if (gBrEvents.seed == gBrMatch.seed)
        {
            for (n = 0; n < BR_EVENT_MAX; n++)
            {
                if ((gBrEvents.live & (1 << n)) && !(gBrEvents.taken & (1 << n))
                 && gBrEvents.mapsec[n] == sIslands[i].mapsec)
                    on = TRUE;
            }
        }
        if (on)
            FlagSet(sIslands[i].flag);
        else
            FlagClear(sIslands[i].flag);
    }
}

void BrStory_Tick(void)
{
    const struct BrStoryDoor *door;
    u8 phase;

    if (gBrMatch.seed == 0 || !BrField_OverworldRunning())
        return;
    Ferry();
    door = DoorHere();
    if (door == NULL || FlagGet(door->flag))
        return;
    if (door->rule == BR_DOOR_WAIT)
    {
        phase = EventPhaseHere();
        if (phase != 0 && gBrRing.phase > phase)
            Open(door);
        return;
    }
    if (!PressedAtWall() || (door->rule == BR_DOOR_FLY && !HasFlier()))
        return; // the braille says what it says
    gMain.newKeys &= ~A_BUTTON;
    gMain.newAndRepeatedKeys &= ~A_BUTTON;
    Open(door);
}

// ---- the people ----------------------------------------------------------------------

extern const u8 BR_EventScript_GateMaxieHideout[];
extern const u8 BR_EventScript_GateArchie[];
extern const u8 BR_EventScript_GateShelly[];
extern const u8 BR_EventScript_GateMatt[];
extern const u8 BR_EventScript_GateMaxieChimney[];
extern const u8 BR_EventScript_GateMaxieSpace[];

static const u8 sName_Maxie[] = _("MAXIE");
static const u8 sName_Archie[] = _("ARCHIE");
static const u8 sName_Shelly[] = _("SHELLY");
static const u8 sName_Matt[] = _("MATT");

struct BrStoryPerson
{
    u8 mapGroup;
    u8 mapNum;
    u8 x; // map coords, no MAP_OFFSET, as story.ts writes them
    u8 y;
    u8 gfx;                 // an object gfx id, u8 as pret's graphicsId is
    u16 wants;   // ITEM_NONE: he just gives it
    u16 trainer; // TRAINER_NONE: no fight first. Else a gate: he gives it when he falls
    const u8 *script; // the gate's trainerbattle (data/scripts/br.inc)
    const u8 *name;   // what the story's other pieces say is guarding them
};

static const struct BrStoryPerson sPeople[] =
{
    {MAP_GROUP(MAP_GRANITE_CAVE_STEVENS_ROOM), MAP_NUM(MAP_GRANITE_CAVE_STEVENS_ROOM), 7, 8, OBJ_EVENT_GFX_STEVEN, ITEM_NONE, TRAINER_NONE, NULL, NULL},
    {MAP_GROUP(MAP_SLATEPORT_CITY_HARBOR), MAP_NUM(MAP_SLATEPORT_CITY_HARBOR), 6, 13, OBJ_EVENT_GFX_SCIENTIST_1, ITEM_SCANNER, TRAINER_NONE, NULL, NULL},
    {MAP_GROUP(MAP_MAGMA_HIDEOUT_4F), MAP_NUM(MAP_MAGMA_HIDEOUT_4F), 16, 21, OBJ_EVENT_GFX_MAXIE, ITEM_NONE, TRAINER_MAXIE_MAGMA_HIDEOUT, BR_EventScript_GateMaxieHideout, sName_Maxie},
    {MAP_GROUP(MAP_ROUTE128), MAP_NUM(MAP_ROUTE128), 37, 22, OBJ_EVENT_GFX_ARCHIE, ITEM_NONE, TRAINER_ARCHIE, BR_EventScript_GateArchie, sName_Archie},
    {MAP_GROUP(MAP_ROUTE119_WEATHER_INSTITUTE_2F), MAP_NUM(MAP_ROUTE119_WEATHER_INSTITUTE_2F), 4, 6, OBJ_EVENT_GFX_AQUA_MEMBER_F, ITEM_NONE, TRAINER_SHELLY_WEATHER_INSTITUTE, BR_EventScript_GateShelly, sName_Shelly},
    {MAP_GROUP(MAP_AQUA_HIDEOUT_B2F), MAP_NUM(MAP_AQUA_HIDEOUT_B2F), 23, 19, OBJ_EVENT_GFX_AQUA_MEMBER_M, ITEM_NONE, TRAINER_MATT, BR_EventScript_GateMatt, sName_Matt},
    {MAP_GROUP(MAP_MT_CHIMNEY), MAP_NUM(MAP_MT_CHIMNEY), 13, 6, OBJ_EVENT_GFX_MAXIE, ITEM_NONE, TRAINER_MAXIE_MT_CHIMNEY, BR_EventScript_GateMaxieChimney, sName_Maxie},
    {MAP_GROUP(MAP_MOSSDEEP_CITY_SPACE_CENTER_2F), MAP_NUM(MAP_MOSSDEEP_CITY_SPACE_CENTER_2F), 1, 9, OBJ_EVENT_GFX_MAXIE, ITEM_NONE, TRAINER_MAXIE_MOSSDEEP, BR_EventScript_GateMaxieSpace, sName_Maxie},
};

// The gate fight under way, by the piece its boss holds; and the bosses we have beaten
// this match, a bit per event (key 0xB000 | n << 4 | i), whose piece any later Take hands
// over without the fight again: a full party parks the mon, and a cancelled release
// screen leaves it on the ground for the next A (story-gate-full). The match is the
// seed's low half, so a new match's same key is a new boss.
static const u8 sText_TakenFirst[] = _("SOMEBODY GOT THERE FIRST");

static EWRAM_DATA u16 sGateKey = 0;
static EWRAM_DATA u16 sGateSeed = 0;
static EWRAM_DATA u8 sGatesWon = 0;

static bool8 GateWon(u16 key)
{
    return sGateSeed == (u16)gBrMatch.seed && (sGatesWon >> ((key >> 4) & 7)) & 1;
}

static bool8 OnMap(const struct BrStoryPerson *person, u8 mapGroup, u8 mapNum)
{
    return person->mapGroup == mapGroup && person->mapNum == mapNum;
}

static const struct BrStoryPerson *PersonAt(const struct BrLootItem *it)
{
    u8 i;

    if ((it->key & 0xF000) != BR_EVENT_KEY_BASE)
        return NULL;
    for (i = 0; i < ARRAY_COUNT(sPeople); i++)
    {
        if (OnMap(&sPeople[i], it->mapGroup, it->mapNum)
         && sPeople[i].x + MAP_OFFSET == it->x && sPeople[i].y + MAP_OFFSET == it->y)
            return &sPeople[i];
    }
    return NULL;
}

// The boss on this piece's map still holding his: the rest of his story waits on him.
static const struct BrStoryPerson *GuardOf(const struct BrLootItem *it)
{
    const struct BrLootItem *row;
    u8 i, j;

    if ((it->key & 0xF000) != BR_EVENT_KEY_BASE)
        return NULL;
    for (i = 0; i < ARRAY_COUNT(sPeople); i++)
    {
        if (sPeople[i].trainer == TRAINER_NONE || !OnMap(&sPeople[i], it->mapGroup, it->mapNum))
            continue;
        for (j = 0; j < BR_MAX_LOOT; j++)
        {
            row = &gBrLoot.items[j];
            if (row != it && row->kind != BR_LOOT_NONE && (row->key & 0xFFF0) == (it->key & 0xFFF0)
             && OnMap(&sPeople[i], row->mapGroup, row->mapNum)
             && sPeople[i].x + MAP_OFFSET == row->x && sPeople[i].y + MAP_OFFSET == row->y)
                return &sPeople[i];
        }
    }
    return NULL;
}

u8 BrStory_Person(const struct BrLootItem *it)
{
    const struct BrStoryPerson *person = PersonAt(it);

    return person != NULL ? person->gfx : 0;
}

bool8 BrStory_IsGate(u16 trainerId)
{
    u8 i;

    for (i = 0; i < ARRAY_COUNT(sPeople); i++)
        if (sPeople[i].trainer != TRAINER_NONE && sPeople[i].trainer == trainerId)
            return TRUE;
    return FALSE;
}

static const u8 sText_Wants[] = _("HE WANTS THE ");
static const u8 sText_Guards[] = _(" GUARDS IT");

bool8 BrStory_Hands(const struct BrLootItem *it)
{
    const struct BrStoryPerson *person = PersonAt(it);
    const struct BrStoryPerson *guard;
    u8 line[BR_HUD_LINE_MAX + 2];
    const u8 *last = line + ARRAY_COUNT(line) - 1;
    u8 *p;

    if (person == NULL)
    {
        guard = GuardOf(it);
        if (guard == NULL)
            return TRUE;
        p = BrHud_Append(line, last, guard->name);
        BrHud_Append(p, last, sText_Guards);
        PlaySE(SE_FAILURE);
        BrHud_Box(line);
        return FALSE;
    }
    if (person->trainer != TRAINER_NONE)
    {
        if (GateWon(it->key))
            return TRUE;
        // The fight first, his own: one shot, and a loss is a loss like any trainer's.
        // Each ROM fights him for itself; whoever wins first takes it from the room.
        ClearTrainerFlag(person->trainer);
        sGateKey = it->key;
        gSelectedObjectEvent = it->objId;
        gSpecialVar_LastTalked = gObjectEvents[it->objId].localId;
        ScriptContext_SetupScript(person->script);
        return FALSE;
    }
    if (person->wants == ITEM_NONE)
        return TRUE;
    if (RemoveBagItem(person->wants, 1))
        return TRUE;
    p = BrHud_Append(line, last, sText_Wants);
    BrHud_Append(p, last, GetItemName(person->wants));
    PlaySE(SE_FAILURE);
    BrHud_Box(line);
    return FALSE;
}

// The gate's boss fell (BR_EventScript_GateBeaten): what he held is ours, if nobody
// else beat him to it while we fought; if somebody did, say so.
void BrStory_GateBeaten(void)
{
    u16 key = sGateKey;

    sGateKey = 0;
    if (sGateSeed != (u16)gBrMatch.seed)
    {
        sGateSeed = gBrMatch.seed;
        sGatesWon = 0;
    }
    sGatesWon |= 1 << ((key >> 4) & 7);
    if (!BrLoot_TakeKey(key))
    {
        PlaySE(SE_FAILURE);
        BrHud_Box(sText_TakenFirst);
    }
}
