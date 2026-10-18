// Looking at the fog (POK-263). See include/br/br_map.h.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "task.h"
#include "palette.h"
#include "gpu_regs.h"
#include "bg.h"
#include "menu.h"
#include "constants/rgb.h"
#include "field_screen_effect.h"
#include "field_weather.h"
#include "constants/field_weather.h"
#include "string_util.h"
#include "text.h"
#include "region_map.h"
#include "pokemon.h"
#include "party_menu.h"
#include "constants/moves.h"
#include "br/br_match.h"
#include "br/br_pick.h"
#include "br/br_map.h"
#include "br/br_ring.h"
#include "br/br_field.h"
#include "br/br_gym.h"
#include "br/br_event.h"

EWRAM_DATA struct BrMap gBrMap = {0};

// The START menu row, and the prompt over the map once it is open.
const u8 gBrText_MenuMap[] = _("MAP");
const u8 gBrText_TheFog[] = _("The FOG.");
static const u8 sText_SafeAt[] = _("SAFE: ");

// The prompt names the ring's centre (POK-325), the one place the fog never reaches:
// "SAFE: LITTLEROOT TOWN". It said "FOG: ", which read as the place the fog had taken
// (Cam's 2026-10-14 play-test, POK-359). WIN_FLY_TO_WHERE is 14 tiles, 112 px; a name too
// wide beside the label (VERDANTURF TOWN) goes alone, and one wider still keeps the old
// prompt rather than run off.
const u8 *BrMap_Prompt(void)
{
    if (!gBrRing.active)
        return gBrText_TheFog;
    if (gBrRing.r < 0)
        return gBrText_FogEverywhere;
    if (gBrRing.place[0] == EOS)
        return gBrText_TheFog;
    StringCopy(StringCopy(gStringVar4, sText_SafeAt), gBrRing.place);
    if (GetStringWidth(FONT_NORMAL, gStringVar4, 0) <= 14 * 8)
        return gStringVar4;
    if (GetStringWidth(FONT_NORMAL, gBrRing.place, 0) <= 14 * 8)
        return gBrRing.place;
    return gBrText_TheFog;
}

void BrMap_Init(void)
{
    gBrMap.active = FALSE;
    gBrMap.flier = PARTY_SIZE;
}

bool8 BrMap_Looking(void)
{
    return gBrMap.active;
}

bool8 BrMap_CanFly(void)
{
    return gBrMap.active && gBrMap.flier < PARTY_SIZE;
}

void BrMap_Close(void)
{
    gBrMap.active = FALSE;
}

void BrMap_TakeFlight(void)
{
    // Emerald's fly animation carries whichever mon the party menu had selected
    // (Task_UseFly reads GetCursorSelectionMonId), and nothing selected one: the map
    // was opened from the START menu, not from a mon. So the one that can actually
    // fly is named here, or the bird we leave on is whatever slot 0 happens to be.
    if (gBrMap.flier < PARTY_SIZE)
        gPartyMenu.slotId = gBrMap.flier;
    gBrMap.active = FALSE;
}

// Who in the party knows FLY. PARTY_SIZE for nobody, which leaves the map a look.
static u8 FlierSlot(void)
{
    u8 slot, i;

    for (slot = 0; slot < gPlayerPartyCount && slot < PARTY_SIZE; slot++)
    {
        if (GetMonData(&gPlayerParty[slot], MON_DATA_IS_EGG))
            continue;
        for (i = 0; i < MAX_MON_MOVES; i++)
        {
            if (GetMonData(&gPlayerParty[slot], MON_DATA_MOVE1 + i) == MOVE_FLY)
                return slot;
        }
    }
    return PARTY_SIZE;
}

// The drop picker's way in, and for the same reason: the fly map wants the overworld's
// windows and tilemaps cleaned up before it takes the screen.
static void EnterMap(void)
{
    gMain.state = 0;
    SetMainCallback2(CB2_OpenFlyMap);
}

bool8 BrMap_Open(void)
{
    // Not while the drop's own picker is up, and not before there is a match to look
    // at: the map outside one is Emerald's, and it belongs to Emerald.
    if (gBrMap.active || BrPick_Picking() || gBrMatch.phase != BR_PHASE_PLAY)
        return FALSE;
    if (gMain.callback2 != CB2_Overworld || gMain.inBattle)
        return FALSE;
    if (!BrField_Leave(20, EnterMap))
        return FALSE;
    gBrMap.active = TRUE;
    // Worked out now rather than on the way out: the party cannot change while the
    // map is up, and the answer decides what A does in there.
    gBrMap.flier = FlierSlot();
    return TRUE;
}

