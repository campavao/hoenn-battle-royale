#ifndef GUARD_BR_MUSIC_H
#define GUARD_BR_MUSIC_H

#include "br/br_config.h"

// The song for where the page's trainer is (spike B, web/spike-b/music.ts). There the
// page owns the overworld and this ROM stands hidden in Littleroot between battles, still
// running, so its sound engine plays the trainer's route: the page says the map, the
// column and whether they SURF or ride the MACH BIKE, and how to get there (the fades
// overworld.c's TransitionMapMusic and bike.c pick), and this plays the song the field
// would have played there (Overworld_PlaySpecialMapMusic's choice). Nothing on the
// cartridge is shipped: the song is the player's ROM's.
//
// The page writes the fields, then asked. While asked is 0 (the live match, a driver)
// this does nothing at all. Only on the field: a battle's own music is the battle's.
#define BR_MUSIC_ASKED 1
#define BR_MUSIC_SURF  2 // on the water: SURF's song
#define BR_MUSIC_BIKE  4 // on the MACH BIKE: the cycling song
#define BR_MUSIC_QUIET 8 // no song (the page's own screens)

// how's low nibble for a door: the old song fades out at 2 going into a building and 4
// coming out (GetMapMusicFadeoutSpeed), and the new one starts at full once it is gone.
#define BR_MUSIC_DOOR 0xF

// sound's top bit: the rest is a fanfare (PlayFanfare), not an SE (PlaySE). The page's
// field plays no sound of its own -- its doors, ledges, walls, pickups and shops are the
// ROM's own sounds, played here on the hidden field (POK-358's parity audit).
#define BR_MUSIC_FANFARE 0x8000

struct BrMusic
{
    /* 0 */ u8 asked;    // page: BR_MUSIC_*, 0 while the page does not drive the music
    /* 1 */ u8 how;      // page: low nibble the old song's fade-out speed, 0 at once;
                         //       high nibble the new one's fade-in speed, 0 at full
    /* 2 */ u8 mapGroup; // page: where its trainer is
    /* 3 */ u8 mapNum;
    /* 4 */ s16 x;       // page: the column (ROUTE118 is two songs, split at 24)
    /* 6 */ u16 playing; // ROM: the song started, or waiting for the old one to fade
    /* 8 */ u8 waiting;  // ROM: the old song is fading out first
    /* 9 */ u8 fadeIn;   // ROM: playing's fade-in speed once it starts
    /* 10 */ u16 sound;   // page: a sound to play once on the field, 0 for none -- an SE
                         //       (constants/songs.h), or with BR_MUSIC_FANFARE a fanfare
                         //       (MUS_OBTAIN_ITEM, MUS_HEAL), which holds the song and gives
                         //       it back; the ROM clears it once it played
};
BR_OFFSET(BrMusic, asked, 0)
BR_OFFSET(BrMusic, how, 1)
BR_OFFSET(BrMusic, mapGroup, 2)
BR_OFFSET(BrMusic, mapNum, 3)
BR_OFFSET(BrMusic, x, 4)
BR_OFFSET(BrMusic, playing, 6)
BR_OFFSET(BrMusic, waiting, 8)
BR_OFFSET(BrMusic, sound, 10)
BR_SIZE(BrMusic, 12)

extern struct BrMusic gBrMusic;

// The sound engine's RAM, as { address, bytes } rows ending in { 0, 0 }. The page puts
// the hidden ROM back to its parked state after anything it ran (a bag, a menu, an item),
// and copies these across it so the song goes on where it was rather than starting over.
struct BrSoundCarry
{
    const void *at;
    u32 size;
};
extern const struct BrSoundCarry gBrSoundCarry[];

// Every frame: the asked song, once the field is running.
void BrMusic_Tick(void);

#endif // GUARD_BR_MUSIC_H
