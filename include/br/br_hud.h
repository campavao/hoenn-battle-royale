#ifndef GUARD_BR_HUD_H
#define GUARD_BR_HUD_H

#include "br/br_config.h"

// The overworld HUD (POK-226): text windows on BG0 that live only while the
// overworld runs, redrawn from gBrHud every frame something changed.
//
//   corner  cols 20..28, rows 1..3   "N LEFT" and the clock "M:SS" (or a FOG! flash) on
//           (frame 19..29, 0..4)     one line; under them, all ring phase long, where
//                                    the ring is closing -- "VERDANTURF TOWN", or FOG
//                                    EVERYWHERE on the last phase (POK-325) -- and an eye
//                                    and a count while anyone is spectating this trainer
//                                    (POK-233), beside the name or taking turns with it
//   ticker  cols  1..28, rows 17..18 one line of news, 180 frames each, kill feed etc.
//   box     cols  1..28, rows 11..14 the bottom box: a transient two-line message
//                                    (the fog closing in), 90 frames, above the ticker
//
// There was a wound bar under the corner too -- a glyph per party mon, full / hurt /
// fainted -- from POK-226 until the 2026-09-16 play-test: "under the seven left and
// time display there's an empty looking box... I don't think we need that, let's get
// rid of it." Its window slot and its tiles are free now.
//
// Tiles (POK-329). BG0's tiles are char block 2 (0x06008000), and BG2's tilemap at
// screen block 25 (0x0600C800) is the first thing past them once the ring is 512 rows
// tall: **tile 0x240 is the ceiling**. Pret's own overworld windows fill 0x008..0x23C --
// the transient boxes (Safari balls, money, a script's multichoice, the spectator's peek
// box in br_spectate.c) from 0x008, the map-name popup 0x107, yes/no 0x125, the start
// menu 0x139, the message box 0x194..0x1FF, the two frames 0x200 and 0x214, and the
// popup's outline 0x21D..0x23C (a 0x400-byte load, thirty-two tiles). There is no run
// of 195 spare below the ceiling, so the HUD SHARES tiles, and only with the two windows
// that cover it on screen whenever they are up:
//
//   corner  0x139..0x153 (27)  the start menu's head: a start menu of any length covers
//                              all of them, and sits over the corner on screen
//   box     0x154..0x1C3 (112) the start menu's tail (a 5-item menu runs to 0x18C) and
//                              the message box's head (0x194..)
//   ticker  0x1C8..0x1FF (56)  the message box's tail only: pret's longest start menu,
//                              nine items, ends at 0x1C4
//
// Seven are spare, 0x1C4..0x1C7 and 0x23D..0x23F. Nothing here loads graphics: the boxes
// are a PIXEL_FILL of the message-box palette (15) and the text is FONT_SMALL, so every
// map load that re-inits the field's text box (InitTextBoxGfxAndPrinters) also re-arms
// the HUD.
//
// Sharing means handing over. Another BG0 window COVERS a HUD window when it is live
// and its tiles overlap the HUD window's, or its cells and frame meet the HUD window's
// on screen (window 0, the field's message box, lives all the time the field does: it
// covers only while its box is up, or while its first cell is still on the tilemap). On
// the frame a HUD window becomes covered, BrHud_Yield takes its cells off wherever the
// covering window will not draw its own, queues that tilemap, then queues the covering
// window's own pixels into the shared tiles -- in that order, so a DMA split across two
// VBlanks never shows one window's cells over the other's pixels. A covered window is
// not drawn and not put; it is drawn again, frame and all, the frame after the last
// window covering it goes. BrHud_Yield runs at the top of BrHud_Tick and again in
// OverworldBasic just before the frame's tilemap copies, which is the first moment a
// window a task or a script opened that frame can be seen: the start menu puts its cells
// on its third frame and copies its text five frames later, so for those five frames it
// shows its own blank box, not the corner. A HUD window whose first cell is no longer
// its own (somebody's clear took it) is put again.
//
// The engine wipes every window on a map load and before a battle. BrHud_Tick sees
// the windows are gone (tileData NULL or the slot re-used) and re-adds them the next
// overworld frame; it removes them itself when the overworld stops, so the battle's
// own BG0 layout starts clean. Besides being covered, the ticker and the box pause while
// the start menu, a script or a field message is up: the ticker leaves its cells where
// they are, the box takes its own off.
//
// The page writes `left`, `clockSecs` and `flashFog` straight into EWRAM (offsets
// below, mirrored in web/src/net/hud.ts); everything else is the ROM's.

