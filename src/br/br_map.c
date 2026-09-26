// Looking at the fog (POK-263). See include/br/br_map.h.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "task.h"
#include "palette.h"
#include "gpu_regs.h"
#include "constants/rgb.h"
#include "field_screen_effect.h"
#include "field_weather.h"
#include "constants/field_weather.h"
#include "region_map.h"
#include "pokemon.h"
#include "party_menu.h"
#include "constants/moves.h"
#include "br/br_match.h"
#include "br/br_pick.h"
#include "br/br_map.h"
#include "br/br_ring.h"
#include "br/br_field.h"

EWRAM_DATA struct BrMap gBrMap = {0};

// The START menu row, and the prompt over the map once it is open.
const u8 gBrText_MenuMap[] = _("MAP");
const u8 gBrText_TheFog[] = _("The FOG.");

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
#define BR_FOG_PLTT 10                 // a 16-colour slot the map's own palette does not reach
#define BR_FOG_COLOUR RGB(13, 3, 22)   // the overworld's fog weather, in one colour
#define BR_FOG_EVA 10                  // ...and how much of it: 10/16 fog over 6/16 map
#define BR_FOG_EVB 6

// `frame` is BG1's tilemap (text, one u16 per cell, 32 a row) and `tiles` its tiles
// (4bpp, 32 bytes each).
void BrMap_ShadeFog(u16 *frame, u8 *tiles, u8 left, u8 top, u8 width, u8 height)
{
    u16 pal[16];
    u16 tile = 0;
    u16 i;
    s16 x, y;

    if (!BrMap_Looking() || !gBrRing.active)
        return;
    // A tile of our own, after the last one the frame uses.
    for (i = 0; i < 32 * 21; i++)
    {
        if ((frame[i] & 0x3FF) > tile)
            tile = frame[i] & 0x3FF;
    }
    if (++tile >= 512)
        return; // no room: the map stays as it was rather than drawing rubbish
    for (i = 0; i < 32; i++)
        tiles[tile * 32 + i] = 0x11; // every pixel colour 1 of whatever palette it is given
    for (i = 0; i < 16; i++)
        pal[i] = BR_FOG_COLOUR;
    LoadPalette(pal, BG_PLTT_ID(BR_FOG_PLTT), sizeof(pal));
    for (y = 0; y < height; y++)
    {
        for (x = 0; x < width; x++)
        {
            if (BrRing_CellInside(x, y))
                continue;
            frame[(y + top) * 32 + (x + left)] = tile | (BR_FOG_PLTT << 12);
        }
    }
}

// The blend the overlay needs: BG1 over BG2 and the backdrop.
void BrMap_BlendFog(void)
{
    if (!BrMap_Looking() || !gBrRing.active)
        return;
    SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG1 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_BG2 | BLDCNT_TGT2_BD);
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(BR_FOG_EVA, BR_FOG_EVB));
}
