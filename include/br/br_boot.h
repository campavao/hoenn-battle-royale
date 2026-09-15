#ifndef GUARD_BR_BOOT_H
#define GUARD_BR_BOOT_H

// Booting straight into the world (POK-221). The page writes gBrMailbox.boot before
// the title screen; the next frame, the ROM skips the intro, the main menu and Birch,
// starts a fresh game with the given name and gender, and warps to the map. Drivers
// use it to start every overworld test from power-on in under a second.

#define BR_BOOT_NONE 0
// Fresh game, warp to boot.map at boot.x/y (map coords, no MAP_OFFSET).
#define BR_BOOT_MAP 1

struct BrBoot
{
    /* 0 */ u8 mode;      // BR_BOOT_*; the ROM clears it once consumed
    /* 1 */ u8 gender;    // MALE / FEMALE
    /* 2 */ u8 mapGroup;
    /* 3 */ u8 mapNum;
    /* 4 */ s16 x;
    /* 6 */ s16 y;
    /* 8 */ u8 name[8];   // Gen 3 charmap, EOS-terminated, PLAYER_NAME_LENGTH + 1
};                        // 16 bytes

void BrBoot_Tick(void);

#endif // GUARD_BR_BOOT_H
