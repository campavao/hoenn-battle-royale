// What a player carries between matches (POK-228): how many they have played, how many
// they have won, and the best they have ever placed. Kanto keeps the same three in
// `lib/career.lua`, and for the same reason -- a battle royale with no memory of last
// time is a demo.
//
// localStorage, not the relay: this is one device's own record, it is never authority
// for anything, and a wiped browser costing somebody their streak is a smaller problem
// than a server that has to be trusted with it.
import { LINE_COUNT, lineIndexOf, VOICE_COUNT, voiceOf } from '../bots/lines';

const KEY = 'hbr:career';

export interface Career {
  matches: number;
  wins: number;
  /** 1 = a win. Undefined until a match has been finished. */
  best?: number;
  /** Who you are in a room, and which of the four trainer sprites is your ghost on
   *  everybody else's screen (POK-243). Seven characters, because that is Emerald's
   *  own name field and the ROM is where the name ends up. */
  name?: string;
  skin?: number;
  /** Which of `bots/lines.ts`'s voices this seat speaks with when its own duels get
   *  announced (POK-243). Undefined means "whatever the match seed deals" -- the same
   *  thing a bot gets, since nobody has picked one yet.
   *
   *  Kept only to migrate an old career file: POK-283 split it into three separate picks
   *  below, because "one index into all three pools at once" meant choosing a win line
   *  you did not want to get the intro you did. Nothing writes it any more. */
  voice?: number;
  /** MY VOICE, three independent indices into `LINES` (POK-283). Undefined is dealt from
   *  the match seed, the same as a bot's. */
  intro?: number;
  win?: number;
  lose?: number;
  /** Everything every match added up (POK-416): what the results say about one match,
   *  kept for the profile. Absent until a match has counted something. */
  totals?: CareerTotals;
}

/** A career's lifetime stats: the room's counts (record.ts) and the ROM's own (tally.ts),
 *  summed, and how often each species and move was fought with, for the favourites. */
export interface CareerTotals {
  won: number;
  caught: number;
  steps: number;
  items: number;
  trainers: number;
  duelsWon: number;
  took: number;
  mons: Record<number, number>;
  moves: Record<number, number>;
}

/** Favourites kept per career: the most-used, and enough under them that a new one can
 *  climb past the old. */
export const FAVOURITES_KEPT = 24;

const TOTAL_COUNTS = ['won', 'caught', 'steps', 'items', 'trainers', 'duelsWon', 'took'] as const;

/** The wardrobe, index for index with `sSkinGraphics` in src/br/br_ghosts.c -- which is
 *  where the sprite actually comes from, so the ROM half has to ship first or a new entry
 *  draws as BRENDAN.
 *
 *  EVEN IS MALE AND ODD IS FEMALE. A skin index is the only thing on the wire that says
 *  which you are: `br_netlink.c` reads the peer's gender as `skin & 1` and `app.ts` reads
 *  your own avatar's as `skin % 2`. Append in pairs. */
export const SKINS = [
  'BRENDAN',
  'MAY',
  'RIVAL BRENDAN',
  'RIVAL MAY',
  'HIKER',
  'BEAUTY',
  'CAMPER',
  'PICNICKER',
  'SWIMMER',
  'SWIMMER GIRL',
  'EXPERT',
  'EXPERT LADY',
  'POKEFAN',
  'POKEFAN LADY',
  'YOUNGSTER',
  'LASS',
];

/** RIVAL BRENDAN and RIVAL MAY stay in SKINS, because a skin is its index on the wire and
 *  in the ROM's table, but they are not in the wardrobe: they draw exactly like BRENDAN and
 *  MAY (Cam's 2026-10-14 play-test, POK-336). A career still wearing one wears the base
 *  sprite it copies, the rival's index minus two. */
export const RETIRED_SKINS: ReadonlySet<number> = new Set([2, 3]);

/** What the wardrobe offers, in its order: every skin but the retired ones. */
export const WARDROBE: readonly number[] = SKINS.map((_, i) => i).filter((i) => !RETIRED_SKINS.has(i));

