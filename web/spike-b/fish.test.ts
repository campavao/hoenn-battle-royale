import { describe, expect, it } from 'vitest';
import { glyphIds } from '../src/ui/emerald';
import { Fishing, GOOD_ROD, OLD_ROD, SUPER_ROD, TEXT_AWAY, TEXT_BITE, TEXT_HOOKED, TEXT_NIBBLE, fishPose, rodOf } from './fish';

/** Random() as a list of rolls, then zeroes. */
const rolls = (...r: number[]) => () => r.shift() ?? 0;

/** Frames until the box says `text` (A pressed on each frame `press` says), at most `max`. */
function until(f: Fishing, text: (t: string) => boolean, press: (n: number) => boolean = () => false, max = 2000): number {
  for (let n = 0; n < max; n++) {
    if (text(f.text)) return n;
    f.frame(press(n));
  }
  throw new Error(`never: ${f.text}`);
}

describe('fishing, as Task_Fishing', () => {
  it("draws its dots in the ROM's font, not as spaces", () => {
    expect(glyphIds('·')).toEqual([0xaf]);
  });

  it('knows the rods by their items', () => {
    expect([rodOf(262), rodOf(263), rodOf(264), rodOf(259)]).toEqual([OLD_ROD, GOOD_ROD, SUPER_ROD, -1]);
  });

  it('waits a second with the rod out, then dots, four to ten the first round', () => {
    // minRounds roll, dots roll 0 -> 4 dots.
    const f = new Fishing(OLD_ROD, true, rolls(0, 0, 0));
    let n = 0;
    for (; !f.boxed; n++) f.frame(false);
    expect(n).toBe(60);
    expect(until(f, (t) => t !== '')).toBe(20);
    until(f, (t) => t.includes(TEXT_BITE));
    expect(f.text).toBe(`· · · ·\n${TEXT_BITE}`);
  });

  it('a map with no table is never a bite', () => {
    const f = new Fishing(OLD_ROD, false, rolls());
    until(f, (t) => t === TEXT_NIBBLE);
    expect(f.anim).toBe('away');
  });

  it('the first round is a coin: odd is not even a nibble', () => {
    const f = new Fishing(OLD_ROD, true, rolls(0, 0, 1));
    until(f, (t) => t === TEXT_NIBBLE);
  });

  it('A in time hooks it; the box closes on the next press', () => {
    const f = new Fishing(OLD_ROD, true, rolls(0, 0, 0));
    until(f, (t) => t.includes(TEXT_BITE));
    expect(f.anim).toBe('hooked');
    expect(f.frame(true)).toBe(null);
    expect(f.text).toBe(TEXT_HOOKED);
    f.frame(false);
    f.frame(false);
    expect(f.frame(true)).toBe('hooked');
  });

  it('too slow, and it got away: 36 frames on the OLD ROD, 30 on the SUPER', () => {
    for (const [rod, frames] of [[OLD_ROD, 36], [SUPER_ROD, 30]] as const) {
      const f = new Fishing(rod, true, rolls(0, 0, 0));
      until(f, (t) => t.includes(TEXT_BITE));
      expect(until(f, (t) => t === TEXT_AWAY)).toBe(frames);
    }
  });

  it('A before the bite is nothing on the first round', () => {
    const f = new Fishing(OLD_ROD, true, rolls(0, 0, 0));
    while (!f.boxed) f.frame(false);
    f.frame(true);
    expect(f.text).toBe(TEXT_NIBBLE);
  });

  it('the SUPER ROD can want up to six rounds, each a bite to answer', () => {
    // minRounds = 1 + 5 % 6 = 6.
    const f = new Fishing(SUPER_ROD, true, rolls(5, 0, 0));
    let bites = 0;
    for (let n = 0; n < 5000 && f.text !== TEXT_HOOKED; n++) {
      const biting = f.text.includes(TEXT_BITE);
      if (biting) bites++;
      f.frame(biting);
    }
    expect(f.text).toBe(TEXT_HOOKED);
    expect(bites).toBe(6);
  });

  it('a bitten GOOD ROD plays another round 10 in 100 after the first (its second column)', () => {
    const go = (more: number) => {
      // minRounds 1, dots 0, coin 0 (a bite), then the more-dots roll.
      const f = new Fishing(GOOD_ROD, true, rolls(0, 0, 0, more));
      until(f, (t) => t.includes(TEXT_BITE));
      f.frame(true);
      return f.text;
    };
    expect(go(9)).not.toBe(TEXT_HOOKED);
    expect(go(10)).toBe(TEXT_HOOKED);
  });
});

describe('the fishing sprite', () => {
  it('takes the rod out facing the water, then holds it', () => {
    expect([0, 4, 8, 12, 100].map((t) => fishPose('out', t, 1).frame)).toEqual([8, 9, 10, 11, 11]);
    expect(fishPose('out', 100, 2).frame).toBe(7);
    expect(fishPose('out', 100, 4)).toEqual({ frame: 3, flip: true, dx: 8, dy: 0 });
    expect(fishPose('out', 100, 3)).toEqual({ frame: 3, flip: false, dx: -8, dy: 0 });
    // south's rod frames reach down a cell's half
    expect(fishPose('out', 100, 1).dy).toBe(8);
  });

  it('tugs twice when it bites, and puts the rod away after', () => {
    expect([0, 6, 12, 18, 24, 50].map((t) => fishPose('hooked', t, 1).frame)).toEqual([10, 11, 10, 11, 11, 11]);
    expect([0, 4, 10, 16, 40].map((t) => fishPose('away', t, 1).frame)).toEqual([11, 10, 9, 8, 8]);
    expect([0, 4, 8, 12].map((t) => fishPose('away', t, 3).frame)).toEqual([3, 2, 1, 0]);
  });
});
