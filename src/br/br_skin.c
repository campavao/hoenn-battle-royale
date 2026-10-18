// A trainer's chosen look, wherever the game draws them (POK-411). See include/br/br_skin.h.
#include "global.h"
#include "battle.h"
#include "battle_anim.h"
#include "battle_gfx_sfx_util.h"
#include "data.h"
#include "decompress.h"
#include "event_object_movement.h"
#include "palette.h"
#include "pokemon.h"
#include "sprite.h"
#include "constants/event_object_movement.h"
#include "constants/characters.h"
#include "constants/event_objects.h"
#include "constants/trainers.h"
#include "br/br_ghosts.h"
#include "br/br_skin.h"
#include "br/br_spectate.h"

// Index for index with br_ghosts.c's sSkinGraphics and the page's SKINS: the walking
// sprite's own trainer class. The two rival skins are the same BRENDAN and MAY.
static const u8 sSkinPics[] =
{
    TRAINER_PIC_BRENDAN,
    TRAINER_PIC_MAY,
    TRAINER_PIC_BRENDAN,
    TRAINER_PIC_MAY,
    TRAINER_PIC_HIKER,
    TRAINER_PIC_BEAUTY,
    TRAINER_PIC_CAMPER,
    TRAINER_PIC_PICNICKER,
    TRAINER_PIC_SWIMMER_M,
    TRAINER_PIC_SWIMMER_F,
    TRAINER_PIC_EXPERT_M,
    TRAINER_PIC_EXPERT_F,
    TRAINER_PIC_POKEFAN_M,
    TRAINER_PIC_POKEFAN_F,
    TRAINER_PIC_YOUNGSTER,
    TRAINER_PIC_LASS,
};

// A front picture's anims table has the one standing frame, and the player's side asks
// for more: anim 1 is the throw, at the end of the intro and for every Safari ball. The
// Safari's throw lets go of the ball on the throw's second command and sways the sprite
// by its command index (battle_main.c's sCenterToCornerVecXs), so a picture standing in
// for a back one throws to BRENDAN's timing, holding its one frame throughout.
static const union AnimCmd sAnim_Stand[] =
{
    ANIMCMD_FRAME(0, 0),
    ANIMCMD_END,
};

static const union AnimCmd sAnim_Throw[] =
{
    ANIMCMD_FRAME(0, 24),
    ANIMCMD_FRAME(0, 9),
    ANIMCMD_FRAME(0, 24),
    ANIMCMD_FRAME(0, 9),
    ANIMCMD_FRAME(0, 50),
    ANIMCMD_END,
};

static const union AnimCmd *const sAnims_FrontAsBack[] =
{
    sAnim_Stand,
    sAnim_Throw,
    sAnim_Throw,
    sAnim_Throw,
};

u16 BrSkin_Pic(u8 skin, u16 pic)
{
    if (skin >= ARRAY_COUNT(sSkinPics))
        return pic;
    return sSkinPics[skin];
}

u16 BrSkin_MyPic(u16 pic)
{
    return BrSkin_Pic(gBrMySkin, pic);
}

u16 BrSkin_CardPic(u16 pic)
{
    // The START menu's card is the followed trainer's while we watch one (start_menu.c's
    // MENU_ACTION_BR_CARD), and ours otherwise.
    if (gBrFollowName[0] != EOS && gBrSpectate.follow < BR_MAX_SEATS)
        return BrSkin_Pic(gBrSeats[gBrSpectate.follow].skin, pic);
    return BrSkin_MyPic(pic);
}

static bool8 IsNpc(u8 skin)
{
    return skin >= BR_SKIN_FIRST_NPC && skin < ARRAY_COUNT(sSkinPics);
}

bool8 BrSkin_MyLookIsNpc(void)
{
    return IsNpc(gBrMySkin);
}

u8 BrSkin_MyAvatar(u8 gfx)
{
    if (!BrSkin_MyLookIsNpc())
        return gfx;
    switch (gfx)
    {
    case OBJ_EVENT_GFX_BRENDAN_ACRO_BIKE:
    case OBJ_EVENT_GFX_MAY_ACRO_BIKE:
    case OBJ_EVENT_GFX_BRENDAN_FISHING:
    case OBJ_EVENT_GFX_MAY_FISHING:
    case OBJ_EVENT_GFX_BRENDAN_NORMAL:
    case OBJ_EVENT_GFX_MAY_NORMAL:
    case OBJ_EVENT_GFX_BRENDAN_MACH_BIKE:
    case OBJ_EVENT_GFX_MAY_MACH_BIKE:
    case OBJ_EVENT_GFX_BRENDAN_SURFING:
    case OBJ_EVENT_GFX_MAY_SURFING:
    case OBJ_EVENT_GFX_BRENDAN_FIELD_MOVE:
    case OBJ_EVENT_GFX_MAY_FIELD_MOVE:
        return BrGhosts_WalkGraphic(gBrMySkin);
    }
    // The watering can is not in a match, and dive is a different sprite altogether.
    return gfx;
}

u8 BrSkin_AvatarGender(u8 gfx)
{
    if (BrSkin_MyLookIsNpc() && gfx == BrGhosts_WalkGraphic(gBrMySkin))
        return gSaveBlock2Ptr->playerGender;
    return MALE;
}

