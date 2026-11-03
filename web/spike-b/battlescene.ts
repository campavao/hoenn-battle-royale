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
  /** Their picture's place: how far it is from where it stands, in pixels, away from the middle
   *  (negative for the near trainer, who slides from the left); null when it is not on the screen
   *  (before the start, or once their first mon is out). */
  trainerDx: number | null;
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

/** The scene `ms` into `log` for a watcher following side `follow`. */
export function sceneAt(log: readonly BattleEvent[], ms: number, follow: Side = 0): Scene {
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
    let slot = state.active[side];
    let appear = 1, vanish = 0, blink = false;
    let leave: SideScene['leave'] = null;
    let trainerDx: number | null = ls && !sent[side] ? 0 : null;
    if (ev?.e === 'start' && ls) trainerDx = dir * SLIDE * (1 - easeOut(clamp01(p / SLIDE_IN)));
    if (mine?.e === 'send') {
      slot = mine.slot;
      appear = easeOut(clamp01(p / APPEAR));
      if (!sent[side] && ls) trainerDx = dir * SLIDE * easeIn(clamp01(p / SLIDE_OUT));
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
    return { side, name: ls?.name ?? '', skin: ls?.skin ?? 0, trainerDx, mon, slot: mon ? slot : -1, hp, status, appear, vanish, leave, blink };
  };
  const sa = sideScene(0), sb = sideScene(1);
  const near = follow === 0 ? sa : sb, far = follow === 0 ? sb : sa;
  let text = state.text, chars = Infinity;
  if (ev?.e === 'text') {
    text = ev.text;
    chars = Math.floor(elapsed / CHAR_MS);
  } else if (ev?.e === 'start') {
    text = introLine(far.name);
    chars = Math.floor(elapsed / CHAR_MS);
  } else if (!text && sides.a && !sent[0] && !sent[1]) {
    text = introLine(far.name);
  }
  const ended = next >= log.length && state.winner !== null;
  return { ms, next, ev, elapsed, p, state, near, far, map: ev?.e === 'start' ? ev.map : state.map, text, chars, ended, waiting: next >= log.length && !ended };
}

/** A health box is up from this far through its mon's coming out. */
export const BOX_FROM = 0.3;

/** Which trainers' names have room over their pictures. The ROM has no such labels, so they make way:
 *  each goes as its trainer sends their first mon out and slides off the edge with its name cut, and
 *  the near one's, which sits where the far health box goes (its line, y 34, is inside the box's),
 *  goes once that box is up. */
export function namesShown(s: Scene): { near: boolean; far: boolean } {
  return {
    far: s.far.trainerDx !== null && !!s.far.name && !s.far.mon,
    near: s.near.trainerDx !== null && !!s.near.name && !s.near.mon && !(s.far.mon && s.far.appear > BOX_FROM),
  };
}

/** What a spec (or a person) can say about a scene without a screenshot. */
export function describe(s: Scene): string {
  const side = (v: SideScene) => `${v.name || '-'}: ${v.mon ? `slot ${v.slot} ${v.hp}/${v.mon.maxHp}${v.status ? ` st${v.status}` : ''}` : v.trainerDx === null ? 'empty' : 'trainer'}`;
  return `near ${side(s.near)} | far ${side(s.far)} | "${s.text}"`;
}
