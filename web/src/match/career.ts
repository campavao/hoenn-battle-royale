// What a player carries between matches (POK-228): how many they have played, how many
// they have won, and the best they have ever placed. Kanto keeps the same three in
// `lib/career.lua`, and for the same reason -- a battle royale with no memory of last
// time is a demo.
//
// localStorage, not the relay: this is one device's own record, it is never authority
// for anything, and a wiped browser costing somebody their streak is a smaller problem
// than a server that has to be trusted with it.
const KEY = 'hbr:career';

export interface Career {
  matches: number;
  wins: number;
  /** 1 = a win. Undefined until a match has been finished. */
  best?: number;
}

const EMPTY: Career = { matches: 0, wins: 0 };

function sane(value: unknown): Career {
  if (typeof value !== 'object' || value === null) return { ...EMPTY };
  const raw = value as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const career: Career = { matches: num(raw.matches), wins: num(raw.wins) };
  const best = num(raw.best);
  if (best > 0) career.best = best;
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
