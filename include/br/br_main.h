#ifndef GUARD_BR_MAIN_H
#define GUARD_BR_MAIN_H

#define BR_STRINGIFY_(x) #x
#define BR_STRINGIFY(x) BR_STRINGIFY_(x)

extern u16 gBrMagic;
extern u16 gBrPatchVersion;
extern const u8 gBrVersionString[];

void BrInit(void);

#endif // GUARD_BR_MAIN_H
