/** The black over the game while a match drops us in (Cam's 2026-10-14 play-test,
 *  POK-346: "There's still the little bit of a weird flash at the beginning there").
 *  START showed the town the ROM was standing in, dimmed and half faded, with the HUD
 *  and the ticker drawn over it; then black; then the Safari popping in. Solo showed the
 *  copyright screen first. So the page holds black from the moment a match is on until
 *  the ROM has left the field it was on and come back to the field on the drop map, and
 *  lets go then: the ROM's own fade from black is the one fade anyone sees.
 *
 *  Fed once a frame. "Left the field" counts only once the match is on, so a ROM still on
 *  the copyright screen (solo's boot) and one walking about a town (a room's START) both
 *  come to the same edge. A ROM that never warps -- a page that joined mid-match, one
 *  whose symbols are missing -- is let go after `giveUpMs`. */

export interface CurtainFrame {
  /** gMain.callback2 is CB2_Overworld: the field is running. */
  onField: boolean;
  /** gBrMatch's phase is not BR_PHASE_NONE. */
  inMatch: boolean;
  /** performance.now(). */
  now: number;
}

export const CURTAIN_GIVE_UP_MS = 6000;

export class Curtain {
  private readonly since: number;
  private left = false;
  private lifted = false;

  constructor(now: number, private readonly giveUpMs = CURTAIN_GIVE_UP_MS) {
    this.since = now;
  }

  /** True while the black stays; false from the frame it goes, and for good. */
  step(f: CurtainFrame): boolean {
    if (this.lifted) return false;
    if (f.now - this.since >= this.giveUpMs) return this.lift();
    if (!f.inMatch) return true;
    if (!f.onField) {
      this.left = true;
      return true;
    }
    return this.left ? this.lift() : true;
  }

  private lift(): false {
    this.lifted = true;
    return false;
  }
}
