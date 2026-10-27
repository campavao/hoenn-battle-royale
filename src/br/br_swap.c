// A drop's screen, the TRADE menu's look offline. See include/br/br_swap.h.
#include "global.h"
#include "malloc.h"
#include "bg.h"
#include "battle_interface.h"
#include "field_screen_effect.h"
#include "gpu_regs.h"
#include "graphics.h"
#include "international_string_util.h"
#include "main.h"
#include "menu.h"
#include "overworld.h"
#include "palette.h"
#include "party_menu.h"
#include "pokemon.h"
#include "pokemon_icon.h"
#include "pokemon_storage_system.h"
#include "scanline_effect.h"
#include "sound.h"
#include "sprite.h"
#include "string_util.h"
#include "task.h"
#include "text.h"
#include "text_window.h"
#include "window.h"
#include "constants/rgb.h"
#include "constants/songs.h"
#include "br/br_swap.h"

#define SIDE_PARTY 0
#define SIDE_DROP  1
#define NO_SLOT    0xFF

#define GFXTAG_CURSOR 300
#define PALTAG_CURSOR 2345

// Windows: trade.c's, in its order, then the two names and the line along the bottom.
#define WIN_MESSAGE 0
#define WIN_NAME(side, i) (2 + (side) * PARTY_SIZE + (i))
#define WIN_TITLE(side) (14 + (side))
#define WIN_HINT 16
#define WIN_DONE 17

struct BrSwap
{
    u16 tilemapBuffer[BG_SCREEN_SIZE / 2];
    u8 iconIds[2][PARTY_SIZE];
    u8 counts[2];
    u8 cursor;     // side * PARTY_SIZE + slot
    u8 picked;     // a drop's mon waiting for one of ours to swap with, or NO_SLOT
    u8 cursorSpriteId;
    u8 messageUp;
    u8 state;
    u8 bg2hofs;
    u8 bg3hofs;
};

static struct BrSwap *sSwap;

// The TRADE menu's own maps: the party boxes, and the stripes that scroll behind them.
static const u16 sPartyBoxTilemap[] = INCBIN_U16("graphics/trade/party_box_map.bin");
static const u8 sStripesBg2Tilemap[] = INCBIN_U8("graphics/trade/stripes_bg2_map.bin");
static const u8 sStripesBg3Tilemap[] = INCBIN_U8("graphics/trade/stripes_bg3_map.bin");

static const u8 sText_Drop[] = _("DROP");
static const u8 sText_Done[] = _("DONE");
static const u8 sText_Hint[] = _("{A_BUTTON} Move  {B_BUTTON} Done");
static const u8 sText_PickOurs[] = _("Swap it for which\nof yours?");
static const u8 sText_OnlyOne[] = _("That's your only\nPOKéMON for battle.");
static const u8 sText_DropFull[] = _("There's no room\nin the DROP.");

static const u8 sTextColors[] = { TEXT_COLOR_TRANSPARENT, TEXT_COLOR_WHITE, TEXT_COLOR_DARK_GRAY };

// trade.c's layout (data/trade.h): icon, level and box cells, our party then theirs.
static const u8 sIconCoords[PARTY_SIZE * 2][2] = {
    { 1,  5}, { 8,  5}, { 1, 10}, { 8, 10}, { 1, 15}, { 8, 15},
    {16,  5}, {23,  5}, {16, 10}, {23, 10}, {16, 15}, {23, 15},
};
static const u8 sLevelCoords[PARTY_SIZE * 2][2] = {
    { 5,  4}, {12,  4}, { 5,  9}, {12,  9}, { 5, 14}, {12, 14},
    {20,  4}, {27,  4}, {20,  9}, {27,  9}, {20, 14}, {27, 14},
};
static const u8 sBoxCoords[PARTY_SIZE * 2][2] = {
    { 1,  3}, { 8,  3}, { 1,  8}, { 8,  8}, { 1, 13}, { 8, 13},
    {16,  3}, {23,  3}, {16,  8}, {23,  8}, {16, 13}, {23, 13},
};

