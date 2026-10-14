// Story events' places. See include/br/br_story.h.
#include "global.h"
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
    BR_DOOR_FLY,   // A at the wall, FLY in the party
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

static bool8 KnowsFly(void)
{
    u8 slot;

    for (slot = 0; slot < gPlayerPartyCount && slot < PARTY_SIZE; slot++)
    {
        if (!GetMonData(&gPlayerParty[slot], MON_DATA_IS_EGG) && MonKnowsMove(&gPlayerParty[slot], MOVE_FLY))
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

void BrStory_Tick(void)
{
    const struct BrStoryDoor *door;
    u8 phase;

    if (gBrMatch.seed == 0 || !BrField_OverworldRunning())
        return;
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
    if (!PressedAtWall() || (door->rule == BR_DOOR_FLY && !KnowsFly()))
        return; // the braille says what it says
    gMain.newKeys &= ~A_BUTTON;
    gMain.newAndRepeatedKeys &= ~A_BUTTON;
    Open(door);
}

// ---- the people ----------------------------------------------------------------------

struct BrStoryPerson
{
    u8 mapGroup;
    u8 mapNum;
    u8 x; // map coords, no MAP_OFFSET, as story.ts writes them
    u8 y;
    u16 gfx;
    u16 wants; // ITEM_NONE: he just gives it
};

static const struct BrStoryPerson sPeople[] =
{
    {MAP_GROUP(MAP_GRANITE_CAVE_STEVENS_ROOM), MAP_NUM(MAP_GRANITE_CAVE_STEVENS_ROOM), 7, 8, OBJ_EVENT_GFX_STEVEN,      ITEM_NONE},
    {MAP_GROUP(MAP_SLATEPORT_CITY_HARBOR),     MAP_NUM(MAP_SLATEPORT_CITY_HARBOR),     6, 13, OBJ_EVENT_GFX_SCIENTIST_1, ITEM_SCANNER},
};

static const struct BrStoryPerson *PersonAt(const struct BrLootItem *it)
{
    u8 i;

    if ((it->key & 0xF000) != BR_EVENT_KEY_BASE)
        return NULL;
    for (i = 0; i < ARRAY_COUNT(sPeople); i++)
    {
        if (sPeople[i].mapGroup == it->mapGroup && sPeople[i].mapNum == it->mapNum
         && sPeople[i].x + MAP_OFFSET == it->x && sPeople[i].y + MAP_OFFSET == it->y)
            return &sPeople[i];
    }
    return NULL;
}

u8 BrStory_Person(const struct BrLootItem *it)
{
    const struct BrStoryPerson *person = PersonAt(it);

    return person != NULL ? person->gfx : 0;
}

static const u8 sText_Wants[] = _("HE WANTS THE ");

bool8 BrStory_Hands(const struct BrLootItem *it)
{
    const struct BrStoryPerson *person = PersonAt(it);
    u8 line[BR_HUD_LINE_MAX + 2];
    const u8 *last = line + ARRAY_COUNT(line) - 1;
    u8 *p;

    if (person == NULL || person->wants == ITEM_NONE)
        return TRUE;
    if (RemoveBagItem(person->wants, 1))
        return TRUE;
    p = BrHud_Append(line, last, sText_Wants);
    BrHud_Append(p, last, GetItemName(person->wants));
    PlaySE(SE_FAILURE);
    BrHud_Box(line);
    return FALSE;
}
