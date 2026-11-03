// What a trainer looks like doing what the page has no ROM sprites for: in the fog, away with a doll,
// on the bird. Numbers from the ROM's own, the drawing in main.ts.

// ---- poisoned, in the fog -------------------------------------------------------------------
// Cam, 11-02: "when a player is in the fog their sprite also does kind of like a purple little
// almost like poison animation." The field's own poison (fldeff_misc.c) is a mosaic of the map with
// nothing on the sprites, so this is the battle's: battle_anim_scripts.s Status_Poison, a shake and
// the mon blended toward RGB(30, 0, 31), 0 to 12 sixteenths and back, in BeginNormalPaletteFade's
// steps of 2 every 3 frames (delay 2).

/** The colour it goes, RGB(30, 0, 31) in eight bits. */
export const POISON_COLOUR = 'rgb(247, 0, 255)';
/** Status_Poison plays this long: 18 frames up, 18 back. */
const POISON_LEN = 36;
/** And again this often, while they stand in it. */
export const POISON_EVERY = 90;

/** Status_Poison at frame `t` of its loop: how far to the colour, out of 16 (0 for none), and
 *  the shake (AnimTask_ShakeMon2: a pixel each way, every 2 frames). */
export function poisonLook(t: number): { blend: number; dx: number } {
  const at = ((t % POISON_EVERY) + POISON_EVERY) % POISON_EVERY;
  if (at >= POISON_LEN) return { blend: 0, dx: 0 };
  const blend = at < POISON_LEN / 2 ? Math.floor(at / 3) * 2 : 12 - Math.floor((at - POISON_LEN / 2) / 3) * 2;
  return { blend, dx: (at >> 1) & 1 ? 1 : -1 };
}

/** Everybody's on a beat of their own, so a crowd in the fog doesn't pulse as one. */
export function poisonBeat(tick: number, id: number): number {
  return tick + id * 37;
}

// ---- away with a doll ------------------------------------------------------------------------
// Cam, 11-02: "you could put the pookie doll in the tooltip, the pookie doll sprite, and then that
// kind of like blinks or flashes as the player runs away, right within their invulnerability."

/** Whether a trainer who ran shows the doll this frame: while the one they ran from is kept off
 *  them (room.ts shun, br_engage.c's fledFrom), eight frames on and eight off. */
export function dollShows(a: { battling: boolean; shun: number; shunUntil: number }, tick: number, frame: number): boolean {
  return !a.battling && !!a.shun && a.shunUntil > tick && ((frame >> 3) & 1) === 0;
}

// ---- FLY -------------------------------------------------------------------------------------
// field_effect.c's Task_FlyOut and Task_FlyIn, less the party's banner: the bird swoops down over
// the trainer (SpriteCB_FlyBirdSwoopDown), they jump on and it carries them off the top of the
// screen; the screen fades (WarpFadeOutScreen); it swoops in with them over there, they jump off
// (FlyInFieldEffect_JumpOffBird) and it goes on. The room has moved them already: it has no
// flight, and this is what the page makes of the jump.

/** gSineTable's unit circle, as a Sin and Cos of 0..255. */
const sin = (a: number) => Math.sin((a * Math.PI * 2) / 256);
const cos = (a: number) => Math.cos((a * Math.PI * 2) / 256);

/** The swoop: 4 of 256 a frame, gone again at 128. */
export const SWOOP = 32;
/** FlyOutFieldEffect_JumpOnBird: 8 frames in, they jump... */
const JUMP_ON = 8;
/** ...and FlyOffWithBird: 10 more, and they are on it. */
const ON_BIRD = JUMP_ON + 10;
/** The fade out and the fade in, as a warp's. */
export const FADE = 16;
/** The second swoop starts here. */
export const ARRIVES = SWOOP + FADE;
/** They are over their cell at the swoop's lowest (data[2] = 64), where they let go. */
const LET_GO = SWOOP / 2;
/** FlyInFieldEffect_JumpOffBird's sYPositions, from riding to standing. */
const JUMP_OFF = [-2, -4, -5, -6, -7, -8, -8, -8, -7, -7, -6, -5, -3, -2, 0, 2, 4, 8];
/** The whole of it: they are on their feet, and the bird's away. */
export const FLIGHT_LEN = ARRIVES + LET_GO + JUMP_OFF.length;

/** The bird's middle at `t` of a swoop, from the middle of the trainer's sprite (the ROM's
 *  sprite starts at the top of the screen, 72 over them, and Cos(…, 0x8c), Sin(…, 0x48) of it). */
function swoop(t: number): { x: number; y: number } {
  const a = t * 4;
  return { x: cos(a) * 0x8c, y: sin(a) * 0x48 - 0x48 };
}

export interface FlightPose {
  /** The bird's middle, from the middle of the trainer's sprite; null while it's off screen. */
  bird: { x: number; y: number } | null;
  /** Theirs. */
  rider: { x: number; y: number };
  /** Their frame is the one for getting on or off, rather than standing. */
  mounted: boolean;
  /** The end the trainer is at. */
  at: 'from' | 'to';
  /** Hidden: flown out of the picture at one end, or not come yet at the other. */
  gone: boolean;
}

/** Where everything is at frame `t` of a flight. */
export function flightPose(t: number): FlightPose {
  if (t < ARRIVES) {
    const on = t < SWOOP;
    const bird = on ? swoop(t) : null;
    if (t >= ON_BIRD) {
      const b = on ? bird! : swoop(SWOOP);
      return { bird, rider: { x: b.x, y: b.y - 8 }, mounted: true, at: 'from', gone: !on };
    }
    // MOVEMENT_ACTION_JUMP_IN_PLACE_LEFT, up 8 at its middle over the 10 frames to the bird.
    const up = t >= JUMP_ON ? Math.round(sin(((t - JUMP_ON) * 128) / (ON_BIRD - JUMP_ON)) * 8) : 0;
    return { bird, rider: { x: 0, y: up ? -up : 0 }, mounted: t >= JUMP_ON, at: 'from', gone: false };
  }
  const s = t - ARRIVES;
  const bird = s < SWOOP ? swoop(s) : null;
  if (s < LET_GO) {
    const b = swoop(s);
    return { bird, rider: { x: b.x, y: b.y - 8 }, mounted: true, at: 'to', gone: false };
  }
  const off = JUMP_OFF[s - LET_GO];
  return { bird, rider: { x: 0, y: off === undefined ? 0 : off - 8 }, mounted: off !== undefined, at: 'to', gone: false };
}

/** The black over the picture, 0 to 1, for whoever the camera goes with. */
export function flightFade(t: number): number {
  if (t < SWOOP) return 0;
  if (t < ARRIVES) return (t - SWOOP) / FADE;
  if (t < ARRIVES + FADE) return 1 - (t - ARRIVES) / FADE;
  return 0;
}

type Spot = { map: string; x: number; y: number };

/** Whether a trainer's jump from `was` to `now` was a flight. The room's `fly` lands on a town's
 *  own spot with no action under way; nothing else that jumps does (a door is a warp action, a
 *  ferry lands by its own dock, and the Zone's drop is any cell of its map, out of the Zone). */
export function flew(was: Spot, now: Spot, acting: boolean, spots: Readonly<Record<string, readonly [number, number]>>): boolean {
  if (acting || was.map.startsWith('MAP_SAFARI_ZONE')) return false;
  const to = spots[now.map];
  if (!to || to[0] !== now.x || to[1] !== now.y) return false;
  return was.map !== now.map || Math.abs(was.x - now.x) + Math.abs(was.y - now.y) > 2;
}