static const struct BgTemplate sBgTemplates[] = {
    { .bg = 0, .charBaseIndex = 2, .mapBaseIndex = 31, .screenSize = 0, .paletteMode = 0, .priority = 0, .baseTile = 0 },
    { .bg = 1, .charBaseIndex = 0, .mapBaseIndex = 5,  .screenSize = 0, .paletteMode = 0, .priority = 1, .baseTile = 0 },
    { .bg = 2, .charBaseIndex = 0, .mapBaseIndex = 6,  .screenSize = 0, .paletteMode = 0, .priority = 2, .baseTile = 0 },
    { .bg = 3, .charBaseIndex = 0, .mapBaseIndex = 7,  .screenSize = 0, .paletteMode = 0, .priority = 3, .baseTile = 0 },
};

static const struct WindowTemplate sWindowTemplates[] = {
    { 0,  4,  7, 22, 4, 15,  30 }, // a message
    { 0, 19, 15, 10, 4, 15, 118 }, // trade.c's yes/no, unused here
    { 0,  0,  5, 8, 2, 13, 158 }, { 0,  7,  5, 8, 2, 13, 174 },
    { 0,  0, 10, 8, 2, 13, 190 }, { 0,  7, 10, 8, 2, 13, 206 },
    { 0,  0, 15, 8, 2, 13, 222 }, { 0,  7, 15, 8, 2, 13, 238 },
    { 0, 15,  5, 8, 2, 13, 254 }, { 0, 22,  5, 8, 2, 13, 270 },
    { 0, 15, 10, 8, 2, 13, 286 }, { 0, 22, 10, 8, 2, 13, 302 },
    { 0, 15, 15, 8, 2, 13, 318 }, { 0, 22, 15, 8, 2, 13, 334 },
    { 0,  0,  0, 15, 2, 13, 350 }, // our name
    { 0, 15,  0, 15, 2, 13, 380 }, // DROP
    { 0,  1, 18, 20, 2, 13, 410 }, // the keys
    { 0, 24, 18,  6, 2, 13, 450 }, // DONE, on trade.c's CANCEL button
    DUMMY_WIN_TEMPLATE,
};

static const struct OamData sOamData_Cursor = {
    .shape = SPRITE_SHAPE(64x32),
    .size = SPRITE_SIZE(64x32),
    .priority = 1,
};
static const union AnimCmd sAnim_Cursor[] = { ANIMCMD_FRAME(0, 5), ANIMCMD_END };
static const union AnimCmd *const sAnims_Cursor[] = { sAnim_Cursor };
static const struct SpriteSheet sCursorSheet = { gTradeCursor_Gfx, 0x800, GFXTAG_CURSOR };
static const struct SpritePalette sCursorPalette = { gTradeCursor_Pal, PALTAG_CURSOR };
static const struct SpriteTemplate sCursorTemplate = {
    GFXTAG_CURSOR, PALTAG_CURSOR, &sOamData_Cursor, sAnims_Cursor, NULL, gDummySpriteAffineAnimTable,
    SpriteCallbackDummy,
};

static u8 CountDrop(void)
{
    u8 n = 0;

    while (n < PARTY_SIZE && GetBoxMonDataAt(0, n, MON_DATA_SPECIES) != SPECIES_NONE)
        n++;
    return n;
}

// The drop's side as Pokemon, for the icons, levels and held items, and for its HP: a
// mon of ours put down and picked up again keeps its hurts, which a box would heal.
// gEnemyParty is nobody's outside a battle. The box is still what counts (written on
// every move), so a battle that starts from here, which takes gEnemyParty, loses nothing.
static void MirrorDrop(void)
{
    u8 i;

    for (i = 0; i < PARTY_SIZE; i++)
    {
        if (i < CountDrop())
            BoxMonAtToMon(0, i, &gEnemyParty[i]);
        else
            ZeroMonData(&gEnemyParty[i]);
    }
}

static void Count(void)
{
    sSwap->counts[SIDE_PARTY] = CountPartyMons();
    sSwap->counts[SIDE_DROP] = CountDrop();
}

