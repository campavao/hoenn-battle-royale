#ifndef GUARD_BR_HUD_H
#define GUARD_BR_HUD_H

#include "br/br_config.h"

// The overworld HUD (POK-226): three text windows on BG0 that live only while the
// overworld runs, redrawn from gBrHud every frame something changed.
//
//   corner  cols 24..29, rows 0..2   "N LEFT" over the clock "M:SS" (or a FOG! flash),
//                                    with an eye and a count left of the clock while
//                                    anyone is spectating this trainer (POK-233)
//   wound   cols 24..29, rows 3..4   one glyph per party mon: full / hurt / fainted
//   ticker  cols  1..28, rows 18..19 one line of news, 180 frames each, kill feed etc.
//   box     cols  1..28, rows 14..17  the bottom box: a transient two-line message
//                                     (the fog closing in), 90 frames, above the ticker
//
// Tiles: the corner is at baseBlock 0x23A, the wound bar at 0x24C, the ticker at
// 0x258..0x293, the bottom box at 0x294..0x303 (shared with the spectator's peek box,
// which only a player who is out ever opens -- and they get no bottom box while they
// are watching somebody else's screen). The overworld's BG0 already uses 0x008 (Safari balls), 0x107 (map
// name), 0x125 (yes/no), 0x139 (start menu), 0x194 (message box), 0x200/0x214 (the
// two frames) and 0x21D..0x23A (the map-name frame edges); 0x23A on is free up to the
// tilemap at 0x3C0. Nothing here loads graphics: the boxes are a PIXEL_FILL of the
// message-box palette (15) and the text is FONT_SMALL, so every map load that
// re-inits the field's text box (InitTextBoxGfxAndPrinters) also re-arms the HUD.
//
// The engine wipes every window on a map load and before a battle. BrHud_Tick sees
// the windows are gone (tileData NULL or the slot re-used) and re-adds them the next
// overworld frame; it removes them itself when the overworld stops, so the battle's
// own BG0 layout starts clean. While the start menu is up the corner and the wound
// bar are left alone (the menu draws over them and clears the cells when it closes);
// the ticker is likewise left alone while a field message box or a script is up.
// The tilemap is put again on the way back, never cleared while another window owns
// the cells.
//
// The page writes `left`, `clockSecs` and `flashFog` straight into EWRAM (offsets
// below, mirrored in web/src/net/hud.ts); everything else is the ROM's.

// Six, not eight: eighteen seconds of backlog at 180 frames a line is already more
// than anyone reads, and EWRAM is at 99.9%.
#define BR_HUD_QUEUE 6
#define BR_HUD_LINE_MAX 40
#define BR_HUD_LINE_FRAMES 180
#define BR_HUD_BOX_FRAMES 90
#define BR_HUD_FOG_FRAMES 60

// gBrHud.shown: whose tilemap cells are ours on screen right now.
#define BR_HUD_SHOWN_CORNER 1
#define BR_HUD_SHOWN_WOUND 2
#define BR_HUD_SHOWN_TICKER 4
#define BR_HUD_SHOWN_BOX 8
// gBrHud.dirty: a window's pixels must be redrawn.
#define BR_HUD_DIRTY_CORNER 1
#define BR_HUD_DIRTY_WOUND 2
#define BR_HUD_DIRTY_TICKER 4
#define BR_HUD_DIRTY_BOX 8

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

struct BrHud
{
    /* 0x00 */ u8 left;          // PAGE WRITES: trainers still in the match
    /* 0x01 */ u8 flashFog;      // PAGE WRITES 1: the ROM clears it and flashes FOG! for 60 frames
    /* 0x02 */ u16 clockSecs;    // PAGE WRITES: seconds; the ROM counts it down once per 60 frames
    /* 0x04 */ u8 clockFrames;   // 0..59, the local second in progress
    /* 0x05 */ u8 fogFrames;     // FOG! flash frames left
    /* 0x06 */ u8 winCorner;     // window ids, WINDOW_NONE (0xFF) while absent
    /* 0x07 */ u8 winWound;
    /* 0x08 */ u8 winTicker;
    /* 0x09 */ u8 live;          // how many of the three windows exist right now, 0..3
    /* 0x0A */ u8 shown;         // BR_HUD_SHOWN_* bits
    /* 0x0B */ u8 queueLen;      // 0..BR_HUD_QUEUE; queue[0] is the line on screen
    /* 0x0C */ u8 lineFrames;    // frames queue[0] has been up
    /* 0x0D */ u8 held;          // heldLine is up and outranks the queue
    /* 0x0E */ u8 dirty;         // BR_HUD_DIRTY_* bits
    /* 0x0F */ u8 scriptWas;     // ScriptContext_IsEnabled on the last tick
    /* 0x10 */ u16 drawnClock;   // what the corner last drew
    /* 0x12 */ u8 drawnLeft;
    /* 0x13 */ u8 drawnFog;      // 0 clock, 1 flash-off, 2 flash-on
    /* 0x14 */ u8 drawnWound[6]; // glyph per slot as last drawn: 0 none 1 fainted 2 hurt 3 full
    /* 0x1A */ u8 eyes;          // PAGE WRITES: spectators watching this trainer
    /* 0x1B */ u8 drawnEyes;     // what the corner last drew
    /* 0x1C */ struct BrHudLine heldLine;             // 44 bytes
    /* 0x48 */ struct BrHudLine queue[BR_HUD_QUEUE];  // 264 bytes
    /* 0x150 */ struct BrHudLine box;                 // 44 bytes, the bottom box
    /* 0x17C */ u8 boxFrames;   // frames the box has left, 0 = none
    /* 0x17D */ u8 winBox;      // window id, WINDOW_NONE while absent
    /* 0x17E */ u8 boxPad[2];
    /* 0x180 */
};

#define BR_HUD_OFF_HELD 0x1C
#define BR_HUD_OFF_QUEUE 0x48

extern struct BrHud gBrHud;

void BrHud_Init(void);
// Every frame from BrFrame. Creates, redraws and removes the windows as the overworld
// comes and goes; the clock and the ticker timer run only while it is running.
void BrHud_Tick(void);
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

#endif // GUARD_BR_HUD_H