// The corner's window, in tiles (see the tile map above). Nine wide is the widest place
// name, 72 px; the start menu (cols 21..29) covers all but its two left columns, which
// BrHud_Yield takes off while the menu is up.
#define BR_HUD_CORNER_LEFT 20
#define BR_HUD_CORNER_WIDTH 9
#define BR_HUD_CORNER_HEIGHT 3
#define BR_HUD_TICKER_WIDTH 28
#define BR_HUD_TICKER_HEIGHT 2
#define BR_HUD_BOX_WIDTH 28
#define BR_HUD_BOX_HEIGHT 4
#define BR_HUD_TILE_CORNER 0x139
#define BR_HUD_TILE_BOX 0x154
#define BR_HUD_TILE_TICKER 0x1C8
// BG2's tilemap at screen block 25 is where BG0's tiles end (POK-329).
#define BR_HUD_TILE_CEILING 0x240
// A name and an eye too wide to share the corner's second line take turns on it.
#define BR_HUD_ALT_FRAMES 120

// Six, not eight: eighteen seconds of backlog at 180 frames a line is already more
// than anyone reads, and EWRAM is at 99.9%.
#define BR_HUD_QUEUE 6
#define BR_HUD_LINE_MAX 40
#define BR_HUD_LINE_FRAMES 180
#define BR_HUD_BOX_FRAMES 90
#define BR_HUD_FOG_FRAMES 60

// gBrHud.shown: whose tilemap cells are ours on screen right now.
#define BR_HUD_SHOWN_CORNER 1
#define BR_HUD_SHOWN_TICKER 2
#define BR_HUD_SHOWN_BOX 4
// gBrHud.dirty: a window's pixels must be redrawn.
#define BR_HUD_DIRTY_CORNER 1
#define BR_HUD_DIRTY_TICKER 2
#define BR_HUD_DIRTY_BOX 4

// Ticker line kinds, as BR_MSG_TICKER carries them.
#define BR_HUD_KIND_SYSTEM 0
#define BR_HUD_KIND_KILL 1
#define BR_HUD_KIND_SAY 2

struct BrHudLine
{
    /* 0 */ u8 kind;          // BR_HUD_KIND_*
    /* 1 */ u8 len;           // text bytes, <= BR_HUD_LINE_MAX
    /* 2 */ u8 text[42];      // Gen 3 charmap, EOS-terminated
};                            // 44 bytes
BR_OFFSET(BrHudLine, kind, 0)
BR_OFFSET(BrHudLine, len, 1)
BR_OFFSET(BrHudLine, text, 2)
BR_SIZE(BrHudLine, 44)

