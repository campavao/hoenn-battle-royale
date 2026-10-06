// Gym leaders as one-shot bosses (POK-295). See include/br/br_gym.h.
#include "global.h"
#include "data.h"
#include "item.h"
#include "money.h"
#include "sound.h"
#include "string_util.h"
#include "constants/characters.h"
#include "constants/items.h"
#include "constants/opponents.h"
#include "constants/songs.h"
#include "br/br_hud.h"
#include "br/br_gym.h"
#include "event_object_movement.h"
#include "palette.h"
#include "region_map.h"
#include "sprite.h"
#include "constants/event_objects.h"
#include "constants/map_groups.h"
#include "constants/region_map_sections.h"

#define BR_GYM_PURSE 1000

struct BrBoss
{
    u16 trainerId;
    u16 prize;
    u16 map;      // the gym, MAP_GROUP << 8 | MAP_NUM, as NPCOUT names it
    u8 localIds[2]; // TATE and LIZA are two sprites and either can be the one talked to
    u8 mapsec;    // the town on the MAP
    u8 gfx;       // the head drawn over it
};

#define GYM(m) ((MAP_GROUP(m) << 8) | MAP_NUM(m))

// The TM each gym already hands out, which is as themed as a prize gets: it is the move
// the leader just used on you. The map and local ids are web/src/match/bosses.ts's,
// which bosses.test.ts pins against the maps.
static const struct BrBoss sBosses[] =
{
    { TRAINER_ROXANNE_1,       ITEM_TM_ROCK_TOMB,   GYM(MAP_RUSTBORO_CITY_GYM),       { 1, 1 }, MAPSEC_RUSTBORO_CITY,  OBJ_EVENT_GFX_ROXANNE },
    { TRAINER_BRAWLY_1,        ITEM_TM_BULK_UP,     GYM(MAP_DEWFORD_TOWN_GYM),        { 1, 1 }, MAPSEC_DEWFORD_TOWN,   OBJ_EVENT_GFX_BRAWLY },
    { TRAINER_WATTSON_1,       ITEM_TM_SHOCK_WAVE,  GYM(MAP_MAUVILLE_CITY_GYM),       { 1, 1 }, MAPSEC_MAUVILLE_CITY,  OBJ_EVENT_GFX_WATTSON },
    { TRAINER_FLANNERY_1,      ITEM_TM_OVERHEAT,    GYM(MAP_LAVARIDGE_TOWN_GYM_1F),   { 1, 1 }, MAPSEC_LAVARIDGE_TOWN, OBJ_EVENT_GFX_FLANNERY },
    { TRAINER_NORMAN_1,        ITEM_TM_FACADE,      GYM(MAP_PETALBURG_CITY_GYM),      { 1, 1 }, MAPSEC_PETALBURG_CITY, OBJ_EVENT_GFX_NORMAN },
    { TRAINER_WINONA_1,        ITEM_TM_AERIAL_ACE,  GYM(MAP_FORTREE_CITY_GYM),        { 1, 1 }, MAPSEC_FORTREE_CITY,   OBJ_EVENT_GFX_WINONA },
    { TRAINER_TATE_AND_LIZA_1, ITEM_TM_CALM_MIND,   GYM(MAP_MOSSDEEP_CITY_GYM),       { 1, 9 }, MAPSEC_MOSSDEEP_CITY,  OBJ_EVENT_GFX_TATE },
    { TRAINER_JUAN_1,          ITEM_TM_WATER_PULSE, GYM(MAP_SOOTOPOLIS_CITY_GYM_1F),  { 1, 1 }, MAPSEC_SOOTOPOLIS_CITY, OBJ_EVENT_GFX_JUAN },
};

EWRAM_DATA u8 gBrGymsBeaten = 0;

extern const u8 BR_EventScript_BossBeaten[];

static const u8 sText_Took[] = _("TOOK ");
// 21 after the newline, so the longest prize name (a TM's move, up to 12) still leaves the
// "!" inside the box's 40. "AND 1000 IN PRIZE MONEY!" lost it to WATER PULSE (POK-330 #55).
static const u8 sText_AndPurse[] = _("\nAND 1000 PRIZE MONEY!");

static const struct BrBoss *Find(u16 trainerId)
{
    u8 i;

    for (i = 0; i < ARRAY_COUNT(sBosses); i++)
    {
        if (sBosses[i].trainerId == trainerId)
            return &sBosses[i];
    }
    return NULL;
}

bool8 BrGym_IsBoss(u16 trainerId)
{
    return Find(trainerId) != NULL;
}

const u8 *BrGym_Intro(u16 trainerId, const u8 *speech)
{
    u16 i;

    if (speech == NULL || Find(trainerId) == NULL)
        return speech;
    // A page ends at a \p; a \l only scrolls, and is still the same breath. gStringVar4
    // is a thousand bytes and the field message box reads out of whatever it is handed.
    for (i = 0; i < 999 && speech[i] != EOS && speech[i] != CHAR_PROMPT_CLEAR; i++)
        gStringVar4[i] = speech[i];
    gStringVar4[i] = EOS;
    return gStringVar4;
}

