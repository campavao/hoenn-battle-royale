// The map's own people, cleared off. See include/br/br_strip.h.
#include "global.h"
#include "constants/event_objects.h"
#include "constants/flags.h"
#include "constants/trainer_types.h"
#include "br/br_gym.h"
#include "br/br_loot.h"
#include "br/br_match.h"
#include "br/br_strip.h"

extern const u8 SlateportCity_Harbor_EventScript_FerryAttendant[];

// The people who take you somewhere: MR. BRINEY at each of his stops (br_boot.c's
// BrBoot_PlaceBriney) and Lilycove's ferry attendant, by the flag that hides each.
// Slateport's attendant shares hers with the harbour's crowd, so she goes by script.
static const u16 sCarriers[] =
{
    FLAG_HIDE_BRINEYS_HOUSE_MR_BRINEY,
    FLAG_HIDE_ROUTE_104_MR_BRINEY,
    FLAG_HIDE_MR_BRINEY_DEWFORD_TOWN,
    FLAG_HIDE_ROUTE_109_MR_BRINEY,
    FLAG_HIDE_LILYCOVE_HARBOR_FERRY_ATTENDANT,
};

// Graphics that are a person or an obstacle, as runs of OBJ_EVENT_GFX_ ids. Everything
// else stays: the nurse (58), item balls and berry trees (59..62), the clerk (83), the
// dolls, the boats and trucks, the Pokemon, the leaders (125..132, 218: kept or not by
// br_gym.c's table, below) and the player's own frames, which no map template uses.
static const u8 sStripped[][2] =
{
    { OBJ_EVENT_GFX_QUINTY_PLUMP, OBJ_EVENT_GFX_HEX_MANIAC },              // 4..40, the town
    { OBJ_EVENT_GFX_SWIMMER_M, OBJ_EVENT_GFX_CYCLING_TRIATHLETE_F },       // 42..57, the routes
    { OBJ_EVENT_GFX_PROF_BIRCH, OBJ_EVENT_GFX_LUCY },                      // Birch, the Frontier
    { OBJ_EVENT_GFX_CUTTABLE_TREE, OBJ_EVENT_GFX_CUTTABLE_TREE },
    { OBJ_EVENT_GFX_ROOFTOP_SALE_WOMAN, OBJ_EVENT_GFX_PUSHABLE_BOULDER },  // and a smash rock
    { OBJ_EVENT_GFX_ARTIST, OBJ_EVENT_GFX_CAMERAMAN },                     // rivals
    { OBJ_EVENT_GFX_SCIENTIST_2, OBJ_EVENT_GFX_DRAKE },                    // teams, the Four
    { OBJ_EVENT_GFX_ROXANNE, OBJ_EVENT_GFX_TATE },                         // leaders off their gyms
    { OBJ_EVENT_GFX_WALLACE, OBJ_EVENT_GFX_LITTLE_BOY_3 },
    { OBJ_EVENT_GFX_HOT_SPRINGS_OLD_WOMAN, OBJ_EVENT_GFX_HOT_SPRINGS_OLD_WOMAN },
    { OBJ_EVENT_GFX_GAMEBOY_KID, OBJ_EVENT_GFX_CONTEST_JUDGE },
    { OBJ_EVENT_GFX_ARCHIE, OBJ_EVENT_GFX_MAXIE },
    { OBJ_EVENT_GFX_KECLEON, OBJ_EVENT_GFX_KECLEON },                      // stands in the road
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

bool8 BrStrip_Stripped(const struct ObjectEventTemplate *template, u8 mapNum, u8 mapGroup)
{
    u8 i;

    // No match, no rules: a ROM booted without one is pret's Hoenn, which is what the
    // drivers' controls (ambush-control.txt) stand on.
    if (gBrMatch.phase == BR_PHASE_NONE || template->localId >= BR_LOOT_LOCAL_ID_BASE)
        return FALSE;
    if (BrGym_IsLeader(mapGroup, mapNum, template->localId))
        return FALSE;
    if (template->script == SlateportCity_Harbor_EventScript_FerryAttendant)
        return FALSE;
    for (i = 0; i < ARRAY_COUNT(sCarriers); i++)
    {
        if (template->flagId == sCarriers[i])
            return FALSE;
    }
    // Every trainer but a leader, whatever they look like: a fight on the way is a stop.
    if (template->trainerType != TRAINER_TYPE_NONE)
        return TRUE;
    return PersonOrObstacle(template->graphicsId);
}
