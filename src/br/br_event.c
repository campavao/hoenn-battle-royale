// Events on the MAP. See include/br/br_event.h.
#include "global.h"
#include "data.h"
#include "item.h"
#include "event_data.h"
#include "event_object_movement.h"
#include "field_player_avatar.h"
#include "fieldmap.h"
#include "main.h"
#include "overworld.h"
#include "pokemon.h"
#include "region_map.h"
#include "script.h"
#include "sound.h"
#include "sprite.h"
#include "string_util.h"
#include "constants/event_object_movement.h"
#include "constants/event_objects.h"
#include "constants/items.h"
#include "constants/region_map_sections.h"
#include "constants/songs.h"
#include "constants/species.h"
#include "br/br_event.h"
#include "br/br_story.h"
#include "br/br_field.h"
#include "br/br_ghosts.h"
#include "br/br_gym.h"
#include "br/br_hud.h"
#include "br/br_levels.h"
#include "br/br_loot.h"
#include "br/br_mailbox.h"
#include "br/br_spectate.h"
#include "br/br_match.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"

EWRAM_DATA struct BrEvents gBrEvents = {0};

extern const u8 BR_EventScript_Trader[];

// A trader is a person the match put down, so he is in the run nothing walks into
// (br_ghosts.c): he stands on a cell the director dealt, which can be the one way down a
// corridor, and a trainer must never find the way shut by him.
STATIC_ASSERT(BR_EVENT_LOCAL_ID_BASE + BR_EVENT_MAX == BR_LOOT_LOCAL_ID_BASE, BrTradersLootAndGhostsAreOneRun)
STATIC_ASSERT(BR_EVENT_MAX <= 8, BrEventBitsFitAByte)
STATIC_ASSERT(((BR_EVENT_MAX - 1) << 4 | 15) < 0x100, BrEventKeysStayUnder0xB100)

// EVENT: seat, n, section, the legendary's key, then the trader -- map group and number,
// x, y and his species, 0 for none.
#define BR_EVENT_LEN 5
#define BR_EVENT_TRADER_LEN 13

static const u8 sText_Traded[] = _("TRADED FOR ");
static const u8 sText_Bang[] = _("!");
static const u8 sText_TradedAlready[] = _("HE HAS ALREADY TRADED");
static const u8 sText_Fainted[] = _("NOT A FAINTED ONE");

static void Despawn(u8 i)
{
    struct ObjectEvent *obj;

    if (gBrEvents.objId[i] == BR_NO_OBJ)
        return;
    obj = &gObjectEvents[gBrEvents.objId[i]];
    if (obj->active && obj->localId == BR_EVENT_LOCAL_ID_BASE + i)
        BrField_RemoveObject(obj->localId, obj->mapNum, obj->mapGroup);
    gBrEvents.objId[i] = BR_NO_OBJ;
}

static void Clear(void)
{
    u8 i;

    CpuFill32(0, &gBrEvents, sizeof(gBrEvents));
    for (i = 0; i < BR_EVENT_MAX; i++)
        gBrEvents.objId[i] = BR_NO_OBJ;
}

// Another match's marks are not this one's: the seed START put in says which match it is.
static void Forget(void)
{
    u8 i;

    if (gBrEvents.seed == gBrMatch.seed)
        return;
    for (i = 0; i < BR_EVENT_MAX; i++)
        Despawn(i);
    Clear();
    gBrEvents.seed = gBrMatch.seed;
}

static void HandleEvent(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);
    struct BrEventTrader *t;
    u8 i;

    if (n < BR_EVENT_LEN || d[1] >= BR_EVENT_MAX || d[2] >= MAPSEC_NONE)
        return;
    Forget();
    i = d[1];
    gBrEvents.mapsec[i] = d[2];
    gBrEvents.key[i] = BrWire_ReadU16(d + 3);
    gBrEvents.live |= 1 << i;
    Despawn(i); // the same EVENT again, a catch-up, may move him
    t = &gBrEvents.trader[i];
    if (n < BR_EVENT_TRADER_LEN)
    {
        // An EVENT without one: whoever stood here before does not any more.
        t->species = SPECIES_NONE;
        return;
    }
    t->mapGroup = d[5];
    t->mapNum = d[6];
    t->x = (s16)BrWire_ReadU16(d + 7);
    t->y = (s16)BrWire_ReadU16(d + 9);
    t->species = BrWire_ReadU16(d + 11);
    if (t->species >= NUM_SPECIES)
        t->species = SPECIES_NONE;
}

