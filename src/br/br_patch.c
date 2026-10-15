// Visible encounters. See include/br/br_patch.h.
#include "global.h"
#include "event_object_movement.h"
#include "field_effect.h"
#include "field_player_avatar.h"
#include "field_weather.h"
#include "fieldmap.h"
#include "metatile_behavior.h"
#include "sprite.h"
#include "wild_encounter.h"
#include "constants/field_effects.h"
#include "constants/map_groups.h"
#include "constants/metatile_behaviors.h"
#include "br/br_field.h"
#include "br/br_loot.h"
#include "br/br_match.h"
#include "br/br_patch.h"
#include "br/br_ring.h"

extern const struct SpritePalette gSpritePalette_GeneralFieldEffect0;
extern const struct SpritePalette gSpritePalette_GeneralFieldEffect1;

EWRAM_DATA struct BrPatch gBrPatch = {0};
// Taken, by key: a bit for every patch the match could deal (124 maps, 8 each), a map's
// eight in its header's byte. A driver clears a byte to grow a map's back.
EWRAM_DATA u8 gBrPatchTaken[(BR_PATCH_KEY(0x7F, 7) - BR_PATCH_KEY_BASE + 8) / 8] = {0};
// The seed the map was dealt under: START puts the match's in after the warp that may
// already have dealt this map under none.
static EWRAM_DATA u32 sDealtFor = 0;
// The ring phase the taken patches grew back for (br_patch.h). The ring is the one clock
// every ROM in the room hears the same way, so on each new phase every patch taken in the
// last one is back, everywhere at once.
static EWRAM_DATA u8 sGrownFor = 0;
STATIC_ASSERT(BR_PATCH_MAX == 8, BrPatchKeysHoldEight)

#define NO_HEADER 0xFFFF

// A patch's sprite is one of ours while it says so: the field reloads its sprites under a
// battle and a warp, and the id we kept is somebody else's by then.
#define sMagic data[6]
#define sSlot  data[7]
#define BR_PATCH_MAGIC 0x7A7C
// The rustle, then a breath, then the rustle again.
#define sPause data[5]
#define BR_PATCH_PAUSE 24

// br_zone.c's mulberry32 step, stateless.
static u32 Mix(u32 t)
{
    t += 0x6d2b79f5;
    t = (t ^ (t >> 15)) * (1 | t);
    t += (t ^ (t >> 7)) * (61 | t);
    t ^= t >> 14;
    return t;
}

static u16 CurrentMap(void)
{
    return (gSaveBlock1Ptr->location.mapGroup << 8) | gSaveBlock1Ptr->location.mapNum;
}

static u16 HeaderOf(u16 map)
{
    u16 i;

    for (i = 0; gWildMonHeaders[i].mapGroup != MAP_GROUP(MAP_UNDEFINED); i++)
    {
        if (gWildMonHeaders[i].mapGroup == (map >> 8) && gWildMonHeaders[i].mapNum == (map & 0xFF))
            return i;
    }
    return NO_HEADER;
}

static void Regrow(void)
{
    u8 i;

    for (i = 0; i < ARRAY_COUNT(gBrPatchTaken); i++)
        gBrPatchTaken[i] = 0;
}

static bool8 IsTaken(u16 key)
{
    u16 n = key - BR_PATCH_KEY_BASE;

    return (gBrPatchTaken[n / 8] >> (n % 8)) & 1;
}

// A cell a battle could start on, by the same test wild_encounter.c makes: grass, a cave
// floor or sand under a land table, water under a water one. Not a wall, and not where
// one of the map's people stood.
//
// Read off the layout as the ROM ships it, not the live grid: a map's ON_LOAD scripts set
// metatiles from flags that differ between players, and one cell more or less on one ROM
// would shift every pick after it -- the same key naming different cells in one room.
static bool8 Eligible(const struct WildPokemonHeader *header, s16 x, s16 y)
{
    const struct MapEvents *events = gMapHeader.events;
    const struct MapLayout *layout = gMapHeader.mapLayout;
    u16 block = layout->map[(x - MAP_OFFSET) + (y - MAP_OFFSET) * layout->width];
    u8 behavior;
    u8 i;

    if (UNPACK_COLLISION(block) != 0)
        return FALSE;
    behavior = GetMetatileAttributesById(UNPACK_METATILE(block)) & METATILE_ATTR_BEHAVIOR_MASK;
    if (!(header->landMonsInfo != NULL && MetatileBehavior_IsLandWildEncounter(behavior))
     && !(header->waterMonsInfo != NULL && MetatileBehavior_IsWaterWildEncounter(behavior)))
        return FALSE;
    for (i = 0; i < events->objectEventCount; i++)
    {
        if (events->objectEvents[i].x + MAP_OFFSET == x && events->objectEvents[i].y + MAP_OFFSET == y)
            return FALSE;
    }
    return TRUE;
}

