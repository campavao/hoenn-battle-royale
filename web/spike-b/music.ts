// Spike B's route music: what the page tells the hidden ROM about its trainer, so the
// ROM's own sound engine plays the song the field would have there (br_music.h). The
// page says where and on what; the ROM picks the song. This file picks how to get to it,
// the way Emerald does when the song changes:
//
//   a door           the old song fades out (2 into a building, 4 out), then the new one
//                    at full (TryFadeOutOldMapMusic, Overworld_PlaySpecialMapMusic)
//   a map's edge     fade out at 8, then the new one (TransitionMapMusic); on the bike,
//                    out at 4 and the new one faded in at 4
//   onto the bike    fade out at 8, then the cycling song (GetOnOffBike)
//   off the bike     the map's own at once (Overworld_PlaySpecialMapMusic)
//   onto the water   fade out at 8, then SURF's (Overworld_ChangeMusicTo)
//   the first ask    at once, as a map loads
//
// The song only moves on one of those, so `how` holds from one to the next.

// include/br/br_music.h.
export const MUSIC_ASKED = 1, MUSIC_SURF = 2, MUSIC_BIKE = 4, MUSIC_QUIET = 8;
export const HOW_DOOR = 0x0f;
const HOW_FADE = 0x08, HOW_BIKE_EDGE = 0x44;

/** Where the trainer the camera is on stands. `door`: through one, and this is the other
 *  side, where they land. */
export interface Where { group: number; num: number; x: number; surf: boolean; bike: boolean; door: boolean }

/** gBrMusic.sound (br_music.h): the field's own sounds, constants/songs.h's, which the
 *  hidden ROM plays once on its field. A fanfare holds the song and gives it back. */
export const SOUND_FANFARE = 0x8000;
export const SE_SELECT = 5, SE_WIN_OPEN = 6, SE_WALL_HIT = 7, SE_DOOR = 8, SE_EXIT = 9, SE_LEDGE = 10;
export const SE_FIELD_POISON = 79, SE_SHOP = 95;
export const MUS_HEAL = 368 | SOUND_FANFARE, MUS_OBTAIN_ITEM = 370 | SOUND_FANFARE, MUS_OBTAIN_TMHM = 372 | SOUND_FANFARE;

/** gBrMusic's page half. */
export interface MusicAsk { asked: number; how: number; group: number; num: number; x: number }

export class MusicCue {
  private last: Where | null = null;
  private how = 0;
  /** The column the map was come into at: ROUTE118's song is picked as the map loads,
   *  not again as the trainer walks across it. */
  private x = 0;

  /** The ask for now; null when there is nothing to play (no match, no trainer). */
  next(at: Where | null): MusicAsk | null {
    const was = this.last;
    this.last = at;
    if (!at) return null;
    const moved = !was || was.group !== at.group || was.num !== at.num;
    if (moved) this.x = at.x;
    if (!was) this.how = 0;
    else if (at.door && !was.door) this.how = HOW_DOOR;
    else if (at.bike !== was.bike) this.how = at.bike ? HOW_FADE : 0;
    else if (at.surf !== was.surf) this.how = HOW_FADE;
    else if (moved && !at.door && !was.door) this.how = at.bike ? HOW_BIKE_EDGE : HOW_FADE;
    return { asked: MUSIC_ASKED | (at.surf ? MUSIC_SURF : 0) | (at.bike ? MUSIC_BIKE : 0), how: this.how, group: at.group, num: at.num, x: this.x };
  }
}
