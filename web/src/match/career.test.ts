import { describe, expect, it } from 'vitest';
import { careerLine, cleanName, loadCareer, NAME_MAX, nextSkin, recordMatch, saveProfile, SKINS } from './career';

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

describe('the career line', () => {
  it('reads as a record', () => {
    const s = store();
    recordMatch(1, s);
    expect(careerLine(loadCareer(s))).toContain('1 won');
  });
});
