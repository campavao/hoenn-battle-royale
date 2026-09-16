// The round, written down (POK-248, Kanto v0.25.0).
//
// Nothing survived a finished match. `Results` works out placements and then the page
// forgets everything: which seed it was, who was in it, where they dropped, when the
// fog moved, who beat whom. Kanto has kept that log since v0.25.0 and its play-log
// dashboard reads it -- and the first thing anybody asks about a match that went wrong
// is "what was the seed", which is the one question a screenshot cannot answer.
//
// Everything the log wants already crosses this page: `start` has the seed and the
// field, `land` is where somebody dropped, `ring` is the fog moving, `out` is an
// elimination in order, `win` closes it. So this is a recorder, not a new source of
// truth -- it listens to the same messages `Results` does and keeps them in a shape a
// round can be replayed from.
//
// It lives in localStorage, like the career: one device's own record, best effort,
// never authority for anything. The last few matches, not all of them -- a log nobody
// can lose is worth less than a page that still loads.
import type { Msg } from '../net/wire';

/** One thing that happened, in the order it happened. `at` is seconds from the start,
 *  because a log anybody reads is read in minutes-and-seconds, not epoch millis. */
export interface LogEvent {
  at: number;
  t: 'drop' | 'ring' | 'kill' | 'out' | 'win';
  /** Who it happened to (the dropper, the loser, the champion). */
  seat?: number;
  /** Who did it, for a kill. */
  by?: number;
  /** The fog's phase, for a ring. */
  phase?: number;
  /** Where, for a drop: `group:num` and the cell. */
  map?: string;
  x?: number;
  y?: number;
}

/** A finished round, as much of it as a page can see. */
export interface LoggedMatch {
  /** When it started, epoch ms -- the only wall-clock time in here. */
  started: number;
  seed: number;
  /** seat -> name, as the roster had them when the match started. */
  roster: Record<number, string>;
  seats: number;
  events: LogEvent[];
  winner?: number;
  /** How long the whole thing took, in seconds. */
  ran: number;
}

/** How many rounds are kept. Kanto keeps a rolling file; a browser keeps what it can
 *  afford to, and five rounds is about 40 KB. */
export const KEEP = 5;
const KEY = 'hbr:log';

export class MatchLog {
  private started = 0;
  private startedAt: number | undefined;
  private seed = 0;
  private seats = 0;
  private roster: Record<number, string> = {};
  private events: LogEvent[] = [];
  private winner: number | undefined;
  private ended = false;

  /** Every message the page sees, in the order it sees it. `now` is the page clock
   *  (performance.now), `names` answers what the roster calls a seat. */
  note(msg: Msg, now: number, names?: (seat: number) => string): void {
    switch (msg.t) {
      case 'start':
        this.started = Date.now();
        this.startedAt = now;
        this.seed = msg.seed;
        this.seats = msg.spawns.length;
        this.events = [];
        this.winner = undefined;
        this.ended = false;
        this.roster = {};
        for (const spawn of msg.spawns) this.roster[spawn.seat] = names?.(spawn.seat) ?? `P${spawn.seat}`;
        return;
      case 'land':
        this.push(now, { t: 'drop', seat: msg.seat, map: `${msg.map.group}:${msg.map.num}`, x: msg.x, y: msg.y });
        return;
      case 'ring':
        this.push(now, { t: 'ring', phase: msg.phase });
        return;
      case 'botout':
        // The only message naming both sides of a fight at once: `seat` beat the bot
        // at `target`. A player beating a player arrives as the loser's own `out`,
        // with no room for who did it.
        this.push(now, { t: 'kill', seat: msg.target, by: msg.seat });
        return;
      case 'out':
        this.push(now, { t: 'out', seat: msg.seat });
        return;
      case 'win':
        if (this.ended) return;
        this.ended = true;
        this.winner = msg.seat ?? undefined;
        this.push(now, { t: 'win', seat: this.winner });
        return;
      default:
    }
  }

  private push(now: number, event: Omit<LogEvent, 'at'>): void {
    if (this.startedAt === undefined || (this.ended && event.t !== 'win')) return;
    this.events.push({ at: Math.max(0, Math.round((now - this.startedAt) / 1000)), ...event });
  }

  /** The round so far, whether or not it has finished. Null before a `start`. */
  current(now: number): LoggedMatch | null {
    if (this.startedAt === undefined) return null;
    return {
      started: this.started,
      seed: this.seed,
      roster: { ...this.roster },
      seats: this.seats,
      events: [...this.events],
      winner: this.winner,
      ran: Math.max(0, Math.round((now - this.startedAt) / 1000)),
    };
  }

  /** Has anything been recorded that is worth keeping? */
  get live(): boolean {
    return this.startedAt !== undefined;
  }
}

function sane(value: unknown): LoggedMatch[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is LoggedMatch =>
      typeof row === 'object' && row !== null && typeof (row as LoggedMatch).seed === 'number' && Array.isArray((row as LoggedMatch).events),
  );
}

/** Every round this device still has, newest first. */
export function loadLog(store: Pick<Storage, 'getItem' | 'setItem'> = localStorage): LoggedMatch[] {
  try {
    const raw = store.getItem(KEY);
    return raw ? sane(JSON.parse(raw)) : [];
  } catch {
    // A private window, or somebody else's JSON under our key: an unreadable log is
    // an empty one, never a page that will not load.
    return [];
  }
}

/** Files a finished round, keeping the last KEEP. Answers what is now on disk. */
export function saveMatch(match: LoggedMatch, store: Pick<Storage, 'getItem' | 'setItem'> = localStorage): LoggedMatch[] {
  const kept = [match, ...loadLog(store)].slice(0, KEEP);

  try {
    store.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Out of quota: this round is not written down, and the match carries on.
  }
  return kept;
}

/** One round as the line a person reads: the seed first, because that is the question.
 *  `2026-09-16 14:02 · seed 1234 · 8 seats · 14:31 · CAM won` */
export function describeMatch(match: LoggedMatch): string {
  const when = new Date(match.started);
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${Math.floor(match.ran / 60)}:${pad(match.ran % 60)}`;
  const who = match.winner === undefined ? 'no winner' : `${match.roster[match.winner] ?? `P${match.winner}`} won`;

  return [
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`,
    `seed ${match.seed}`,
    `${match.seats} seats`,
    clock,
    who,
  ].join(' · ');
}