static struct Pokemon *MonAt(u8 side, u8 i)
{
    return side == SIDE_PARTY ? &gPlayerParty[i] : &gEnemyParty[i];
}

// The box under a mon, with its level and gender in the tilemap trade.c's way.
static void DrawLevel(u8 side, u8 i)
{
    struct Pokemon *mon = MonAt(side, i);
    u8 cell = side * PARTY_SIZE + i;
    u8 x = sLevelCoords[cell][0], y = sLevelCoords[cell][1];
    u8 level = GetMonData(mon, MON_DATA_LEVEL, NULL);
    u16 symbol;

    CopyToBgTilemapBufferRect_ChangePalette(1, gTradeMenuMonBox_Tilemap, sBoxCoords[cell][0], sBoxCoords[cell][1], 6, 3, 0);
    if (level / 10 != 0)
        sSwap->tilemapBuffer[x + y * 32] = (level / 10) + 0x60;
    sSwap->tilemapBuffer[x + y * 32 + 1] = (level % 10) + 0x70;
    switch (GetMonGender(mon))
    {
    case MON_MALE:   symbol = 0x84; break;
    case MON_FEMALE: symbol = 0x85; break;
    default:         symbol = 0x83; break;
    }
    sSwap->tilemapBuffer[(y - 1) * 32 + x + 1] = symbol;
}

static void PrintCentered(u8 windowId, const u8 *text, u8 width, u8 font)
{
    FillWindowPixelBuffer(windowId, PIXEL_FILL(0));
    AddTextPrinterParameterized3(windowId, font, GetStringCenterAlignXOffset(font, text, width), font == FONT_SMALL ? 4 : 1,
                                 sTextColors, TEXT_SKIP_DRAW, text);
    PutWindowTilemap(windowId);
    CopyWindowToVram(windowId, COPYWIN_FULL);
}

static void PlaceCursor(void)
{
    struct Sprite *cursor = &gSprites[sSwap->cursorSpriteId];

    cursor->x = sIconCoords[sSwap->cursor][0] * 8 + 32;
    cursor->y = sIconCoords[sSwap->cursor][1] * 8;
}

// Everything again from the party and the box: a move changes both sides.
static void Redraw(void)
{
    u8 side, i;
    u8 name[POKEMON_NAME_BUFFER_SIZE];
    u8 str[32];

    for (side = 0; side < 2; side++)
    {
        for (i = 0; i < PARTY_SIZE; i++)
        {
            if (sSwap->iconIds[side][i] != SPRITE_NONE)
                FreeAndDestroyMonIconSprite(&gSprites[sSwap->iconIds[side][i]]);
            sSwap->iconIds[side][i] = SPRITE_NONE;
            FillWindowPixelBuffer(WIN_NAME(side, i), PIXEL_FILL(0));
            CopyWindowToVram(WIN_NAME(side, i), COPYWIN_GFX);
        }
    }
    Count();
    for (side = 0; side < 2; side++)
    {
        CopyToBgTilemapBufferRect_ChangePalette(1, sPartyBoxTilemap, side * 15, 0, 15, 17, 0);
        for (i = 0; i < sSwap->counts[side]; i++)
        {
            struct Pokemon *mon = MonAt(side, i);
            u8 cell = side * PARTY_SIZE + i;

            sSwap->iconIds[side][i] = CreateMonIcon(GetMonData(mon, MON_DATA_SPECIES_OR_EGG, NULL), SpriteCB_MonIcon,
                                                    sIconCoords[cell][0] * 8 + 14, sIconCoords[cell][1] * 8 - 12, 1,
                                                    GetMonData(mon, MON_DATA_PERSONALITY, NULL), TRUE);
            SetPartyHPBarSprite(&gSprites[sSwap->iconIds[side][i]],
                                4 - GetHPBarLevel(GetMonData(mon, MON_DATA_HP, NULL), GetMonData(mon, MON_DATA_MAX_HP, NULL)));
            GetMonData(mon, MON_DATA_NICKNAME, name);
            StringCopy_Nickname(str, name);
            PrintCentered(WIN_NAME(side, i), str, 64, FONT_SMALL);
            DrawLevel(side, i);
        }
    }
    DrawHeldItemIconsForTrade(sSwap->counts, &sSwap->iconIds[0][0], SIDE_PARTY);
    DrawHeldItemIconsForTrade(sSwap->counts, &sSwap->iconIds[0][0], SIDE_DROP);
    CopyBgTilemapBufferToVram(1);
    if (sSwap->picked != NO_SLOT && sSwap->iconIds[SIDE_DROP][sSwap->picked] != SPRITE_NONE)
        gSprites[sSwap->iconIds[SIDE_DROP][sSwap->picked]].y2 = -4; // lifted, waiting for one of ours
    PlaceCursor();
}

