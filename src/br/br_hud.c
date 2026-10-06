// The overworld HUD (POK-226): corner counter and clock, ticker, bottom box.
// See include/br/br_hud.h for the model, the tile map and the lifecycle rules.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "window.h"
#include "text.h"
#include "menu.h"
#include "text_window.h"
#include "palette.h"
#include "bg.h"
#include "script.h"
#include "string_util.h"
#include "field_message_box.h"
#include "constants/characters.h"
#include "br/br_hud.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "br/br_field.h"
#include "br/br_ring.h"

EWRAM_DATA struct BrHud gBrHud = {0};

// bg, left, top, width, height, palette, baseBlock. Palette 15 is the message-box
// palette the field loads on every map: 1 white, 2 dark gray, 3 light gray, 5 light red.
//
// Every one of these is inset by a tile from the edge it wants to sit on, because an
// Emerald frame is drawn OUTSIDE the window it belongs to -- one tile on each side, in
// palette 14, from the border set in OPTIONS (POK-256). A window flush against the top
// of the screen has nowhere to put its lid.
//
// The tiles are shared with the start menu and the message box (br_hud.h's tile map,
// POK-329). They were 0x23D..0x2FF, a run of their own, until BG2's tilemap came down
// to screen block 25 for the 512-row ring and took everything from 0x240.
static const struct WindowTemplate sCornerTemplate = { 0, BR_HUD_CORNER_LEFT, 1,
    BR_HUD_CORNER_WIDTH, BR_HUD_CORNER_HEIGHT, 15, BR_HUD_TILE_CORNER };
static const struct WindowTemplate sTickerTemplate = { 0, 1, 17,
    BR_HUD_TICKER_WIDTH, BR_HUD_TICKER_HEIGHT, 15, BR_HUD_TILE_TICKER };
static const struct WindowTemplate sBoxTemplate = { 0, 1, 11,
    BR_HUD_BOX_WIDTH, BR_HUD_BOX_HEIGHT, 15, BR_HUD_TILE_BOX };

#define BR_HUD_CORNER_END (BR_HUD_TILE_CORNER + BR_HUD_CORNER_WIDTH * BR_HUD_CORNER_HEIGHT)
#define BR_HUD_BOX_END (BR_HUD_TILE_BOX + BR_HUD_BOX_WIDTH * BR_HUD_BOX_HEIGHT)
#define BR_HUD_TICKER_END (BR_HUD_TILE_TICKER + BR_HUD_TICKER_WIDTH * BR_HUD_TICKER_HEIGHT)
// Pret's windows the tiles are laid out against (menu.c): the start menu, 7 wide and
// 2n + 2 tall from 0x139, and the message box, window 0, 27x4 from 0x194 up to the
// dialogue frame's tiles at 0x200. The map-name popup is 0x107..0x124 and yes/no
// 0x125..0x138, just under the corner.
#define BR_HUD_START_MENU 0x139
#define BR_HUD_START_MENU_END(items) (BR_HUD_START_MENU + 7 * (2 * (items) + 2))
#define BR_HUD_MESSAGE_BOX 0x194
#define BR_HUD_MESSAGE_BOX_END (BR_HUD_MESSAGE_BOX + 27 * 4)
#define BR_HUD_YES_NO_END (0x125 + 5 * 4)

// Every start menu, one item or pret's nine, covers the whole corner: on screen the
// menu sits over it, so the corner is never up with its tiles in the menu.
STATIC_ASSERT(BR_HUD_TILE_CORNER >= BR_HUD_START_MENU && BR_HUD_CORNER_END <= BR_HUD_START_MENU_END(1), BrHudCornerUnderEveryStartMenu)
// The box shares the start menu's tail and the message box's head, after the corner.
STATIC_ASSERT(BR_HUD_TILE_BOX >= BR_HUD_CORNER_END && BR_HUD_BOX_END <= 0x1C4, BrHudBoxAfterTheCorner)
// The ticker shares the message box's tail and nothing else: past the longest start
// menu pret can draw (nine items, to 0x1C4) and past the box, short of the frames.
STATIC_ASSERT(BR_HUD_TILE_TICKER >= BR_HUD_START_MENU_END(9) && BR_HUD_TILE_TICKER >= BR_HUD_BOX_END, BrHudTickerPastEveryStartMenu)
STATIC_ASSERT(BR_HUD_TILE_TICKER >= BR_HUD_MESSAGE_BOX && BR_HUD_TICKER_END <= BR_HUD_MESSAGE_BOX_END, BrHudTickerInsideTheMessageBox)
// Nothing at or above the ceiling, BG2's tilemap at screen block 25 (br_field.h). A tile
// past it is a write over the map's middle layer: the box once ran four tiles over the
// old ceiling, 0x300, and every line it printed put a magenta band across the DAY CARE's
// floor (2026-09-17).
STATIC_ASSERT(BR_HUD_TILE_CEILING == (BR_FIELD_MAP_BASE_BG2 * BG_SCREEN_SIZE - 2 * BG_CHAR_SIZE) / TILE_SIZE_4BPP, BrHudCeilingIsBg2Map)
STATIC_ASSERT(BR_HUD_CORNER_END <= BR_HUD_TILE_CEILING && BR_HUD_BOX_END <= BR_HUD_TILE_CEILING
    && BR_HUD_TICKER_END <= BR_HUD_TILE_CEILING, BrHudBelowTheCeiling)
