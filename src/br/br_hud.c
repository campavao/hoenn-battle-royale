// The overworld HUD (POK-226): corner counter and clock, ticker, bottom box.
// See include/br/br_hud.h for the model, the tile map and the lifecycle rules.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "window.h"
#include "text.h"
#include "menu.h"
#include "palette.h"
#include "script.h"
#include "string_util.h"
#include "field_message_box.h"
#include "constants/characters.h"
#include "br/br_hud.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"

EWRAM_DATA struct BrHud gBrHud = {0};

// bg, left, top, width, height, palette, baseBlock. Palette 15 is the message-box
// palette the field loads on every map: 1 white, 2 dark gray, 3 light gray, 5 light red.
//
// Every one of these is inset by a tile from the edge it wants to sit on, because an
// Emerald frame is drawn OUTSIDE the window it belongs to -- one tile on each side, in
// palette 14, from the border set in OPTIONS (POK-256). A window flush against the top
// of the screen has nowhere to put its lid.
//
// The floor is 0x23D, not 0x23A. The map-name popup loads its outline at 0x21D and the
// load is 0x400 bytes -- thirty-two tiles, 0x21D..0x23C -- so on every outdoor map it
// wrote its last three over the corner's first three. That, and the popup putting its
// own palette in slot 14 (see BrHud_Tick), is the play-test's "counter framed in RED with
// garbage tiles in its corner"; it was blamed on a weather fade for two days.
static const struct WindowTemplate sCornerTemplate = { 0, 23, 1, 6, 3, 15, 0x23D };
static const struct WindowTemplate sTickerTemplate = { 0, 1, 17, 28, 2, 15, 0x24F };
static const struct WindowTemplate sBoxTemplate = { 0, 1, 11, 28, 4, 15, 0x287 };

// BG0's tiles are char block 2 (0x06008000) and the first thing after them is not BG0's
// own tilemap, it is BG2's, at 0x0600E000: tile 0x300. The box sat at 0x294..0x303 for a
// month and every line it printed wrote 0x80 bytes of PIXEL_FILL(1) over the first two
// rows of the map's middle layer -- a magenta band wherever those rows were on screen
// and nothing had scrolled to redraw them, which is the DAY CARE's whole floor
// (2026-09-17), and very likely the "orange bars across the top" of an earlier play-test.
#define BR_HUD_TILE_CEILING 0x300
STATIC_ASSERT(0x287 + 28 * 4 <= BR_HUD_TILE_CEILING, BrHudBoxFitsBelowBg2Tilemap)
STATIC_ASSERT(0x21D + 0x400 / 32 <= 0x23D, BrHudCornerClearOfTheMapNamePopup)

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

static bool8 OverworldRunning(void)
{
    return gMain.callback2 == CB2_Overworld && !gMain.inBattle;
}

// The slot still holds our window: a map load frees the buffer (tileData NULL) and
// the next InitWindows may hand the slot to someone else (baseBlock differs).
static bool8 Live(u8 id, const struct WindowTemplate *t)
{
    if (id == WINDOW_NONE)
        return FALSE;
    return gWindows[id].tileData != NULL
        && gWindows[id].window.bg == t->bg
        && gWindows[id].window.baseBlock == t->baseBlock;
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
    if (id != WINDOW_NONE && gWindows[id].window.bg == t->bg && gWindows[id].window.baseBlock == t->baseBlock)
        RemoveWindow(id);
    return (u8)AddWindow(t);
}

static void Drop(u8 *id, const struct WindowTemplate *t)
{
    if (Live(*id, t))
        RemoveWindow(*id);
    *id = WINDOW_NONE;
}

// Puts or clears a window's tilemap cells, but only across a change, and only when
// nothing else owns the cells (the caller checks that). `pixels` says the buffer was
// redrawn this frame and needs a tile copy too.
static void Present(u8 id, u8 bit, bool8 want, bool8 pixels)
{
    struct BrHud *h = &gBrHud;
    bool8 have = (h->shown & bit) != 0;

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
        // The frame goes on with the window. DrawStdWindowFrame fills the buffer as it
        // goes, so this has to happen before the content is printed -- which is why the
        // drawing functions call it in place of their own FillWindowPixelBuffer, and
        // this branch only has to put the tilemap up.
        PutWindowTilemap(id);
        CopyWindowToVram(id, COPYWIN_FULL);
        h->shown |= bit;
    }
    else if (!want && have)
    {
        // And comes off with it: a cleared window with its border still drawn is a
        // frame around a hole in the map.
        ClearStdWindowAndFrame(id, FALSE);
        CopyWindowToVram(id, COPYWIN_MAP);
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
    s32 x = 47 - w;

    if (x < 0)
        x = 0;
    AddTextPrinterParameterized3(id, FONT_SMALL, (u8)x, y, colors, (s8)TEXT_SKIP_DRAW, str);
}