static void ShowMessage(const u8 *text)
{
    FillWindowPixelBuffer(WIN_MESSAGE, PIXEL_FILL(1));
    AddTextPrinterParameterized(WIN_MESSAGE, FONT_NORMAL, text, 0, 1, TEXT_SKIP_DRAW, NULL);
    DrawTextBorderOuter(WIN_MESSAGE, 20, 12);
    PutWindowTilemap(WIN_MESSAGE);
    CopyWindowToVram(WIN_MESSAGE, COPYWIN_FULL);
    sSwap->messageUp = TRUE;
}

static void HideMessage(void)
{
    rbox_fill_rectangle(WIN_MESSAGE);
    ClearWindowTilemap(WIN_MESSAGE);
    CopyBgTilemapBufferToVram(0);
    sSwap->messageUp = FALSE;
    Redraw(); // the box was over the names, which share its background
}

// The drop's slots stay packed from 0, in the box and the mirror alike, so its count is
// where the next one goes.
static void TakeFromDrop(u8 i)
{
    u8 j;
    struct BoxPokemon mon;

    for (j = i; j + 1 < PARTY_SIZE; j++)
    {
        CopyBoxMonAt(0, j + 1, &mon);
        SetBoxMonAt(0, j, &mon);
        gEnemyParty[j] = gEnemyParty[j + 1];
    }
    ZeroBoxMonAt(0, PARTY_SIZE - 1);
    ZeroMonData(&gEnemyParty[PARTY_SIZE - 1]);
}

static void ToDrop(u8 i)
{
    u8 n = sSwap->counts[SIDE_DROP];

    gEnemyParty[n] = gPlayerParty[i];
    SetBoxMonAt(0, n, &gPlayerParty[i].box);
    ZeroMonData(&gPlayerParty[i]);
    CompactPartySlots();
}

static void ToParty(u8 i)
{
    gPlayerParty[sSwap->counts[SIDE_PARTY]] = gEnemyParty[i];
    TakeFromDrop(i);
}

static void Swap(u8 ours, u8 theirs)
{
    struct Pokemon mon = gPlayerParty[ours];

    gPlayerParty[ours] = gEnemyParty[theirs];
    gEnemyParty[theirs] = mon;
    SetBoxMonAt(0, theirs, &mon.box);
}

// The cursor's next cell in a direction: the trade menu's grid, two columns a side, three
// rows, skipping the empty cells, and staying put when there is none that way.
static void MoveCursor(s8 dx, s8 dy)
{
    s8 col = (sSwap->cursor / PARTY_SIZE) * 2 + (sSwap->cursor % PARTY_SIZE) % 2;
    s8 row = (sSwap->cursor % PARTY_SIZE) / 2;
    u8 tries, side, slot;

    for (tries = 0; tries < 4; tries++)
    {
        col = (col + dx + 4) % 4;
        row = (row + dy + 3) % 3;
        side = col / 2;
        slot = row * 2 + col % 2;
        if (slot < sSwap->counts[side])
        {
            sSwap->cursor = side * PARTY_SIZE + slot;
            PlaySE(SE_SELECT);
            PlaceCursor();
            return;
        }
    }
}