// ...and clear of the map-name popup and the nurse's yes/no, which open beside the HUD
// without covering it and must not have their pixels drawn over.
STATIC_ASSERT(BR_HUD_TILE_CORNER >= BR_HUD_YES_NO_END && BR_HUD_TILE_BOX >= BR_HUD_YES_NO_END
    && BR_HUD_TILE_TICKER >= BR_HUD_YES_NO_END, BrHudClearOfThePopupAndYesNo)
// The corner's frame is one tile outside it on every side and must stay on the screen.
STATIC_ASSERT(BR_HUD_CORNER_LEFT + BR_HUD_CORNER_WIDTH <= 29, BrHudCornerFrameOnScreen)
#define BR_HUD_CORNER_PX (BR_HUD_CORNER_WIDTH * 8)

// The message box's own background, which is what makes it look like one.
#define BR_HUD_BOX PIXEL_FILL(1)

// bg, fg, shadow -- the standard trio on a light box, and the line kinds keep their
// colours so a kill and the fog still read differently at a glance.
static const u8 sColorsText[] = { 1, TEXT_COLOR_DARK_GRAY, TEXT_COLOR_LIGHT_GRAY };
static const u8 sColorsFog[] = { 1, TEXT_COLOR_RED, TEXT_COLOR_LIGHT_RED };
static const u8 sColorsKill[] = { 1, TEXT_COLOR_RED, TEXT_COLOR_LIGHT_RED };
static const u8 sColorsSay[] = { 1, TEXT_COLOR_BLUE, TEXT_COLOR_LIGHT_BLUE };

static const u8 sText_Left[] = _(" LEFT");
static const u8 sText_Fog[] = _("FOG!");
// How many are watching. Kanto's corner eye, on the small font's own symbol page.
static const u8 sText_Eye[] = _("{EMOJI_LEFT_EYE}");
// ---- windows ------------------------------------------------------------------

// The slot holds our template: the same BG, base tile and place. The base alone is not
// enough since the tiles are shared (POK-329) -- the start menu's base is the corner's.
static bool8 Ours(u8 id, const struct WindowTemplate *t)
{
    const struct WindowTemplate *w;

    if (id == WINDOW_NONE)
        return FALSE;
    w = &gWindows[id].window;
    return w->bg == t->bg && w->baseBlock == t->baseBlock
        && w->tilemapLeft == t->tilemapLeft && w->tilemapTop == t->tilemapTop;
}

// The slot still holds our window: a map load frees the buffer (tileData NULL) and
// the next InitWindows may hand the slot to someone else.
static bool8 Live(u8 id, const struct WindowTemplate *t)
{
    return Ours(id, t) && gWindows[id].tileData != NULL;
}

static u8 Ensure(u8 id, const struct WindowTemplate *t)
{
    if (Live(id, t))
        return id;
    // The frame's tiles and its two palettes, from the border the player chose in
    // OPTIONS. Idempotent, and cheap enough to say every time a window is made rather
    // than track whether the field has done it on this map yet.
    LoadMessageBoxAndBorderGfx();
    // Our template with no buffer: the engine freed it without an InitWindows since.
    if (Ours(id, t))
        RemoveWindow(id);
    return (u8)AddWindow(t);
}

static void Drop(u8 *id, const struct WindowTemplate *t)
{
    if (Live(*id, t))
        RemoveWindow(*id);
    *id = WINDOW_NONE;
}

// ---- sharing tiles (POK-329) ----------------------------------------------------

// A window's cells and the frame round it, in tilemap cells, inclusive.
struct BrHudExtent
{
    s8 left;
    s8 top;
    s8 right;
    s8 bottom;
};

// The most windows over the HUD whose cells TakeOff keeps: more than the field ever has up.
#define BR_HUD_KEEP_MAX 8

static u16 *Bg0Map(void)
{
    return (u16 *)GetBgTilemapBuffer(0);
}

// The cell at (x, y) names `tile`. For a window's first cell and its base tile, that is
// the window being on the tilemap: BG0's base tile is 0 on the overworld.
static bool8 Names(const u16 *map, s16 x, s16 y, u16 tile)
{
    if (map == NULL || x < 0 || y < 0 || x >= 32 || y >= 32)
        return FALSE;
    return (map[y * 32 + x] & 0x3FF) == tile;
}

static bool8 IsHudWindow(u8 id)
{
    struct BrHud *h = &gBrHud;

    return (id == h->winCorner && Ours(id, &sCornerTemplate))
        || (id == h->winTicker && Ours(id, &sTickerTemplate))
        || (id == h->winBox && Ours(id, &sBoxTemplate));
}

// Another window whose cells are on BG0, or are about to be: any live one that is not
// the HUD's -- and window 0, the field's message box, which lives as long as the field
// does, only while its box is up. Its mode goes back to hidden as soon as the text has
// printed, with the box still on screen waiting for A, so its first cell says the rest
// (a mart's clerk talks there without the field message box at all).
static bool8 Occupies(u8 id, const u16 *map)
{
    const struct Window *w = &gWindows[id];

    if (w->tileData == NULL || w->window.bg != 0 || IsHudWindow(id))
        return FALSE;
    if (id == 0)
        return !IsFieldMessageBoxHidden()
            || Names(map, w->window.tilemapLeft, w->window.tilemapTop, w->window.baseBlock);
    return TRUE;
}