// The fog itself (POK-277). POK-263 drew the ring's *edge* as red outline sprites,
// because the fogged area is most of Hoenn and OAM has 128 -- and the play-test read
// the result as markers rather than weather: "instead of red arrows, we should just
// show the purple overlay like we did in Kanto".
//
// So it is shaded instead, and it costs no sprites at all.
//
// The map itself cannot be tinted a cell at a time: BG2 there is an affine background in
// 256 colours (mode 1, region_map.c's sFlyMapBgTemplates), so its tilemap is one byte
// per cell with no palette field to point somewhere else, and there is no room beside
// its 233 tiles for a second, darker copy of them. The overlay goes on BG1 instead --
// the frame layer, a text background with a palette field and nothing of its own over
// the map area -- as one solid tile in one colour, and the hardware blends it with the
// map underneath. A purple overlay, in the literal sense.
#define BR_MAP_FRAME_CELLS (32 * 20)   // the frame's own tilemap, from its top-left cell
#define BR_FOG_PLTT 10                 // a 16-colour slot the map's own palette does not reach
#define BR_FOG_COLOUR RGB(13, 3, 22)   // the overworld's fog weather, in one colour
#define BR_FOG_EVA 10                  // ...and how much of it: 10/16 fog over 6/16 map
#define BR_FOG_EVB 6
// The next ring's circle, on BG0 over everything and out of the blend: white, with a dark
// pixel either side so it reads on the sea's pale blue as well as on the land.
#define BR_RING_PLTT 11
#define BR_RING_WHITE RGB_WHITE
#define BR_RING_EDGE RGB(4, 4, 8)
#define BR_RING_LAST_TILE 0x1FF        // BG0's own char block; BG2's tiles start at block 2
// The blink: a 4x4 ordered dither over the fog tile, sixteen steps in and sixteen out,
// so the cells breathe rather than flick. One breath is 128 frames, about two seconds.
#define BR_BLINK_FRAMES 128
static const u8 sBayer[4][4] = { { 0, 8, 2, 10 }, { 12, 4, 14, 6 }, { 3, 11, 1, 9 }, { 15, 7, 13, 5 } };

// Will the next phase still have the cell? Only when there is a next to ask about.
static bool8 Previewing(void)
{
    return gBrRing.next != gBrRing.r;
}

// `frame` is BG1's tilemap (text, one u16 per cell, 32 a row) and `tiles` its tiles
// (4bpp, 32 bytes each).
void BrMap_ShadeFog(u16 *frame, u8 *tiles, u8 left, u8 top, u8 width, u8 height)
{
    u16 pal[16];
    u16 tile = 0;
    u16 i;
    s16 x, y;

    gBrMap.blinkTile = 0;
    if (!BrMap_Looking() || !gBrRing.active)
        return;
    // A tile of our own, after the last one the frame uses. The frame is 32x20 cells
    // (region_map.c's frame.bin, the screen and no more): below it, BG1's screen block
    // holds whatever the last screen left there, which is not the frame's. It was the
    // field's BG3 tilemap until POK-329 moved that to block 29, and a tile number out of
    // its row 20 made the fog's tile 0x15 in Littleroot -- and 511 or more, no fog at all.
    for (i = 0; i < BR_MAP_FRAME_CELLS; i++)
    {
        if ((frame[i] & 0x3FF) > tile)
            tile = frame[i] & 0x3FF;
    }
    if (tile + 2 >= 256)
        return; // no room before BG2's tilemap: the map stays as it was, not drawing rubbish
    tile++;
    for (i = 0; i < 32; i++)
        tiles[tile * 32 + i] = 0x11; // every pixel colour 1 of whatever palette it is given
    // ...and the one after it for the cells the next ring fogs, which BrMap_BlinkFog fills.
    if (Previewing())
        gBrMap.blinkTile = tile + 1;
    for (i = 0; i < 16; i++)
        pal[i] = BR_FOG_COLOUR;
    LoadPalette(pal, BG_PLTT_ID(BR_FOG_PLTT), sizeof(pal));
    for (y = 0; y < height; y++)
    {
        for (x = 0; x < width; x++)
        {
            if (!BrRing_CellInside(x, y, gBrRing.r))
                frame[(y + top) * 32 + (x + left)] = tile | (BR_FOG_PLTT << 12);
            else if (gBrMap.blinkTile != 0 && !BrRing_CellInside(x, y, gBrRing.next))
                frame[(y + top) * 32 + (x + left)] = gBrMap.blinkTile | (BR_FOG_PLTT << 12);
        }
    }
}

void BrMap_DrawGyms(s16 left, s16 top)
{
    if (BrMap_Looking() || BrPick_Picking())
        BrGym_DrawOnMap(left, top);
    if (BrMap_Looking())
        BrEvent_DrawOnMap(left, top);
}