static void Press(void)
{
    u8 side = sSwap->cursor / PARTY_SIZE;
    u8 slot = sSwap->cursor % PARTY_SIZE;

    if (side == SIDE_PARTY)
    {
        if (sSwap->picked != NO_SLOT)
        {
            Swap(slot, sSwap->picked);
            sSwap->picked = NO_SLOT;
        }
        else if (sSwap->counts[SIDE_PARTY] <= 1)
        {
            PlaySE(SE_FAILURE);
            ShowMessage(sText_OnlyOne);
            return;
        }
        else if (sSwap->counts[SIDE_DROP] >= PARTY_SIZE)
        {
            PlaySE(SE_FAILURE);
            ShowMessage(sText_DropFull);
            return;
        }
        else
        {
            ToDrop(slot);
        }
    }
    else if (sSwap->counts[SIDE_PARTY] < PARTY_SIZE)
    {
        ToParty(slot);
    }
    else
    {
        // A full party: lift this one, and the next A on one of ours swaps them.
        sSwap->picked = slot;
        sSwap->cursor = 0;
        PlaySE(SE_SELECT);
        Redraw();
        ShowMessage(sText_PickOurs);
        return;
    }
    CalculatePlayerPartyCount();
    PlaySE(SE_SELECT);
    Redraw();
    // The cell under the cursor may be empty now: the nearest one on that side, else the other.
    side = sSwap->cursor / PARTY_SIZE;
    slot = sSwap->cursor % PARTY_SIZE;
    if (slot >= sSwap->counts[side])
    {
        if (sSwap->counts[side] != 0)
            sSwap->cursor = side * PARTY_SIZE + sSwap->counts[side] - 1;
        else
            sSwap->cursor = (side ^ 1) * PARTY_SIZE;
        PlaceCursor();
    }
}

static void VBlankCB_BrSwap(void)
{
    LoadOam();
    ProcessSpriteCopyRequests();
    TransferPlttBuffer();
}

static void CB2_BrSwapRun(void)
{
    if (!gPaletteFade.active)
    {
        if (sSwap->state == 1)
        {
            u8 side, i;

            for (side = 0; side < 2; side++)
                for (i = 0; i < PARTY_SIZE; i++)
                    if (sSwap->iconIds[side][i] != SPRITE_NONE)
                        FreeAndDestroyMonIconSprite(&gSprites[sSwap->iconIds[side][i]]);
            FreeAllWindowBuffers();
            FREE_AND_SET_NULL(sSwap);
            gFieldCallback = FieldCB_ReturnToFieldNoScript;
            SetMainCallback2(CB2_ReturnToField);
            return;
        }
        if (sSwap->messageUp)
        {
            if (JOY_NEW(A_BUTTON | B_BUTTON))
                HideMessage();
        }
        else if (JOY_NEW(A_BUTTON))
        {
            Press();
        }
        else if (JOY_NEW(B_BUTTON))
        {
            if (sSwap->picked != NO_SLOT)
            {
                sSwap->picked = NO_SLOT;
                Redraw();
            }
            else
            {
                PlaySE(SE_SELECT);
                BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
                sSwap->state = 1;
            }
        }
        else if (JOY_REPEAT(DPAD_UP))
            MoveCursor(0, -1);
        else if (JOY_REPEAT(DPAD_DOWN))
            MoveCursor(0, 1);
        else if (JOY_REPEAT(DPAD_LEFT))
            MoveCursor(-1, 0);
        else if (JOY_REPEAT(DPAD_RIGHT))
            MoveCursor(1, 0);
    }
    SetGpuReg(REG_OFFSET_BG2HOFS, sSwap->bg2hofs++);
    SetGpuReg(REG_OFFSET_BG3HOFS, sSwap->bg3hofs--);
    RunTextPrinters();
    RunTasks();
    AnimateSprites();
    BuildOamBuffer();
    UpdatePaletteFade();
}

