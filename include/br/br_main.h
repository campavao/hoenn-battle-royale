#ifndef GUARD_BR_MAIN_H
#define GUARD_BR_MAIN_H

#define BR_STRINGIFY_(x) #x
#define BR_STRINGIFY(x) BR_STRINGIFY_(x)

extern const u8 gBrVersionString[];

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
