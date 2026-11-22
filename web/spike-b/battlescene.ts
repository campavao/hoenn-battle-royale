// What a watcher's battle screen shows at some moment of a battle log (battlelog.ts): the pure
// half of battleview.ts, with no canvas in it, so the unit tests can pin it.
//
// The screen is Emerald's battle (240 x 160): the far mon's front picture and the near mon's
// back picture on their platforms, a health box for each, the message box under them. The
// log says what happened and for how long (eventMs); this says where everything stands
// while one event plays: how far a bar has drained, whether a mon is blinking from a hit,
// how many letters of a line are on the screen.

import { eventMs, stateAt, type BattleEvent, type LogMon, type LogState, type Side } from './shared/battlelog';
import { wrapText } from '../src/ui/emerald';
import type { BattleEnv } from './romart';

export const W = 240;
export const H = 160;

/** Which of the two a side is on the screen. The near one has its back to us. */
export type Slot = 'near' | 'far';

/** Side 0 is the near one unless the watcher follows side 1 (battlelog.ts LogSide): the one
 *  followed is the one with its back to the camera, as in their own fight. */
export function slotOf(side: Side, follow: Side): Slot {
  return side === follow ? 'near' : 'far';
}

export function sideOf(slot: Slot, follow: Side): Side {
  return slot === 'near' ? follow : follow === 0 ? 1 : 0;
}

/** Device pixels per GBA pixel are a whole number, so the picture stays crisp, and the CSS size
 *  is that over the device pixel ratio: 320 CSS px wide of a 3x phone is four times over. Never
 *  under one device pixel a pixel. */
export function fitScale(width: number, height: number, dpr = 1): number {
  const d = Math.max(1, dpr);
  const whole = Math.floor(Math.min((width * d) / W, (height * d) / H));
  return Math.max(1, whole) / d;
}

// ---- where a fight is ----------------------------------------------------------------

/** Which ground the fight is on, from the map's name (GetBattleEnvironment reads the tile under
 *  the player, which the log does not carry): a building inside, water on a sea route, a cave, grass
 *  in the open. */
export function envFor(map: string): BattleEnv {
  const m = map.replace(/^MAP_/, '');
  if (/UNDERWATER|SEAFLOOR/.test(m)) return 'underwater';
  if (/GYM/.test(m)) return 'gym';
  if (/MT_CHIMNEY|MT_PYRE|JAGGED_PASS|FIERY_PATH|METEOR_FALLS|SKY_PILLAR/.test(m)) return 'mountain';
  if (/CAVE|TUNNEL|CHAMBER|CAVERN|GROTTO|PASSAGE|RUINS|HIDEOUT|ABANDONED_SHIP|SHOAL|VICTORY_ROAD|TERRA|UNDERPASS/.test(m)) return 'cave';
  if (/(^|_)(\d+F|B\d+F|HOUSE|CENTER|MART|LAB|HALL|SHOP|ROOM|STATION|MUSEUM|COMPANY|FACTORY|OFFICE|STORE|DAY_CARE|GAME_CORNER|TRAINER_HILL|LOBBY|INTERIOR|HQ)(_|$)/.test(m)) return 'building';
  const route = /^ROUTE(\d+)/.exec(m);
  if (route) {
    const n = Number(route[1]);
    if ([105, 106, 107, 108, 109, 122, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134].includes(n)) return 'water';
    if (n === 111 || n === 113) return 'sand';
    return 'grass';
  }
  if (/_(TOWN|CITY)$/.test(m)) return 'plain';
  return 'grass';
}

// ---- time ------------------------------------------------------------------------------

/** How long a letter takes to come onto the message box, in ms: Emerald's MID text speed
 *  prints a letter every 4 frames of a 60 Hz screen, and its FAST one every frame; this is a
 *  watcher's pace between them, so a line is read at the pace the log holds it for. */
export const CHAR_MS = 28;
/** The width a line of the box has to run in (B_WIN_MSG is 26 tiles wide, the window's own
 *  edge to edge), in the font's pixels. */
export const LINE_W = 208;

/** The playhead after `dt` more ms: on through the log and no further, so a live fight that has
 *  not said its next turn yet is waited for, not run past. */
export function advance(t: number, dt: number, total: number): number {
  return Math.min(total, t + Math.max(0, dt));
}

