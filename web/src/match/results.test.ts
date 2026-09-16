import { describe, expect, it } from 'vitest';
import { Results } from './results';
import { careerLine, loadCareer, ordinal, recordMatch } from './career';

function memStore(): Pick<Storage, 'getItem' | 'setItem'> {
  const mem = new Map<string, string>();
  return {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => void mem.set(k, v),
  };
}

describe('placement, from the outs anybody can see', () => {
  it('counts back from the end: the winner is 1st, the first one out is last', () => {
    const r = new Results();
    r.start(4, 0);
    r.note({ t: 'out', seat: 3 }, 1000);
    r.note({ t: 'out', seat: 1 }, 2000);
    r.note({ t: 'out', seat: 2 }, 3000);
    r.note({ t: 'win', seat: 0 }, 3000);
    expect(r.forSeat(0, 4000).placement).toBe(1);
    expect(r.forSeat(2, 4000).placement).toBe(2);
    expect(r.forSeat(1, 4000).placement).toBe(3);
    expect(r.forSeat(3, 4000).placement).toBe(4);
  });

  it('gives every seat a distinct placement for any field and any order', () => {
    for (let seats = 2; seats <= 30; seats++) {
      const r = new Results();
      r.start(seats, 0);
      // A shuffled elimination order; the survivor is whoever is left.
      const all = Array.from({ length: seats }, (_, i) => i);
      for (let i = all.length - 1; i > 0; i--) {
        const j = (i * 7 + seats) % (i + 1); // deterministic, not random: a failure must repeat
        [all[i], all[j]] = [all[j], all[i]];
      }
      const winner = all[all.length - 1];
      for (const seat of all.slice(0, -1)) r.note({ t: 'out', seat }, 0);
      r.note({ t: 'win', seat: winner }, 0);
      const places = all.map((seat) => r.forSeat(seat, 0).placement);
      expect(places).not.toContain(undefined);
      expect(new Set(places).size, `seats=${seats}`).toBe(seats);
      expect(Math.min(...(places as number[]))).toBe(1);
      expect(Math.max(...(places as number[]))).toBe(seats);
      expect(r.forSeat(winner, 0).placement).toBe(1);
    }
  });

  it('a draw has no winner and still places everyone who went out', () => {
    const r = new Results();
    r.start(2, 0);
    r.note({ t: 'out', seat: 0 }, 100);
    r.note({ t: 'out', seat: 1 }, 100);
    r.note({ t: 'win' }, 100);
    expect(r.forSeat(0, 0).winner).toBeUndefined();
    expect(r.forSeat(1, 0).placement).toBe(1);
    expect(r.forSeat(0, 0).placement).toBe(2);
  });

  it('ignores a repeated out and anything after the match is decided', () => {
    const r = new Results();
    r.start(3, 0);
    r.note({ t: 'out', seat: 2 }, 0);
    r.note({ t: 'out', seat: 2 }, 0);
    expect(r.eliminationOrder()).toEqual([2]);
    r.note({ t: 'win', seat: 0 }, 0);
    r.note({ t: 'out', seat: 1 }, 0);
    expect(r.eliminationOrder()).toEqual([2]);
  });

  it('measures how long a seat lasted, to its own out', () => {
    const r = new Results();
    r.start(2, 10_000);
    r.note({ t: 'out', seat: 1 }, 100_000);
    r.note({ t: 'win', seat: 0 }, 100_000);
    expect(r.forSeat(1, 200_000).survived).toBe(90);
    expect(r.forSeat(0, 200_000).survived).toBe(90); // the winner's clock stops at the end too
  });
});

describe('the career record', () => {
  it('starts empty and counts matches, wins and the best placement', () => {
    const store = memStore();
    expect(loadCareer(store)).toEqual({ matches: 0, wins: 0 });
    recordMatch(4, store);
    recordMatch(1, store);
    recordMatch(7, store);
    expect(loadCareer(store)).toEqual({ matches: 3, wins: 1, best: 1 });
  });

  it('keeps the best placement, not the last', () => {
    const store = memStore();
    recordMatch(3, store);
    recordMatch(9, store);
    expect(loadCareer(store).best).toBe(3);
  });

  it('survives junk under its own key', () => {
    const store = memStore();
    store.setItem('hbr:career', 'not json at all');
    expect(loadCareer(store)).toEqual({ matches: 0, wins: 0 });
  });

  it('reads as a line', () => {
    expect(careerLine({ matches: 12, wins: 3, best: 2 })).toBe('12 played · 3 won · best 2nd');
    expect(careerLine({ matches: 0, wins: 0 })).toBe('0 played · 0 won');
  });

  it('ordinals the awkward ones', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st',
    ]);
  });
});
