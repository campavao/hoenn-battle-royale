import { describe, expect, it } from 'vitest';
import { DEBUG_FLAGS, cycleFlag, flagDetail } from './debug';
import { devPace, perfWanted, withRoom } from './hash';
import { measure } from './ui/emerald';
import { W } from './ui/screens';

const flag = (key: string) => DEBUG_FLAGS.find((f) => f.key === key)!;

describe('the DEBUG rows', () => {
  it('step a bare flag on and off, leaving the rest of the hash alone', () => {
    const on = cycleFlag('#quick&rom=x', flag('fast'));
    expect(on).toBe('quick&rom=x&fast');
    expect(cycleFlag(`#${on}`, flag('fast'))).toBe('quick&rom=x');
  });

  it('step a value through its choices and back to off', () => {
    let hash = '';
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      hash = cycleFlag(hash, flag('safari'));
      seen.push(hash);
    }
    expect(seen).toEqual(['safari=25', 'safari=60', 'safari=120', '']);
  });

  it('send a value typed by hand to off on the next press', () => {
    expect(cycleFlag('#seed=99&fast', flag('seed'))).toBe('fast');
  });

  it('write what the page already reads', () => {
    let hash = cycleFlag('', flag('fast'));
    hash = cycleFlag(hash, flag('fog'));
    expect(devPace(hash)).toEqual({ safariSecs: 25, fogSecs: 15 });
    expect(perfWanted(cycleFlag(hash, flag('perf')))).toBe(true);
    // ...and a door into a room keeps them, as a typed flag always was.
    expect(withRoom(hash, 'host')).toBe('fast&fog=15&host');
  });

  it('say what each value means', () => {
    expect(flagDetail(flag('fast'), '#fast')).toBe('ON');
    expect(flagDetail(flag('fast'), '')).toBe('OFF');
    expect(flagDetail(flag('safari'), '')).toBe('ROOM');
    expect(flagDetail(flag('safari'), '#safari=60')).toBe('60s');
    expect(flagDetail(flag('seed'), '#seed=7')).toBe('7');
    expect(flagDetail(flag('away'), '')).toBe('2 MIN');
  });

  it('say the pace #fast runs, not ROOM, under FAST PACE', () => {
    expect(flagDetail(flag('safari'), '#fast')).toBe('25s');
    expect(flagDetail(flag('fog'), '#fast')).toBe('15s');
    expect(flagDetail(flag('fog'), '#fast&fog=60')).toBe('60s');
  });

  it('start every switch at off, and fit every label beside every value it can say', () => {
    for (const f of DEBUG_FLAGS) {
      expect(f.choices[0], f.key).toBeNull();
      for (const v of f.choices) {
        const hash = v === null ? '' : v === '' ? f.key : `${f.key}=${v}`;
        const detail = flagDetail(f, hash);
        // paintRows's room for a detail: the row inside the frame, less the cursor's slot,
        // the label and an 8px gap.
        expect(measure(detail), `${f.key} ${detail}`).toBeLessThanOrEqual(W - 16 - 8 - measure(f.label) - 8);
      }
    }
  });

  it('leave only #perf readable in a build: the rest rig a match', () => {
    expect(DEBUG_FLAGS.filter((f) => !f.dev).map((f) => f.key)).toEqual(['perf']);
  });
});