/** Wins needed to unlock each entry in SKINS, index for index -- Kanto's wardrobe ladder
 *  (lib/skins.lua unlocks nine trainer classes on a curve from 1 win). Your own two
 *  starting trainers are free; each pair after them is staggered, the man a win or two
 *  before the woman, so the next unlock is never far off (Cam, 2026-10-14, POK-338: "boy
 *  four and then the girl five... nine, ten... thirteen"). The retired rivals can never
 *  be worn. */
export const SKIN_UNLOCK_WINS = [
  0, 0,
  Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY,
  1, 2, 4, 5, 9, 10, 13, 15, 18, 20, 23, 25,
];

export function skinUnlocked(skin: number, wins: number): boolean {
  return wins >= (SKIN_UNLOCK_WINS[skin] ?? 0);
}

/** The next skin still locked, and how many more wins it takes -- null once the
 *  wardrobe is full. What the lobby's sprite row hints at. */
export function nextLockedSkin(wins: number): { skin: number; wins: number } | null {
  let next: { skin: number; wins: number } | null = null;
  for (const i of WARDROBE) {
    if (skinUnlocked(i, wins)) continue;
    if (next === null || SKIN_UNLOCK_WINS[i] < next.wins) next = { skin: i, wins: SKIN_UNLOCK_WINS[i] };
  }
  return next;
}

/** Emerald's own PLAYER_NAME_LENGTH. A longer one is not truncated somewhere clever;
 *  it is refused, so what you typed is what a room calls you. */
export const NAME_MAX = 7;

/** Uppercase, letters and digits, at most seven. Empty when it is not a name. */
export function cleanName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .trim()
    .slice(0, NAME_MAX);
}

/** The next skin after this one in the wardrobe, skipping anything `wins` has not
 *  unlocked yet. `wins` defaults to unlimited so callers that do not care about the
 *  wardrobe (most of the existing tests, `voiceFor`-style pure use) still get a plain
 *  cycle. */
export function nextSkin(skin: number, wins = Number.POSITIVE_INFINITY): number {
  const at = WARDROBE.indexOf(skin);
  for (let i = 1; i <= WARDROBE.length; i++) {
    const candidate = WARDROBE[(at + i + WARDROBE.length) % WARDROBE.length];
    if (skinUnlocked(candidate, wins)) return candidate;
  }
  return skin; // nothing else is unlocked -- stay put rather than loop forever
}

/** The next skin after this one whether it is unlocked or not (POK-282).
 *
 *  Cam: "in Kanto you're able to preview all the different skins even if you don't have
 *  all the wins yet." A wardrobe you cannot look at is not a ladder -- there is nothing to
 *  climb towards. `nextSkin` above is what SAVES; this is what BROWSES. */
export function peekSkin(skin: number): number {
  const at = WARDROBE.indexOf(skin);
  return WARDROBE[(at + 1) % WARDROBE.length];
}

/** What to say under a skin while it is being browsed: its price, or that it is yours. */
export function skinNote(skin: number, wins: number): string {
  if (skinUnlocked(skin, wins)) return 'your sprite';
  const need = SKIN_UNLOCK_WINS[skin] ?? 0;
  return `LOCKED -- ${need} ${need === 1 ? 'win' : 'wins'}`;
}

const EMPTY: Career = { matches: 0, wins: 0 };

function emptyTotals(): CareerTotals {
  return { won: 0, caught: 0, steps: 0, items: 0, trainers: 0, duelsWon: 0, took: 0, mons: {}, moves: {} };
}

/** The `FAVOURITES_KEPT` highest counts, ids that are whole numbers in range only. */
function keepTop(raw: unknown, limit: number): Record<number, number> {
  if (typeof raw !== 'object' || raw === null) return {};
  const rows = Object.entries(raw as Record<string, unknown>)
    .map(([k, v]) => [Number(k), typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0] as const)
    .filter(([id, n]) => Number.isInteger(id) && id > 0 && id <= limit && n > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, FAVOURITES_KEPT);
  return Object.fromEntries(rows);
}

function saneTotals(raw: unknown): CareerTotals | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const t = emptyTotals();
  for (const k of TOTAL_COUNTS) t[k] = typeof r[k] === 'number' && Number.isFinite(r[k]) && (r[k] as number) > 0 ? Math.floor(r[k] as number) : 0;
  t.mons = keepTop(r.mons, 0xffff);
  t.moves = keepTop(r.moves, 0xffff);
  return t;
}

