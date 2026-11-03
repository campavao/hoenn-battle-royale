import { afterEach, describe, expect, it, vi } from 'vitest';
import { fightKey, nextAfter, pickedBy, Watch } from './watch';

afterEach(() => { vi.unstubAllGlobals(); });

describe('one fight, whatever the two seats did before it', () => {
  const start = (seed: number[]) => ({ t: 'bstart' as const, battle: 2050, data: [...seed, 14, 0, 0, 0] });
  it('a rematch of the same pair is another fight, the same one sent again is not', () => {
    expect(fightKey(2, start([1, 2, 3, 4]))).toBe(fightKey(2, start([1, 2, 3, 4])));
    expect(fightKey(2, start([1, 2, 3, 4]))).not.toBe(fightKey(2, start([9, 2, 3, 4])));
    expect(fightKey(2, start([1, 2, 3, 4]))).not.toBe(fightKey(8, start([1, 2, 3, 4])));
  });
});

describe('the watcher is told what the trainer watched took (POK-268)', () => {
  it('tells each new key of theirs once, and nothing taken before the watch began', () => {
    const picked = new Map<number, number>([[1, 5], [2, 7]]);
    const seen = new Set(picked.keys());
    expect(pickedBy(picked, seen, 5)).toEqual([]);
    picked.set(3, 5);
    picked.set(4, 7);
    expect(pickedBy(picked, seen, 5)).toEqual([3]);
    expect(pickedBy(picked, seen, 5), 'once').toEqual([]);
  });

  it('a key taken while nobody was watched is never told later', () => {
    const picked = new Map<number, number>();
    const seen = new Set<number>();
    picked.set(9, 5);
    expect(pickedBy(picked, seen, 0)).toEqual([]);
    expect(pickedBy(picked, seen, 5)).toEqual([]);
  });
});

describe('a replay that ends itself', () => {
  const el = () => ({ hidden: false, textContent: '', style: {}, classList: { add() {}, remove() {} }, addEventListener() {} });
  const start = { t: 'bstart' as const, battle: 2050, data: [1, 2, 3, 4, 14, 0, 0, 0] };

  function rig() {
    const els = new Map<string, ReturnType<typeof el>>();
    vi.stubGlobal('document', { getElementById: (id: string) => els.get(id) ?? els.set(id, el()).get(id) });
    vi.stubGlobal('devicePixelRatio', 1);
    let onTheMap = true;
    const room = { picked: new Map(), actor: (id: number) => (id === 2 ? { id, name: 'BRENDAN', battling: true, foe: 8, skin: 0 } : undefined) };
    const asked: number[] = [];
    const told: string[] = [];
    let follow = 2;
    // Ends itself as soon as it is asked, as the ROM's turn check would; held when `hold` is on.
    let release: (() => void) | null = null;
    let hold = false;
    const link = {
      room, onSp: null as ((from: number, m: typeof start) => void) | null, onEyes: null,
      watch: (id: number) => { asked.push(id); },
      sp: () => {},
    };
    const mirrors: number[] = [];
    const rom = {
      publish: () => {},
      mirror: (feed: { peek(): unknown; shift(): void }) => {
        mirrors.push(1);
        for (let m = feed.peek(); m; m = feed.peek()) feed.shift();
        return hold ? new Promise<void>((r) => { release = r; }) : Promise.resolve();
      },
    };
    const watch = new Watch({
      trainers: () => (onTheMap ? [{ id: 2, name: 'BRENDAN' }] : []) as never,
      me: () => 1003,
      spectating: () => true,
      follow: () => follow,
      setFollow: (id) => { follow = id; },
      zoom: () => 2,
      link: () => link as never,
      rom: () => rom as never,
      idle: () => true,
      describe: () => null,
      tell: (t) => void told.push(t),
    });
    return {
      watch, link, asked, told, mirrors,
      hold: () => { hold = true; },
      release: () => { release?.(); },
      gone: () => { onTheMap = false; },
      follow: () => follow,
    };
  }

  const settled = () => new Promise((r) => setTimeout(r, 0));

  it('goes back in for the whole fight once, then says so and stays out', async () => {
    const r = rig();
    r.watch.frame();
    expect(r.asked).toEqual([2]);
    r.link.onSp!(2, start);
    r.watch.frame();
    await settled();
    expect(r.mirrors.length).toBe(1);
    expect(r.asked, 'a new watch: the relay sends the fight from its start').toEqual([2, 0, 2]);
    expect(r.told).toEqual([]);

    r.link.onSp!(2, start);
    r.watch.frame();
    await settled();
    expect(r.mirrors.length).toBe(2);
    expect(r.asked, 'the same stream would only end again').toEqual([2, 0, 2]);
    expect(r.told).toEqual(["BRENDAN's battle can't be shown."]);
  });

  it('a rematch of the same two is a new fight, and gets its own try', async () => {
    const r = rig();
    r.watch.frame();
    r.link.onSp!(2, start);
    r.watch.frame();
    await settled();
    r.link.onSp!(2, { ...start, data: [9, 9, 9, 9, 14, 0, 0, 0] });
    r.watch.frame();
    await settled();
    expect(r.asked).toEqual([2, 0, 2, 0, 2]);
    expect(r.told).toEqual([]);
  });

  it('the camera stays under a replay of the fight that put the trainer out, and moves on after', async () => {
    const r = rig();
    r.hold();
    r.watch.frame();
    r.link.onSp!(2, start);
    r.watch.frame();
    expect(r.watch.replaying).toBe(true);
    r.gone();
    r.watch.frame();
    expect(r.follow(), 'still on them: moving on would stop the replay').toBe(2);
    r.release();
    await settled();
    r.watch.frame();
    expect(r.follow()).toBe(0);
  });
});

describe('the camera on a trainer who is out goes on to the next one still in', () => {
  it('the next in the strip, round to the first, none when nobody is left', () => {
    expect(nextAfter([2, 4, 9], 5)).toBe(9);
    expect(nextAfter([2, 4, 9], 9)).toBe(2);
    expect(nextAfter([], 3)).toBeNull();
  });
});