// Every leader's defeat speech runs on into the badge: "The POKeMON LEAGUE's rules state
// that TRAINERS are to be given this..." (2026-10-06 play-test: "beating a gym leader has
// them give you a badge and has a whole dialogue"). Everybody already has all eight, so the
// speech stops where its first page does, as the intro does.
void BrGym_CutLoseText(u16 trainerId, u8 *text)
{
    u16 i;

    if (Find(trainerId) == NULL)
        return;
    for (i = 0; i < 999 && text[i] != EOS; i++)
    {
        if (text[i] == CHAR_PROMPT_CLEAR)
        {
            text[i] = EOS;
            return;
        }
    }
}

const u8 *BrGym_AfterScript(u16 trainerId, const u8 *script)
{
    return Find(trainerId) != NULL ? BR_EventScript_BossBeaten : script;
}

void BrGym_Beaten(u16 trainerId)
{
    const struct BrBoss *boss = Find(trainerId);
    u8 line[BR_HUD_LINE_MAX + 2];
    const u8 *last = line + ARRAY_COUNT(line) - 1;
    u8 *p;

    if (boss == NULL)
        return;
    gBrGymsBeaten |= 1 << (boss - sBosses);
    AddBagItem(boss->prize, 1);
    AddMoney(&gSaveBlock1Ptr->money, BR_GYM_PURSE);
    // "TOOK ROCK TOMB" / "AND 1000 PRIZE MONEY!" No yen sign: FONT_SMALL has no glyph
    // for it and prints a hash.
    p = BrHud_Append(line, last, sText_Took);
    p = BrHud_Append(p, last, GetItemName(boss->prize));
    BrHud_Append(p, last, sText_AndPurse);
    PlaySE(SE_PIN);
    BrHud_Box(line);
}

void BrGym_Init(void)
{
    gBrGymsBeaten = 0;
}

void BrGym_NoteOut(u8 mapGroup, u8 mapNum, u8 localId)
{
    u8 i;

    for (i = 0; i < ARRAY_COUNT(sBosses); i++)
    {
        if (sBosses[i].map == ((mapGroup << 8) | mapNum)
         && (sBosses[i].localIds[0] == localId || sBosses[i].localIds[1] == localId))
            gBrGymsBeaten |= 1 << i;
    }
}

// A beaten leader's head is the same picture in gray. Its palette is shared with every
// other sprite drawn from the same tag, so the gray goes in a copy under a tag of its own.
#define BR_GYM_GRAY_TAG 0x5A00

static void Gray(struct Sprite *sprite, u16 tag)
{
    struct SpritePalette pal;
    u16 colours[16];
    u8 slot = IndexOfSpritePaletteTag(tag);
    u8 i;

    if (slot == 0xFF)
        return;
    for (i = 0; i < 16; i++)
        colours[i] = gPlttBufferUnfaded[OBJ_PLTT_ID(slot) + i];
    TintPalette_GrayScale(colours, 16);
    pal.data = colours;
    pal.tag = BR_GYM_GRAY_TAG + slot;
    slot = LoadSpritePalette(&pal);
    if (slot != 0xFF)
        sprite->oam.paletteNum = slot;
}

// The frame's top eight rows are air: the head is rows 8..23, two tiles in. The sprite's
// first animation frame copies the whole picture to oam.tileNum, and it is run after the
// callback in a frame -- so on the callback's second run the copy has been asked for, the
// animation is held so it is never asked for again, and moving the OAM's first tile moves
// nothing but the window.
static void SpriteCB_Head(struct Sprite *sprite)
{
    if (sprite->data[0]++ == 0)
        return;
    sprite->animPaused = TRUE;
    sprite->oam.tileNum += 2;
    sprite->callback = SpriteCallbackDummy;
}

// Each head is a 16x16 window on the leader's standing frame: an object event's frame is
// 16x32 in 1D tile order, two tiles a row, so a 16x16 OAM shows any four consecutive
// tiles as two rows. Just above the town's own fly marker, so neither covers the other;
// a cell is 8 pixels.
void BrGym_DrawOnMap(s16 left, s16 top)
{
    const struct RegionMapLocation *loc;
    struct Sprite *sprite;
    u8 i, spriteId;
    s16 x, y;

    for (i = 0; i < ARRAY_COUNT(sBosses); i++)
    {
        loc = &gRegionMapEntries[sBosses[i].mapsec];
        x = (loc->x + left) * 8 + loc->width * 4;
        y = (loc->y + top) * 8 + loc->height * 4 - 8;
        spriteId = CreateObjectGraphicsSprite(sBosses[i].gfx, SpriteCB_Head, x, y, 0);
        if (spriteId == MAX_SPRITES)
            continue;
        sprite = &gSprites[spriteId];
        sprite->subspriteTables = NULL;
        sprite->subspriteMode = SUBSPRITES_OFF;
        sprite->oam.shape = SPRITE_SHAPE(16x16);
        sprite->oam.size = SPRITE_SIZE(16x16);
        sprite->centerToCornerVecX = -8;
        sprite->centerToCornerVecY = -8;
        sprite->oam.priority = 2; // the fly markers', in front of them on subpriority; under the cursor
        if (gBrGymsBeaten & (1 << i))
            Gray(sprite, GetObjectEventGraphicsInfo(sBosses[i].gfx)->paletteTag);
    }
}