struct BrHud
{
    /* 0x00 */ u8 left;          // PAGE WRITES: trainers still in the match
    /* 0x01 */ u8 flashFog;      // PAGE WRITES 1: the ROM clears it and flashes FOG! for 60 frames
    /* 0x02 */ u16 clockSecs;    // PAGE WRITES: seconds; the ROM counts it down once per 60 frames
    /* 0x04 */ u8 clockFrames;   // 0..59, the local second in progress
    /* 0x05 */ u8 fogFrames;     // FOG! flash frames left
    /* 0x06 */ u8 winCorner;     // window ids, WINDOW_NONE (0xFF) while absent
    /* 0x07 */ u8 winTicker;
    /* 0x08 */ u8 live;          // how many of the two standing windows exist, 0..2
    /* 0x09 */ u8 shown;         // BR_HUD_SHOWN_* bits
    /* 0x0A */ u8 queueLen;      // 0..BR_HUD_QUEUE; queue[0] is the line on screen
    /* 0x0B */ u8 lineFrames;    // frames queue[0] has been up
    /* 0x0C */ u8 held;          // heldLine is up and outranks the queue
    /* 0x0D */ u8 dirty;         // BR_HUD_DIRTY_* bits
    /* 0x0E */ u8 scriptWas;     // ScriptContext_IsEnabled on the last tick
    /* 0x0F */ u8 eyes;          // PAGE WRITES: spectators watching this trainer
    /* 0x10 */ u16 drawnClock;   // what the corner last drew
    /* 0x12 */ u8 drawnLeft;
    /* 0x13 */ u8 drawnFog;      // 0 clock, 1 flash-off, 2 flash-on
    /* 0x14 */ u8 drawnEyes;     // what the corner last drew
    /* 0x15 */ u8 popupWas;      // the map-name popup was up on the last tick
    /* 0x16 */ u8 altFrames;     // 0..2*BR_HUD_ALT_FRAMES-1: the name's turn, then the eye's
    /* 0x17 */ u8 drawnAlt;      // 0 both fit, 1 name drawn, 2 eye drawn
    /* 0x18 */ struct BrHudLine heldLine;             // 44 bytes
    /* 0x44 */ struct BrHudLine queue[BR_HUD_QUEUE];  // 264 bytes
    /* 0x14C */ struct BrHudLine box;                 // 44 bytes, the bottom box
    /* 0x178 */ u8 boxFrames;   // frames the box has left, 0 = none
    /* 0x179 */ u8 winBox;      // window id, WINDOW_NONE while absent
    /* 0x17A */ u8 boxPad[2];
    /* 0x17C */
};

// The page writes the four PAGE WRITES fields (web/src/net/hud.ts); drivers read the rest.
// BR_HUD_OFF_HELD and _QUEUE said 0x1C and 0x48 here, four bytes past both, and nothing
// read them (POK-330 #32): the pins are the offsets now.
BR_OFFSET(BrHud, left, 0x00)
BR_OFFSET(BrHud, flashFog, 0x01)
BR_OFFSET(BrHud, clockSecs, 0x02)
BR_OFFSET(BrHud, fogFrames, 0x05)
BR_OFFSET(BrHud, live, 0x08)
BR_OFFSET(BrHud, shown, 0x09)
BR_OFFSET(BrHud, queueLen, 0x0A)
BR_OFFSET(BrHud, held, 0x0C)
BR_OFFSET(BrHud, eyes, 0x0F)
BR_OFFSET(BrHud, drawnEyes, 0x14)
BR_OFFSET(BrHud, heldLine, 0x18)
BR_OFFSET(BrHud, queue, 0x44)
BR_OFFSET(BrHud, box, 0x14C)
BR_OFFSET(BrHud, boxFrames, 0x178)
BR_SIZE(BrHud, 0x17C)

extern struct BrHud gBrHud;

void BrHud_Init(void);
// Every frame from BrFrame. Creates, redraws and removes the windows as the overworld
// comes and goes; the clock and the ticker timer run only while it is running.
void BrHud_Tick(void);
// Hands a HUD window's shared tiles over to a window that has just come up over it (see
// the tile map above). From BrHud_Tick, and from OverworldBasic just before the frame's
// tilemap copies. Does nothing off the overworld.
void BrHud_Yield(void);
// Queue a system line for the ticker (EOS-terminated Gen 3 text, cut at 40 bytes).
// The oldest queued line goes if the queue is full.
void BrHud_Say(const u8 *text);
// A held line: shown at once and kept until BrHud_Release; queued news waits behind
// it (the Kanto rule: a held line outranks the feed).
void BrHud_Hold(const u8 *text);
void BrHud_Release(void);
// The bottom box: a two-line message over the field for 90 frames, above the ticker
// and out of the way of both it and the corner. CHAR_NEWLINE splits the two lines.
void BrHud_Box(const u8 *text);
// StringCopy for a line built on the stack from names out of a table: copies src up to
// its EOS or to `last`, the buffer's last byte, and ends it there either way. Returns the
// EOS, as StringCopy does. A name one letter longer than the table has today would
// otherwise write past the line (POK-330 #55).
u8 *BrHud_Append(u8 *dst, const u8 *last, const u8 *src);

#endif // GUARD_BR_HUD_H