u8 BrSkin_MyAnim(struct ObjectEvent *objectEvent, u8 anim, u8 standard)
{
    if (objectEvent->isPlayer && objectEvent->graphicsId == BrGhosts_WalkGraphic(gBrMySkin) && BrSkin_MyLookIsNpc())
        return standard;
    return anim;
}

static bool8 PlayerIsNpc(void)
{
    struct ObjectEvent *player = &gObjectEvents[gPlayerAvatar.objectEventId];

    return player->graphicsId == BrGhosts_WalkGraphic(gBrMySkin) && BrSkin_MyLookIsNpc();
}

u8 BrSkin_PlayerAnim(u8 anim, u8 standard)
{
    return PlayerIsNpc() ? standard : anim;
}

bool8 BrSkin_PlayerAnimEndless(void)
{
    return PlayerIsNpc();
}

void BrSkin_FishingOffsets(struct Sprite *sprite)
{
    // AlignFishingAnimationFrames reads the rod's arc off the frame number, and an NPC's
    // facing frames are 0..2: west and east would swing the trainer 8 pixels sideways.
    if (PlayerIsNpc())
    {
        sprite->x2 = 0;
        sprite->y2 = 0;
    }
}

static bool8 LoadPic(u8 battler, u8 skin)
{
    u16 pic;

    if (!IsNpc(skin))
        return FALSE;
    pic = sSkinPics[skin];
    // Into the battler's own palette slot, as pret puts a back picture: a front picture's
    // tagged palette would hold a slot for the rest of the battle.
    DecompressPicFromTable_2(&gTrainerFrontPicTable[pic], gMonSpritesGfxPtr->sprites.ptr[GetBattlerPosition(battler)], SPECIES_NONE);
    LoadCompressedPalette(gTrainerFrontPicPaletteTable[pic].data, OBJ_PLTT_ID(battler), PLTT_SIZE_4BPP);
    return TRUE;
}

static bool8 CreatePic(u8 battler, u8 skin, s16 x2, s16 speedX)
{
    u16 pic;
    u8 spriteId;

    if (!IsNpc(skin))
        return FALSE;
    pic = sSkinPics[skin];
    SetMultiuseSpriteTemplateToTrainerFront(pic, GetBattlerPosition(battler));
    gMultiuseSpriteTemplate.anims = sAnims_FrontAsBack;
    spriteId = CreateSprite(&gMultiuseSpriteTemplate, 80, (8 - gTrainerFrontPicCoords[pic].size) * 4 + 80,
                            GetBattlerSpriteSubpriority(battler));
    gBattlerSpriteIds[battler] = spriteId;
    gSprites[spriteId].oam.paletteNum = battler;
    gSprites[spriteId].oam.affineMode = ST_OAM_AFFINE_OFF;
    // Facing the foe across the field, not the camera's left.
    gSprites[spriteId].hFlip = TRUE;
    gSprites[spriteId].x2 = x2;
    gSprites[spriteId].data[0] = speedX;
    gSprites[spriteId].callback = speedX != 0 ? SpriteCB_TrainerSlideIn : SpriteCallbackDummy;
    return TRUE;
}

bool8 BrSkin_DrawPic(u8 battler, u8 skin, s16 x2, s16 speedX)
{
    return LoadPic(battler, skin) && CreatePic(battler, skin, x2, speedX);
}

void BrSkin_ThrowPalette(u8 skin, u8 paletteNum)
{
    if (IsNpc(skin))
        LoadCompressedPalette(gTrainerFrontPicPaletteTable[sSkinPics[skin]].data, OBJ_PLTT_ID(paletteNum), PLTT_SIZE_4BPP);
}

bool8 BrSkin_MyAnimEndless(struct ObjectEvent *objectEvent)
{
    return BrSkin_MyAnim(objectEvent, FALSE, TRUE);
}

bool8 BrSkin_LoadMyPic(u8 battler)
{
    return LoadPic(battler, gBrMySkin);
}

bool8 BrSkin_CreateMyPic(u8 battler, s16 x2, s16 speedX)
{
    return CreatePic(battler, gBrMySkin, x2, speedX);
}

bool8 BrSkin_DrawMyPic(u8 battler, s16 x2, s16 speedX)
{
    return BrSkin_DrawPic(battler, gBrMySkin, x2, speedX);
}

void BrSkin_MyThrowPalette(u8 paletteNum)
{
    BrSkin_ThrowPalette(gBrMySkin, paletteNum);
}

void BrSkin_MapIcon(u16 tileTag, u16 paletteTag)
{
    const struct ObjectEventGraphicsInfo *info;

    if (!BrSkin_MyLookIsNpc())
        return;
    info = GetObjectEventGraphicsInfo(BrGhosts_WalkGraphic(gBrMySkin));
    // A 16x32 frame is four rows of two tiles, in 1D order, and its top eight pixels are
    // mostly hat and air: the middle two rows are the face and shoulders.
    CpuCopy16((const u8 *)info->images[0].data + 2 * TILE_SIZE_4BPP, (void *)(OBJ_VRAM0 + GetSpriteTileStartByTag(tileTag) * TILE_SIZE_4BPP), 4 * TILE_SIZE_4BPP);
    PatchObjectPalette(info->paletteTag, IndexOfSpritePaletteTag(paletteTag));
}