static void Extent(const struct WindowTemplate *t, u8 left, u8 other, struct BrHudExtent *e)
{
    e->left = t->tilemapLeft - left;
    e->top = t->tilemapTop - other;
    e->right = t->tilemapLeft + t->width - 1 + other;
    e->bottom = t->tilemapTop + t->height - 1 + other;
}

// Where an occupying window draws: its cells, and its frame -- window 0's dialogue frame
// two cells to the left and one on every other side, anybody else's standard frame one
// all round, when it has one. It has one when the cell beside its first row is a frame
// tile (the dialogue and standard frames and the popup's outline, 0x200..0x23C); the
// spectator's peek box has none, and a margin kept round it would leave our cells there.
static void OccupantExtent(u8 id, const u16 *map, struct BrHudExtent *e)
{
    const struct WindowTemplate *t = &gWindows[id].window;
    s16 x = t->tilemapLeft > 0 ? t->tilemapLeft - 1 : t->tilemapLeft + t->width;
    u16 tile;

    if (id == 0)
    {
        Extent(t, 2, 1, e);
        return;
    }
    tile = (x < 32 && t->tilemapTop < 32 && map != NULL) ? (map[t->tilemapTop * 32 + x] & 0x3FF) : 0;
    if (tile >= 0x200 && tile < 0x23D)
        Extent(t, 1, 1, e);
    else
        Extent(t, 0, 0, e);
}

static bool8 Meet(const struct BrHudExtent *a, const struct BrHudExtent *b)
{
    return a->left <= b->right && b->left <= a->right && a->top <= b->bottom && b->top <= a->bottom;
}

static bool8 SharesTiles(const struct WindowTemplate *a, const struct WindowTemplate *b)
{
    return a->baseBlock < b->baseBlock + b->width * b->height
        && b->baseBlock < a->baseBlock + a->width * a->height;
}

// The three windows, for the loops below.
static const struct WindowTemplate *const sHudTemplates[] = { &sCornerTemplate, &sTickerTemplate, &sBoxTemplate };
static const u8 sHudBits[] = { BR_HUD_SHOWN_CORNER, BR_HUD_SHOWN_TICKER, BR_HUD_SHOWN_BOX };

static u8 HudId(u8 i)
{
    if (i == 0)
        return gBrHud.winCorner;
    if (i == 1)
        return gBrHud.winTicker;
    return gBrHud.winBox;
}

// Which of the HUD's windows another window covers now, as BR_HUD_SHOWN_* bits: it
// shares the HUD window's tiles, or it draws where the HUD window does. `sharers`, when
// not NULL, gets the bits whose tiles a window other than window 0 shares. One pass
// over the window table -- this runs three times a frame.
static u8 CoveredBits(u8 *sharers)
{
    const u16 *map = Bg0Map();
    struct BrHudExtent ours[ARRAY_COUNT(sHudTemplates)];
    struct BrHudExtent theirs;
    const struct WindowTemplate *w;
    u8 i, k, live = 0, bits = 0, shared = 0;

    for (k = 0; k < ARRAY_COUNT(sHudTemplates); k++)
    {
        if (Live(HudId(k), sHudTemplates[k]))
        {
            live |= sHudBits[k];
            Extent(sHudTemplates[k], 1, 1, &ours[k]);
        }
    }
    for (i = 0; live != 0 && i < WINDOWS_MAX; i++)
    {
        if (gWindows[i].tileData == NULL || !Occupies(i, map))
            continue;
        w = &gWindows[i].window;
        OccupantExtent(i, map, &theirs);
        for (k = 0; k < ARRAY_COUNT(sHudTemplates); k++)
        {
            if (!(live & sHudBits[k]))
                continue;
            if (SharesTiles(sHudTemplates[k], w))
            {
                bits |= sHudBits[k];
                if (i != 0)
                    shared |= sHudBits[k];
            }
            else if (Meet(&ours[k], &theirs))
            {
                bits |= sHudBits[k];
            }
        }
    }
    if (sharers != NULL)
        *sharers = shared;
    return bits;
}

// Takes a HUD window's cells and frame off the tilemap -- but not where a window over it
// has put its own (or, for the message box, is about to): those cells are that window's
// now. ClearStdWindowAndFrame took the whole rectangle, and a five-item start menu opened
// over the bottom box lost the foot of its frame to it. TRUE when a cell changed.
static bool8 TakeOff(const struct WindowTemplate *t)
{
    u16 *map = Bg0Map();
    struct BrHudExtent keep[BR_HUD_KEEP_MAX];
    struct BrHudExtent ours;
    const struct WindowTemplate *w;
    u8 i, n, k;
    s16 x, y;
    bool8 changed = FALSE;

    if (map == NULL)
        return FALSE;
    n = 0;
    for (i = 0; i < WINDOWS_MAX && n < BR_HUD_KEEP_MAX; i++)
    {
        w = &gWindows[i].window;
        if (gWindows[i].tileData != NULL && Occupies(i, map)
         && (i == 0 || Names(map, w->tilemapLeft, w->tilemapTop, w->baseBlock)))
            OccupantExtent(i, map, &keep[n++]);
    }
    Extent(t, 1, 1, &ours);
    for (y = ours.top; y <= ours.bottom; y++)
    {
        for (x = ours.left; x <= ours.right; x++)
        {
            if (x < 0 || y < 0 || x >= 32 || y >= 32 || map[y * 32 + x] == 0)
                continue;
            for (k = 0; k < n; k++)
            {
                if (x >= keep[k].left && x <= keep[k].right && y >= keep[k].top && y <= keep[k].bottom)
                    break;
            }
            if (k == n)
            {
                map[y * 32 + x] = 0;
                changed = TRUE;
            }
        }
    }
    return changed;
}