/** One match's counts, added to a career's. */
export function addTotals(
  into: CareerTotals | undefined,
  match: { won: number; caught: number; steps: number; items: number; trainers: number; duelsWon: number; took: number; mons: Record<number, number>; moves: Record<number, number> },
): CareerTotals {
  const t = into ? { ...into, mons: { ...into.mons }, moves: { ...into.moves } } : emptyTotals();
  for (const k of TOTAL_COUNTS) t[k] += match[k];
  for (const [id, n] of Object.entries(match.mons)) t.mons[Number(id)] = (t.mons[Number(id)] ?? 0) + n;
  for (const [id, n] of Object.entries(match.moves)) t.moves[Number(id)] = (t.moves[Number(id)] ?? 0) + n;
  t.mons = keepTop(t.mons, 0xffff);
  t.moves = keepTop(t.moves, 0xffff);
  return t;
}

function sane(value: unknown): Career {
  if (typeof value !== 'object' || value === null) return { ...EMPTY };
  const raw = value as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const career: Career = { matches: num(raw.matches), wins: num(raw.wins) };
  const best = num(raw.best);
  if (best > 0) career.best = best;
  const name = typeof raw.name === 'string' ? cleanName(raw.name) : '';
  if (name) career.name = name;
  const skin = num(raw.skin);
  const worn = RETIRED_SKINS.has(skin) ? skin - 2 : skin;
  if (worn > 0 && worn < SKINS.length) career.skin = worn;
  const voice = num(raw.voice);
  if (voice > 0 && voice < VOICE_COUNT) career.voice = voice;
  const line = (key: 'intro' | 'win' | 'lose') => {
    const v = num(raw[key]);
    if (v > 0 && v < LINE_COUNT) career[key] = v;
  };
  line('intro');
  line('win');
  line('lose');
  const totals = saneTotals(raw.totals);
  if (totals) career.totals = totals;
  // An old career picked one number for all three (POK-243). Keep what it was saying
  // rather than resetting somebody to the top of the list: the three lines it resolved
  // to are all in the new pool, because the pool starts with the pools it came from.
  if (career.intro === undefined && career.win === undefined && career.lose === undefined && career.voice !== undefined) {
    const was = voiceOf(career.voice);
    const at = (text: string) => {
      const i = lineIndexOf(text);
      return i > 0 ? i : undefined;
    };
    career.intro = at(was.intro);
    career.win = at(was.win);
    career.lose = at(was.lose);
  }
  return career;
}

export function loadCareer(store: Pick<Storage, 'getItem' | 'setItem'> = localStorage): Career {
  try {
    const raw = store.getItem(KEY);
    return raw ? sane(JSON.parse(raw)) : { ...EMPTY };
  } catch {
    // A private window, or somebody else's JSON under our key: start clean rather than
    // taking the page down over a record nobody is depending on.
    return { ...EMPTY };
  }
}

/** Folds one finished match in and saves. A placement of 1 is a win. `counts` is what
 *  the match added to the lifetime stats, when the page could read them. */
export function recordMatch(
  placement: number | undefined,
  store: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
  counts?: Parameters<typeof addTotals>[1],
): Career {
  const career = loadCareer(store);
  career.matches++;
  if (placement === 1) career.wins++;
  if (counts) career.totals = addTotals(career.totals, counts);
  if (placement !== undefined && (career.best === undefined || placement < career.best)) {
    career.best = placement;
  }
  try {
    store.setItem(KEY, JSON.stringify(career));
  } catch {
    // Out of quota or a blocked store: the match still happened, the record just does
    // not survive the tab.
  }
  return career;
}

/** Adds to the lifetime stats of a match already recorded: what the ROM counted after
 *  the verdict, like the battle that won it (POK-416). */
export function addCareerTotals(
  counts: Parameters<typeof addTotals>[1],
  store: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): Career {
  const career = loadCareer(store);
  career.totals = addTotals(career.totals, counts);
  try {
    store.setItem(KEY, JSON.stringify(career));
  } catch {
    // As recordMatch: the match still happened.
  }
  return career;
}

