// A deploy drains the relay it replaces (relay/server.js drain, Cam 11-16: "make it so clients
// are resilient to changes ... so that we don't have to wait until there is no traffic"): the
// matches under way play out on the old relay, every other room moves now, and a room that
// moved opens again on the new relay under its code when its people come back.
import { describe, expect, it } from 'vitest';
import type { WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';
import { WorldService } from './service';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const PATCHES = patchJson as unknown as PatchTable;

function phone() {
  const got: { t: string; [k: string]: unknown }[] = [];
  const p = { got, closed: false, link: { send: (t: string) => got.push(JSON.parse(t)), close: () => { p.closed = true; } } };
  return p;
}
const svcWith = (lines: string[]) => new WorldService({ maps: MAPS, patches: PATCHES, bots: 0, cap: 30, now: () => 0, log: (l: string) => { lines.push(l); } });
const roomOf = (p: ReturnType<typeof phone>) => p.got.filter((m) => m.t === 'room').at(-1) as unknown as { code: string; you: number; key: string; quick: boolean; owner: number; set: { door: string } };

describe('a draining relay', () => {
  it('plays out the match under way, moves every other room now, and takes nobody new', () => {
    const lines: string[] = [];
    const svc = svcWith(lines);
    try {
      // A match under way: two trainers, started.
      const a = phone(), b = phone();
      const sa = svc.open(a.link);
      sa.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true }));
      const code = roomOf(a).code;
      svc.open(b.link).onText(JSON.stringify({ t: 'join', name: 'bob', skin: 0, code }));
      sa.onText(JSON.stringify({ t: 'start' }));
      expect(a.got.some((m) => m.t === 'hello')).toBe(true);
      // A room still waiting.
      const w = phone();
      svc.open(w.link).onText(JSON.stringify({ t: 'join', name: 'wes', skin: 0, host: true }));
      const waiting = roomOf(w).code;
      expect(svc.busy).toBe(1);

      svc.drain();
      expect(w.closed).toBe(true);
      expect(lines).toContain(`room ${waiting} closed (draining, no heir)`);
      expect(a.closed || b.closed).toBe(false);
      expect(svc.busy).toBe(1);
      // Nobody new: the socket goes, and the page's reconnect finds the new relay.
      const n = phone();
      svc.open(n.link).onText(JSON.stringify({ t: 'join', name: 'nia', skin: 0, host: true }));
      expect(n.closed).toBe(true);
      expect(n.got.some((m) => m.t === 'room')).toBe(false);

      // The match ends: its standings go out, then the room moves too.
      const room = (svc as unknown as { rooms: Map<string, unknown> }).rooms.get(code);
      (svc as unknown as { finish: (r: unknown) => void }).finish(room);
      expect(svc.busy).toBe(0);
      expect(a.closed && b.closed).toBe(true);
      expect(lines).toContain(`room ${code} closed (draining, no heir)`);
    } finally {
      svc.stop();
    }
  });
});

describe('the new relay', () => {
  it('opens a moved room again under its code, its door as it was, the first back its owner', () => {
    const lines: string[] = [];
    const svc = svcWith(lines);
    try {
      const a = phone();
      svc.open(a.link).onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, code: 'QX7TPA', again: { code: 'QX7TPA', id: 1003, key: 'k', q: false, d: 'open' } }));
      const r = roomOf(a);
      expect(r).toMatchObject({ code: 'QX7TPA', quick: false, set: { door: 'open' } });
      expect(r.owner).toBe(r.you);
      // The next one back joins it, as anybody with the code would.
      const b = phone();
      svc.open(b.link).onText(JSON.stringify({ t: 'join', name: 'bob', skin: 0, code: 'QX7TPA', again: { code: 'QX7TPA', id: 1004, key: 'j', q: false, d: 'open' } }));
      expect(roomOf(b)).toMatchObject({ code: 'QX7TPA' });
      expect(lines).toContain('world: room QX7TPA opened again, from another relay');
      // A quick room comes back quick; a passcode room comes back unlisted (nobody knows its code's pass).
      const q = phone();
      svc.open(q.link).onText(JSON.stringify({ t: 'join', name: 'quinn', skin: 0, code: 'HJK234', again: { code: 'HJK234', id: 1009, key: 'k', q: true, d: 'open' } }));
      expect(roomOf(q)).toMatchObject({ code: 'HJK234', quick: true });
      const p = phone();
      svc.open(p.link).onText(JSON.stringify({ t: 'join', name: 'pat', skin: 0, code: 'MNP567', again: { code: 'MNP567', id: 1010, key: 'k', q: false } }));
      expect(roomOf(p)).toMatchObject({ code: 'MNP567', set: { door: 'private' } });
    } finally {
      svc.stop();
    }
  });

  it('does not invent a room for a page back from a match (no `q`), nor for a code it could never issue', () => {
    const svc = svcWith([]);
    try {
      const a = phone();
      svc.open(a.link).onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, code: 'QX7TPA', again: { code: 'QX7TPA', id: 1003, key: 'k' } }));
      expect(a.got.at(-1)).toMatchObject({ t: 'no_room', code: 'QX7TPA' });
      const b = phone();
      svc.open(b.link).onText(JSON.stringify({ t: 'join', name: 'bob', skin: 0, code: 'OOOOOO', again: { code: 'OOOOOO', id: 1004, key: 'k', q: false } }));
      expect(b.got.at(-1)).toMatchObject({ t: 'no_room' });
    } finally {
      svc.stop();
    }
  });
});
