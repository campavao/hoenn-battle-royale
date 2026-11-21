// The LEADERBOARD (#397's suggestion, Cam 11-20): every player ranked by a rating from the
// finishing order of their matches with other people. The relay logs a `result` line per
// finished match (spike-b/shared/service.ts resultLine), tools/br/play-log.mjs adds them up
// into leaderboard.json on the `play-log` branch every fifteen minutes, and this reads it raw,
// as /play.html reads play.json. Nothing here is authority: the page only shows the file.
import { ordinal } from './career';

export const LEADERBOARD_URL = 'https://raw.githubusercontent.com/campavao/hoenn-battle-royale/play-log/leaderboard.json';

export interface BoardPlayer {
  /** The public id (relay/world.js playerId): a hash of the browser's key. */
  id: string;
  name: string;
  rating: number;
  played: number;
  wins: number;
  best: number | null;
}

export interface Board {
  matches: number;
  players: BoardPlayer[];
}

const ID = /^[0-9a-f]{12}$/;
const NAME = /^[A-Z0-9 ]{0,10}$/;
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** The file as the page will draw it: only ids, names and numbers of the shapes play-log.mjs
 *  writes, so a bad file is an empty board rather than markup on a public page. */
export function cleanBoard(raw: unknown): Board | null {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { players?: unknown }).players)) return null;
  const players: BoardPlayer[] = [];
  for (const p of (raw as { players: unknown[] }).players) {
    if (typeof p !== 'object' || p === null) continue;
    const r = p as Record<string, unknown>;
    if (typeof r.id !== 'string' || !ID.test(r.id) || typeof r.rating !== 'number' || !Number.isFinite(r.rating)) continue;
    const name = typeof r.name === 'string' && NAME.test(r.name) ? r.name : '';
    const best = count(r.best);
    players.push({ id: r.id, name, rating: Math.round(r.rating), played: count(r.played), wins: count(r.wins), best: best > 0 ? best : null });
  }
  players.sort((a, b) => b.rating - a.rating);
  return { matches: count((raw as { matches?: unknown }).matches), players };
}

/** The board as it is now, or null when it cannot be read (offline, the branch not there yet). */
export async function fetchBoard(get: typeof fetch = fetch): Promise<Board | null> {
  try {
    // The time on the end steps past GitHub's own cache: a board up to fifteen minutes
    // behind is the pipeline's, not five more of the CDN's on top.
    const res = await get(`${LEADERBOARD_URL}?t=${Math.floor(Date.now() / 60_000)}`, { cache: 'no-store' });
    // No file yet: play-log.mjs writes it after the first rated match.
    if (res.status === 404) return { matches: 0, players: [] };
    return res.ok ? cleanBoard(await res.json()) : null;
  } catch {
    return null;
  }
}

/** Rows a screen has room for. */
export const BOARD_ROWS = 8;

export interface BoardView {
  rows: { label: string; detail: string; mine: boolean }[];
  note: string;
}

/** What the LEADERBOARD screen says: the top `top`, each place, name and rating, and a note
 *  with where `me` (this browser's public id) stands. */
export function boardView(board: Board | null | 'loading', me: string | null, top = BOARD_ROWS): BoardView {
  if (board === 'loading') return { rows: [], note: 'Reading the leaderboard...' };
  if (!board) return { rows: [], note: 'The leaderboard could not be read. Try again in a while.' };
  if (!board.players.length) return { rows: [], note: 'Nobody is on it yet. Finish a match with another person to be first.' };
  // Equal ratings share a place.
  const placeOf: number[] = [];
  board.players.forEach((p, i) => { placeOf.push(i > 0 && p.rating === board.players[i - 1].rating ? placeOf[i - 1] : i + 1); });
  const rows = board.players.slice(0, top).map((p, i) => ({
    label: `${placeOf[i]}. ${p.name || 'TRAINER'}`,
    detail: String(p.rating),
    mine: p.id === me,
  }));
  const at = me ? board.players.findIndex((p) => p.id === me) : -1;
  const note = at < 0
    ? 'Finish a match with another person to get on the board.'
    : `You are ${ordinal(placeOf[at])} of ${board.players.length}, rated ${board.players[at].rating}.`;
  return { rows, note };
}
