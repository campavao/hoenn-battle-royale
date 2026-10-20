// The map's own people, cleared off. See include/br/br_strip.h.
#include "global.h"
#include "constants/event_objects.h"
#include "constants/flags.h"
#include "constants/trainer_types.h"
#include "br/br_gym.h"
#include "br/br_match.h"
#include "br/br_strip.h"

extern const u8 SlateportCity_Harbor_EventScript_FerryAttendant[];
extern const u8 SouthernIsland_Exterior_EventScript_Sailor[];
extern const u8 BirthIsland_Harbor_EventScript_Sailor[];
extern const u8 FarawayIsland_Entrance_EventScript_Sailor[];
extern const u8 NavelRock_Harbor_EventScript_Sailor[];
extern const u8 SSTidalCorridor_EventScript_ExitSailor[];
extern const u8 Route112_CableCarStation_EventScript_Attendant[];
extern const u8 MtChimney_CableCarStation_EventScript_Attendant[];

// The people who take you somewhere: MR. BRINEY at each of his stops (br_boot.c's
// BrBoot_PlaceBriney) and Lilycove's ferry attendant, by the flag that hides each.
// Slateport's attendant shares hers with the harbour's crowd, so she goes by script, and
// so do the sailors who take you back from the islands (br_story.c, Ferry), who have none,
// and the one at the SS TIDAL's gangway, the only way off the boat once it has made land.
// The cable car's attendants, at both stations, are the only ride up MT. CHIMNEY.
static const u8 *const sFerrymen[] =
{
    SlateportCity_Harbor_EventScript_FerryAttendant,
    SouthernIsland_Exterior_EventScript_Sailor,
    BirthIsland_Harbor_EventScript_Sailor,
    FarawayIsland_Entrance_EventScript_Sailor,
    NavelRock_Harbor_EventScript_Sailor,
    SSTidalCorridor_EventScript_ExitSailor,
    Route112_CableCarStation_EventScript_Attendant,
    MtChimney_CableCarStation_EventScript_Attendant,
};

static const u16 sCarriers[] =
{
    FLAG_HIDE_BRINEYS_HOUSE_MR_BRINEY,
    FLAG_HIDE_ROUTE_104_MR_BRINEY,
    FLAG_HIDE_MR_BRINEY_DEWFORD_TOWN,
    FLAG_HIDE_ROUTE_109_MR_BRINEY,
    FLAG_HIDE_LILYCOVE_HARBOR_FERRY_ATTENDANT,
};

// Graphics that are a person or an obstacle, as runs of OBJ_EVENT_GFX_ ids: 84..86 are
// the rooftop saleswoman, TEALA and a smash rock. CUT trees and STRENGTH boulders stay
// since Cam's 10-19 play-test (#7): somebody who could learn the HM clears them as you
// walk in (br_hm.c). Everything else stays: the
// nurse (58), item balls and berry trees (59..62), the clerk (83), the dolls, the boats
// and trucks, the Pokemon, the leaders (125..132, 218: kept or not by br_gym.c's table,
// below) and the player's own frames, which no map template uses.
static const u8 sStripped[][2] =
{
    { OBJ_EVENT_GFX_QUINTY_PLUMP, OBJ_EVENT_GFX_HEX_MANIAC },        // 4..40, towns
    { OBJ_EVENT_GFX_SWIMMER_M, OBJ_EVENT_GFX_CYCLING_TRIATHLETE_F }, // 42..57, routes
    { OBJ_EVENT_GFX_PROF_BIRCH, OBJ_EVENT_GFX_LUCY },                // the Frontier
    { OBJ_EVENT_GFX_ROOFTOP_SALE_WOMAN, OBJ_EVENT_GFX_BREAKABLE_ROCK },
    { OBJ_EVENT_GFX_ARTIST, OBJ_EVENT_GFX_CAMERAMAN },               // rivals
    { OBJ_EVENT_GFX_SCIENTIST_2, OBJ_EVENT_GFX_DRAKE },              // teams, the Four
    { OBJ_EVENT_GFX_ROXANNE, OBJ_EVENT_GFX_TATE },                   // leaders, off gyms
    { OBJ_EVENT_GFX_WALLACE, OBJ_EVENT_GFX_LITTLE_BOY_3 },
    { OBJ_EVENT_GFX_HOT_SPRINGS_OLD_WOMAN, OBJ_EVENT_GFX_HOT_SPRINGS_OLD_WOMAN },
    { OBJ_EVENT_GFX_GAMEBOY_KID, OBJ_EVENT_GFX_CONTEST_JUDGE },
    { OBJ_EVENT_GFX_ARCHIE, OBJ_EVENT_GFX_MAXIE },
    { OBJ_EVENT_GFX_KECLEON, OBJ_EVENT_GFX_KECLEON },                // in the road
    { OBJ_EVENT_GFX_KECLEON_BRIDGE_SHADOW, OBJ_EVENT_GFX_TUBER_M_SWIMMING },
    { OBJ_EVENT_GFX_MOM, OBJ_EVENT_GFX_LINK_MAY },
    { OBJ_EVENT_GFX_JUAN, OBJ_EVENT_GFX_SCOTT },
    { OBJ_EVENT_GFX_MYSTERY_GIFT_MAN, OBJ_EVENT_GFX_MYSTERY_GIFT_MAN },
    { OBJ_EVENT_GFX_UNION_ROOM_NURSE, OBJ_EVENT_GFX_UNION_ROOM_NURSE },
    { OBJ_EVENT_GFX_RED, OBJ_EVENT_GFX_LEAF },
    { OBJ_EVENT_GFX_BRANDON, OBJ_EVENT_GFX_LINK_RS_MAY },
};

