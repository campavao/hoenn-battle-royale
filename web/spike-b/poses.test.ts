// The frame drawn for a trainer on foot, every sim frame of a walk and a run (Cam, 11-14:
// "there is stuttering with the run animation"). Each frame is what main.ts's frameOf draws
// after that frame's tick.
import { describe, expect, it } from 'vitest';
import { newMover, tick, DIR_SOUTH, type Keys, type Mover, type StepFn } from './sim';
import { footPose, FACE, GO, RUN } from './poses';

const DXY: Record<number, [number, number]> = { 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] };
/** Open ground everywhere, but a wall at y = `wallY` and beyond. */
const open = (wallY = Infinity): StepFn => (from, dir) => {
  const to = { map: 'M', x: from.x + DXY[dir][0], y: from.y + DXY[dir][1] };
  return to.y >= wallY ? null : { to, hop: false };
};

/** The poses drawn over `frames` ticks of `keys`, from a trainer standing at 0,0. */
function poses(frames: { keys: Keys; n: number }[], step = open(), m: Mover = newMover({ map: 'M', x: 0, y: 0 }, DIR_SOUTH)): number[] {
  const out: number[] = [];
  for (const { keys, n } of frames) for (let i = 0; i < n; i++) { tick(m, keys, step); out.push(footPose(m, true)); }
  return out;
}

const RUN_SOUTH = new Set(RUN[DIR_SOUTH]);

describe('a run held down', () => {
  it('draws only the run sheet, never the walk stand between steps', () => {
    // Four steps of eight frames, the thumb still on the pad after the last.
    const drawn = poses([{ keys: { down: true }, n: 33 }]);
    const off = drawn.map((p, f) => ({ f, p })).filter(({ p }) => !RUN_SOUTH.has(p));
    expect(off).toEqual([]);
  });

  it('keeps sAnim_RunSouth\'s order: stride, stand, other stride, stand', () => {
    const drawn = poses([{ keys: { down: true }, n: 32 }]);
    // Each step's frames collapsed to the poses it shows in order.
    const steps = [0, 8, 16, 24].map((s) => [...new Set(drawn.slice(s, s + 8))]);
    const [a, b] = [steps[0][0], steps[0][0] === 12 ? 13 : 12];
    expect(steps).toEqual([[a, 9], [b, 9], [a, 9], [b, 9]]);
  });

  it('stands as the walk does once the thumb lets go', () => {
    const drawn = poses([{ keys: { down: true }, n: 16 }, { keys: {}, n: 3 }]);
    expect(drawn.slice(-2)).toEqual([FACE[DIR_SOUTH], FACE[DIR_SOUTH]]);
  });
});

describe('the walk and the wall are as they were', () => {
  it('a walk (B held) uses the walk sheet, its stand between steps', () => {
    const drawn = poses([{ keys: { down: true, b: true }, n: 33 }]);
    expect(drawn.every((p) => GO[DIR_SOUTH].includes(p))).toBe(true);
  });

  it('a run into a wall bumps on the walk sheet, and stands after', () => {
    // One step to y = 1, then the wall at y = 2.
    const drawn = poses([{ keys: { down: true }, n: 8 + 32 }, { keys: {}, n: 2 }], open(2));
    expect(drawn.slice(8, 40).every((p) => GO[DIR_SOUTH].includes(p))).toBe(true);
    expect(drawn.slice(-1)).toEqual([FACE[DIR_SOUTH]]);
  });
});