/** "12 played · 3 won · best 2nd" -- the line the results panel shows. */
/** Sets who you are. Kept beside the record rather than in a key of its own, so one
 *  read is your whole profile. */
export function saveProfile(
  patch: { name?: string; skin?: number; voice?: number; intro?: number; win?: number; lose?: number },
  store: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): Career {
  const career = loadCareer(store);
  if (patch.name !== undefined) {
    const name = cleanName(patch.name);
    if (name) career.name = name;
    else delete career.name;
  }
  if (patch.skin !== undefined) {
    const wanted = ((patch.skin % SKINS.length) + SKINS.length) % SKINS.length;
    // A locked skin is refused rather than worn -- the lobby's own cycle never offers
    // one, but this is the backstop against a store poked by hand.
    if (skinUnlocked(wanted, career.wins)) career.skin = wanted;
  }
  if (patch.voice !== undefined) career.voice = ((patch.voice % VOICE_COUNT) + VOICE_COUNT) % VOICE_COUNT;
  for (const key of ['intro', 'win', 'lose'] as const) {
    const v = patch[key];
    if (v !== undefined) career[key] = ((v % LINE_COUNT) + LINE_COUNT) % LINE_COUNT;
  }
  try {
    store.setItem(KEY, JSON.stringify(career));
  } catch {
    // A blocked store: you are still that name for this tab's life.
  }
  return career;
}

export function careerLine(career: Career): string {
  const parts = [`${career.matches} played`, `${career.wins} won`];
  if (career.best !== undefined) parts.push(`best ${ordinal(career.best)}`);
  return parts.join(' · ');
}

/** The TRAINER CARD's eight badge slots (POK-335), filled one per win: the first badge
 *  for the first win, the second for the second (Kanto's player-card idea, its
 *  Instructions.md: "the badges correspond to wins"). */
export const CARD_BADGES = 8;

export function cardBadges(wins: number): number {
  return Math.max(0, Math.min(CARD_BADGES, Math.floor(wins)));
}

/** Wins for each of the card's four stars. Emerald's card turns bronze, copper, silver
 *  and gold as its stars come in (sHoennTrainerCardPals); here the first win turns it
 *  bronze, a full case of badges copper, 15 silver, and the wardrobe's last price gold. */
export const STAR_WINS = [1, 8, 15, 25];

export function cardStars(wins: number): number {
  return STAR_WINS.filter((w) => wins >= w).length;
}

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** The career as a file (POK-243). Kanto's career IS a file -- `lib/keyfile.lua` on
 *  disk, which a player can copy to another machine -- and a browser's localStorage
 *  cannot be copied at all, so the same ownership needs a door: take your record out,
 *  put it back on the next device. The shape is the record itself plus a tag, because
 *  a file somebody opens should say what it is. */
export const FILE_TAG = 'hoenn-battle-royale/career';

export function exportCareer(store: Pick<Storage, 'getItem' | 'setItem'> = localStorage): string {
  return JSON.stringify({ tag: FILE_TAG, v: 1, career: loadCareer(store) }, null, 2);
}

/** Reads one back. Answers the career that is now stored, or null when the text is not
 *  one of ours -- every field goes through the same `sane` a stored record does, so a
 *  hand-edited file cannot put a skin, a voice or a negative count into the app that
 *  the app would not have written itself. A claimed win total is taken at face value:
 *  this is one device's own record, there is no leaderboard to defend, and Kanto's
 *  keyfile is a text file anybody can edit too. */
export function importCareer(
  text: string,
  store: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): Career | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const file = parsed as { tag?: unknown; career?: unknown };
  if (file.tag !== FILE_TAG || typeof file.career !== 'object' || file.career === null) return null;
  const career = sane(file.career);
  // The wardrobe still has to be earned by the wins in the same file: a record that
  // claims BRENDAN'S RIVAL with no wins behind it wears what it has actually earned.
  if (career.skin !== undefined && !skinUnlocked(career.skin, career.wins)) delete career.skin;
  try {
    store.setItem(KEY, JSON.stringify(career));
  } catch {
    // Out of quota or a blocked store: nothing was kept, so say so rather than
    // pretending the import worked.
    return null;
  }
  return career;
}