void BrHud_Yield(void)
{
    struct BrHud *h = &gBrHud;
    const u16 *map;
    const struct WindowTemplate *t;
    u8 k, id, bit, covered, sharers, share = 0;
    bool8 shown, first, copy = FALSE;
    u16 ime;

    if (!BrField_OverworldRunning() || gWindows[0].tileData == NULL)
        return;
    map = Bg0Map();
    if (map == NULL)
        return;
    covered = CoveredBits(&sharers);
    for (k = 0; k < ARRAY_COUNT(sHudTemplates); k++)
    {
        id = HudId(k);
        t = sHudTemplates[k];
        bit = sHudBits[k];
        if (!Live(id, t))
            continue;
        // Up: we put it, or its first cell is still ours -- the ticker, paused, leaves
        // its cells where they are.
        shown = (h->shown & bit) != 0;
        first = Names(map, t->tilemapLeft, t->tilemapTop, t->baseBlock);
        if (!shown && !first)
            continue;
        if (covered & bit)
        {
            if (TakeOff(t) || shown)
            {
                copy = TRUE;
                share |= bit & sharers;
            }
            h->shown &= ~bit;
            h->dirty |= bit;
        }
        else if (shown && !first)
        {
            // Somebody's clear took our cells: put the window again, frame and all.
            h->shown &= ~bit;
            h->dirty |= bit;
        }
    }
    if (!copy)
        return;
    // The cells first, then the covering windows' pixels into the shared tiles -- so a
    // copy the 40 KB cap splits over two VBlanks changes the tiles under cells that are
    // already their own -- and the VBlank interrupt held off between the two requests:
    // a frame that runs long takes its VBlank wherever the code is, and the start menu's
    // opening frame can (hud-vram.txt caught the corner handed over a frame before the
    // box). Window 0's pixels never go: its box copies its cells and pixels together
    // (DrawDialogueFrame), and until then its buffer holds the last message.
    ime = REG_IME;
    REG_IME = 0;
    CopyBgTilemapBufferToVram(0);
    for (id = 1; share != 0 && id < WINDOWS_MAX; id++)
    {
        if (gWindows[id].tileData == NULL || !Occupies(id, map))
            continue;
        for (k = 0; k < ARRAY_COUNT(sHudTemplates); k++)
        {
            if ((share & sHudBits[k]) && SharesTiles(sHudTemplates[k], &gWindows[id].window))
            {
                CopyWindowToVram(id, COPYWIN_GFX);
                break;
            }
        }
    }
    REG_IME = ime;
}

void BrHud_WindowAdded(u8 windowId)
{
    u8 k;

    for (k = 0; k < ARRAY_COUNT(sHudTemplates); k++)
    {
        if (Ours(windowId, sHudTemplates[k]))
            return;
    }
    BrHud_Yield();
}

// The standard frame round a window, into the tilemap buffer: menu.c's
// WindowFunc_DrawStandardFrame (static there), with the border OPTIONS chose at 0x214 in
// palette 14. DrawStdWindowFrame does the same and also puts the window's cells and
// wipes its pixels, all at once -- which is the order this cannot have.
#define BR_HUD_STD_FRAME 0x214
// Palette 14 is the frame's own, and the map-name popup loads its sign's colours over it
// while it is up: every HUD box went red-framed for as long as a route's name showed
// (2026-10-05 play-test). The HUD keeps its own copy of the frame's colours in 13, which
// nothing on the field uses -- the map's own tilesets stop at 12.
#define BR_HUD_STD_FRAME_PALETTE 13
static void PutFrame(const struct WindowTemplate *t)
{
    u8 l = t->tilemapLeft, top = t->tilemapTop, w = t->width, ht = t->height;

    FillBgTilemapBufferRect(0, BR_HUD_STD_FRAME + 0, l - 1, top - 1, 1, 1, BR_HUD_STD_FRAME_PALETTE);
    FillBgTilemapBufferRect(0, BR_HUD_STD_FRAME + 1, l, top - 1, w, 1, BR_HUD_STD_FRAME_PALETTE);
    FillBgTilemapBufferRect(0, BR_HUD_STD_FRAME + 2, l + w, top - 1, 1, 1, BR_HUD_STD_FRAME_PALETTE);
    FillBgTilemapBufferRect(0, BR_HUD_STD_FRAME + 3, l - 1, top, 1, ht, BR_HUD_STD_FRAME_PALETTE);
    FillBgTilemapBufferRect(0, BR_HUD_STD_FRAME + 5, l + w, top, 1, ht, BR_HUD_STD_FRAME_PALETTE);
    FillBgTilemapBufferRect(0, BR_HUD_STD_FRAME + 6, l - 1, top + ht, 1, 1, BR_HUD_STD_FRAME_PALETTE);
    FillBgTilemapBufferRect(0, BR_HUD_STD_FRAME + 7, l, top + ht, w, 1, BR_HUD_STD_FRAME_PALETTE);
    FillBgTilemapBufferRect(0, BR_HUD_STD_FRAME + 8, l + w, top + ht, 1, 1, BR_HUD_STD_FRAME_PALETTE);
}