/** `text` as the lines the message box sets it in. */
export function boxLines(text: string): string[] {
  // A line the words already break (Emerald's strings carry their own "\n") keeps its break.
  return text.split('\n').flatMap((part) => wrapText(part, LINE_W));
}

/** The lines on show when `chars` letters of `text` have printed: two at a time, the second
 *  line coming under the first and a third pushing the first off, as a message box scrolls. */
export function revealed(text: string, chars: number): string[] {
  const lines = boxLines(text);
  let left = Math.max(0, Math.floor(chars));
  const shown: string[] = [];
  for (const line of lines) {
    if (left <= 0) break;
    shown.push(line.slice(0, left));
    left -= line.length + 1;
  }
  return shown.slice(-2);
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeIn = (t: number) => t * t;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** How long a blink from a hit runs, and how long each half of it. */
export const BLINK_MS = 480;
export const BLINK_STEP = 60;
/** How much of a hold the bar takes to drain; the rest is the pause after it. */
const DRAIN = 0.85;
/** How much of a hold a mon takes to come out of its ball, to sink when it faints, to go back. */
const APPEAR = 0.55;
const SINK = 0.6;
/** And how much of the start's hold the trainers take to slide in, and of a send-out's to slide off. */
const SLIDE_IN = 0.6;
const SLIDE_OUT = 0.5;
/** How far, in screen pixels, a trainer slides from: off the edge. */
export const SLIDE = 240;

export interface SideScene {
  side: Side;
  /** The trainer's name and look. */
  name: string;
  skin: number;
  /** The ROM's trainer picture over the skin's (LogSide `pic`). */
  pic?: number;
  /** Their picture's place: how far it is from where it stands, in pixels, away from the middle
   *  (negative for the near trainer, who slides from the left); null when it is not on the screen
   *  (before the start, or once their first mon is out). */
  trainerDx: number | null;
  /** A wild POKeMON's side: no trainer, and the mon there from the start. */
  wild: boolean;
  /** How far the mon is from where it stands, as `trainerDx`: a wild one slides in as they do. */
  monDx: number;
  /** The mon on the field, and its place in the team; null for none. */
  mon: LogMon | null;
  slot: number;
  /** Its HP as the bar shows it now (draining), and the status it wears. */
  hp: number;
  status: number;
  /** 0..1: a mon coming out of its ball (1 is out). */
  appear: number;
  /** 0..1: going back (shrinking away) or sinking, with which. */
  vanish: number;
  leave: 'back' | 'faint' | null;
  /** The mon is hidden this frame: a hit's blink. */
  blink: boolean;
  /** 0..1: how far a wild mon has gone into a ball thrown at it (1: in it, not drawn). */
  inBall: number;
}

/** A ball thrown at the wild mon, while it is on the screen (Cam, 11-21: "the ball-throw animation
 *  does not play"). The view puts it in its place: along the throw's arc, at the mon, on the ground
 *  under it. */
export interface BallScene {
  /** 0..1 along the arc from the near side's corner to the far mon (1: there). */
  fly: number;
  /** 0..1 from the mon's middle down to the ground under it, once the mon is in. */
  drop: number;
  /** A shake's lean, -1 (left) .. 1 (right); 0 standing. */
  tilt: number;
  /** The ball is open: the mon going in, or out again. */
  open: boolean;
  /** Which ball: the MASTER BALL's or the ROYALé BALL's (every other ball is one, br_items.c). */
  master: boolean;
}

/** The line said as a ball is thrown ("SINBAD used ROYALé BALL!", the simulator's "used ROYALE
 *  BALL!", "used SAFARI BALL!"): STRINGID_PLAYERUSEDITEM with a ball for the item. */
export const THROW_LINE = /\bused\b.*\bBALL!$/;
/** What comes after: caught (sText_GotchaPkmnCaughtPlayer), or out again (the four lines of
 *  sBallCaughtStrings' shakes, and a ball turned away). */
const CAUGHT_LINE = /^Gotcha!/;
const FREE_LINE = /^(Oh, no!|Aww!|Aargh!|Shoot!)|blocked the BALL|dodged the thrown BALL/;
/** How much of the throw's line the ball takes to fly, the mon to go in, the ball to drop. */
const FLY = 0.35;
const TAKE = 0.25;
const DROP = 0.2;
/** How much of the line that frees it the mon takes to come back out. */
const FREE = 0.4;
/** A shake while the fight is waited on (the ROM is shaking it): one lean and back a second. */
export const SHAKE_MS = 1000;
const SHAKE_FOR = 0.4;

/** A ball's lean `ms` into the shakes: a lean left, right and back in the first part of each
 *  second, then still. */
export function shakeAt(ms: number): number {
  const p = (ms % SHAKE_MS) / SHAKE_MS;
  // (+ 0: never a -0 to stand still on.)
  return p < SHAKE_FOR ? -Math.sin((p / SHAKE_FOR) * Math.PI * 2) + 0 : 0;
}

/** The screen has waited this long on a live fight before it says so. */
export const WAIT_LINE_MS = 1500;
/** The dots of the line come one by one, one every this many ms. */
const DOT_MS = 400;

/** What the message box says while a live fight is waited on ("SINBAD is choosing..."): its
 *  dots run, so the screen is seen not to have stopped. `name` is the trainer watched. */
export function waitLine(name: string, waited: number): string {
  const dots = '.'.repeat(1 + (Math.floor(waited / DOT_MS) % 3));
  return name ? `${name} is choosing${dots}` : `Waiting${dots}`;
}

export interface Scene {
  /** The playhead, and the index of the event playing at it (`log.length` for none). */
  ms: number;
  next: number;
  ev: BattleEvent | null;
  /** How far into that event, in ms and as a fraction of its hold. */
  elapsed: number;
  p: number;
  /** Everything before that event: the state a late joiner is dropped into. */
  state: LogState;
  near: SideScene;
  far: SideScene;
  map: string;
  /** The line in the message box, and how many of its letters have printed. */
  text: string;
  chars: number;
  /** The last event has played and the fight is over; or the log has run out with it not (a
   *  live fight between turns: the screen waits). */
  ended: boolean;
  waiting: boolean;
  /** A ball thrown at the wild mon, on the screen now; null for none. */
  ball: BallScene | null;
}

/** The intro line, said by the far trainer: "<name> would like to battle!". */
export function introLine(farName: string): string {
  return `${farName} would like to battle!`;
}

/** A line of a log as it reads for a watcher following side 1. A log says things from side 0's
 *  seat: its mons bare, side 1's "Foe X", "Go! X!" for side 0's send-out and "NAME sent out X!" for
 *  side 1's, "Your team" and "Foe's team". So this turns those round: "Foe X" goes bare, and a name
 *  of side 0's team with no "Foe" before it gets one. (Both sides can have the same species, which
 *  the "Foe" in the line tells apart. A name only side 1 has, bare, is side 1's: leave it.)
 *  `trainers` and `names` are [side 0, side 1]. */
export function readsFor(text: string, trainers: readonly [string, string], names: readonly [readonly string[], readonly string[]]): string {
  if (text.startsWith('Go! ')) return `${trainers[0]} sent out ${text.slice(4)}`;
  if (text.startsWith(`${trainers[1]} sent out `)) return `Go! ${text.slice(trainers[1].length + 10)}`;
  const team = text.replace(/\bFoe's team\b|\bYour team\b/g, (m) => (m === 'Your team' ? "Foe's team" : 'Your team'));
  const theirs = new Set(names[0]);
  const all = [...new Set([...names[0], ...names[1]])].filter(Boolean).sort((a, b) => b.length - a.length);
  // A name on its own, not the end of a longer word: "ABRA" in "KADABRA" is no ABRA.
  const pick = new RegExp(`(^|[^A-Za-z0-9.'])(Foe )?(${all.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') || '$^'})(?![A-Za-z0-9'])`, 'g');
  return team.replace(pick, (_m, before: string, foe: string | undefined, name: string) => `${before}${!foe && theirs.has(name) ? 'Foe ' : ''}${name}`).replace(/\bFoe (?=\S)(?!(?:'|[a-z]))/g, (m, at: number, s: string) => (all.some((n) => s.startsWith(n, at + 4)) ? m : ''));
}

/** The scene `ms` into `log` for a watcher following side `follow`. `waited` is how long the
 *  screen has stood at the end of a live log (the playhead does not move then): what the wait
 *  shows runs on it. */
export function sceneAt(log: readonly BattleEvent[], ms: number, follow: Side = 0, waited = 0): Scene {
  const { state, next } = stateAt(log, ms);
  let at = 0;
  for (let i = 0; i < next; i++) at += eventMs(log[i]);
  const ev = next < log.length ? log[next] : null;
  const elapsed = ev ? Math.max(0, ms - at) : 0;
  const p = ev ? clamp01(elapsed / eventMs(ev)) : 1;
  const sent: [boolean, boolean] = [false, false];
  for (let i = 0; i < next; i++) {
    const e = log[i];
    if (e.e === 'send') sent[e.side] = true;
  }
  // The sides, from the start that is playing or has played.
  const sides = ev?.e === 'start' ? { a: ev.a, b: ev.b } : { a: state.a, b: state.b };
  const sideScene = (side: Side): SideScene => {
    const ls = side === 0 ? sides.a : sides.b;
    const mine = ev && 'side' in ev && ev.side === side ? ev : null;
    const dir = slotOf(side, follow) === 'near' ? -1 : 1;
    const wild = !!ls?.wild;
    // Nobody sends a wild one out: it is there until the log has it sent, and the sending shows nothing.
    let slot = wild && !sent[side] ? 0 : state.active[side];
    let appear = 1, vanish = 0, blink = false;
    let leave: SideScene['leave'] = null;
    let trainerDx: number | null = ls && !sent[side] && !wild ? 0 : null;
    let monDx = 0;
    if (ev?.e === 'start' && ls) {
      const dx = dir * SLIDE * (1 - easeOut(clamp01(p / SLIDE_IN)));
      if (wild) monDx = dx;
      else trainerDx = dx;
    }
    if (mine?.e === 'send') {
      slot = mine.slot;
      if (!wild) appear = easeOut(clamp01(p / APPEAR));
      if (!sent[side] && ls && !wild) trainerDx = dir * SLIDE * easeIn(clamp01(p / SLIDE_OUT));
    }
    if (mine?.e === 'back') { leave = 'back'; vanish = easeOut(clamp01(p / SINK)); }
    if (mine?.e === 'faint') { leave = 'faint'; vanish = easeOut(clamp01(p / SINK)); }
    if (mine?.e === 'hit') blink = elapsed < BLINK_MS && Math.floor(elapsed / BLINK_STEP) % 2 === 1;
    const mon = ls && slot >= 0 ? ls.team[slot] ?? null : null;
    let hp = mon ? mon.hp : 0;
    let status = mon ? mon.status : 0;
    if (mon && mine?.e === 'hp') hp = Math.round(mon.hp + (Math.max(0, Math.min(mon.maxHp, mine.hp)) - mon.hp) * clamp01(p / DRAIN));
    if (mon && mine?.e === 'status') status = mine.status;
    if (mon && mine?.e === 'faint') hp = 0;
    return { side, name: ls?.name ?? '', skin: ls?.skin ?? 0, ...(ls?.pic !== undefined ? { pic: ls.pic } : {}), trainerDx, wild, monDx, mon, slot: mon ? slot : -1, hp, status, appear, vanish, leave, blink, inBall: 0 };
  };
  const sa = sideScene(0), sb = sideScene(1);
  const wildSide: Side | null = sides.b?.wild ? 1 : sides.a?.wild ? 0 : null;
  const { ball, inBall, shaking } = ballAt(log, next, ev, p, waited, wildSide !== null && slotOf(wildSide, follow) === 'far');
  if (wildSide !== null) (wildSide === 1 ? sb : sa).inBall = inBall;
  const near = follow === 0 ? sa : sb, far = follow === 0 ? sb : sa;
  let text = state.text, chars = Infinity;
  if (ev?.e === 'text') {
    text = ev.text;
    chars = Math.floor(elapsed / CHAR_MS);
  } else if (ev?.e === 'start') {
    // A wild one has nobody to say this: the box is empty until "Wild X appeared!", as on a cart.
    text = far.wild ? '' : introLine(far.name);
    chars = Math.floor(elapsed / CHAR_MS);
  } else if (!text && sides.a && !sent[0] && !sent[1] && !far.wild) {
    text = introLine(far.name);
  }
  const ended = next >= log.length && state.winner !== null;
  const waiting = next >= log.length && !ended;
  // A live fight waited on, for longer than its own pauses (Cam, 11-21: "it looks frozen"): the box
  // says who it waits on, its dots running. Not over a ball's shakes, which are the wait's own show.
  if (waiting && state.a && waited >= WAIT_LINE_MS && !shaking) {
    text = waitLine(near.name, waited);
    chars = Infinity;
  }
  return { ms, next, ev, elapsed, p, state, near, far, map: ev?.e === 'start' ? ev.map : state.map, text, chars, ended, waiting, ball };
}

/** The ball thrown at the wild mon `next` events into `log`, with `ev` playing `p` of the way
 *  through: the throw that has played and not been answered yet (caught, or out again), and what
 *  plays now. `far`: the wild mon is the far one, where a ball can be drawn going to it. */
function ballAt(log: readonly BattleEvent[], next: number, ev: BattleEvent | null, p: number, waited: number, far: boolean): { ball: BallScene | null; inBall: number; shaking: boolean } {
  const none = { ball: null, inBall: 0, shaking: false };
  if (!far) return none;
  let thrown = false, caught = false, master = false;
  for (let i = 0; i < next; i++) {
    const e = log[i];
    if (e.e === 'start') thrown = caught = false;
    if (e.e !== 'text') continue;
    if (THROW_LINE.test(e.text)) { thrown = true; caught = false; master = /\bMASTER BALL!$/.test(e.text); }
    else if (thrown && CAUGHT_LINE.test(e.text)) caught = true;
    else if (thrown && !caught && FREE_LINE.test(e.text)) thrown = false;
  }
  const line = ev?.e === 'text' ? ev.text : '';
  // Thrown now: to the mon, open, the mon in, shut, down to the ground.
  if (THROW_LINE.test(line)) {
    const fly = clamp01(p / FLY), take = clamp01((p - FLY) / TAKE), drop = easeIn(clamp01((p - FLY - TAKE) / DROP));
    return { ball: { fly, drop, tilt: 0, open: take > 0 && take < 1, master: /\bMASTER BALL!$/.test(line) }, inBall: take, shaking: false };
  }
  if (!thrown) return none;
  // Out again: the ball opens and the mon comes back out of it.
  if (!caught && FREE_LINE.test(line)) {
    const out = clamp01(p / FREE);
    return { ball: out < 1 ? { fly: 1, drop: 1, tilt: 0, open: true, master } : null, inBall: 1 - out, shaking: false };
  }
  // On the ground with the mon in it: shaking while the fight is waited on (the ROM is shaking it
  // meanwhile), still once it is caught.
  const shaking = !caught && !CAUGHT_LINE.test(line) && next >= log.length;
  return { ball: { fly: 1, drop: 1, tilt: shaking ? shakeAt(waited) : 0, open: false, master }, inBall: 1, shaking };
}

/** A health box is up from this far through its mon's coming out. */
export const BOX_FROM = 0.3;

/** A mon's health box is on the screen: it is far enough out of its ball, or done sliding in. */
export function boxUp(v: SideScene): boolean {
  return !!v.mon && v.appear > BOX_FROM && !v.monDx;
}

/** Which trainers' names have room over their pictures. The ROM has no such labels, so they make way:
 *  each goes as its trainer sends their first mon out and slides off the edge with its name cut, and
 *  the near one's, which sits where the far health box goes (its line, y 34, is inside the box's),
 *  goes once that box is up. */
export function namesShown(s: Scene): { near: boolean; far: boolean } {
  return {
    far: s.far.trainerDx !== null && !!s.far.name && !s.far.mon,
    near: s.near.trainerDx !== null && !!s.near.name && !s.near.mon && !boxUp(s.far),
  };
}

/** What a spec (or a person) can say about a scene without a screenshot. */
export function describe(s: Scene): string {
  const side = (v: SideScene) => `${v.name || '-'}: ${v.mon ? `slot ${v.slot} ${v.hp}/${v.mon.maxHp}${v.status ? ` st${v.status}` : ''}` : v.trainerDx === null ? 'empty' : 'trainer'}`;
  return `near ${side(s.near)} | far ${side(s.far)} | "${s.text}"`;
}
