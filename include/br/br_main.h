#ifndef GUARD_BR_MAIN_H
#define GUARD_BR_MAIN_H

#define BR_STRINGIFY_(x) #x
#define BR_STRINGIFY(x) BR_STRINGIFY_(x)

extern const u8 gBrVersionString[];

// IntrMain_Buffer's size in words (src/main.c): IntrMain (src/crt0.s), copied there to run
// from IWRAM, is 0x15C bytes, and pret's 0x800-byte buffer left the rest unused. That
// rest is the stack's: it grows down from sp_sys into whatever IWRAM ends with, and BR's
// own IWRAM had cut it to 796 bytes on agbcc. A deep enough frame wrote over gBrTally,
// the last thing there, and the results said WON 769 and STEPS 30608 (Cam, 2026-10-27).
// tools/br/ram-headroom.py holds the stack to a floor and IntrMain to this.
#define BR_INTR_MAIN_WORDS 0x80

void BrInit(void);
void BrFrame(void);
// main.c, the main loop's last call before WaitForVBlank: the frame's work is done.
void BrFrameEnd(void);
// 1 from BrFrame to BrFrameEnd: the main loop is mid-iteration. The page reads RAM at
// each VBlank, and an iteration that runs past one (a map loaded crossing into the next,
// LoadMapFromCameraTransition) leaves it half-written: the map is the new one and the
// position not yet stepped, so the field drew a tile off for two frames (2026-10-07
// play-test: "flashing as I move between routes"). The page holds its last frame then.
extern u8 gBrMidFrame;
// InitHeap (src/malloc.c) has just re-initialised the heap, which CB2_InitBattle does on
// the way into every battle. Every Alloc a module kept is gone: each one lets go here.
void BrHeapReset(void);

#endif // GUARD_BR_MAIN_H
