// A battle as a log of what happened, for whoever watches it (Cam, 11-02: no "shared duplicate
// stream that can get out of sync"). A watcher used to re-simulate a fight from its seed and
// choices on their own ROM, and any difference ended the replay. Now the one who knows what
// happened says so, and the page draws it (battleview.ts): nothing is worked out twice, so
// nothing can drift. Two things write a log:
//   - the server's simulator, for a bot-vs-bot fight (battlesim.ts), the whole log at once;
//   - a fighter's page, reading its ROM, for a trainer's own fight, as it happens.
//
// Plain data, small enough to send a turn at a time. It holds no game code or art: the watcher
// draws sprites and names from their own ROM.

/** One mon as a watcher needs it. */
export interface LogMon {
  species: number;
  level: number;
  hp: number;
  maxHp: number;
  /** PackedMon's status: 0 none, else a status condition id. */
  status: number;
  shiny?: boolean;
  /** 0 male, 1 female, 2 neither. */
  gender?: number;
  nickname?: string;
}

/** One side of the fight. Side 0 is the near one, back to the camera, unless the watcher follows
 *  side 1 (the view flips it). */
export interface LogSide {
  /** The trainer's actor id on the room. */
  seat: number;
  name: string;
  /** Their look (room.ts `skin`), for the trainer picture. */
  skin: number;
  team: LogMon[];
}

export type Side = 0 | 1;

export type BattleEvent =
  /** The fight begins: always first. `map` is where it is, for the ground under them. */
  | { e: 'start'; a: LogSide; b: LogSide; map: string }
  /** A mon comes out, to the side's team slot `slot`. */
  | { e: 'send'; side: Side; slot: number }
  /** A mon is called back without fainting. */
  | { e: 'back'; side: Side }
  /** A line of the message box, as Emerald words it ("Foe GLOOM used TOXIC!"). */
  | { e: 'text'; text: string }
  /** A move's flash on `side`'s active mon, the one it lands on. Nothing is said by it. */
  | { e: 'hit'; side: Side; move?: number }
  /** The active mon's HP goes to `hp` (the bar drains over time). */
  | { e: 'hp'; side: Side; hp: number }
  /** The active mon's status changes. */
  | { e: 'status'; side: Side; status: number }
  /** The active mon faints. */
  | { e: 'faint'; side: Side }
  /** The fight is over. `winner` is a seat, 0 for nobody (both down, or a trainer left). */
  | { e: 'end'; winner: number };

/** How long each event holds the screen, so a watcher sees a fight at a real one's pace, a late
 *  one can be dropped in where it stands, and the room can keep a simulated fight's bots busy for
 *  as long as a fight takes. A log from a live ROM carries the same events as they happen. */
const TEXT_MS = 1400;
const HOLD_MS: Record<BattleEvent['e'], number> = { start: 2000, send: 1200, back: 700, text: TEXT_MS, hit: 500, hp: 900, status: 300, faint: 1000, end: 1500 };

export function eventMs(ev: BattleEvent): number {
  return ev.e === 'text' ? Math.max(TEXT_MS, 500 + ev.text.length * 30) : HOLD_MS[ev.e];
}

/** How long a whole log takes to play. */
export function logMs(log: readonly BattleEvent[]): number {
  return log.reduce((t, ev) => t + eventMs(ev), 0);
}

/** What a watcher sees at some point of a log: the state after everything before it. For
 *  joining late, and what the view draws from. */
export interface LogState {
  a: LogSide | null;
  b: LogSide | null;
  map: string;
  /** Each side's team slot on the field, -1 for none. */
  active: [number, number];
  text: string;
  winner: number | null;
}

export function emptyState(): LogState {
  return { a: null, b: null, map: '', active: [-1, -1], text: '', winner: null };
}

/** One event on a state, in place. Unknown or out-of-order events are ignored: the log comes from
 *  a network and a page must not crash on it. */
export function applyEvent(s: LogState, ev: BattleEvent): LogState {
  const team = (side: Side) => (side === 0 ? s.a : s.b)?.team;
  const mon = (side: Side) => team(side)?.[s.active[side]];
  switch (ev.e) {
    case 'start':
      s.a = structuredClone(ev.a);
      s.b = structuredClone(ev.b);
      s.map = ev.map;
      s.active = [-1, -1];
      s.text = '';
      s.winner = null;
      break;
    case 'send':
      if (team(ev.side)?.[ev.slot]) s.active[ev.side] = ev.slot;
      break;
    case 'back':
      s.active[ev.side] = -1;
      break;
    case 'text':
      s.text = ev.text;
      break;
    case 'hp': {
      const m = mon(ev.side);
      if (m) m.hp = Math.max(0, Math.min(m.maxHp, ev.hp));
      break;
    }
    case 'status': {
      const m = mon(ev.side);
      if (m) m.status = ev.status;
      break;
    }
    case 'faint': {
      const m = mon(ev.side);
      if (m) m.hp = 0;
      s.active[ev.side] = -1;
      break;
    }
    case 'end':
      s.winner = ev.winner;
      break;
    default:
      break;
  }
  return s;
}

/** The state `ms` into a log, and how far through it that is: the event to play next. */
export function stateAt(log: readonly BattleEvent[], ms: number): { state: LogState; next: number } {
  const state = emptyState();
  let t = 0, i = 0;
  for (; i < log.length; i++) {
    const d = eventMs(log[i]);
    if (t + d > ms) break;
    applyEvent(state, log[i]);
    t += d;
  }
  return { state, next: i };
}
