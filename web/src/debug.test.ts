import { describe, expect, it } from 'vitest';
import appSource from './app.ts?raw';
import { DEBUG_FLAGS, DEBUG_MENU_KEY, cycleFlag, flagDetail, toggleDebugMenu } from './debug';
import { devPace, perfWanted, withRoom } from './hash';
import { measure } from './ui/emerald';
import { W } from './ui/screens';

const flag = (key: string) => DEBUG_FLAGS.find((f) => f.key === key)!;
/** What a row says for `hash`, with the pace the page would read off it. */
const detail = (key: string, hash: string) => flagDetail(flag(key), hash, devPace(hash));

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
    expect(detail('fast', '#fast')).toBe('ON');
    expect(detail('fast', '')).toBe('OFF');
    expect(detail('safari', '')).toBe('ROOM');
    expect(detail('safari', '#safari=60')).toBe('60s');
    expect(detail('seed', '#seed=7')).toBe('7');
    expect(detail('away', '')).toBe('2 MIN');
  });

  it('say the pace #fast runs, not ROOM, under FAST PACE', () => {
    expect(detail('safari', '#fast')).toBe('25s');
    expect(detail('fog', '#fast')).toBe('15s');
    expect(detail('fog', '#fast&fog=60')).toBe('60s');
  });

  it('start every switch at off, and fit every label beside every value it can say', () => {
    for (const f of DEBUG_FLAGS) {
      expect(f.choices[0], f.key).toBeNull();
      for (const v of f.choices) {
        const hash = v === null ? '' : v === '' ? f.key : `${f.key}=${v}`;
        const detail = flagDetail(f, hash, devPace(hash));
        // paintRows's room for a detail: the row inside the frame, less the cursor's slot,
        // the label and an 8px gap.
        expect(measure(detail), `${f.key} ${detail}`).toBeLessThanOrEqual(W - 16 - 8 - measure(f.label) - 8);
      }
    }
  });

  it('leave only #perf readable in a build: the rest rig a match', () => {
    expect(DEBUG_FLAGS.filter((f) => !f.dev).map((f) => f.key)).toEqual(['perf']);
  });

  it('turn the tile on and off under the key app.ts reads for it', () => {
    const store = new Map<string, string>();
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as Storage;
    toggleDebugMenu(fake);
    expect(store.get('hbr-debug-menu')).toBe('1');
    toggleDebugMenu(fake);
    expect(store.size).toBe(0);
    // Spelled out there too, so debug.ts stays out of main.js.
    expect(appSource).toContain(`localStorage.getItem('${DEBUG_MENU_KEY}') === '1'`);
  });
});