// Puts or takes off a window's tilemap cells, but only across a change, and only when
// nothing covers it (the caller checks that). `pixels` says the buffer was redrawn this
// frame and needs a tile copy too. The drawing functions only fill and print: the frame
// and the cells go on here.
static void Present(u8 id, const struct WindowTemplate *t, u8 bit, bool8 want, bool8 pixels)
{
    struct BrHud *h = &gBrHud;
    bool8 have = (h->shown & bit) != 0;
    u16 ime;

    if (want && !have)
    {
        // The frame's tiles and palettes, again. Loading them when the window was made
        // is not enough: a map load, a weather fade or a battle coming back puts its
        // own palettes in that slot, and the frame is then drawn in whatever colours
        // were left there. (The play-test's red counter with garbage in its corner and
        // its orange bars were put down to this for two days; they were the map-name
        // popup and the box's tiles, see the templates above.) Idempotent, and this runs
        // on a show, not every frame.
        LoadMessageBoxAndBorderGfx();
        LoadUserWindowBorderGfxOnBg(0, BR_HUD_STD_FRAME, BG_PLTT_ID(BR_HUD_STD_FRAME_PALETTE));
        // Pixels first, then the frame and the cells: the tiles are shared (POK-329), and
        // until our copy lands they hold whatever the last window over us left there --
        // the start menu's blank box, say. Any tilemap copy that ran in between would
        // show our cells over it. The two requests go with the VBlank interrupt held off,
        // so they land in the same VBlank however long the frame runs: the frame a start
        // menu closes redraws all three windows, and it runs long.
        ime = REG_IME;
        REG_IME = 0;
        CopyWindowToVram(id, COPYWIN_GFX);
        PutFrame(t);
        PutWindowTilemap(id);
        CopyBgTilemapBufferToVram(0);
        REG_IME = ime;
        h->shown |= bit;
    }
    else if (!want && have)
    {
        // And comes off with it: a cleared window with its border still drawn is a
        // frame around a hole in the map. What another window put over it stays.
        TakeOff(t);
        CopyBgTilemapBufferToVram(0);
        h->shown &= ~bit;
    }
    else if (want && pixels)
    {
        CopyWindowToVram(id, COPYWIN_GFX);
    }
}

// ---- corner -------------------------------------------------------------------

static u8 FogPhase(void)
{
    if (gBrHud.fogFrames == 0)
        return 0;
    return ((gBrHud.fogFrames >> 3) & 1) ? 1 : 2;
}

static void PrintRight(u8 id, const u8 *str, u8 y, const u8 *colors)
{
    s32 w = GetStringWidth(FONT_SMALL, str, 0);
    s32 x = BR_HUD_CORNER_PX - 1 - w;

    if (x < 0)
        x = 0;
    AddTextPrinterParameterized3(id, FONT_SMALL, (u8)x, y, colors, (s8)TEXT_SKIP_DRAW, str);
}

// The corner's second line: where the ring is closing, all ring phase long (POK-325).
// Nothing before the ring (the Safari) or when the host named no place.
static const u8 *CornerPlace(void)
{
    if (!gBrRing.active)
        return NULL;
    if (gBrRing.r < 0)
        return gBrText_FogEverywhere;
    if (gBrRing.place[0] == EOS)
        return NULL;
    return gBrRing.place;
}

// Whose turn it is on the second line when the name and the eye do not both fit.
static u8 AltTurn(void)
{
    return gBrHud.altFrames < BR_HUD_ALT_FRAMES ? 1 : 2;
}

static void DrawCorner(void)
{
    struct BrHud *h = &gBrHud;
    u8 buf[16];
    u8 eye[8];
    u8 *p;
    u8 fog = FogPhase();
    const u8 *place = CornerPlace();
    u8 alt = 0;
    u8 clockY;

    FillWindowPixelBuffer(h->winCorner, BR_HUD_BOX);
    // Line one: how many are left, and the clock on the right -- or the FOG! flash in the
    // clock's place. With no place to name (the Safari, before the ring) the clock keeps
    // the second line to itself, as the corner always had it, rather than leave that
    // line an empty strip -- the wound bar's "empty looking box" (2026-09-16).
    clockY = place != NULL ? 0 : 12;
    p = ConvertIntToDecimalStringN(buf, h->left, STR_CONV_MODE_LEFT_ALIGN, 2);
    StringCopy(p, sText_Left);
    AddTextPrinterParameterized3(h->winCorner, FONT_SMALL, 0, 0, sColorsText,
        (s8)TEXT_SKIP_DRAW, buf);
    if (fog == 2)
    {
        PrintRight(h->winCorner, sText_Fog, clockY, sColorsFog);
    }
    else if (fog == 0)
    {
        p = ConvertIntToDecimalStringN(buf, h->clockSecs / 60, STR_CONV_MODE_LEFT_ALIGN, 2);
        *p++ = CHAR_COLON;
        ConvertIntToDecimalStringN(p, h->clockSecs % 60, STR_CONV_MODE_LEADING_ZEROS, 2);
        PrintRight(h->winCorner, buf, clockY, sColorsText);
    }
    // Line two: the place on the right, the eye and its count on the left. The eye is a
    // two-byte escape (F9 D8), so the count goes where StringCopy left the terminator.
    // A route fits beside the eye; VERDANTURF TOWN and FOG EVERYWHERE do not, and those
    // take turns with it, two seconds each.
    if (h->eyes != 0)
        ConvertIntToDecimalStringN(StringCopy(eye, sText_Eye), h->eyes, STR_CONV_MODE_LEFT_ALIGN, 2);
    if (h->eyes != 0 && place != NULL
     && GetStringWidth(FONT_SMALL, eye, 0) + 4 + GetStringWidth(FONT_SMALL, place, 0) > BR_HUD_CORNER_PX)
        alt = AltTurn();
    if (place != NULL && alt != 2)
        PrintRight(h->winCorner, place, 12, gBrRing.r < 0 ? sColorsFog : sColorsText);
    if (h->eyes != 0 && alt != 1)
        AddTextPrinterParameterized3(h->winCorner, FONT_SMALL, 0, 12, sColorsText,
            (s8)TEXT_SKIP_DRAW, eye);
    h->drawnClock = h->clockSecs;
    h->drawnLeft = h->left;
    h->drawnFog = fog;
    h->drawnEyes = h->eyes;
    h->drawnAlt = alt;
}