// The blend the overlay needs: BG1 over BG2 and the backdrop.
void BrMap_BlendFog(void)
{
    if (!BrMap_Looking() || !gBrRing.active)
        return;
    SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG1 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_BG2 | BLDCNT_TGT2_BD);
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(BR_FOG_EVA, BR_FOG_EVB));
}

// One step of the blink, from the fly map's VBlank: the blink tile's pixels on where the
// dither's threshold is under the breath's level, 0 (none) to 16 (all, the fog itself).
void BrMap_BlinkFog(u8 *tiles)
{
    u32 *dst;
    u32 row;
    u8 t, level, x, y;

    if (!BrMap_Looking() || gBrMap.blinkTile == 0)
        return;
    t = gMain.vblankCounter1 % BR_BLINK_FRAMES;
    if (t >= BR_BLINK_FRAMES / 2)
        t = BR_BLINK_FRAMES - 1 - t;
    level = (t * 17) / (BR_BLINK_FRAMES / 2);
    dst = (u32 *)(tiles + gBrMap.blinkTile * 32);
    for (y = 0; y < 8; y++)
    {
        row = 0;
        for (x = 0; x < 8; x++)
        {
            if (sBayer[y & 3][x & 3] < level)
                row |= 1 << (x * 4);
        }
        dst[y] = row;
    }
}

void BrMap_DrawNextRing(u16 *map, u8 *tiles, u16 firstTile, u8 left, u8 top, u8 width, u8 height)
{
    u16 pal[16];
    u32 pixels[8];
    u16 tile = firstTile;
    s32 cx, cy, r, white0, white1, edge0, edge1, d, dx, dy, nearX, nearY, farX, farY;
    s16 x, y, px, py;
    u8 c;
    bool8 any;

    if (!BrMap_Looking() || !gBrRing.active || !Previewing() || gBrRing.next < 0)
        return;
    // In half pixels, so a pixel's centre is a whole number: the ring's centre is its
    // cell's middle, and the circle runs round the outside edge of the cells the next
    // ring keeps -- BrRing_CellInside's r, and the four pixels to its cells' far side.
    cx = ((left + gBrRing.cx) * 8 + 4) * 2;
    cy = ((top + gBrRing.cy) * 8 + 4) * 2;
    r = (gBrRing.next * 8 + 4) * 2;
    white0 = (r - 2) * (r - 2);
    white1 = (r + 2) * (r + 2);
    edge0 = r > 4 ? (r - 4) * (r - 4) : 0;
    edge1 = (r + 4) * (r + 4);
    for (y = 0; y < height; y++)
    {
        for (x = 0; x < width; x++)
        {
            // The cell's nearest and farthest corners from the centre: no ring through it
            // unless the band falls between them.
            px = (left + x) * 16;
            py = (top + y) * 16;
            nearX = cx < px ? px - cx : (cx > px + 16 ? cx - px - 16 : 0);
            nearY = cy < py ? py - cy : (cy > py + 16 ? cy - py - 16 : 0);
            farX = cx - px > px + 16 - cx ? cx - px : px + 16 - cx;
            farY = cy - py > py + 16 - cy ? cy - py : py + 16 - cy;
            if (nearX * nearX + nearY * nearY >= edge1 || farX * farX + farY * farY < edge0)
                continue;
            any = FALSE;
            for (py = 0; py < 8; py++)
            {
                pixels[py] = 0;
                dy = (top + y) * 16 + py * 2 + 1 - cy;
                for (px = 0; px < 8; px++)
                {
                    dx = (left + x) * 16 + px * 2 + 1 - cx;
                    d = dx * dx + dy * dy;
                    if (d >= white0 && d < white1)
                        c = 1;
                    else if (d >= edge0 && d < edge1)
                        c = 2;
                    else
                        continue;
                    pixels[py] |= c << (px * 4);
                    any = TRUE;
                }
            }
            // A window's frame is there already (the place's name, bottom right): it
            // stays on top, as it would over anything else on the map.
            if (!any || map[(top + y) * 32 + left + x] != 0)
                continue;
            if (tile > BR_RING_LAST_TILE)
                break;
            CpuCopy32(pixels, tiles + tile * 32, sizeof(pixels));
            map[(top + y) * 32 + left + x] = tile | (BR_RING_PLTT << 12);
            tile++;
        }
    }
    pal[0] = 0;
    pal[1] = BR_RING_WHITE;
    for (c = 2; c < 16; c++)
        pal[c] = BR_RING_EDGE;
    LoadPalette(pal, BG_PLTT_ID(BR_RING_PLTT), sizeof(pal));
    ScheduleBgCopyTilemapToVram(0);
}
