import { describe, expect, it } from 'vitest';
import { ASH_DELAY, frameOf, grassUnderAsh, isFloor, MB_ASHGRASS, MB_DEEP_SAND, MB_LONG_GRASS, MB_PUDDLE, MB_SAND, MB_TALL_GRASS, stepEffects, tireLook, type Step } from './fieldfx';

const step = (over: Partial<Step>): Step => ({ from: 0, to: 0, fromX: 0, fromY: 16, toX: 0, toY: 0, dir: 2, cameFrom: 2, bike: false, hop: false, ashGone: false, ...over });
const kinds = (s: Partial<Step>) => stepEffects(step(s), 100).map((e) => e.kind);

describe('what a step starts', () => {
  it('nothing on plain ground', () => {
    expect(kinds({})).toEqual([]);
  });

  it('grass rustles on the cell entered', () => {
    expect(stepEffects(step({ to: MB_TALL_GRASS }), 100)).toEqual([{ kind: 'grass', x: 0, y: 0, start: 100 }]);
    expect(kinds({ to: MB_LONG_GRASS })).toEqual(['long']);
    expect(kinds({ to: MB_PUDDLE })).toEqual(['splash']);
  });

  it("ash goes up after the ROM's delay, once a cell", () => {
    expect(stepEffects(step({ to: MB_ASHGRASS }), 100)).toEqual([{ kind: 'ash', x: 0, y: 0, start: 100 + ASH_DELAY }]);
    expect(kinds({ to: MB_ASHGRASS, ashGone: true })).toEqual([]);
  });

  it('tracks are left on the cell walked off, footprints or tyres', () => {
    const [foot] = stepEffects(step({ from: MB_SAND }), 100);
    expect(foot).toMatchObject({ kind: 'foot', x: 0, y: 16 });
    expect(kinds({ from: MB_DEEP_SAND })).toEqual(['deep']);
    expect(kinds({ from: MB_SAND, bike: true })).toEqual(['tire']);
    expect(kinds({ to: MB_SAND })).toEqual([]);
  });

  it('a ledge lands in dust as the hop ends, grass rustles instead', () => {
    expect(stepEffects(step({ hop: true }), 100)).toEqual([{ kind: 'dust', x: 0, y: 0, start: 132 }]);
    expect(kinds({ hop: true, to: MB_TALL_GRASS })).toEqual(['grass']);
  });
});

describe('how it plays', () => {
  it("runs the sAnim's frames and ends", () => {
    const e = { kind: 'grass' as const, x: 0, y: 0, start: 100 };
    expect(frameOf(e, 99)).toBeNull();
    expect(frameOf(e, 100)).toBe(1);
    expect(frameOf(e, 110)).toBe(2);
    expect(frameOf(e, 149)).toBe(0);
    expect(frameOf(e, 150)).toBe('done');
  });

  it('a footprint stays 40 frames, flickers, and is gone after 56', () => {
    const e = { kind: 'foot' as const, x: 0, y: 0, start: 0, look: { frame: 1, hFlip: false, vFlip: false } };
    expect(frameOf(e, 40)).toBe(1);
    expect(frameOf(e, 41)).toBeNull();
    expect(frameOf(e, 42)).toBe(1);
    expect(frameOf(e, 57)).toBe('done');
  });

  it('tracks lie under everybody, the rest among them', () => {
    expect(isFloor('foot')).toBe(true);
    expect(isFloor('tire')).toBe(true);
    expect(isFloor('grass')).toBe(false);
    expect(isFloor('ash')).toBe(false);
  });
});

describe('the ROM tables', () => {
  it('a tyre track bends with the turn', () => {
    expect(tireLook(1, 1)).toMatchObject({ frame: 2 }); // south on south
    expect(tireLook(1, 3)).toMatchObject({ frame: 3, hFlip: true }); // south, then west
    expect(tireLook(3, 3)).toMatchObject({ frame: 1 }); // west on west
    expect(tireLook(3, 1)).toMatchObject({ frame: 0, hFlip: false }); // west, then south
  });

  it("ash leaves its own tileset's plain grass", () => {
    expect(grassUnderAsh(0x20a)).toBe(0x212);
    expect(grassUnderAsh(0x20a | 0x400)).toBe(0x212);
    expect(grassUnderAsh(0x207)).toBe(0x206);
  });
});
