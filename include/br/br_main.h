#ifndef GUARD_BR_MAIN_H
#define GUARD_BR_MAIN_H

#define BR_STRINGIFY_(x) #x
#define BR_STRINGIFY(x) BR_STRINGIFY_(x)

extern const u8 gBrVersionString[];

void BrInit(void);
void BrFrame(void);
// InitHeap (src/malloc.c) has just re-initialised the heap, which CB2_InitBattle does on
// the way into every battle. Every Alloc a module kept is gone: each one lets go here.
void BrHeapReset(void);

#endif // GUARD_BR_MAIN_H