void BrEvent_NoteTaken(u16 key)
{
    u8 i;

    if ((key & 0xF000) != BR_EVENT_KEY_BASE || gBrEvents.seed != gBrMatch.seed)
        return;
    for (i = 0; i < BR_EVENT_MAX; i++)
    {
        if (!(gBrEvents.live & (1 << i)))
            continue;
        if (gBrEvents.key[i] == key)
            gBrEvents.taken |= 1 << i;
        if (key == BR_EVENT_TRADER_KEY(i))
            gBrEvents.used |= 1 << i; // BrEvent_Tick lets go of him
    }
}

// An item ball in the middle of the section, the thing that is lying there. Half a cell
// below the middle, so a town's leader head (br_gym.c, a cell above it) and its fly
// marker stay readable over it.
void BrEvent_DrawOnMap(s16 left, s16 top)
{
    const struct RegionMapLocation *loc;
    struct Sprite *sprite;
    u8 i, spriteId;
    s16 x, y;

    if (gBrEvents.seed != gBrMatch.seed)
        return;
    for (i = 0; i < BR_EVENT_MAX; i++)
    {
        if (!(gBrEvents.live & (1 << i)))
            continue;
        loc = &gRegionMapEntries[BrStory_Dock(gBrEvents.mapsec[i])];
        x = (loc->x + left) * 8 + loc->width * 4;
        y = (loc->y + top) * 8 + loc->height * 4 + 4;
        spriteId = CreateObjectGraphicsSprite(OBJ_EVENT_GFX_ITEM_BALL, SpriteCallbackDummy, x, y, 0);
        if (spriteId == MAX_SPRITES)
            continue;
        sprite = &gSprites[spriteId];
        sprite->oam.priority = 2; // with the leader heads: over the map, under the cursor
        if (gBrEvents.taken & (1 << i))
            BrGym_Gray(sprite, GetObjectEventGraphicsInfo(OBJ_EVENT_GFX_ITEM_BALL)->paletteTag);
    }
}

// ---- the traders ---------------------------------------------------------------------

static bool8 TraderHere(u8 i)
{
    const struct BrEventTrader *t = &gBrEvents.trader[i];

    return gBrEvents.seed == gBrMatch.seed && (gBrEvents.live & (1 << i)) && !(gBrEvents.used & (1 << i))
        && t->species != SPECIES_NONE
        && t->mapGroup == gSaveBlock1Ptr->location.mapGroup && t->mapNum == gSaveBlock1Ptr->location.mapNum;
}

static bool8 InView(u8 i)
{
    return TraderHere(i) && BrField_InObjectView(gBrEvents.trader[i].x, gBrEvents.trader[i].y);
}

u8 BrEvent_Wanted(void)
{
    u8 i, n = 0;

    for (i = 0; i < BR_EVENT_MAX; i++)
        if (InView(i))
            n++;
    return n;
}

// Still ours? A map load wipes the object table under us, and the local id is the proof,
// the rule the loot and the ghosts live by.
static struct ObjectEvent *TraderObject(u8 i)
{
    struct ObjectEvent *obj;

    if (gBrEvents.objId[i] == BR_NO_OBJ)
        return NULL;
    obj = &gObjectEvents[gBrEvents.objId[i]];
    if (!obj->active || obj->localId != BR_EVENT_LOCAL_ID_BASE + i)
    {
        gBrEvents.objId[i] = BR_NO_OBJ;
        return NULL;
    }
    return obj;
}

static void Spawn(u8 i)
{
    const struct BrEventTrader *t = &gBrEvents.trader[i];
    u8 id = SpawnSpecialObjectEventParameterized(OBJ_EVENT_GFX_GENTLEMAN, MOVEMENT_TYPE_FACE_DOWN,
                                                 BR_EVENT_LOCAL_ID_BASE + i, t->x, t->y,
                                                 MapGridGetElevationAt(t->x, t->y));

    if (id < OBJECT_EVENTS_COUNT)
        gBrEvents.objId[i] = id;
}

// The trader we face, or BR_EVENT_MAX.
static u8 TraderFaced(void)
{
    struct ObjectEvent *self = &gObjectEvents[gPlayerAvatar.objectEventId];
    s16 x = self->currentCoords.x + (s16)gDirectionToVectors[self->facingDirection].x;
    s16 y = self->currentCoords.y + (s16)gDirectionToVectors[self->facingDirection].y;
    u8 i;

    for (i = 0; i < BR_EVENT_MAX; i++)
    {
        if (TraderObject(i) != NULL && gBrEvents.trader[i].x == x && gBrEvents.trader[i].y == y)
            return i;
    }
    return BR_EVENT_MAX;
}

