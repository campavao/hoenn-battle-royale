import { describe, expect, it } from 'vitest';
import { DEBUG_FLAGS, cycleFlag, flagDetail, flagValue } from './debug';
import { devPace, perfWanted, withRoom } from './hash';
import { fitText } from './ui/emerald';
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
    expect(flagDetail(flag('fast'), flagValue('#fast', flag('fast')))).toBe('ON');
    expect(flagDetail(flag('fast'), flagValue('', flag('fast')))).toBe('OFF');
    expect(flagDetail(flag('safari'), flagValue('', flag('safari')))).toBe('ROOM');
    expect(flagDetail(flag('safari'), flagValue('#safari=60', flag('safari')))).toBe('60s');
    expect(flagDetail(flag('seed'), flagValue('#seed=7', flag('seed')))).toBe('7');
    expect(flagDetail(flag('away'), null)).toBe('2 MIN');
  });

  it('start every switch at off, and fit every label beside its widest value', () => {
    for (const f of DEBUG_FLAGS) {
      expect(f.choices[0], f.key).toBeNull();
      const widest = Math.max(...f.choices.map((v) => flagDetail(f, v).length));
      const line = `${f.label}  ${'0'.repeat(widest)}`;
      expect(fitText(line, W - 32), f.key).toBe(line);
    }
  });

  it('leave only #perf readable in a build: the rest rig a match (devsurface.test.ts)', () => {
    expect(DEBUG_FLAGS.filter((f) => !f.dev).map((f) => f.key)).toEqual(['perf']);
  });
});
