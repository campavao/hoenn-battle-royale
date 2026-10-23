import { describe, expect, it } from 'vitest';
import { LEGEND_GFX, LegendWatch, legendGfx } from './legends';
import type { EventMsg } from '../net/wire';

const ev = (n: number, key: number, place?: string): EventMsg => ({ t: 'event', seat: 0, n, mapsec: 0, key, place });
const names = (seat: number) => ['ALICE', 'BOBBYBOBBY'][seat] ?? 'X';

describe('LegendWatch (the sheet\'s legendary chip, #10)', () => {
  it('says nothing before any legendary drops', () => {
    expect(new LegendWatch().chip([], { mon: () => undefined }, names)).toBeNull();
  });

  it('names the place while the legendary is down', () => {
    const w = new LegendWatch();
    const ground = { mon: (k: number) => (k === 0x8100 ? { species: 401 } : undefined) };
    expect(w.chip([ev(0, 0x8100, 'Route 111')], ground, names)).toBe('Legendary at ROUTE 111');
  });

  it('gives no chip for a rare find', () => {
    const w = new LegendWatch();
    expect(w.chip([ev(0, 0x8100, 'Route 111')], { mon: () => ({ species: 25 }) }, names)).toBeNull();
  });

  it('says who has it once it is taken, and the newest event wins', () => {
    const w = new LegendWatch();
    let down = true;
    const ground = { mon: (k: number) => (down && k === 0x8100 ? { species: 401 } : undefined) };
    w.chip([ev(0, 0x8100, 'Route 111')], ground, names);
    down = false;
    w.note({ t: 'pickup', seat: 1, key: 0x8100 });
    expect(w.chip([ev(0, 0x8100, 'Route 111')], ground, names)).toBe('BOBBYBO has the legendary');
  });

  it('stops saying who has it once they are out', () => {
    const w = new LegendWatch();
    w.chip([ev(0, 0x8100)], { mon: () => ({ species: 401 }) }, names);
    w.note({ t: 'pickup', seat: 0, key: 0x8100 });
    w.note({ t: 'out', seat: 0 });
    expect(w.chip([ev(0, 0x8100)], { mon: () => undefined }, names)).toBeNull();
  });

  it('forgets everything at a new start', () => {
    const w = new LegendWatch();
    w.chip([ev(0, 0x8100)], { mon: () => ({ species: 401 }) }, names);
    w.note({ t: 'pickup', seat: 0, key: 0x8100 });
    w.note({ t: 'start', seed: 1, spawns: [] });
    expect(w.chip([ev(0, 0x8100)], { mon: () => undefined }, names)).toBeNull();
  });
});

describe('legendGfx', () => {
  it("stands the match's own legendary as itself, and a trader holding one as a trader", () => {
    expect(legendGfx(0x8100, 407)).toBe(LEGEND_GFX.get(407));
    expect(legendGfx(0x8c21, 407), 'a house trader (Cam, 2026-10-23)').toBeUndefined();
    expect(legendGfx(0x8c92, 407), "a floor's trader").toBeUndefined();
    expect(legendGfx(0x0300, 407), "one out of a trainer's team").toBeUndefined();
  });
});
