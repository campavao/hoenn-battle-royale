// A player's note from the FEEDBACK screen (POK-428), on its way to the relay.
//
// It goes on a socket of its own, opened for the note and closed after the answer: the
// menu's socket closes before a match starts, and solo play never opens one, so there is
// no connection to borrow at the moment somebody wants to say something. The relay logs
// the note as one line and play-log.yml files it in Linear. relay/server.js's `feedback`
// case is the other end, and cleans everything again: what this does is for the screen.
import type { WebSocketFactory, WebSocketLike } from './relay';

/** The relay's own cap (relay/clean.js FEEDBACK_MAX), in characters. */
export const FEEDBACK_MAX = 1000;
/** How long the screen says "Sending…" before it calls the relay unreachable. */
export const FEEDBACK_WAIT_MS = 8000;

export interface FeedbackMsg {
  type: 'feedback';
  text: string;
  /** The page's version line, so a note about a bug says which build had it. */
  v: string;
  /** Where it was written: `menu`, or `match-` and the way in (`match-solo`). */
  where: string;
  name: string;
  /** The room's code, when the note was written in one. */
  room?: string;
}

/** How a send ended: logged, refused for having no words, for one note too many from
 *  this address, or for too many from everybody, or no answer at all. */
export type FeedbackResult = 'sent' | 'empty' | 'busy' | 'full' | 'failed';

/** What the box holds, as the relay will keep it: one line, whitespace runs as one
 *  space, at most FEEDBACK_MAX characters. Empty means there is nothing to send. */
export function cleanNote(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return Array.from(flat).slice(0, FEEDBACK_MAX).join('').trim();
}

/** Open a socket, send the note, and wait for the relay to say what became of it. */
export function sendFeedback(
  url: string,
  msg: FeedbackMsg,
  open: WebSocketFactory = (u) => new WebSocket(u) as unknown as WebSocketLike,
  waitMs = FEEDBACK_WAIT_MS,
): Promise<FeedbackResult> {
  return new Promise((resolve) => {
    let ws: WebSocketLike | null = null;
    let settled = false;
    const end = (result: FeedbackResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        // already gone
      }
      resolve(result);
    };
    const timer = setTimeout(() => end('failed'), waitMs);
    try {
      ws = open(url);
    } catch {
      end('failed');
      return;
    }
    ws.onopen = () => ws?.send(JSON.stringify(msg));
    ws.onmessage = (ev) => {
      let m: { type?: unknown; reason?: unknown };
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      // The relay pushes `info` the moment a socket opens; only the answer counts.
      if (m.type === 'feedback_ok') end('sent');
      else if (m.type === 'feedback_error') end(m.reason === 'busy' || m.reason === 'full' || m.reason === 'empty' ? m.reason : 'failed');
    };
    ws.onerror = () => end('failed');
    ws.onclose = () => end('failed');
  });
}
