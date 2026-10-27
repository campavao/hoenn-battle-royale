// A drop's screen, the TRADE menu's look offline. See include/br/br_swap.h.
#include "global.h"
#include "malloc.h"
#include "bg.h"
#include "battle.h"
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

#define GFXTAG_CURSOR 300
#define PALTAG_CURSOR 2345

// Windows: trade.c's, in its order, then the two names and the line along the bottom.
#define WIN_NAME(side, i) (2 + (side) * PARTY_SIZE + (i))
#define WIN_TITLE(side) (14 + (side))
#define WIN_HINT 16
#define WIN_MOVE 17

// The cursor's cell past the twelve mons: the button bottom right, trade.c's CANCEL.
#define CELL_MOVE (PARTY_SIZE * 2)
#define BOX_PICKED_PALETTE 3

struct BrSwap
{
    struct Pokemon drop[PARTY_SIZE];
    struct Pokemon scratch[PARTY_SIZE]; // the party as a MOVE leaves it
    u16 tilemapBuffer[BG_SCREEN_SIZE / 2];
    u8 iconIds[2][PARTY_SIZE];
    u8 counts[2];
    u8 cursor;     // side * PARTY_SIZE + slot
    u8 marked[2];  // a bit per slot: picked to go across on the next MOVE
    u8 lastCell;   // the cell the cursor left for the MOVE button
    u8 cursorSpriteId;
    u8 state;
    u8 bg2hofs;
    u8 bg3hofs;
};

static struct BrSwap *sSwap;

static void CB2_BrSwapRun(void);

// The TRADE menu's own maps: the party boxes, and the stripes that scroll behind them.
static const u16 sPartyBoxTilemap[] = INCBIN_U16("graphics/trade/party_box_map.bin");
static const u8 sStripesBg2Tilemap[] = INCBIN_U8("graphics/trade/stripes_bg2_map.bin");
static const u8 sStripesBg3Tilemap[] = INCBIN_U8("graphics/trade/stripes_bg3_map.bin");

static const u8 sText_Drop[] = _("BAG"); // Cam, 2026-10-27: "rename to \"BAG\" instead of \"DROP\""
static const u8 sText_Move[] = _("MOVE");
static const u8 sText_Hint[] = _("{A_BUTTON}Pick {START_BUTTON}Move {B_BUTTON}Done");

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

// bg, charBaseIndex, mapBaseIndex, screenSize, paletteMode, priority, baseTile
static const struct BgTemplate sBgTemplates[] = {
    { 0, 2, 31, 0, 0, 0, 0 },
    { 1, 0,  5, 0, 0, 1, 0 },
    { 2, 0,  6, 0, 0, 2, 0 },
    { 3, 0,  7, 0, 0, 3, 0 },
};

static const struct WindowTemplate sWindowTemplates[] = {
    { 0,  4,  7, 22, 4, 15,  30 }, // trade.c's message, unused here
    { 0, 19, 15, 10, 4, 15, 118 }, // trade.c's yes/no, unused here
    { 0,  0,  5, 8, 2, 13, 158 }, { 0,  7,  5, 8, 2, 13, 174 },
    { 0,  0, 10, 8, 2, 13, 190 }, { 0,  7, 10, 8, 2, 13, 206 },
    { 0,  0, 15, 8, 2, 13, 222 }, { 0,  7, 15, 8, 2, 13, 238 },
    { 0, 15,  5, 8, 2, 13, 254 }, { 0, 22,  5, 8, 2, 13, 270 },
    { 0, 15, 10, 8, 2, 13, 286 }, { 0, 22, 10, 8, 2, 13, 302 },
    { 0, 15, 15, 8, 2, 13, 318 }, { 0, 22, 15, 8, 2, 13, 334 },
    { 0,  0,  0, 15, 2, 13, 350 }, // our name
    { 0, 15,  0, 15, 2, 13, 380 }, // BAG, the drop's side
    { 0,  1, 18, 20, 2, 13, 410 }, // the keys
    { 0, 24, 18,  6, 2, 13, 450 }, // MOVE, on trade.c's CANCEL button
    DUMMY_WIN_TEMPLATE,
};

// y, affineMode, objMode, mosaic, bpp, shape, x, matrixNum, size, tileNum, priority
static const struct OamData sOamData_Cursor = {
    0, 0, 0, 0, 0, SPRITE_SHAPE(64x32), 0, 0, SPRITE_SIZE(64x32), 0, 1,
};
static const union AnimCmd sAnim_Cursor[] = { ANIMCMD_FRAME(0, 5), ANIMCMD_END };
static const union AnimCmd sAnim_CursorOnButton[] = { ANIMCMD_FRAME(32, 5), ANIMCMD_END };
static const union AnimCmd *const sAnims_Cursor[] = { sAnim_Cursor, sAnim_CursorOnButton };
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
// mon of ours put down and picked up again keeps its hurts, which a box would heal. Its
// own copy, not gEnemyParty, where a bot's staged team waits for its challenge. The box
// is still what counts (written on every move), so a battle that starts from here loses
// nothing.
static void MirrorDrop(void)
{
    u8 i;

    for (i = 0; i < PARTY_SIZE; i++)
    {
        if (i < CountDrop())
            BoxMonAtToMon(0, i, &sSwap->drop[i]);
        else
            ZeroMonData(&sSwap->drop[i]);
    }
}

