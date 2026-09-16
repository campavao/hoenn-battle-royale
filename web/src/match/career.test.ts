import { describe, expect, it } from 'vitest';
import { VOICE_COUNT } from '../bots/lines';
import {
  careerLine,
  cleanName,
  loadCareer,
  NAME_MAX,
  nextLockedSkin,
  nextSkin,
  recordMatch,
  saveProfile,
  SKIN_UNLOCK_WINS,
  SKINS,
  skinUnlocked,
} from './career';

/** A localStorage that lives for one test. */
function store() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('a name', () => {
  it('is uppercase, letters and digits, at most Emerald s seven', () => {
    expect(cleanName('brendan')).toBe('BRENDAN');
    expect(cleanName('  may  ')).toBe('MAY');
    expect(cleanName('a-very-long-name')).toHaveLength(NAME_MAX);
    expect(cleanName('!!!')).toBe('');
  });
});

describe('the profile', () => {
  it('is kept beside the record, so one read is the lot', () => {
    const s = store();
    recordMatch(1, s);
    saveProfile({ name: 'wally', skin: 2 }, s);
    const career = loadCareer(s);
    expect(career.name).toBe('WALLY');
    expect(career.skin).toBe(2);
    expect(career.wins).toBe(1); // the record survived the profile write
  });

  it('forgets a name that is not one, rather than keeping a blank', () => {
    const s = store();
    saveProfile({ name: 'MAY' }, s);
    saveProfile({ name: '???' }, s);
    expect(loadCareer(s).name).toBeUndefined();
  });

  it('cycles the skins and wraps', () => {
    expect(nextSkin(0)).toBe(1);
    expect(nextSkin(SKINS.length - 1)).toBe(0);
  });

  it('survives a store holding nonsense', () => {
    const s = store();
    s.setItem('hbr:career', '{"name":42,"skin":"blue","wins":-3}');
    const career = loadCareer(s);
    expect(career.name).toBeUndefined();
    expect(career.skin).toBeUndefined();
    expect(career.wins).toBe(0);
  });
});

describe('the wardrobe', () => {
  it('starts with the two base trainers unlocked and the rivals locked', () => {
    expect(skinUnlocked(0, 0)).toBe(true);
    expect(skinUnlocked(1, 0)).toBe(true);
    expect(skinUnlocked(2, 0)).toBe(false);
    expect(skinUnlocked(3, 0)).toBe(false);
  });

  it('unlocks each rival at its own win threshold, not before', () => {
    const rivalBrendan = SKIN_UNLOCK_WINS[2];
    expect(skinUnlocked(2, rivalBrendan - 1)).toBe(false);
    expect(skinUnlocked(2, rivalBrendan)).toBe(true);
  });

  it('names the next locked skin and how many wins it takes, or nothing once full', () => {
    expect(nextLockedSkin(0)?.skin).toBe(2);
    expect(nextLockedSkin(SKIN_UNLOCK_WINS[SKINS.length - 1])).toBeNull();
  });

  it('cycles past a locked skin rather than landing on it', () => {
    // At 0 wins only BRENDAN(0)/MAY(1) are unlocked.
    expect(nextSkin(0, 0)).toBe(1);
    expect(nextSkin(1, 0)).toBe(0); // wraps past both locked rivals
  });

  it('refuses to save a skin the win count has not earned', () => {
    const s = store();
    saveProfile({ skin: 3 }, s); // 0 wins: RIVAL MAY is locked
    expect(loadCareer(s).skin).toBeUndefined();
    recordMatch(1, s);
    recordMatch(1, s);
    recordMatch(1, s); // 3 wins: RIVAL MAY unlocks
    saveProfile({ skin: 3 }, s);
    expect(loadCareer(s).skin).toBe(3);
  });
});

describe('the chosen voice', () => {
  it('is kept beside the record, and wraps like a skin', () => {
    const s = store();
    saveProfile({ voice: 1 }, s);
    expect(loadCareer(s).voice).toBe(1);
    saveProfile({ voice: VOICE_COUNT }, s); // wraps back to 0, which reads as unset
    expect(loadCareer(s).voice).toBeUndefined();
  });

  it('drops an out-of-range voice from a store holding nonsense', () => {
    const s = store();
    s.setItem('hbr:career', JSON.stringify({ voice: VOICE_COUNT + 5 }));
    expect(loadCareer(s).voice).toBeUndefined();
  });
});

describe('the career line', () => {
  it('reads as a record', () => {
    const s = store();
    recordMatch(1, s);
    expect(careerLine(loadCareer(s))).toContain('1 won');
  });
});