void CB2_BrSwap(void)
{
    u8 i;

    SetVBlankCallback(NULL);
    ResetSpriteData();
    FreeAllSpritePalettes();
    ResetTasks();
    ResetPaletteFade();
    ScanlineEffect_Stop();
    sSwap = AllocZeroed(sizeof(*sSwap));
    if (sSwap == NULL)
    {
        gFieldCallback = FieldCB_ReturnToFieldNoScript;
        SetMainCallback2(CB2_ReturnToField); // the box settles on the field all the same
        return;
    }
    for (i = 0; i < PARTY_SIZE; i++)
    {
        sSwap->iconIds[SIDE_PARTY][i] = SPRITE_NONE;
        sSwap->iconIds[SIDE_DROP][i] = SPRITE_NONE;
    }
    sSwap->picked = NO_SLOT;
    SetGpuReg(REG_OFFSET_DISPCNT, 0);
    SetGpuReg(REG_OFFSET_BLDCNT, 0);
    LoadPalette(gStandardMenuPalette, BG_PLTT_ID(15), PLTT_SIZEOF(10));
    LoadPalette(gStandardMenuPalette, BG_PLTT_ID(13), PLTT_SIZEOF(10));
    ResetBgsAndClearDma3BusyFlags(0);
    InitBgsFromTemplates(0, sBgTemplates, ARRAY_COUNT(sBgTemplates));
    SetBgTilemapBuffer(1, sSwap->tilemapBuffer);
    InitWindows(sWindowTemplates);
    DeactivateAllTextPrinters();
    for (i = 0; i < ARRAY_COUNT(sWindowTemplates) - 1; i++)
    {
        ClearWindowTilemap(i);
        FillWindowPixelBuffer(i, PIXEL_FILL(0));
    }
    FillBgTilemapBufferRect(0, 0, 0, 0, DISPLAY_TILE_WIDTH, DISPLAY_TILE_HEIGHT, 15);
    LoadUserWindowBorderGfx_(0, 20, BG_PLTT_ID(12));
    LoadMonIconPalettes();
    LoadHeldItemIcons();
    LoadSpriteSheet(&sCursorSheet);
    LoadSpritePalette(&sCursorPalette);
    LoadPalette(gTradeMenu_Pal, BG_PLTT_ID(0), 3 * PLTT_SIZE_4BPP);
    LoadBgTiles(1, gTradeMenu_Gfx, 0x1280, 0);
    CopyToBgTilemapBufferRect_ChangePalette(1, gTradeMenu_Tilemap, 0, 0, 32, 20, 0);
    LoadBgTilemap(2, sStripesBg2Tilemap, 0x800, 0);
    LoadBgTilemap(3, sStripesBg3Tilemap, 0x800, 0);
    sSwap->cursorSpriteId = CreateSprite(&sCursorTemplate, 0, 0, 2);
    sSwap->cursor = 0;
    MirrorDrop();
    Redraw();
    // On the drop's first mon: that is what the screen was opened for.
    if (sSwap->counts[SIDE_DROP] != 0)
        sSwap->cursor = SIDE_DROP * PARTY_SIZE;
    PlaceCursor();
    PrintCentered(WIN_TITLE(SIDE_PARTY), gSaveBlock2Ptr->playerName, 120, FONT_NORMAL);
    PrintCentered(WIN_TITLE(SIDE_DROP), sText_Drop, 120, FONT_NORMAL);
    PrintCentered(WIN_DONE, sText_Done, 48, FONT_NORMAL);
    FillWindowPixelBuffer(WIN_HINT, PIXEL_FILL(0));
    AddTextPrinterParameterized3(WIN_HINT, FONT_NORMAL, 0, 1, sTextColors, TEXT_SKIP_DRAW, sText_Hint);
    PutWindowTilemap(WIN_HINT);
    CopyWindowToVram(WIN_HINT, COPYWIN_FULL);
    for (i = 0; i < 4; i++)
        SetGpuReg(REG_OFFSET_BG0HOFS + i * 2, 0);
    SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON);
    ShowBg(0);
    ShowBg(1);
    ShowBg(2);
    ShowBg(3);
    BlendPalettes(PALETTES_ALL, 16, RGB_BLACK);
    BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
    SetVBlankCallback(VBlankCB_BrSwap);
    SetMainCallback2(CB2_BrSwapRun);
}
