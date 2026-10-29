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
});