// His mon as it would come to us now: the rung settles it, so a DRATINI offered at 50 is
// the DRAGONITE we would get, and he says so.
static u16 Offered(u8 i, struct Pokemon *mon)
{
    CreateMon(mon, gBrEvents.trader[i].species, BrLevels_WildLevel(), USE_RANDOM_IVS, FALSE, 0,
              OT_ID_PLAYER_ID, 0);
    BrLevels_Settle(mon);
    return GetMonData(mon, MON_DATA_SPECIES, NULL);
}

// A on him, the way a ball's A is the loot's (br_loot.c TryTake): he has no template, so
// no script the field could find, and the press is his alone.
static void TryTalk(void)
{
    struct ObjectEvent *self;
    struct Pokemon mon;
    u8 i;

    if (!JOY_NEW(A_BUTTON) || ScriptContext_IsEnabled() || ArePlayerFieldControlsLocked())
        return;
    i = TraderFaced();
    if (i == BR_EVENT_MAX)
        return;
    gMain.newKeys &= ~A_BUTTON;
    gMain.newAndRepeatedKeys &= ~A_BUTTON;
    self = &gObjectEvents[gPlayerAvatar.objectEventId];
    ObjectEventTurn(&gObjectEvents[gBrEvents.objId[i]], GetOppositeDirection(self->facingDirection));
    StringCopy(gStringVar1, gSpeciesNames[Offered(i, &mon)]);
    gBrEvents.trading = i;
    ScriptContext_SetupScript(BR_EventScript_Trader);
}

bool8 BrEvent_Swap(u8 slot, struct Pokemon *mon)
{
    u8 line[BR_HUD_LINE_MAX + 2];
    const u8 *last = line + ARRAY_COUNT(line) - 1;
    u16 held;
    u8 *p;

    // A fainted one for a healthy one would be a MAX REVIVE thrown in.
    if (GetMonData(&gPlayerParty[slot], MON_DATA_HP, NULL) == 0)
    {
        PlaySE(SE_FAILURE);
        BrHud_Box(sText_Fainted);
        return FALSE;
    }
    // What it held stays ours: back in the bag, or at our feet when that pocket is full.
    held = GetMonData(&gPlayerParty[slot], MON_DATA_HELD_ITEM, NULL);
    if (held != ITEM_NONE && !AddBagItem(held, 1))
        BrLoot_DropItem(held);
    // He keeps the one he is given. POK-294's "nothing ever leaves the match" is about a
    // mon let go to make room, and is not this: dropped at our feet, it would be ours
    // again for one press, and the trade a free mon.
    gPlayerParty[slot] = *mon;
    p = BrHud_Append(line, last, sText_Traded);
    p = BrHud_Append(p, last, gSpeciesNames[GetMonData(mon, MON_DATA_SPECIES, NULL)]);
    BrHud_Append(p, last, sText_Bang);
    PlaySE(SE_PIN);
    BrHud_Box(line);
    BrSpectate_SendParty();
    return TRUE;
}

void BrEvent_Trade(void)
{
    struct Pokemon mon;
    u16 slot = gSpecialVar_0x8004;
    u8 i = gBrEvents.trading;

    if (slot >= PARTY_SIZE || i >= BR_EVENT_MAX
        || GetMonData(&gPlayerParty[slot], MON_DATA_SPECIES, NULL) == SPECIES_NONE)
        return;
    // Somebody else got to him while we were choosing.
    if (!TraderHere(i))
    {
        PlaySE(SE_FAILURE);
        BrHud_Box(sText_TradedAlready);
        return;
    }
    Offered(i, &mon);
    if (!BrEvent_Swap(slot, &mon))
        return;
    // Once, for the whole room: the PICKUP of his key takes him off every map.
    gBrEvents.used |= 1 << i;
    BrLoot_SendTaken(BR_EVENT_TRADER_KEY(i));
}

void BrEvent_Tick(void)
{
    u8 i;

    if (!BrField_OverworldRunning())
        return;
    for (i = 0; i < BR_EVENT_MAX; i++)
    {
        if (!InView(i))
            Despawn(i);
        else if (TraderObject(i) == NULL)
            Spawn(i);
    }
    TryTalk();
}

void BrEvent_Init(void)
{
    Clear();
    BrNet_On(BR_MSG_EVENT, HandleEvent);
}