static void Count(void)
{
    sSwap->counts[SIDE_PARTY] = CountPartyMons();
    sSwap->counts[SIDE_DROP] = CountDrop();
}

static struct Pokemon *MonAt(u8 side, u8 i)
{
    return side == SIDE_PARTY ? &gPlayerParty[i] : &sSwap->drop[i];
}

// The box under a mon, trade.c's, with no level: its "Lv." and gender cells take the strip's plain tile
// beside it (Cam, 2026-10-27: "we don't need to show the level"). A picked mon's box is
// orange, so what goes across on MOVE stands out.
static void DrawBox(u8 side, u8 i)
{
    u8 cell = side * PARTY_SIZE + i;
    u16 at = sLevelCoords[cell][0] + (sLevelCoords[cell][1] - 1) * 32;

    CopyToBgTilemapBufferRect_ChangePalette(1, gTradeMenuMonBox_Tilemap, sBoxCoords[cell][0], sBoxCoords[cell][1], 6, 3,
                                            (sSwap->marked[side] & (1 << i)) ? BOX_PICKED_PALETTE : 0);
    sSwap->tilemapBuffer[at] = sSwap->tilemapBuffer[at - 1];
    sSwap->tilemapBuffer[at + 1] = sSwap->tilemapBuffer[at - 1];
}

static void SwapWithEnemyParty(void)
{
    u8 i;
    struct Pokemon mon;

    for (i = 0; i < PARTY_SIZE; i++)
    {
        mon = gEnemyParty[i];
        gEnemyParty[i] = sSwap->drop[i];
        sSwap->drop[i] = mon;
    }
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

    if (sSwap->cursor == CELL_MOVE)
    {
        StartSpriteAnim(cursor, 1);
        cursor->x = DISPLAY_WIDTH - 16;
        cursor->y = DISPLAY_HEIGHT;
        return;
    }
    StartSpriteAnim(cursor, 0);
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
            DrawBox(side, i);
        }
    }
    DrawHeldItemIconsForTrade(sSwap->counts, &sSwap->iconIds[0][0], SIDE_PARTY);
    // party_menu.c draws the partner's from gEnemyParty: the drop there for the call only.
    SwapWithEnemyParty();
    DrawHeldItemIconsForTrade(sSwap->counts, &sSwap->iconIds[0][0], SIDE_DROP);
    SwapWithEnemyParty();
    CopyBgTilemapBufferToVram(1);
    PlaceCursor();
}

static u8 CountBits(u8 bits)
{
    u8 n = 0;

    while (bits != 0)
    {
        n += bits & 1;
        bits >>= 1;
    }
    return n;
}

// MOVE: every picked mon goes across at once, ours to the drop's side and the drop's to
// ours, so a full party trades one for one with no question asked. The party keeps one
// and neither side holds more than six, or nothing moves.
static void MovePicked(void)
{
    u8 party = sSwap->counts[SIDE_PARTY], drop = sSwap->counts[SIDE_DROP];
    u8 out = CountBits(sSwap->marked[SIDE_PARTY]), in = CountBits(sSwap->marked[SIDE_DROP]);
    u8 i, n = 0, k = 0;

    if (out + in == 0 || party - out + in == 0 || party - out + in > PARTY_SIZE || drop - in + out > PARTY_SIZE)
    {
        PlaySE(SE_FAILURE);
        return;
    }
    for (i = 0; i < party; i++)
        if (!(sSwap->marked[SIDE_PARTY] & (1 << i)))
            sSwap->scratch[n++] = gPlayerParty[i];
    for (i = 0; i < drop; i++)
        if (sSwap->marked[SIDE_DROP] & (1 << i))
            sSwap->scratch[n++] = sSwap->drop[i];
    for (i = 0; i < drop; i++)
        if (!(sSwap->marked[SIDE_DROP] & (1 << i)))
            sSwap->drop[k++] = sSwap->drop[i];
    for (i = 0; i < party; i++)
        if (sSwap->marked[SIDE_PARTY] & (1 << i))
            sSwap->drop[k++] = gPlayerParty[i];
    for (i = 0; i < PARTY_SIZE; i++)
    {
        if (i < n)
            gPlayerParty[i] = sSwap->scratch[i];
        else
            ZeroMonData(&gPlayerParty[i]);
        // The box is what counts: written now, so a battle from here loses nothing.
        if (i < k)
        {
            SetBoxMonAt(0, i, &sSwap->drop[i].box);
        }
        else
        {
            ZeroMonData(&sSwap->drop[i]);
            ZeroBoxMonAt(0, i);
        }
    }
    sSwap->marked[SIDE_PARTY] = 0;
    sSwap->marked[SIDE_DROP] = 0;
    CalculatePlayerPartyCount();
    PlaySE(SE_SELECT);
    Redraw();
}

