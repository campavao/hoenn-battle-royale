// Events on the MAP. See include/br/br_event.h.
#include "global.h"
#include "event_object_movement.h"
#include "region_map.h"
#include "sprite.h"
#include "constants/event_objects.h"
#include "constants/region_map_sections.h"
#include "br/br_event.h"
#include "br/br_gym.h"
#include "br/br_mailbox.h"
#include "br/br_match.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"

EWRAM_DATA struct BrEvents gBrEvents = {0};

STATIC_ASSERT(BR_EVENT_MAX <= 8, BrEventBitsFitAByte)
STATIC_ASSERT(((BR_EVENT_MAX - 1) << 4 | 15) < 0x100, BrEventKeysStayUnder0xB100)

// Another match's marks are not this one's: the seed START put in says which match it is.
static void Forget(void)
{
    if (gBrEvents.seed == gBrMatch.seed)
        return;
    CpuFill32(0, &gBrEvents, sizeof(gBrEvents));
    gBrEvents.seed = gBrMatch.seed;
}

static void HandleEvent(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);
    u8 i;

    if (n < 5 || d[1] >= BR_EVENT_MAX || d[2] >= MAPSEC_NONE)
        return;
    Forget();
    i = d[1];
    gBrEvents.mapsec[i] = d[2];
    gBrEvents.key[i] = BrWire_ReadU16(d + 3);
    gBrEvents.live |= 1 << i;
}

void BrEvent_NoteTaken(u16 key)
{
    u8 i;

    if ((key & 0xF000) != BR_EVENT_KEY_BASE || gBrEvents.seed != gBrMatch.seed)
        return;
    for (i = 0; i < BR_EVENT_MAX; i++)
    {
        if ((gBrEvents.live & (1 << i)) && gBrEvents.key[i] == key)
            gBrEvents.taken |= 1 << i;
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
        loc = &gRegionMapEntries[gBrEvents.mapsec[i]];
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

void BrEvent_Init(void)
{
    CpuFill32(0, &gBrEvents, sizeof(gBrEvents));
    BrNet_On(BR_MSG_EVENT, HandleEvent);
}
