// The relay's rooms (service.ts) on a clock of the test's own.
import { describe, expect, it } from 'vitest';
import type { WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';
import { WorldService } from './service';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const PATCHES = patchJson as unknown as PatchTable;

function phone() {
  const got: { t: string }[] = [];
  const p = { got, closed: false, link: { send: (t: string) => got.push(JSON.parse(t)), close: () => { p.closed = true; } } };
  return p;
}

describe('world rooms', () => {
  it('a room waits as long as it likes; a match lets a silent phone go', () => {
    let t = 0;
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 0, cap: 30, now: () => t, log: () => undefined });
    try {
      const a = phone();
      const s = svc.open(a.link);
      s.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true }));
      expect(a.got.at(-1)!.t).toBe('room');
      t += 10 * 60_000; // ten minutes in the room, saying nothing
      svc.pump();
      expect(a.closed).toBe(false);
      s.onText(JSON.stringify({ t: 'start' }));
      expect(a.got.some((m) => m.t === 'hello')).toBe(true);
      t += 1000;
      svc.pump();
      expect(a.closed).toBe(false);
      t += 130_000; // two minutes into the match without a key
      svc.pump();
      expect(a.closed).toBe(true);
    } finally {
      svc.stop();
    }
  });
  it('LOBBIES lists the hosted rooms, not quick play\'s, to anybody who asks', () => {
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 0, cap: 30, now: () => 0, log: () => undefined });
    try {
      const a = phone(), q = phone(), c = phone();
      svc.open(a.link).onText(JSON.stringify({ t: 'join', name: 'alice', skin: 3, host: true }));
      svc.open(q.link).onText(JSON.stringify({ t: 'join', name: 'quinn', skin: 0 }));
      const code = (a.got.at(-1) as unknown as { code: string }).code;
      const s = svc.open(c.link);
      s.onText(JSON.stringify({ t: 'list' }));
      expect(c.got.at(-1)).toEqual({ t: 'rooms', rooms: [{ code, host: 'ALICE', skin: 3, players: 1, seats: expect.any(Number), playing: false }] });
      // And in by its code.
      s.onText(JSON.stringify({ t: 'join', name: 'carl', skin: 0, code }));
      expect(c.got.at(-1)).toMatchObject({ t: 'room', code, members: [{ name: 'ALICE' }, { name: 'CARL' }] });
    } finally {
      svc.stop();
    }
  });
  it("the host's BOTS, FOG and SAFARI make the match; nobody else's", () => {
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 3, cap: 30, now: () => 0, log: () => undefined });
    try {
      const a = phone(), g = phone();
      const sa = svc.open(a.link);
      sa.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true }));
      const code = (a.got.at(-1) as unknown as { code: string }).code;
      const sg = svc.open(g.link);
      sg.onText(JSON.stringify({ t: 'join', name: 'gus', skin: 0, code }));
      expect(g.got.at(-1)).toMatchObject({ t: 'room', set: { bots: true, fogSecs: 120, safariSecs: 120 } });
      sg.onText(JSON.stringify({ t: 'set', set: { bots: false } }));
      expect(g.got.at(-1)).toMatchObject({ set: { bots: true } });
      sa.onText(JSON.stringify({ t: 'set', set: { bots: false, fogSecs: 60, safariSecs: 0 } }));
      sa.onText(JSON.stringify({ t: 'set', set: { fogSecs: 7 } })); // not a step: ignored
      expect(g.got.at(-1)).toMatchObject({ set: { bots: false, fogSecs: 60, safariSecs: 0 } });
      sa.onText(JSON.stringify({ t: 'start' }));
      const hello = g.got.find((m) => m.t === 'hello') as unknown as { state: { ringPhase?: number; opening?: number; actors: { bot: boolean }[] } };
      expect(hello.state.ringPhase).toBe(3600);
      expect(hello.state.opening).toBeUndefined();
      expect(hello.state.actors.filter((x) => x.bot)).toHaveLength(0);
    } finally {
      svc.stop();
    }
  });
  it('a reload within a minute is the same trainer; later, it watches', () => {
    // Bots on the map keep the match going after bob is the last trainer left.
    let t = 0;
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 3, cap: 30, now: () => t, log: () => undefined });
    try {
      const a = phone(), b = phone();
      const sa = svc.open(a.link), sb = svc.open(b.link);
      sa.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true }));
      const code = (a.got.at(-1) as unknown as { code: string }).code;
      sb.onText(JSON.stringify({ t: 'join', name: 'bob', skin: 0, code }));
      sa.onText(JSON.stringify({ t: 'start' }));
      const hello = a.got.find((m) => m.t === 'hello') as unknown as { id: number; key: string };
      expect(hello.key).toBeTruthy();
      t += 1000; svc.pump();
      sa.onClose();
      t += 20_000; svc.pump();
      // Back with the key: the same trainer, still on the map.
      const a2 = phone();
      const sa2 = svc.open(a2.link);
      sa2.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, code, again: { code, id: hello.id, key: hello.key } }));
      const back = a2.got.find((m) => m.t === 'hello') as unknown as { id: number; state: { actors: { id: number }[] } };
      expect(back.id).toBe(hello.id);
      expect(back.state.actors.some((x) => x.id === hello.id)).toBe(true);
      // A wrong key is somebody else: in to watch, as a new trainer.
      const c = phone();
      svc.open(c.link).onText(JSON.stringify({ t: 'join', name: 'eve', skin: 0, code, again: { code, id: hello.id, key: 'nope' } }));
      expect((c.got.find((m) => m.t === 'hello') as unknown as { id: number }).id).not.toBe(hello.id);
      // Gone past the minute: off the map, and the key no longer brings it back.
      sa2.onClose();
      t += 61_000; svc.pump();
      const a3 = phone();
      svc.open(a3.link).onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, code, again: { code, id: hello.id, key: hello.key } }));
      const late = a3.got.find((m) => m.t === 'hello') as unknown as { id: number; state: { actors: { id: number }[] } };
      expect(late.id).not.toBe(hello.id);
      expect(late.state.actors.some((x) => x.id === hello.id)).toBe(false);
      void sb;
    } finally {
      svc.stop();
    }
  });

  it('a room with a phone reloading stays open when everybody else leaves', () => {
    let t = 0;
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 0, cap: 30, now: () => t, log: () => undefined });
    try {
      const a = phone(), b = phone();
      const sa = svc.open(a.link);
      sa.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true }));
      const code = (a.got.at(-1) as unknown as { code: string }).code;
      sa.onText(JSON.stringify({ t: 'start' }));
      const hello = a.got.find((m) => m.t === 'hello') as unknown as { id: number; key: string };
      t += 1000; svc.pump();
      // Bob comes in late, alice reloads, bob goes.
      const sb = svc.open(b.link);
      sb.onText(JSON.stringify({ t: 'join', name: 'bob', skin: 0, code }));
      sa.onClose();
      sb.onClose();
      t += 20_000; svc.pump();
      const a2 = phone();
      svc.open(a2.link).onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, code, again: { code, id: hello.id, key: hello.key } }));
      expect((a2.got.find((m) => m.t === 'hello') as unknown as { id: number }).id).toBe(hello.id);
    } finally {
      svc.stop();
    }
  });

  it('counts who watches a trainer and hands them that trainer\'s battle, from its start', () => {
    let t = 0;
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 0, cap: 30, now: () => t, log: () => undefined });
    try {
      const a = phone(), b = phone(), c = phone();
      const sa = svc.open(a.link), sb = svc.open(b.link), sc = svc.open(c.link);
      sa.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true }));
      const code = (a.got.at(-1) as unknown as { code: string }).code;
      sb.onText(JSON.stringify({ t: 'join', name: 'bob', skin: 1, code }));
      sa.onText(JSON.stringify({ t: 'start' }));
      const hello = a.got.find((m) => m.t === 'hello') as unknown as { id: number };
      const alice = hello.id;
      t += 200;
      svc.pump();
      const eyes = () => (a.got.filter((m) => m.t === 'eyes').at(-1) as unknown as { n: number } | undefined)?.n;
      const sp = (p: ReturnType<typeof phone>) => p.got.filter((m) => m.t === 'sp') as unknown as { from: number; m: { t: string } }[];

      sb.onText(JSON.stringify({ t: 'watch', id: alice }));
      expect(eyes()).toBe(1);
      // Not in a battle: nothing of hers goes anywhere.
      sa.onText(JSON.stringify({ t: 'sp', m: { t: 'bstart', battle: 31 << 8, data: [1, 2, 3] } }));
      expect(sp(b)).toHaveLength(0);

      const room = [...(svc as unknown as { rooms: Map<string, { host: { room: { actor(id: number): { battling: boolean } } } }> }).rooms.values()][0];
      room.host.room.actor(alice).battling = true;
      sa.onText(JSON.stringify({ t: 'sp', m: { t: 'bstart', battle: 31 << 8, data: [1, 2, 3] } }));
      sa.onText(JSON.stringify({ t: 'sp', m: { t: 'turn', battle: 31 << 8, data: [0, 1, 4] } }));
      expect(sp(b).map((m) => [m.from, m.m.t])).toEqual([[alice, 'bstart'], [alice, 'turn']]);

      // Somebody who comes in late and watches her gets the fight from its BSTART.
      sc.onText(JSON.stringify({ t: 'join', name: 'carol', skin: 2, code }));
      sc.onText(JSON.stringify({ t: 'watch', id: alice }));
      expect(eyes()).toBe(2);
      expect(sp(c).map((m) => m.m.t)).toEqual(['bstart', 'turn']);

      sb.onText(JSON.stringify({ t: 'watch', id: 0 }));
      expect(eyes()).toBe(1);
      sa.onText(JSON.stringify({ t: 'sp', m: { t: 'turn', battle: 31 << 8, data: [0, 1, 5] } }));
      expect(sp(b)).toHaveLength(2);
      expect(sp(c)).toHaveLength(3);
      // Her battle over, the next watcher has nothing to start from.
      sa.onText(JSON.stringify({ t: 'end' }));
      sb.onText(JSON.stringify({ t: 'watch', id: alice }));
      expect(sp(b)).toHaveLength(2);
      sc.onClose();
      expect(eyes()).toBe(1);
    } finally {
      svc.stop();
    }
  });
});
