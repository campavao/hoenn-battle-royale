// The overworld HUD (POK-226): corner counter and clock, wound bar, ticker.
// See include/br/br_hud.h for the model, the tile map and the lifecycle rules.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "window.h"
#include "text.h"
#include "menu.h"
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
static const struct WindowTemplate sCornerTemplate = { 0, 23, 1, 6, 3, 15, 0x23A };
static const struct WindowTemplate sWoundTemplate = { 0, 23, 6, 6, 2, 15, 0x24C };
static const struct WindowTemplate sTickerTemplate = { 0, 1, 17, 28, 2, 15, 0x258 };
static const struct WindowTemplate sBoxTemplate = { 0, 1, 11, 28, 4, 15, 0x294 };

// The message box's own background, which is what makes it look like one.
#define BR_HUD_BOX PIXEL_FILL(1)

// bg, fg, shadow -- the standard trio on a light box, and the line kinds keep their
// colours so a kill and the fog still read differently at a glance.
static const u8 sColorsText[] = { 1, TEXT_COLOR_DARK_GRAY, TEXT_COLOR_LIGHT_GRAY };
static const u8 sColorsFog[] = { 1, TEXT_COLOR_RED, TEXT_COLOR_LIGHT_RED };
static const u8 sColorsKill[] = { 1, TEXT_COLOR_RED, TEXT_COLOR_LIGHT_RED };
static const u8 sColorsSay[] = { 1, TEXT_COLOR_BLUE, TEXT_COLOR_LIGHT_BLUE };
static const u8 sColorsWound[] = { 1, TEXT_COLOR_GREEN, TEXT_COLOR_LIGHT_GREEN };

static const u8 sText_Left[] = _(" LEFT");
static const u8 sText_Fog[] = _("FOG!");
// How many are watching. Kanto's corner eye, on the small font's own symbol page.
static const u8 sText_Eye[] = _("{EMOJI_LEFT_EYE}");
// Wound glyphs, all from the small font's extra-symbol page: no new graphics.
static const u8 sText_WoundFull[] = _("{EMOJI_CIRCLE}");
static const u8 sText_WoundHurt[] = _("{CIRCLE_DOT}");
static const u8 sText_WoundDown[] = _("×");

#define WOUND_NONE 0
#define WOUND_DOWN 1
#define WOUND_HURT 2
#define WOUND_FULL 3

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

// ---- wound bar ----------------------------------------------------------------

static u8 WoundOf(u8 slot)
{
    struct Pokemon *mon;
    u16 hp, max;

    if (slot >= gPlayerPartyCount || slot >= PARTY_SIZE)
        return WOUND_NONE;
    mon = &gPlayerParty[slot];
    hp = GetMonData(mon, MON_DATA_HP);
    max = GetMonData(mon, MON_DATA_MAX_HP);
    if (max == 0)
        return WOUND_NONE;
    if (hp == 0)
        return WOUND_DOWN;
    if (hp * 2 <= max)
        return WOUND_HURT;
    return WOUND_FULL;
}

static void DrawWound(const u8 *codes)
{
    struct BrHud *h = &gBrHud;
    u8 buf[2 * PARTY_SIZE + 1];
    u8 *p = buf;
    u8 i;

    for (i = 0; i < PARTY_SIZE; i++)
    {
        h->drawnWound[i] = codes[i];
        switch (codes[i])
        {
        case WOUND_FULL: p = StringCopy(p, sText_WoundFull); break;
        case WOUND_HURT: p = StringCopy(p, sText_WoundHurt); break;
        case WOUND_DOWN: p = StringCopy(p, sText_WoundDown); break;
        }
    }
    *p = EOS;
    DrawStdWindowFrame(h->winWound, FALSE);
    PrintRight(h->winWound, buf, 0, sColorsWound);
}

static void TickWound(bool8 blocked)
{
    struct BrHud *h = &gBrHud;
    u8 codes[PARTY_SIZE];
    bool8 pixels = FALSE;
    bool8 any = FALSE;
    u8 i;

    if (blocked)
    {
        h->shown &= ~BR_HUD_SHOWN_WOUND;
        return;
    }
    // GetMonData on HP is a plain read, but six of them a frame is still needless.
    if ((h->dirty & BR_HUD_DIRTY_WOUND) == 0 && (gMain.vblankCounter1 & 7) != 0)
    {
        for (i = 0; i < PARTY_SIZE; i++)
            if (h->drawnWound[i] != WOUND_NONE)
                any = TRUE;
        Present(h->winWound, BR_HUD_SHOWN_WOUND, any, FALSE);
        return;
    }
    for (i = 0; i < PARTY_SIZE; i++)
    {
        codes[i] = WoundOf(i);
        if (codes[i] != WOUND_NONE)
            any = TRUE;
        if (codes[i] != h->drawnWound[i])
            pixels = TRUE;
    }
    if (pixels || (h->dirty & BR_HUD_DIRTY_WOUND))
    {
        DrawWound(codes);
        h->dirty &= ~BR_HUD_DIRTY_WOUND;
        pixels = TRUE;
    }
    Present(h->winWound, BR_HUD_SHOWN_WOUND, any, pixels);
}

// ---- ticker -------------------------------------------------------------------

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
    h->winWound = WINDOW_NONE;
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
    h->drawnClock = 0xFFFF;
    h->drawnLeft = 0xFF;
    h->drawnFog = 0xFF;
    for (i = 0; i < PARTY_SIZE; i++)
        h->drawnWound[i] = WOUND_NONE;
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
        Present(h->winBox, BR_HUD_SHOWN_BOX, FALSE, FALSE);
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
    bool8 scriptOn, menuUp;
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
        Drop(&h->winWound, &sWoundTemplate);
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
    if (h->boxFrames > 0)
        h->boxFrames--;
    AdvanceTicker();

    // The field's own message box (window 0) is the sign that InitWindows has run for
    // this map; before that there is no BG0 tilemap buffer to draw into.
    if (gWindows[0].tileData == NULL)
        return;

    live = 0;
    h->winCorner = Ensure(h->winCorner, &sCornerTemplate);
    h->winWound = Ensure(h->winWound, &sWoundTemplate);
    h->winTicker = Ensure(h->winTicker, &sTickerTemplate);
    if (h->winCorner != WINDOW_NONE)
        live++;
    if (h->winWound != WINDOW_NONE)
        live++;
    if (h->winTicker != WINDOW_NONE)
        live++;
    // The box is transient: it holds tiles only while it has something to say, which
    // is also what keeps it clear of the spectator's peek box at the same baseBlock.
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
        h->dirty = BR_HUD_DIRTY_CORNER | BR_HUD_DIRTY_WOUND | BR_HUD_DIRTY_TICKER;
        h->shown = 0;
        h->live = live;
    }

    scriptOn = ScriptContext_IsEnabled();
    menuUp = GetStartMenuWindowId() != WINDOW_NONE;
    // A script's own windows (multichoice, braille, the like) may have cleared our
    // cells on their way out; put every tilemap again once it is over.
    if (h->scriptWas && !scriptOn)
        h->shown = 0;
    h->scriptWas = scriptOn;

    if (h->winCorner != WINDOW_NONE)
        TickCorner(menuUp);
    if (h->winWound != WINDOW_NONE)
        TickWound(menuUp);
    if (h->winTicker != WINDOW_NONE)
        TickTicker(menuUp || scriptOn || !IsFieldMessageBoxHidden());
    TickBox(menuUp || scriptOn || !IsFieldMessageBoxHidden());
}