static void Undraw(u8 i)
{
    u8 id = gBrPatch.spriteIds[i];

    gBrPatch.spriteIds[i] = MAX_SPRITES;
    if (id < MAX_SPRITES && gSprites[id].inUse && gSprites[id].sMagic == BR_PATCH_MAGIC && gSprites[id].sSlot == i)
    {
        u8 paletteNum = gSprites[id].oam.paletteNum;

        DestroySprite(&gSprites[id]);
        FieldEffectFreePaletteIfUnused(paletteNum);
    }
}

// Two passes over the map: count the cells, then find the ones the seed picked. A Safari
// area is 1600 cells and Route 119 over 5000, and a pass at once held the field up for
// five frames on the first (safari-opening.txt) -- so it goes a slice a frame, and the
// map has no patches until the second pass is done.
#define BR_PATCH_SLICE 256

static EWRAM_DATA u8 sPass = 0;          // 0 dealt, 1 counting, 2 placing
static EWRAM_DATA u8 sWant = 0;
static EWRAM_DATA s16 sX = 0, sY = 0;
static EWRAM_DATA u16 sCells = 0, sK = 0;
static EWRAM_DATA u16 sPicks[BR_PATCH_MAX] = {0};

static void Deal(u16 map)
{
    u8 i;

    for (i = 0; i < BR_PATCH_MAX; i++)
        Undraw(i);
    gBrPatch.map = map;
    gBrPatch.count = 0;
    gBrPatch.header = HeaderOf(map);
    sPass = 0;
    // Seven bits of header in a key (br_patch.h); Emerald has 124 rows.
    if (gBrPatch.header >= 0x80 || gBrMatch.seed == 0)
        return;
    sPass = 1;
    sX = sY = MAP_OFFSET;
    sCells = sK = 0;
}

static void Pick(void)
{
    u8 i, j;

    sWant = sCells / BR_PATCH_CELLS;
    if (sWant == 0)
        sWant = 1;
    if (sWant > BR_PATCH_MAX)
        sWant = BR_PATCH_MAX;
    for (i = 0; i < sWant; i++)
    {
        u16 pick = Mix(gBrMatch.seed ^ 0x9A7C ^ ((u32)gBrPatch.map << 8) ^ i) % sCells;

        // Distinct: a cell picked twice is the next one along.
        for (j = 0; j < i; j++)
        {
            if (sPicks[j] == pick)
            {
                pick = (pick + 1) % sCells;
                j = 0xFF;
            }
        }
        sPicks[i] = pick;
    }
}

// The next slice of whichever pass is running.
static void DealSome(void)
{
    const struct WildPokemonHeader *header = &gWildMonHeaders[gBrPatch.header];
    s16 w = gMapHeader.mapLayout->width + MAP_OFFSET;
    s16 h = gMapHeader.mapLayout->height + MAP_OFFSET;
    u16 n;
    u8 i;

    for (n = 0; n < BR_PATCH_SLICE; n++)
    {
        if (sY >= h)
        {
            if (sPass == 2 || sCells == 0)
            {
                gBrPatch.count = sCells == 0 ? 0 : sWant;
                sPass = 0;
                return;
            }
            Pick();
            sPass = 2;
            sX = sY = MAP_OFFSET;
        }
        if (Eligible(header, sX, sY))
        {
            if (sPass == 1)
            {
                sCells++;
            }
            else
            {
                for (i = 0; i < sWant; i++)
                {
                    if (sPicks[i] == sK)
                    {
                        gBrPatch.x[i] = sX;
                        gBrPatch.y[i] = sY;
                    }
                }
                sK++;
            }
        }
        if (++sX >= w)
        {
            sX = MAP_OFFSET;
            sY++;
        }
    }
}