// The cell under the cursor may be empty after a MOVE: the nearest one on that side, else
// the other's first.
static void KeepCursorOnAMon(void)
{
    u8 side = sSwap->cursor / PARTY_SIZE;
    u8 slot = sSwap->cursor % PARTY_SIZE;

    if (sSwap->cursor == CELL_MOVE || slot < sSwap->counts[side])
        return;
    if (sSwap->counts[side] != 0)
        sSwap->cursor = side * PARTY_SIZE + sSwap->counts[side] - 1;
    else
        sSwap->cursor = (side ^ 1) * PARTY_SIZE;
    PlaceCursor();
}

// The cursor's next cell in a direction: the trade menu's grid, two columns a side, three
// rows, skipping the empty cells. Down past the last row is the MOVE button, and up from it
// is where the cursor came from.
static void MoveCursor(s8 dx, s8 dy)
{
    s8 col = (sSwap->cursor / PARTY_SIZE) * 2 + (sSwap->cursor % PARTY_SIZE) % 2;
    s8 row = (sSwap->cursor % PARTY_SIZE) / 2;
    u8 tries, side, slot;

    if (sSwap->cursor == CELL_MOVE)
    {
        if (dy < 0)
        {
            sSwap->cursor = sSwap->lastCell;
            PlaySE(SE_SELECT);
            PlaceCursor();
        }
        return;
    }
    if (dy != 0)
    {
        for (row += dy; row >= 0 && row < 3; row += dy)
        {
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
        if (dy > 0)
        {
            sSwap->lastCell = sSwap->cursor;
            sSwap->cursor = CELL_MOVE;
            PlaySE(SE_SELECT);
            PlaceCursor();
        }
        return;
    }
    for (tries = 0; tries < 4; tries++)
    {
        col = (col + dx + 4) % 4;
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

    if (sSwap->cursor == CELL_MOVE)
    {
        MovePicked();
        KeepCursorOnAMon();
        return;
    }
    sSwap->marked[side] ^= 1 << slot;
    DrawBox(side, slot);
    CopyBgTilemapBufferToVram(1);
    PlaySE(SE_SELECT);
}

bool8 BrSwap_Up(void)
{
    return gMain.callback2 == CB2_BrSwapRun;
}

// The settle has run (a battle is on its way): the box is empty and the party is the
// truth, so the screen shows that and takes no more moves. B still closes it.
void BrSwap_Settled(void)
{
    if (sSwap == NULL || sSwap->state != 0)
        return;
    sSwap->state = 2;
    sSwap->marked[SIDE_PARTY] = 0;
    sSwap->marked[SIDE_DROP] = 0;
    MirrorDrop();
    Redraw();
    sSwap->cursor = 0;
    PlaceCursor();
}

void BrSwap_HeapReset(void)
{
    sSwap = NULL;
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
        if (sSwap->state == 2)
        {
            if (JOY_NEW(B_BUTTON))
            {
                PlaySE(SE_SELECT);
                BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
                sSwap->state = 1;
            }
        }
        else if (JOY_NEW(A_BUTTON))
        {
            Press();
        }
        else if (JOY_NEW(START_BUTTON))
        {
            MovePicked();
            KeepCursorOnAMon();
        }
        else if (JOY_NEW(B_BUTTON))
        {
            if (sSwap->marked[SIDE_PARTY] | sSwap->marked[SIDE_DROP])
            {
                // B lets go of what was picked first, and closes the screen after.
                sSwap->marked[SIDE_PARTY] = 0;
                sSwap->marked[SIDE_DROP] = 0;
                PlaySE(SE_SELECT);
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
    // A picked mon's box: trade.c's first palette with its purples in the menu's orange.
    LoadPalette(gTradeMenu_Pal, BG_PLTT_ID(BOX_PICKED_PALETTE), PLTT_SIZE_4BPP);
    LoadPalette(&gTradeMenu_Pal[9], BG_PLTT_ID(BOX_PICKED_PALETTE) + 4, PLTT_SIZEOF(1));
    LoadPalette(&gTradeMenu_Pal[8], BG_PLTT_ID(BOX_PICKED_PALETTE) + 3, PLTT_SIZEOF(1));
    LoadPalette(&gTradeMenu_Pal[8], BG_PLTT_ID(BOX_PICKED_PALETTE) + 6, PLTT_SIZEOF(1));
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
    PrintCentered(WIN_MOVE, sText_Move, 48, FONT_NORMAL);
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