static void TickCorner(bool8 covered)
{
    struct BrHud *h = &gBrHud;
    bool8 pixels = FALSE;

    if (covered)
    {
        // The start menu, most often. BrHud_Yield took the corner off where the menu does
        // not draw -- its two left columns, frame and all -- and it is drawn whole again
        // when the menu goes: the menu's pixels are in its tiles by then.
        h->shown &= ~BR_HUD_SHOWN_CORNER;
        h->dirty |= BR_HUD_DIRTY_CORNER;
        return;
    }
    if ((h->dirty & BR_HUD_DIRTY_CORNER) || h->drawnClock != h->clockSecs || h->drawnLeft != h->left
        || h->drawnFog != FogPhase() || h->drawnEyes != h->eyes
        || (h->drawnAlt != 0 && h->drawnAlt != AltTurn()))
    {
        DrawCorner();
        h->dirty &= ~BR_HUD_DIRTY_CORNER;
        pixels = TRUE;
    }
    Present(h->winCorner, &sCornerTemplate, BR_HUD_SHOWN_CORNER, TRUE, pixels);
}


static void SetLine(struct BrHudLine *line, u8 kind, const u8 *text, u8 len)
{
    u8 i;

    if (len > BR_HUD_LINE_MAX)
        len = BR_HUD_LINE_MAX;
    line->kind = kind;
    line->len = len;
    for (i = 0; i < len; i++)
        line->text[i] = text[i];
    line->text[len] = EOS;
}

// Kanto's Ticker.push (lib/ticker.lua): a line identical to the last one queued -- or to
// the one on screen, when nothing waits behind it -- is dropped. A beat two paths both
// announce is one line, whichever side of the mailbox said it first (POK-324).
static bool8 SameAsLast(const u8 *text, u8 len)
{
    const struct BrHudLine *last;
    u8 i;

    if (gBrHud.queueLen == 0)
        return FALSE;
    last = &gBrHud.queue[gBrHud.queueLen - 1];
    if (last->len != len)
        return FALSE;
    for (i = 0; i < len; i++)
    {
        if (last->text[i] != text[i])
            return FALSE;
    }
    return TRUE;
}

static void Push(u8 kind, const u8 *text, u8 len)
{
    struct BrHud *h = &gBrHud;
    u8 i;

    if (len > BR_HUD_LINE_MAX)
        len = BR_HUD_LINE_MAX;
    if (SameAsLast(text, len))
        return;
    if (h->queueLen >= BR_HUD_QUEUE)
    {
        // Full: the oldest line goes, and if it was on screen the next one starts fresh.
        for (i = 1; i < BR_HUD_QUEUE; i++)
            h->queue[i - 1] = h->queue[i];
        h->queueLen = BR_HUD_QUEUE - 1;
        h->lineFrames = 0;
        h->dirty |= BR_HUD_DIRTY_TICKER;
    }
    SetLine(&h->queue[h->queueLen], kind, text, len);
    if (h->queueLen == 0)
        h->dirty |= BR_HUD_DIRTY_TICKER;
    h->queueLen++;
}

static void PopLine(void)
{
    struct BrHud *h = &gBrHud;
    u8 i;

    if (h->queueLen == 0)
        return;
    for (i = 1; i < h->queueLen; i++)
        h->queue[i - 1] = h->queue[i];
    h->queueLen--;
    h->lineFrames = 0;
    h->dirty |= BR_HUD_DIRTY_TICKER;
}

// The 180-frame timer: runs while the overworld does, held or not shown alike, so
// stale news does not pile up behind a message box.
static void AdvanceTicker(void)
{
    struct BrHud *h = &gBrHud;

    if (h->held || h->queueLen == 0)
        return;
    h->lineFrames++;
    if (h->lineFrames >= BR_HUD_LINE_FRAMES)
        PopLine();
}

static const struct BrHudLine *CurrentLine(void)
{
    struct BrHud *h = &gBrHud;

    if (h->held)
        return &h->heldLine;
    if (h->queueLen > 0)
        return &h->queue[0];
    return NULL;
}

static void DrawTicker(const struct BrHudLine *line)
{
    const u8 *colors = sColorsText;

    if (line->kind == BR_HUD_KIND_KILL)
        colors = sColorsKill;
    else if (line->kind == BR_HUD_KIND_SAY)
        colors = sColorsSay;
    FillWindowPixelBuffer(gBrHud.winTicker, BR_HUD_BOX);
    AddTextPrinterParameterized3(gBrHud.winTicker, FONT_SMALL, 2, 1, colors, (s8)TEXT_SKIP_DRAW, line->text);
}