static void DrawCorner(void)
{
    struct BrHud *h = &gBrHud;
    u8 buf[16];
    u8 *p;
    u8 fog = FogPhase();

    DrawStdWindowFrame(h->winCorner, FALSE);
    p = ConvertIntToDecimalStringN(buf, h->left, STR_CONV_MODE_LEFT_ALIGN, 2);
    StringCopy(p, sText_Left);
    PrintRight(h->winCorner, buf, 0, sColorsText);
    if (fog == 2)
    {
        PrintRight(h->winCorner, sText_Fog, 12, sColorsFog);
    }
    else if (fog == 0)
    {
        p = ConvertIntToDecimalStringN(buf, h->clockSecs / 60, STR_CONV_MODE_LEFT_ALIGN, 2);
        *p++ = CHAR_COLON;
        ConvertIntToDecimalStringN(p, h->clockSecs % 60, STR_CONV_MODE_LEADING_ZEROS, 2);
        PrintRight(h->winCorner, buf, 12, sColorsText);
    }
    if (h->eyes != 0)
    {
        // Left of the clock, on the same line: the corner is two lines tall and both
        // are spoken for.
        // The eye is a two-byte escape (F9 D8), so the count goes where StringCopy
        // left the terminator, not at buf[1].
        ConvertIntToDecimalStringN(StringCopy(buf, sText_Eye), h->eyes,
            STR_CONV_MODE_LEFT_ALIGN, 2);
        AddTextPrinterParameterized3(h->winCorner, FONT_SMALL, 0, 12, sColorsText,
            (s8)TEXT_SKIP_DRAW, buf);
    }
    h->drawnClock = h->clockSecs;
    h->drawnLeft = h->left;
    h->drawnFog = fog;
    h->drawnEyes = h->eyes;
}

static void TickCorner(bool8 blocked)
{
    struct BrHud *h = &gBrHud;
    bool8 pixels = FALSE;

    if (blocked)
    {
        h->shown &= ~BR_HUD_SHOWN_CORNER;
        return;
    }
    if ((h->dirty & BR_HUD_DIRTY_CORNER) || h->drawnClock != h->clockSecs || h->drawnLeft != h->left
        || h->drawnFog != FogPhase() || h->drawnEyes != h->eyes)
    {
        DrawCorner();
        h->dirty &= ~BR_HUD_DIRTY_CORNER;
        pixels = TRUE;
    }
    Present(h->winCorner, BR_HUD_SHOWN_CORNER, TRUE, pixels);
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

static void Push(u8 kind, const u8 *text, u8 len)
{
    struct BrHud *h = &gBrHud;
    u8 i;

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
    DrawStdWindowFrame(gBrHud.winTicker, FALSE);
    AddTextPrinterParameterized3(gBrHud.winTicker, FONT_SMALL, 2, 1, colors, (s8)TEXT_SKIP_DRAW, line->text);
}

static void TickTicker(bool8 blocked)
{
    struct BrHud *h = &gBrHud;
    const struct BrHudLine *line = CurrentLine();
    bool8 pixels = FALSE;

    if (blocked)
    {
        h->shown &= ~BR_HUD_SHOWN_TICKER;
        return;
    }
    if (line != NULL && (h->dirty & BR_HUD_DIRTY_TICKER))
    {
        DrawTicker(line);
        h->dirty &= ~BR_HUD_DIRTY_TICKER;
        pixels = TRUE;
    }
    Present(h->winTicker, BR_HUD_SHOWN_TICKER, line != NULL, pixels);
}

// BR_MSG_TICKER: seat, kind, textLen, text. One slot only; a line the page split
// across slots is longer than the ticker shows anyway.
static void HandleTicker(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);
    u8 textLen;

    if (n == 0xFF || n < 3)
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
    h->drawnClock = 0xFFFF;
    h->drawnLeft = 0xFF;
    h->drawnFog = 0xFF;
    h->heldLine.text[0] = EOS;
}

// ---- bottom box ---------------------------------------------------------------

static void DrawBox(void)
{
    struct BrHud *h = &gBrHud;

    DrawStdWindowFrame(h->winBox, FALSE);
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
        // Taking it down wipes its pixels as well as its cells (ClearStdWindowAndFrame),
        // so a box that outlives whatever blocked it has to be drawn again, not just put
        // again. It was not: the purse line after a gym (POK-295) came back from the
        // win's own script as a white slab with no frame and nothing written on it.
        Present(h->winBox, BR_HUD_SHOWN_BOX, FALSE, FALSE);
        h->dirty |= BR_HUD_DIRTY_BOX;
        return;
    }
    if (h->dirty & BR_HUD_DIRTY_BOX)
    {
        DrawBox();
        h->dirty &= ~BR_HUD_DIRTY_BOX;
        pixels = TRUE;
    }
    Present(h->winBox, BR_HUD_SHOWN_BOX, TRUE, pixels);
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
    bool8 scriptOn, menuUp, popupUp;
    u8 live;

    if (h->flashFog)
    {
        h->flashFog = 0;
        h->fogFrames = BR_HUD_FOG_FRAMES;
    }
    if (!OverworldRunning())
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
    // A box said on the way out of a battle (the gym's purse, POK-295) spent most of its
    // ninety frames behind the fade back to the map. The fade does not count against it.
    if (h->boxFrames > 0 && !gPaletteFade.active)
        h->boxFrames--;
    AdvanceTicker();

    // The field's own message box (window 0) is the sign that InitWindows has run for
    // this map; before that there is no BG0 tilemap buffer to draw into.
    if (gWindows[0].tileData == NULL)
        return;

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

    if (h->winCorner != WINDOW_NONE)
        TickCorner(menuUp);
    if (h->winTicker != WINDOW_NONE)
        TickTicker(menuUp || scriptOn || !IsFieldMessageBoxHidden());
    TickBox(menuUp || scriptOn || !IsFieldMessageBoxHidden());
}
