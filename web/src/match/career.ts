// What a player carries between matches (POK-228): how many they have played, how many
// they have won, and the best they have ever placed. Kanto keeps the same three in
// `lib/career.lua`, and for the same reason -- a battle royale with no memory of last
// time is a demo.
//
// localStorage, not the relay: this is one device's own record, it is never authority
// for anything, and a wiped browser costing somebody their streak is a smaller problem
// than a server that has to be trusted with it.
import { VOICE_COUNT } from '../bots/lines';

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
   *  thing a bot gets, since nobody has picked one yet. */
  voice?: number;
}

/** How many sprites there are to pick from: `sSkinGraphics` in src/br/br_ghosts.c. */
export const SKINS = ['BRENDAN', 'MAY', 'RIVAL BRENDAN', 'RIVAL MAY'];

/** Wins needed to unlock each entry in SKINS, index for index -- Kanto's wardrobe
 *  ladder (lib/skins.lua unlocks nine trainer classes on a curve from 1 win), sized to
 *  Hoenn's four: your own two starting trainers are free, the rival's recolors are
 *  what winning earns. */
export const SKIN_UNLOCK_WINS = [0, 0, 1, 3];

export function skinUnlocked(skin: number, wins: number): boolean {
  return wins >= (SKIN_UNLOCK_WINS[skin] ?? 0);
}

/** The next skin still locked, and how many more wins it takes -- null once the
 *  wardrobe is full. What the lobby's sprite row hints at. */
export function nextLockedSkin(wins: number): { skin: number; wins: number } | null {
  for (let i = 0; i < SKINS.length; i++) {
    if (!skinUnlocked(i, wins)) return { skin: i, wins: SKIN_UNLOCK_WINS[i] };
  }
  return null;
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

/** The next skin after this one, skipping anything `wins` has not unlocked yet.
 *  `wins` defaults to unlimited so callers that do not care about the wardrobe (most
 *  of the existing tests, `voiceFor`-style pure use) still get a plain cycle. */
export function nextSkin(skin: number, wins = Number.POSITIVE_INFINITY): number {
  for (let i = 1; i <= SKINS.length; i++) {
    const candidate = (skin + i) % SKINS.length;
    if (skinUnlocked(candidate, wins)) return candidate;
  }
  return skin; // nothing else is unlocked -- stay put rather than loop forever
}

const EMPTY: Career = { matches: 0, wins: 0 };

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
  if (skin > 0 && skin < SKINS.length) career.skin = skin;
  const voice = num(raw.voice);
  if (voice > 0 && voice < VOICE_COUNT) career.voice = voice;
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

/** Folds one finished match in and saves. A placement of 1 is a win. */
export function recordMatch(
  placement: number | undefined,
  store: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): Career {
  const career = loadCareer(store);
  career.matches++;
  if (placement === 1) career.wins++;
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

/** "12 played · 3 won · best 2nd" -- the line the results panel shows. */
/** Sets who you are. Kept beside the record rather than in a key of its own, so one
 *  read is your whole profile. */
export function saveProfile(
  patch: { name?: string; skin?: number; voice?: number },
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