// Darkened (Cam: "darkened indicators you can see"). In grass, the field's own rustle,
// redrawn in the darker greens of the palette it already uses, so it reads apart from the
// grass a step disturbs. Anywhere else -- water, a cave floor, sand, ash -- something's
// shadow, drifting: a ripple or a puff of dust in a darker colour still vanished into the
// sea and the sand (review of #19). Neither costs a palette slot of its own.
static const u32 sTallGrassPic[] = INCGFX_U32("graphics/field_effects/pics/br_patch_tall_grass.png", ".4bpp", "-mwidth 2 -mheight 2");
static const u32 sLongGrassPic[] = INCGFX_U32("graphics/field_effects/pics/br_patch_long_grass.png", ".4bpp", "-mwidth 2 -mheight 2");

static const struct SpriteFrameImage sTallGrassImages[] = {
    overworld_frame(sTallGrassPic, 2, 2, 0),
    overworld_frame(sTallGrassPic, 2, 2, 1),
    overworld_frame(sTallGrassPic, 2, 2, 2),
    overworld_frame(sTallGrassPic, 2, 2, 3),
    overworld_frame(sTallGrassPic, 2, 2, 4),
};
static const struct SpriteFrameImage sLongGrassImages[] = {
    overworld_frame(sLongGrassPic, 2, 2, 0),
    overworld_frame(sLongGrassPic, 2, 2, 1),
    overworld_frame(sLongGrassPic, 2, 2, 2),
    overworld_frame(sLongGrassPic, 2, 2, 3),
};

static void SpriteCB_Patch(struct Sprite *sprite)
{
    if (!sprite->animEnded)
        return;
    if (sprite->sPause++ < BR_PATCH_PAUSE)
        return;
    sprite->sPause = 0;
    StartSpriteAnim(sprite, 0);
}

// A pixel or two either way and back, every eight frames a step.
static const s8 sDrift[] = { 0, 1, 2, 1, 0, -1, -2, -1 };

static void SpriteCB_Shadow(struct Sprite *sprite)
{
    sprite->sPause++;
    sprite->x2 = sDrift[(sprite->sPause >> 3) & 7];
}

// The field's own sprite for what the cell is: see above. Read off the live grid, not the
// shipped layout the deal reads: a cell the deal picked is a cell a battle starts on
// either way, and only the picture can tell a metatile the map has since swapped.
static void Draw(u8 i)
{
    u8 behavior = MapGridGetMetatileBehaviorAt(gBrPatch.x[i], gBrPatch.y[i]);
    const struct SpritePalette *palette = &gSpritePalette_GeneralFieldEffect1;
    const struct SpriteFrameImage *images = NULL;
    struct SpriteTemplate template;
    u8 object, id, slot;
    s16 x = gBrPatch.x[i], y = gBrPatch.y[i];
    struct Sprite *sprite;

    if (MetatileBehavior_IsTallGrass(behavior))
    {
        object = FLDEFFOBJ_TALL_GRASS;
        images = sTallGrassImages;
    }
    else if (MetatileBehavior_IsLongGrass(behavior))
    {
        object = FLDEFFOBJ_LONG_GRASS;
        images = sLongGrassImages;
    }
    else
    {
        // 16x8, in colour 15 of whatever palette it is given: general 0's is black.
        object = FLDEFFOBJ_SHADOW_M;
        palette = &gSpritePalette_GeneralFieldEffect0;
    }
    slot = LoadSpritePalette(palette);
    if (slot == 0xFF)
        return; // no room this frame; the next one tries again
    UpdateSpritePaletteWithWeather(slot);
    SetSpritePosToOffsetMapCoords(&x, &y, 8, 8);
    template = *gFieldEffectObjectTemplatePointers[object];
    if (images != NULL)
        template.images = images;
    else
        y += 4; // at the cell's feet
    id = CreateSpriteAtEnd(&template, x, y, 0);
    if (id == MAX_SPRITES)
        return;
    sprite = &gSprites[id];
    sprite->coordOffsetEnabled = TRUE;
    sprite->oam.priority = 2;
    sprite->oam.paletteNum = slot;
    sprite->callback = images != NULL ? SpriteCB_Patch : SpriteCB_Shadow;
    sprite->sMagic = BR_PATCH_MAGIC;
    sprite->sSlot = i;
    sprite->sPause = images != NULL ? BR_PATCH_PAUSE : 0;
    gBrPatch.spriteIds[i] = id;
}

