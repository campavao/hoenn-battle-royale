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
  it('a reload within a minute is the same trainer; later, it watches', () => {
    let t = 0;
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 0, cap: 30, now: () => t, log: () => undefined });
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
});