static void TickTicker(bool8 paused, bool8 covered)
{
    struct BrHud *h = &gBrHud;
    const struct BrHudLine *line = CurrentLine();
    bool8 pixels = FALSE;

    if (covered)
    {
        // The message box: BrHud_Yield handed it the tiles. Drawn again once it goes.
        h->shown &= ~BR_HUD_SHOWN_TICKER;
        h->dirty |= BR_HUD_DIRTY_TICKER;
        return;
    }
    if (paused)
    {
        // Frozen where it is: the cells stay, and are put again on the way back.
        h->shown &= ~BR_HUD_SHOWN_TICKER;
        return;
    }
    if (line != NULL && (h->dirty & BR_HUD_DIRTY_TICKER))
    {
        DrawTicker(line);
        h->dirty &= ~BR_HUD_DIRTY_TICKER;
        pixels = TRUE;
    }
    Present(h->winTicker, &sTickerTemplate, BR_HUD_SHOWN_TICKER, line != NULL, pixels);
}

// BR_MSG_TICKER: seat, kind, textLen, text. One slot only; a line the page split
// across slots is longer than the ticker shows anyway.
static void HandleTicker(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);
    u8 textLen;

    if (n < 3)
        return;
    // Who went out and who beat a gym leader are not the banner's news (2026-10-05
    // play-test: "don't announce deaths or gym leader defeats in the bottom banner"):
    // the corner's count says how many are left, and the MAP's gray heads say which gyms
    // are down (br_gym.c). Both are the page's KILL lines and nothing else is.
    if (d[1] == BR_HUD_KIND_KILL)
        return;
    textLen = d[2];
    if (textLen > n - 3)
        textLen = n - 3;
    Push(d[1], d + 3, textLen);
}

// ---- entry points -------------------------------------------------------------

void BrHud_Init(void)
{
    struct BrHud *h = &gBrHud;
    u8 i;

    BrNet_On(BR_MSG_TICKER, HandleTicker);
    h->left = 0;
    h->flashFog = 0;
    h->clockSecs = 0;
    h->clockFrames = 0;
    h->fogFrames = 0;
    h->winCorner = WINDOW_NONE;
    h->winTicker = WINDOW_NONE;
    h->winBox = WINDOW_NONE;
    h->boxFrames = 0;
    h->live = 0;
    h->shown = 0;
    h->queueLen = 0;
    h->lineFrames = 0;
    h->held = 0;
    h->dirty = 0;
    h->scriptWas = 0;
    h->popupWas = 0;
    h->altFrames = 0;
    h->drawnAlt = 0;
    h->drawnClock = 0xFFFF;
    h->drawnLeft = 0xFF;
    h->drawnFog = 0xFF;
    h->heldLine.text[0] = EOS;
}

// ---- bottom box ---------------------------------------------------------------

static void DrawBox(void)
{
    struct BrHud *h = &gBrHud;

    FillWindowPixelBuffer(h->winBox, BR_HUD_BOX);
    // CHAR_NEWLINE in the text gives the second line; the printer handles the rest.
    AddTextPrinterParameterized3(h->winBox, FONT_SMALL, 2, 2, sColorsText,
        (s8)TEXT_SKIP_DRAW, h->box.text);
}

static void TickBox(bool8 blocked)
{
    struct BrHud *h = &gBrHud;
    bool8 pixels = FALSE;

    if (h->winBox == WINDOW_NONE)
        return;
    if (blocked || h->boxFrames == 0)
    {
        // Taken down, its cells come off (but for any another window has put over them),
        // so a box that outlives whatever blocked it is drawn again, frame and all, not
        // just put again. It was not once: the purse line after a gym (POK-295) came
        // back from the win's own script as a white slab with no frame and nothing
        // written on it.
        Present(h->winBox, &sBoxTemplate, BR_HUD_SHOWN_BOX, FALSE, FALSE);
        h->dirty |= BR_HUD_DIRTY_BOX;
        return;
    }
    if (h->dirty & BR_HUD_DIRTY_BOX)
    {
        DrawBox();
        h->dirty &= ~BR_HUD_DIRTY_BOX;
        pixels = TRUE;
    }
    Present(h->winBox, &sBoxTemplate, BR_HUD_SHOWN_BOX, TRUE, pixels);
}

void BrHud_Box(const u8 *text)
{
    struct BrHud *h = &gBrHud;
    u8 i;

    for (i = 0; i < BR_HUD_LINE_MAX && text[i] != EOS; i++)
        h->box.text[i] = text[i];
    h->box.text[i] = EOS;
    h->box.len = i;
    h->box.kind = BR_HUD_KIND_SYSTEM;
    h->boxFrames = BR_HUD_BOX_FRAMES;
    h->dirty |= BR_HUD_DIRTY_BOX;
}

u8 *BrHud_Append(u8 *dst, const u8 *last, const u8 *src)
{
    while (dst < last && *src != EOS)
        *dst++ = *src++;
    *dst = EOS;
    return dst;
}

void BrHud_Say(const u8 *text)
{
    u16 len = StringLength(text);

    Push(BR_HUD_KIND_SYSTEM, text, len > BR_HUD_LINE_MAX ? BR_HUD_LINE_MAX : (u8)len);
}

