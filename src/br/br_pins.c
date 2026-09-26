// The offsets the page reads out of pret's own structs, pinned (POK-331 #22).
//
// web/src/field.ts and touch.ts read gMain, gSaveBlock1Ptr, gFieldCamera, gPaletteFade,
// gObjectEvents, gSprites, gWeather and gBattleBufferA at fixed offsets, and
// web/src/parity.test.ts derives each one from pret's headers: the `/*0x20*/` comments
// where a struct has them, the declarations laid out the way agbcc does where it has
// not. A comment can be wrong and a derivation can miss a rule. These are the compiler's
// word for the same numbers, so a pret merge that moves a field fails the build here,
// and parity.test.ts holds every pin to what it derived.
//
// A bitfield has no offsetof. For one the page reads, the plain fields either side of its
// run are pinned (or the struct's size, where the run ends it): the run is then exactly
// the bytes between them, and within it the bits go in declaration order, the same on
// agbcc and modern GCC, which is what parity.test.ts reads them from.
//
// Nothing here makes code or data: every line is a typedef.
#include "global.h"
#include "main.h"
#include "sprite.h"
#include "palette.h"
#include "field_camera.h"
#include "field_weather.h"
#include "battle.h"
#include "battle_controllers.h"
#include "br/br_config.h"

// gMain: callback2 (MAIN_CALLBACK2); inBattle is in the u8 run straight after state
// (MAIN_IN_BATTLE_BYTE).
BR_OFFSET(Main, callback2, 0x004)
BR_OFFSET(Main, state, 0x438)

// gSaveBlock1Ptr: where we stand (SB1_POS_X/Y), on which map (SB1_MAP_GROUP/NUM), and
// the vars (SB1_VARS).
BR_OFFSET(SaveBlock1, pos, 0x00)
BR_OFFSET(SaveBlock1, location, 0x04)
BR_OFFSET(SaveBlock1, vars, 0x139C)
BR_OFFSET(Coords16, x, 0)
BR_OFFSET(Coords16, y, 2)
BR_OFFSET(WarpData, mapGroup, 0)
BR_OFFSET(WarpData, mapNum, 1)

// gFieldCamera: the sub-tile offset (CAMERA_X/Y).
BR_OFFSET(CameraObject, x, 16)
BR_OFFSET(CameraObject, y, 20)

// gPaletteFade: the palettes it touches (FADE_SELECTED), then nothing but bitfields to the
// end, y in the word at 4 and blendColor and active in the word at 6.
BR_OFFSET(PaletteFadeControl, multipurpose1, 0)
BR_SIZE(PaletteFadeControl, 12)

// gObjectEvents: the stride (OBJ_SIZE), the flags run that fills the first word
// (OBJ_ACTIVE_BYTE, OBJ_INVISIBLE_BYTE, OBJ_PLAYER_BYTE), the sprite and graphics ids
// (OBJ_SPRITE_ID, OBJ_GFX), and the elevation nibbles' byte between the map and the
// coords.
BR_SIZE(ObjectEvent, 0x24)
BR_OFFSET(ObjectEvent, spriteId, 0x04)
BR_OFFSET(ObjectEvent, graphicsId, 0x05)
BR_OFFSET(ObjectEvent, mapGroup, 0x0A)
BR_OFFSET(ObjectEvent, initialCoords, 0x0C)

// gSprites: the stride (SPR_SIZE) and every field field.ts draws a ghost from; the flags
// (SPR_FLAGS) are the u16 run between data and sheetTileStart.
BR_SIZE(Sprite, 0x44)
BR_OFFSET(Sprite, anims, 0x08)
BR_OFFSET(Sprite, x, 0x20)
BR_OFFSET(Sprite, y, 0x22)
BR_OFFSET(Sprite, x2, 0x24)
BR_OFFSET(Sprite, y2, 0x26)
BR_OFFSET(Sprite, centerToCornerVecX, 0x28)
BR_OFFSET(Sprite, centerToCornerVecY, 0x29)
BR_OFFSET(Sprite, animNum, 0x2A)
BR_OFFSET(Sprite, animCmdIndex, 0x2B)
BR_OFFSET(Sprite, data, 0x2E)
BR_OFFSET(Sprite, sheetTileStart, 0x40)
BR_OFFSET(Sprite, subpriority, 0x43)

// gWeather: the weather, the fog's scroll and the blend (WEATHER_CURR, WEATHER_FOG_X,
// WEATHER_EVA, WEATHER_EVB).
BR_OFFSET(Weather, currWeather, 0x6D0)
BR_OFFSET(Weather, fogHScrollPosX, 0x6EE)
BR_OFFSET(Weather, currBlendEVA, 0x730)
BR_OFFSET(Weather, currBlendEVB, 0x732)

// gBattleBufferA: a battler's row (BUFFER_A_ROW), and the move ids leading the struct the
// move menu is sent (CHOOSE_MOVE_MOVES is the controller command's four bytes before it).
STATIC_ASSERT(sizeof(gBattleBufferA[0]) == 0x200, BrPin_gBattleBufferA_row)
BR_OFFSET(ChooseMoveStruct, moves, 0)
