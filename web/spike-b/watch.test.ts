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
    const room = { picked: new Map(), actor: (id: number) => (id === 2 ? { id, bot: true, name: 'BRENDAN', battling: true, foe: 8, skin: 0 } : undefined) };
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
      view: () => null,
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

describe('a fight with a log is drawn by the page', () => {
  const el = () => ({ hidden: true, textContent: '', style: {}, classList: { add() {}, remove() {} }, addEventListener() {} });
  const bstart = { t: 'bstart' as const, battle: 2050, data: [1, 2, 3, 4, 14, 0, 0, 0] };
  const mon = { species: 280, level: 12, hp: 31, maxHp: 31, status: 0 };
  const start = (a = 2, b = 8) => ({ e: 'start' as const, a: { seat: a, name: 'A', skin: 0, team: [mon] }, b: { seat: b, name: 'B', skin: 1, team: [mon] }, map: 'MAP_ROUTE101' });

  function rig(fighterBot = true) {
    const els = new Map<string, ReturnType<typeof el>>();
    vi.stubGlobal('document', { getElementById: (id: string) => els.get(id) ?? els.set(id, el()).get(id) });
    vi.stubGlobal('devicePixelRatio', 1);
    let battling = true;
    let foe = 8;
    const results = { winner: 0, entrants: [] as [number, string][], fallen: [] as { id: number }[] };
    const room = { results, picked: new Map(), actor: (id: number) => (id === 2 || id === 3 ? { id, bot: fighterBot, name: 'BRENDAN', battling, foe, skin: 0 } : undefined) };
    let follow = 2;
    let idle = true;
    const asked: number[] = [];
    const link = { room, onSp: null as never as (from: number, m: typeof bstart) => void, onEyes: null, onBattleLog: null as never as (from: number, f: number, e: unknown[], ago?: number) => void, watch: (id: number) => { asked.push(id); }, sp: () => {} };
    const mirrors: number[] = [];
    const songs: boolean[] = [];
    const sounds: number[] = [];
    const rom = { publish: () => {}, mirror: () => { mirrors.push(1); return new Promise<void>(() => {}); }, fightSong: (on: boolean) => songs.push(on), sound: (id: number) => sounds.push(id) };
    let cameInAt = 0;
    const views: { follow: number; played?: [unknown[], number]; added: unknown[]; closed: boolean; at: { next: number; ended: boolean; waiting: boolean } }[] = [];
    const watch = new Watch({
      trainers: () => [{ id: 2, name: 'BRENDAN' }, { id: 3, name: 'MAY' }] as never,
      me: () => 1003,
      spectating: () => true,
      follow: () => follow,
      setFollow: (id) => { follow = id; },
      zoom: () => 2,
      link: () => link as never,
      rom: () => rom as never,
      idle: () => idle,
      describe: () => null,
      tell: () => undefined,
      view: (side) => {
        const v: (typeof views)[number] = { follow: side, added: [], closed: false, at: { next: cameInAt, ended: false, waiting: false } };
        views.push(v);
        return { play: (log, ms) => { v.played = [[...log], ms]; }, add: (ev) => { v.added.push(...ev); }, snapshot: () => v.at, redraw: () => undefined, close: () => { v.closed = true; } };
      },
    });
    return { comeInAt: (n: number) => { cameInAt = n; }, watch, link, asked, mirrors, songs, sounds, views, dim: () => els.get('battleview-dim')!, setFollow: (id: number) => { follow = id; }, setIdle: (on: boolean) => { idle = on; }, fightOver: () => { battling = false; }, otherFoe: () => { foe = 9; }, crowned: () => { results.winner = 7; } };
  }

  it('in the battle screen\'s place, from where the fight stands, its back to us on the side followed', () => {
    const r = rig();
    r.watch.frame();
    r.link.onBattleLog(2, 7, [start(8, 2)], 5000);
    r.watch.frame();
    expect(r.views).toHaveLength(1);
    expect(r.views[0].follow, 'side 1 is the one watched').toBe(1);
    expect(r.views[0].played![0]).toEqual([start(8, 2)]);
    expect(r.views[0].played![1]).toBeGreaterThanOrEqual(5000);
    expect(r.watch.viewing).toBe(true);
    expect(r.watch.replaying, 'the results wait for it').toBe(true);
    expect(r.dim().hidden).toBe(false);
    expect(r.songs).toEqual([true]);
    r.watch.frame();
    expect(r.views, 'one view').toHaveLength(1);
  });

  it('never starts the ROM\'s replay of a fight with a log; a stream that comes along is dropped', () => {
    const r = rig();
    r.watch.frame();
    r.link.onBattleLog(2, 7, [start()], 0);
    r.link.onSp(2, bstart);
    r.watch.frame();
    r.watch.frame();
    expect(r.mirrors).toEqual([]);
    expect(r.views).toHaveLength(1);
  });

  it('a BSTART from a trainer\'s page waits for their log, and the replay runs if none comes', () => {
    const r = rig(false);
    const at = vi.spyOn(performance, 'now');
    try {
      at.mockReturnValue(1000);
      r.watch.frame();
      r.link.onSp(2, bstart);
      r.watch.frame();
      expect(r.mirrors).toEqual([]);
      at.mockReturnValue(8999);
      r.watch.frame();
      expect(r.mirrors).toEqual([]);
      at.mockReturnValue(9001);
      r.watch.frame();
      expect(r.mirrors).toEqual([1]);
    } finally {
      at.mockRestore();
    }
  });

  it('a fight of the same trainer follows on by its `f`; another\'s is not this one', () => {
    const r = rig();
    r.watch.frame();
    r.link.onBattleLog(2, 7, [start()], 0);
    r.watch.frame();
    r.link.onBattleLog(2, 7, [{ e: 'text', text: 'one' }]);
    r.link.onBattleLog(2, 6, [{ e: 'text', text: 'old' }]);
    r.link.onBattleLog(5, 7, [{ e: 'text', text: 'theirs' }]);
    expect(r.views[0].added).toEqual([{ e: 'text', text: 'one' }]);
    // The next fight, with this one's end not played yet.
    r.link.onBattleLog(2, 8, [start()], 0);
    r.watch.frame();
    expect(r.views[0].closed).toBe(true);
    expect(r.views).toHaveLength(2);
  });

  it('a log of somebody I no longer watch, still on its way, is not opened', () => {
    const r = rig();
    r.watch.frame();
    r.link.onBattleLog(9, 7, [start(9, 10)], 0);
    r.watch.frame();
    expect(r.views).toEqual([]);
  });

  it('NEXT or STOP in a fight closes it, gives the field back and tells the relay', () => {
    const r = rig();
    r.watch.frame();
    r.link.onBattleLog(2, 7, [start()], 0);
    r.watch.frame();
    r.setFollow(3);
    r.watch.frame();
    expect(r.views[0].closed).toBe(true);
    expect(r.dim().hidden).toBe(true);
    expect(r.watch.viewing).toBe(false);
    expect(r.songs).toEqual([true, false]);
    expect(r.asked).toEqual([2, 3]);
    // The relay hears the new watch and sends that one's fight, from where it stands.
    r.link.onBattleLog(3, 9, [start(3, 8)], 2000);
    r.watch.frame();
    expect(r.views[1].closed).toBe(false);
    expect(r.views[1].follow).toBe(0);
    r.setFollow(0);
    r.watch.frame();
    expect(r.views[1].closed).toBe(true);
    expect(r.dim().hidden).toBe(true);
  });

  it('ends with the log, sounding what happens and nothing that was over before I came', () => {
    const r = rig();
    r.comeInAt(1);
    r.watch.frame();
    r.link.onBattleLog(2, 7, [start(), { e: 'send', side: 0, slot: 0 }, { e: 'hit', side: 0 }, { e: 'faint', side: 0 }, { e: 'end', winner: 8 }], 4000);
    r.watch.frame();
    expect(r.sounds, 'where I came in: said nothing').toEqual([]);
    r.views[0].at.next = 2;
    r.watch.frame();
    r.views[0].at.next = 3;
    r.watch.frame();
    r.views[0].at.next = 4;
    r.watch.frame();
    expect(r.sounds).toEqual([13, 16]);
    r.views[0].at.ended = true;
    r.watch.frame();
    expect(r.views[0].closed).toBe(true);
    expect(r.dim().hidden).toBe(true);
    expect(r.watch.replaying).toBe(false);
  });

  it('a log that lost its end stops waiting once the room says the fight is over', () => {
    const r = rig();
    const at = vi.spyOn(performance, 'now');
    try {
      at.mockReturnValue(1000);
      r.watch.frame();
      r.link.onBattleLog(2, 7, [start()], 0);
      r.watch.frame();
      r.views[0].at.waiting = true;
      r.watch.frame();
      expect(r.views[0].closed, 'between turns of a fight still on').toBe(false);
      r.fightOver();
      r.watch.frame();
      at.mockReturnValue(6100);
      r.watch.frame();
      expect(r.views[0].closed).toBe(true);
    } finally {
      at.mockRestore();
    }
  });

  describe('a log that just stops', () => {
    const run = (r: ReturnType<typeof rig>, at: ReturnType<typeof vi.spyOn>, ms: number) => { (at as unknown as { mockReturnValue(n: number): void }).mockReturnValue(ms); r.watch.frame(); };
    const open = (r: ReturnType<typeof rig>, at: ReturnType<typeof vi.spyOn>) => {
      run(r, at, 1000);
      r.link.onBattleLog(2, 7, [start()], 0);
      r.watch.frame();
      r.views[0].at.waiting = true;
    };

    it('the watched trainer in another fight: this one is over', () => {
      const r = rig();
      const at = vi.spyOn(performance, 'now');
      try {
        open(r, at);
        r.otherFoe();
        run(r, at, 1100);
        expect(r.views[0].closed).toBe(false);
        run(r, at, 6200);
        expect(r.views[0].closed).toBe(true);
      } finally {
        at.mockRestore();
      }
    });

    it('the match over, its room standing still with them still marked as fighting', () => {
      const r = rig();
      const at = vi.spyOn(performance, 'now');
      try {
        open(r, at);
        r.crowned();
        run(r, at, 1100);
        run(r, at, 6200);
        expect(r.views[0].closed).toBe(true);
      } finally {
        at.mockRestore();
      }
    });

    it('still marked as fighting and nothing heard for minutes: the socket has gone', () => {
      const r = rig();
      const at = vi.spyOn(performance, 'now');
      try {
        open(r, at);
        run(r, at, 100_000);
        expect(r.views[0].closed, 'a long think at a menu').toBe(false);
        r.link.onBattleLog(2, 7, [{ e: 'text', text: 'there you are' }]);
        run(r, at, 180_000);
        expect(r.views[0].closed, 'heard from at 100 s').toBe(false);
        run(r, at, 285_000);
        expect(r.views[0].closed).toBe(true);
      } finally {
        at.mockRestore();
      }
    });
  });

  it('comes up only when nothing of my own is on the screen, and where the fight stands by then', () => {
    const r = rig();
    const at = vi.spyOn(performance, 'now');
    try {
      at.mockReturnValue(1000);
      r.setIdle(false);
      r.watch.frame();
      r.link.onBattleLog(2, 7, [start(), { e: 'text', text: 'long enough to outlast this' }], 0);
      r.watch.frame();
      expect(r.views).toEqual([]);
      at.mockReturnValue(2000);
      r.setIdle(true);
      r.watch.frame();
      expect(r.views[0].played![1]).toBe(1000);
    } finally {
      at.mockRestore();
    }
  });
});