static bool8 Drawn(u8 i)
{
    u8 id = gBrPatch.spriteIds[i];

    return id < MAX_SPRITES && gSprites[id].inUse && gSprites[id].sMagic == BR_PATCH_MAGIC
        && gSprites[id].sSlot == i;
}

// The screen is 15 cells by 10 around the player; a cell past that is let go, one or two
// further out, so walking the edge back and forth does not make and unmake it.
static bool8 Near(u8 i, s16 rx, s16 ry)
{
    s16 dx = gBrPatch.x[i] - gSaveBlock1Ptr->pos.x - MAP_OFFSET;
    s16 dy = gBrPatch.y[i] - gSaveBlock1Ptr->pos.y - MAP_OFFSET;

    return dx >= -rx && dx <= rx && dy >= -ry && dy <= ry;
}

void BrPatch_Init(void)
{
    u8 i;

    gBrPatch.map = 0xFFFF;
    gBrPatch.count = 0;
    sDealtFor = 0;
    sGrownFor = 0;
    sPass = 0;
    for (i = 0; i < BR_PATCH_MAX; i++)
        gBrPatch.spriteIds[i] = MAX_SPRITES;
    Regrow();
}

// Brings the taken bits up to the match and the ring before anything reads or sets one.
// Both callers ask: the tick, and a PICKUP -- which BrNet_Tick hands over before the tick
// runs, so a PICKUP in the same frame as a new phase's RING would otherwise be marked and
// then grown straight back.
static void Settle(void)
{
    if (sDealtFor != gBrMatch.seed)
    {
        // A new match: every patch is back, the moment the seed is in -- a PICKUP that
        // lands before the field is running again is this match's, and must stay.
        Regrow();
        sDealtFor = gBrMatch.seed;
        gBrPatch.map = 0xFFFF;
        gBrPatch.count = 0;
    }
    if (sGrownFor != gBrRing.phase)
    {
        // A new ring: what was taken grows back, drawn by the tick when in view. A PICKUP
        // sent in the old phase that lands after the RING takes its patch for this one
        // too, on our ROM alone -- a whole phase of one patch, at worst.
        Regrow();
        sGrownFor = gBrRing.phase;
    }
}

void BrPatch_Tick(void)
{
    u8 i;

    Settle();
    if (!BrField_OverworldRunning())
        return;
    if (gBrPatch.map != CurrentMap())
        Deal(CurrentMap());
    if (sPass != 0)
        DealSome();
    for (i = 0; i < gBrPatch.count; i++)
    {
        bool8 live = !IsTaken(BR_PATCH_KEY(gBrPatch.header, i));

        if (Drawn(i))
        {
            if (!live || !Near(i, 10, 7))
                Undraw(i);
        }
        else
        {
            gBrPatch.spriteIds[i] = MAX_SPRITES;
            if (live && Near(i, 8, 6))
                Draw(i);
        }
    }
}

static s8 Under(void)
{
    struct ObjectEvent *player = &gObjectEvents[gPlayerAvatar.objectEventId];
    u8 i;

    if (gBrPatch.map != CurrentMap())
        return -1;
    for (i = 0; i < gBrPatch.count; i++)
    {
        if (gBrPatch.x[i] == player->currentCoords.x && gBrPatch.y[i] == player->currentCoords.y
         && !IsTaken(BR_PATCH_KEY(gBrPatch.header, i)))
            return i;
    }
    return -1;
}

bool8 BrPatch_Here(void)
{
    return Under() >= 0;
}

void BrPatch_Take(void)
{
    s8 i = Under();
    u16 key;

    if (i < 0)
        return;
    key = BR_PATCH_KEY(gBrPatch.header, i);
    BrPatch_NoteTaken(key);
    Undraw(i);
    BrLoot_SendTaken(key);
}

void BrPatch_NoteTaken(u16 key)
{
    u16 n;

    if (!BR_PATCH_IS_KEY(key))
        return;
    Settle();
    n = key - BR_PATCH_KEY_BASE;
    if (n / 8 < ARRAY_COUNT(gBrPatchTaken))
        gBrPatchTaken[n / 8] |= 1 << (n % 8);
}
