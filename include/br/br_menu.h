#ifndef GUARD_BR_MENU_H
#define GUARD_BR_MENU_H

#include "br/br_config.h"

// The start menu, as the page's PARTY and MAP buttons drive it (web/src/ui/hud.ts). The
// page presses START, walks the cursor to the row it wants with UP and DOWN, and presses
// A -- the keys a thumb would press, through HandleStartMenuInput. What it needs to read
// is static in start_menu.c, so these point at it: which rows the menu has (MENU_ACTION_*
// each, start_menu.c's enum), where the cursor is, and the input handler, which
// gMenuCallback is while the menu takes keys.
struct BrStartMenu
{
    /* 0x0 */ const u8 *cursor;     // sStartMenuCursorPos
    /* 0x4 */ const u8 *count;      // sNumStartMenuActions
    /* 0x8 */ const u8 *actions;    // sCurrentStartMenuActions
    /* 0xC */ bool8 (*input)(void); // HandleStartMenuInput
};
BR_OFFSET(BrStartMenu, cursor, 0x0)
BR_OFFSET(BrStartMenu, count, 0x4)
BR_OFFSET(BrStartMenu, actions, 0x8)
BR_OFFSET(BrStartMenu, input, 0xC)
BR_SIZE(BrStartMenu, 0x10)

extern const struct BrStartMenu gBrStartMenu;

#endif // GUARD_BR_MENU_H