void BrHud_Hold(const u8 *text)
{
    u16 len = StringLength(text);

    SetLine(&gBrHud.heldLine, BR_HUD_KIND_SYSTEM, text, len > BR_HUD_LINE_MAX ? BR_HUD_LINE_MAX : (u8)len);
    gBrHud.held = 1;
    gBrHud.dirty |= BR_HUD_DIRTY_TICKER;
}

void BrHud_Release(void)
{
    if (!gBrHud.held)
        return;
    gBrHud.held = 0;
    gBrHud.dirty |= BR_HUD_DIRTY_TICKER;
}

void BrHud_Tick(void)
{
    struct BrHud *h = &gBrHud;
    bool8 scriptOn, menuUp, popupUp, paused;
    u8 live, covered;

    if (h->flashFog)
    {
        h->flashFog = 0;
        h->fogFrames = BR_HUD_FOG_FRAMES;
    }
    if (!BrField_OverworldRunning())
    {
        // Battle, menu or a map load: the windows must not outlive the overworld's BG0.
        Drop(&h->winCorner, &sCornerTemplate);
        Drop(&h->winTicker, &sTickerTemplate);
        Drop(&h->winBox, &sBoxTemplate);
        h->live = 0;
        h->shown = 0;
        h->scriptWas = 0;
        return;
    }
    // The page's clock is a wall clock; the ROM only keeps it moving between writes.
    if (++h->clockFrames >= 60)
    {
        h->clockFrames = 0;
        if (h->clockSecs > 0)
            h->clockSecs--;
    }
    if (h->fogFrames > 0)
        h->fogFrames--;
    if (++h->altFrames >= 2 * BR_HUD_ALT_FRAMES)
        h->altFrames = 0;
    // A box said on the way out of a battle (the gym's purse, POK-295) spent most of its
    // ninety frames behind the fade back to the map. The fade does not count against it.
    if (h->boxFrames > 0 && !gPaletteFade.active)
        h->boxFrames--;
    AdvanceTicker();

    // The field's own message box (window 0) is the sign that InitWindows has run for
    // this map; before that there is no BG0 tilemap buffer to draw into.
    if (gWindows[0].tileData == NULL)
        return;

    // Whatever came up over the HUD since OverworldBasic's hand-over last frame -- a
    // window the page's messages opened earlier in BrFrame, say.
    BrHud_Yield();

    live = 0;
    h->winCorner = Ensure(h->winCorner, &sCornerTemplate);
    h->winTicker = Ensure(h->winTicker, &sTickerTemplate);
    if (h->winCorner != WINDOW_NONE)
        live++;
    if (h->winTicker != WINDOW_NONE)
        live++;
    // The box is transient: it holds a window slot only while it has something to say.
    if (h->boxFrames > 0)
    {
        u8 was = h->winBox;

        h->winBox = Ensure(h->winBox, &sBoxTemplate);
        if (h->winBox != was)
            h->dirty |= BR_HUD_DIRTY_BOX;
    }
    else if (h->winBox != WINDOW_NONE)
    {
        TickBox(TRUE); // clear our cells before the window goes
        Drop(&h->winBox, &sBoxTemplate);
        h->shown &= ~BR_HUD_SHOWN_BOX;
    }

    if (live != h->live)
    {
        // Fresh buffers hold garbage and no tilemap: draw and put everything again.
        // OR, not assign: the box's own bit was set a few lines up when its window came
        // back, and assigning dropped it.
        h->dirty |= BR_HUD_DIRTY_CORNER | BR_HUD_DIRTY_TICKER | BR_HUD_DIRTY_BOX;
        h->shown = 0;
        h->live = live;
    }

    // The map-name popup paints every frame on screen in ITS colours while it is up --
    // it loads its theme's palette into slot 14, which is the standard frame's -- and
    // nothing put ours back when it left, so outdoors the HUD stayed framed in brick red
    // or wood brown until something else happened to reload it. When it goes, reload.
    popupUp = GetMapNamePopUpWindowId() != WINDOW_NONE;
    if (h->popupWas && !popupUp)
    {
        LoadMessageBoxAndBorderGfx();
        LoadUserWindowBorderGfxOnBg(0, BR_HUD_STD_FRAME, BG_PLTT_ID(BR_HUD_STD_FRAME_PALETTE));
        h->shown = 0;
    }
    h->popupWas = popupUp;

    scriptOn = ScriptContext_IsEnabled();
    menuUp = GetStartMenuWindowId() != WINDOW_NONE;
    // A script's own windows (multichoice, braille, the like) may have cleared our
    // cells on their way out; put every tilemap again once it is over.
    if (h->scriptWas && !scriptOn)
        h->shown = 0;
    h->scriptWas = scriptOn;

    // A covered window is neither drawn nor put: its tiles are somebody else's. The
    // ticker and the box also pause for the start menu, a script or a field message.
    paused = menuUp || scriptOn || !IsFieldMessageBoxHidden();
    covered = CoveredBits(NULL);
    if (h->winCorner != WINDOW_NONE)
        TickCorner((covered & BR_HUD_SHOWN_CORNER) != 0);
    if (h->winTicker != WINDOW_NONE)
        TickTicker(paused, (covered & BR_HUD_SHOWN_TICKER) != 0);
    TickBox(paused || (covered & BR_HUD_SHOWN_BOX));
}
