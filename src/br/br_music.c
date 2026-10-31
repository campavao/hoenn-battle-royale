// The song the page asks for. See include/br/br_music.h.
#include "global.h"
#include "gba/m4a_internal.h"
#include "m4a.h"
#include "overworld.h"
#include "sound.h"
#include "constants/map_types.h"
#include "constants/songs.h"
#include "br/br_field.h"
#include "br/br_music.h"

// sound/music_player_table.inc's NUM_TRACKS_*.
#define TRACKS_BGM 10
#define TRACKS_SE1 3
#define TRACKS_SE2 9
#define TRACKS_SE3 1

extern struct MusicPlayerTrack gMPlayTrack_BGM[];
extern struct MusicPlayerTrack gMPlayTrack_SE1[];
extern struct MusicPlayerTrack gMPlayTrack_SE2[];
extern struct MusicPlayerTrack gMPlayTrack_SE3[];
extern struct MusicPlayerInfo *gMPlay_PokemonCry;
extern u8 gPokemonCryBGMDuckingCounter;

// In IWRAM, as gBrWildAsk: EWRAM has no room left over its floor (ram-headroom.py).
struct BrMusic gBrMusic;

const struct BrSoundCarry gBrSoundCarry[] =
{
    { &gSoundInfo, sizeof(gSoundInfo) },
    { &gMPlayInfo_BGM, sizeof(gMPlayInfo_BGM) },
    { &gMPlayInfo_SE1, sizeof(gMPlayInfo_SE1) },
    { &gMPlayInfo_SE2, sizeof(gMPlayInfo_SE2) },
    { &gMPlayInfo_SE3, sizeof(gMPlayInfo_SE3) },
    { gMPlayTrack_BGM, sizeof(struct MusicPlayerTrack) * TRACKS_BGM },
    { gMPlayTrack_SE1, sizeof(struct MusicPlayerTrack) * TRACKS_SE1 },
    { gMPlayTrack_SE2, sizeof(struct MusicPlayerTrack) * TRACKS_SE2 },
    { gMPlayTrack_SE3, sizeof(struct MusicPlayerTrack) * TRACKS_SE3 },
    { gCgbChans, sizeof(struct CgbChannel) * 4 },
    { gMPlayMemAccArea, 0x10 },
    { gPokemonCrySongs, sizeof(struct PokemonCrySong) * MAX_POKEMON_CRIES },
    { gPokemonCryMusicPlayers, sizeof(struct MusicPlayerInfo) * MAX_POKEMON_CRIES },
    { gPokemonCryTracks, sizeof(struct MusicPlayerTrack) * MAX_POKEMON_CRIES * 2 },
    { &gPokemonCrySong, sizeof(gPokemonCrySong) },
    { &gMPlay_PokemonCry, sizeof(gMPlay_PokemonCry) },
    { &gPokemonCryBGMDuckingCounter, sizeof(gPokemonCryBGMDuckingCounter) },
    { &gBrMusic, sizeof(gBrMusic) },
    { NULL, 0 },
};

// Overworld_PlaySpecialMapMusic's song, for the page's trainer: GetLocationMusic (which
// knows the story's specials), ROUTE118's halves, then the bike's, the sea floor's or
// SURF's over it. MUS_NONE is silence.
static u16 Want(void)
{
    struct WarpData at;
    u16 music;

    if (gBrMusic.asked & BR_MUSIC_QUIET)
        return MUS_DUMMY;
    at.mapGroup = gBrMusic.mapGroup;
    at.mapNum = gBrMusic.mapNum;
    at.warpId = -1;
    at.x = gBrMusic.x;
    at.y = 0;
    music = GetLocationMusic(&at);
    if (music == MUS_ROUTE118)
        music = gBrMusic.x < 24 ? MUS_ROUTE110 : MUS_ROUTE119;
    if (music == MUS_NONE)
        return MUS_DUMMY;
    if (music == MUS_ABNORMAL_WEATHER)
        return music;
    if (gBrMusic.asked & BR_MUSIC_BIKE)
        return MUS_CYCLING;
    if (Overworld_GetMapHeaderByGroupAndId(gBrMusic.mapGroup, gBrMusic.mapNum)->mapType == MAP_TYPE_UNDERWATER)
        return MUS_UNDERWATER;
    if (gBrMusic.asked & BR_MUSIC_SURF)
        return MUS_SURF;
    return music;
}

static void Start(void)
{
    gBrMusic.waiting = FALSE;
    if (gBrMusic.fadeIn)
        FadeInNewBGM(gBrMusic.playing, gBrMusic.fadeIn);
    else
        PlayBGM(gBrMusic.playing);
}

void BrMusic_Tick(void)
{
    u16 want;
    u8 out;

    if (!gBrMusic.asked || !BrField_OverworldRunning())
        return;
    // The page's sound, once: an SE over the song, or a fanfare in its place (the song
    // comes back from the top once it is done, below).
    if (gBrMusic.sound != 0)
    {
        u16 sound = gBrMusic.sound;

        gBrMusic.sound = 0;
        if (sound & BR_MUSIC_FANFARE)
            PlayFanfare(sound & ~BR_MUSIC_FANFARE);
        else
            PlaySE(sound);
    }
    want = Want();
    if (want != gBrMusic.playing)
    {
        out = gBrMusic.how & 0xF;
        if (out == BR_MUSIC_DOOR)
            out = IsMapTypeIndoors(Overworld_GetMapHeaderByGroupAndId(gBrMusic.mapGroup, gBrMusic.mapNum)->mapType) ? 2 : 4;
        gBrMusic.playing = want;
        gBrMusic.fadeIn = gBrMusic.how >> 4;
        if (out == 0 || IsBGMStopped())
        {
            Start();
        }
        else
        {
            FadeOutBGM(out);
            gBrMusic.waiting = TRUE;
        }
    }
    else if (gBrMusic.waiting)
    {
        if (IsBGMStopped())
            Start();
    }
    // The hidden field put its own town's song on (a screen it came back from):
    // ours again, from the top.
    else if (gMPlayInfo_BGM.songHeader != gSongTable[gBrMusic.playing].header && IsFanfareTaskInactive())
    {
        gBrMusic.fadeIn = 0;
        Start();
    }
    // A fanfare a turn cut short: its task is not carried across the parked state, so
    // nothing would give the song back.
    else if (IsFanfareTaskInactive() && (gMPlayInfo_BGM.status & MUSICPLAYER_STATUS_PAUSE))
    {
        m4aMPlayContinue(&gMPlayInfo_BGM);
    }
}
