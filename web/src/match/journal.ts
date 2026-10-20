// What a reload reads the match's books back from (HBR-20, match/resume.ts): every
// message the session books, as it books them, from the match's `start`. Kept apart from
// resume.ts, which the page loads only once a match is on, because this has to be
// listening from the `start` itself.
import type { Msg } from '../net/wire';
import type { Via } from './session';

export type JournalEntry = [msg: Msg, via: Via, wall: number];

/** What the books need to be rebuilt from. The fight's own traffic and the room's
 *  chatter are not the match; and of where everybody is, only where our own ROM last was
 *  matters to the books (the loot it was handed for that map), so it is kept apart. */
const SKIPPED = new Set<Msg['t']>([
  'place', 'step', 'face', 'bt', 'bstart', 'turn', 'peek', 'shot', 'ping', 'pong', 'follow', 'card', 'ready', 'away',
]);
/** The books are rebuilt from at most this many, newest kept; past it the record is not
 *  written at all rather than written wrong. */
export const JOURNAL_MAX = 6000;

/** Every message the session books, as it books them, from the match's `start`. */
export class Journal {
  private list: JournalEntry[] = [];
  private lastPlace: JournalEntry | null = null;
  private overflow = false;

  note(msg: Msg, via: Via, wall: number): void {
    if (msg.t === 'start') this.clear();
    if (msg.t === 'place' && via === 'rom') {
      this.lastPlace = [msg, via, wall];
      return;
    }
    if (SKIPPED.has(msg.t)) return;
    // The clock says the same thing every five seconds: only the latest counts.
    if (msg.t === 'clock' && this.list.length > 0 && this.list[this.list.length - 1][0].t === 'clock') this.list.pop();
    if (this.list.length >= JOURNAL_MAX) {
      this.overflow = true;
      return;
    }
    this.list.push([msg, via, wall]);
  }

  clear(): void {
    this.list = [];
    this.lastPlace = null;
    this.overflow = false;
  }

  /** In the order they were booked, our ROM's last `place` at the end; null when there
   *  were too many to keep. */
  entries(): JournalEntry[] | null {
    if (this.overflow) return null;
    return this.lastPlace ? [...this.list, this.lastPlace] : [...this.list];
  }
}