static bool8 PersonOrObstacle(u8 gfx)
{
    u8 i;

    // The rival and the rest drawn through a VAR are people whoever they turn out to be.
    if (gfx >= OBJ_EVENT_GFX_VARS)
        return TRUE;
    for (i = 0; i < ARRAY_COUNT(sStripped); i++)
    {
        if (gfx >= sStripped[i][0] && gfx <= sStripped[i][1])
            return TRUE;
    }
    return FALSE;
}

EWRAM_DATA u32 gBrStripped[BR_STRIPPED_WORDS] = {0};

// The rule, match or not. A map's own ids are small; from LOCALID_CAMERA up they are
// spawned by code -- a cutscene's camera (a BOY_1 the script then hides and follows),
// BR's loot and ghosts -- and every one is wanted.
static bool8 StrippedInAMatch(const struct ObjectEventTemplate *template, u8 mapNum, u8 mapGroup)
{
    u8 i;

    if (template->localId >= LOCALID_CAMERA)
        return FALSE;
    // Every trainer, whatever they look like: a fight on the way is a stop. The rest go
    // by what they look like. The exceptions below are asked only of those, since this
    // runs for every template on every map load, and a load that runs a VBlank longer is
    // a frame more the page holds (seam-midframe).
    if (template->trainerType == TRAINER_TYPE_NONE && !PersonOrObstacle(template->graphicsId))
        return FALSE;
    if (BrGym_IsLeader(mapGroup, mapNum, template->localId))
        return FALSE;
    for (i = 0; i < ARRAY_COUNT(sFerrymen); i++)
    {
        if (template->script == sFerrymen[i])
            return FALSE;
    }
    for (i = 0; i < ARRAY_COUNT(sCarriers); i++)
    {
        if (template->flagId == sCarriers[i])
            return FALSE;
    }
    return TRUE;
}

bool8 BrStrip_Stripped(const struct ObjectEventTemplate *template, u8 mapNum, u8 mapGroup)
{
    // No match, no rules: a ROM booted without one is pret's Hoenn, which is what the
    // drivers' controls (ambush-control.txt) stand on.
    if (gBrMatch.phase == BR_PHASE_NONE)
        return FALSE;
    return StrippedInAMatch(template, mapNum, mapGroup);
}

void BrStrip_MarkTemplates(void)
{
    const struct ObjectEventTemplate *templates = gSaveBlock1Ptr->objectEventTemplates;
    u8 mapNum = gSaveBlock1Ptr->location.mapNum;
    u8 mapGroup = gSaveBlock1Ptr->location.mapGroup;
    u8 i;

    CpuFill32(0, gBrStripped, sizeof(gBrStripped));
    for (i = 0; i < OBJECT_EVENT_TEMPLATES_COUNT; i++)
    {
        // A localId of 0 is an empty row.
        if (templates[i].localId != 0 && StrippedInAMatch(&templates[i], mapNum, mapGroup))
            gBrStripped[i / 32] |= 1u << (i % 32);
    }
}
