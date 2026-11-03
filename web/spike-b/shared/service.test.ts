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
  it('a page of another world is told `old` and gets no room', () => {
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 0, cap: 30, now: () => 0, log: () => undefined, world: 'abc' });
    try {
      const a = phone();
      const s = svc.open(a.link);
      s.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true, w: 'old' }));
      expect(a.got).toEqual([{ t: 'old' }]);
      s.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true, w: 'abc' }));
      expect(a.got.at(-1)!.t).toBe('room');
    } finally {
      svc.stop();
    }
  });
  it('a room battles on one patch: a page on another is refused, and quick play keeps them apart', () => {
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 0, cap: 30, now: () => 0, log: () => undefined });
    try {
      const [a, b, c, d, e] = [phone(), phone(), phone(), phone(), phone()];
      svc.open(a.link).onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true, r: 'aaaaaaa' }));
      const code = (a.got.at(-1) as unknown as { code: string }).code;
      // A link battle between two patches desyncs (CLAUDE.md): told why, not let in.
      svc.open(b.link).onText(JSON.stringify({ t: 'join', name: 'bob', skin: 0, code: code.toLowerCase(), r: 'bbbbbbb' }));
      expect(b.got.at(-1)).toEqual({ t: 'no_room', code, rom: true });
      svc.open(c.link).onText(JSON.stringify({ t: 'join', name: 'cal', skin: 0, code, r: 'aaaaaaa' }));
      expect(c.got.at(-1)!.t).toBe('room');
      // QUICK PLAY: one room a patch.
      svc.open(d.link).onText(JSON.stringify({ t: 'join', name: 'dee', skin: 0, r: 'aaaaaaa' }));
      svc.open(e.link).onText(JSON.stringify({ t: 'join', name: 'eve', skin: 0, r: 'bbbbbbb' }));
      const quick = (p: { got: { t: string }[] }) => (p.got.filter((m) => m.t === 'room').at(-1) as unknown as { code: string }).code;
      expect(quick(d)).not.toBe(quick(e));
    } finally {
      svc.stop();
    }
  });
  it('says what happens in the live relay\'s words, so the play log counts world matches', async () => {
    const lines: string[] = [];
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 3, cap: 30, now: () => 0, log: (l) => lines.push(l) });
    try {
      const [a, b] = [phone(), phone()];
      const sa = svc.open(a.link), sb = svc.open(b.link);
      sa.onText(JSON.stringify({ t: 'join', name: 'ash ketchum', skin: 0, host: true }));
      const code = (a.got.at(-1) as unknown as { code: string }).code;
      sb.onText(JSON.stringify({ t: 'join', name: 'misty', skin: 1, code }));
      sa.onText(JSON.stringify({ t: 'set', set: { door: 'private' } }));
      sa.onText(JSON.stringify({ t: 'start' }));
      const { parseLine } = await import('../../../tools/br/play-log.mjs' as string) as { parseLine(m: string, at: string): { kind: string; [k: string]: unknown } | null };
      const kinds = lines.map((l) => parseLine(l, '2026-10-30T00:00:00Z')).filter((e) => e).map((e) => e!.kind);
      expect(kinds).toEqual(['host', 'join', 'door', 'match']);
      const match = lines.map((l) => parseLine(l, '2026-10-30T00:00:00Z')).find((e) => e?.kind === 'match');
      expect(match).toMatchObject({ code, mode: 'host', trainers: 2, max: 8 });
    } finally {
      svc.stop();
    }
  });
  it('a room waits as long as it likes; a match lets a silent phone go', () => {
    let t = 0;
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 3, cap: 30, now: () => t, log: () => undefined });
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
  it('READY UP: back from a match, a quick room waits for its owner (or somebody new), then counts', () => {
    let t = 0;
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 0, cap: 30, now: () => t, log: () => undefined });
    try {
      const [a, b, c] = [phone(), phone(), phone()];
      const sa = svc.open(a.link), sb = svc.open(b.link);
      sa.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0 }));
      sb.onText(JSON.stringify({ t: 'join', name: 'bob', skin: 0 }));
      type R = { t: 'room'; startsIn?: number; ready?: boolean; playing: boolean };
      const last = (p: { got: { t: string }[] }) => p.got.filter((m) => m.t === 'room').at(-1) as unknown as R;
      expect(last(a).startsIn).toBeGreaterThan(0);
      // The first match counts itself in, as quick play's promise.
      t += 60_001;
      svc.pump();
      expect(a.got.some((m) => m.t === 'hello')).toBe(true);
      const rooms = (svc as unknown as { rooms: Map<string, unknown>; finish(r: unknown): void });
      rooms.finish([...rooms.rooms.values()][0]);
      expect(last(a)).toMatchObject({ ready: true, playing: false });
      expect(last(a).startsIn).toBeUndefined();
      // Nobody is pulled into the next one while they read their results.
      const hellos = () => a.got.filter((m) => m.t === 'hello').length;
      t += 600_000;
      svc.pump();
      expect(hellos()).toBe(1);
      // Only the owner readies up; their READY UP counts, START in the count deals.
      sb.onText(JSON.stringify({ t: 'start' }));
      expect(last(a).ready).toBe(true);
      sa.onText(JSON.stringify({ t: 'start' }));
      expect(last(a).ready).toBeUndefined();
      expect(last(a).startsIn).toBe(60_000);
      sa.onText(JSON.stringify({ t: 'start' }));
      expect(hellos()).toBe(2);
      // Back again: somebody new quick-joins, and the count is theirs too.
      rooms.finish([...rooms.rooms.values()][0]);
      expect(last(b).ready).toBe(true);
      svc.open(c.link).onText(JSON.stringify({ t: 'join', name: 'cy', skin: 0 }));
      expect(last(b).startsIn).toBe(60_000);
    } finally {
      svc.stop();
    }
  });
  it("MY VOICE rides with a trainer's card, for whoever fights them, sane or not at all", () => {
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 0, cap: 30, now: () => 0, log: () => undefined });
    try {
      const a = phone(), b = phone();
      svc.open(a.link).onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true, rec: { wins: 1, played: 2, intro: 3, win: 4, lose: 5 } }));
      const code = (a.got.at(-1) as unknown as { code: string }).code;
      svc.open(b.link).onText(JSON.stringify({ t: 'join', name: 'bob', skin: 0, code, rec: { wins: 0, played: 0, intro: -1, win: 'x', lose: 1000 } }));
      const members = (b.got.filter((m) => m.t === 'room').at(-1) as unknown as { members: { name: string; rec?: object }[] }).members;
      expect(members.find((m) => m.name === 'ALICE')!.rec).toEqual({ wins: 1, played: 2, intro: 3, win: 4, lose: 5 });
      expect(members.find((m) => m.name === 'BOB')!.rec).toEqual({ wins: 0, played: 0 });
    } finally {
      svc.stop();
    }
  });
  it('LOBBIES lists the hosted rooms, not quick play\'s, to anybody who asks', () => {
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 0, cap: 30, now: () => 0, log: () => undefined });
    try {
      const a = phone(), q = phone(), c = phone();
      const sa = svc.open(a.link);
      sa.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 3, host: true }));
      svc.open(q.link).onText(JSON.stringify({ t: 'join', name: 'quinn', skin: 0 }));
      const code = (a.got.at(-1) as unknown as { code: string }).code;
      const s = svc.open(c.link);
      s.onText(JSON.stringify({ t: 'list' }));
      // Of the host's MAX (live's 8), not the relay's cap (HBR-111).
      expect(c.got.at(-1)).toEqual({ t: 'rooms', rooms: [{ code, host: 'ALICE', skin: 3, players: 1, seats: 8, playing: false, pass: false }] });
      // And in by its code.
      s.onText(JSON.stringify({ t: 'join', name: 'carl', skin: 0, code }));
      expect(c.got.at(-1)).toMatchObject({ t: 'room', code, members: [{ name: 'ALICE' }, { name: 'CARL' }] });
      // Started, it is off the list, as live's locked room is: nobody walks into it.
      const listed = () => { const d = phone(); const sd = svc.open(d.link); sd.onText(JSON.stringify({ t: 'list' })); return (d.got.at(-1) as unknown as { rooms: { players: number }[] }).rooms; };
      expect(listed()[0].players).toBe(2);
      sa.onText(JSON.stringify({ t: 'start' }));
      expect(a.got.some((m) => m.t === 'hello')).toBe(true);
      expect(listed()).toEqual([]);
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
      expect(g.got.at(-1)).toMatchObject({ t: 'room', set: { bots: true, fogSecs: 120, safariSecs: 120, textSpeed: 5, animations: false } });
      sa.onText(JSON.stringify({ t: 'set', set: { textSpeed: 3, animations: true } }));
      sa.onText(JSON.stringify({ t: 'set', set: { textSpeed: 4 } }));
      expect(g.got.at(-1)).toMatchObject({ set: { textSpeed: 3, animations: true } });
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
  it('MAX is the seats and FILL deals bots into the ones nobody has; START needs somebody to play', () => {
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 29, cap: 30, now: () => 0, log: () => undefined });
    const hello = (p: ReturnType<typeof phone>) => (p.got.find((m) => m.t === 'hello') as unknown as { state: { actors: { bot: boolean }[] } }).state.actors;
    try {
      // The live room's to start with: MAX 8, FILL on, so alone you play seven bots.
      const a = phone();
      const sa = svc.open(a.link);
      sa.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true }));
      expect(a.got.at(-1)).toMatchObject({ t: 'room', set: { max: 8, bots: true } });
      sa.onText(JSON.stringify({ t: 'start' }));
      expect(hello(a).filter((x) => x.bot)).toHaveLength(7);
      // MAX 30 is thirty in it, two trainers and 28 bots, not 1 + 64 (HBR-92).
      const b = phone(), c = phone();
      const sb = svc.open(b.link);
      sb.onText(JSON.stringify({ t: 'join', name: 'bob', skin: 0, host: true }));
      const code = (b.got.at(-1) as unknown as { code: string }).code;
      svc.open(c.link).onText(JSON.stringify({ t: 'join', name: 'cy', skin: 0, code }));
      sb.onText(JSON.stringify({ t: 'set', set: { max: 30 } }));
      sb.onText(JSON.stringify({ t: 'start' }));
      expect(hello(b).filter((x) => x.bot)).toHaveLength(28);
      // FILL off and nobody else: no START (match/room.ts dealable).
      const d = phone();
      const sd = svc.open(d.link);
      sd.onText(JSON.stringify({ t: 'join', name: 'dee', skin: 0, host: true }));
      sd.onText(JSON.stringify({ t: 'set', set: { bots: false } }));
      sd.onText(JSON.stringify({ t: 'start' }));
      expect(d.got.some((m) => m.t === 'hello')).toBe(false);
      expect(d.got.at(-1)).toMatchObject({ t: 'room', playing: false });
    } finally {
      svc.stop();
    }
  });
  it('the host sets MAX and the door (unlisted, a passcode), and takes a guest out', () => {
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 0, cap: 30, now: () => 0, log: () => undefined });
    try {
      const a = phone(), g = phone(), h = phone(), w = phone();
      const sa = svc.open(a.link);
      sa.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true }));
      const code = (a.got.at(-1) as unknown as { code: string }).code;
      const sw = svc.open(w.link);
      const list = () => { sw.onText(JSON.stringify({ t: 'list' })); return (w.got.at(-1) as unknown as { rooms: { pass: boolean; seats: number }[] }).rooms; };
      sa.onText(JSON.stringify({ t: 'set', set: { max: 2 } }));
      expect(list()[0].seats).toBe(2);
      sa.onText(JSON.stringify({ t: 'set', set: { door: 'private' } }));
      expect(list()).toEqual([]);
      sa.onText(JSON.stringify({ t: 'set', set: { door: 'pass', pass: 'abcd' } }));
      expect(list()[0].pass).toBe(true);
      expect(a.got.at(-1)).toMatchObject({ pass: 'ABCD', set: { door: 'pass' } });
      // A wrong passcode is turned away; the right one comes in; MAX 2 turns the third away.
      const sg = svc.open(g.link);
      sg.onText(JSON.stringify({ t: 'join', name: 'gus', skin: 0, code, pass: 'ZZZZ' }));
      expect(g.got.at(-1)).toEqual({ t: 'no_room', code, pass: true });
      sg.onText(JSON.stringify({ t: 'join', name: 'gus', skin: 0, code, pass: 'abcd' }));
      expect(g.got.at(-1)).toMatchObject({ t: 'room', code });
      expect((g.got.at(-1) as unknown as { pass?: string }).pass).toBeUndefined();
      svc.open(h.link).onText(JSON.stringify({ t: 'join', name: 'hal', skin: 0, code, pass: 'ABCD' }));
      // Told it is full, not that there is no such room.
      expect(h.got.at(-1)).toEqual({ t: 'no_room', code, full: true });
      // KICK: only the host's, and the guest's socket can join again.
      const gus = (g.got.at(-1) as unknown as { you: number }).you;
      sg.onText(JSON.stringify({ t: 'kick', id: (a.got.at(-1) as unknown as { you: number }).you }));
      expect(a.got.at(-1)).toMatchObject({ t: 'room' });
      sa.onText(JSON.stringify({ t: 'kick', id: gus }));
      expect(g.got.at(-1)).toEqual({ t: 'kicked' });
      expect(a.got.at(-1)).toMatchObject({ members: [{ name: 'ALICE' }] });
      sg.onText(JSON.stringify({ t: 'join', name: 'gus', skin: 0, host: true }));
      expect(g.got.at(-1)).toMatchObject({ t: 'room', members: [{ name: 'GUS' }] });
    } finally {
      svc.stop();
    }
  });
  it("KICK keeps them out: their address can't join that room again, in a match or not (relay server.js)", () => {
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 0, cap: 30, now: () => 0, log: () => undefined });
    try {
      const at = (ip: string) => { const p = phone(); return { ...p, link: { ...p.link, ip } }; };
      const a = at('1.1.1.1'), g = at('2.2.2.2'), g2 = at('2.2.2.2'), h = at('3.3.3.3');
      const sa = svc.open(a.link);
      sa.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true }));
      const code = (a.got.at(-1) as unknown as { code: string }).code;
      const sg = svc.open(g.link);
      sg.onText(JSON.stringify({ t: 'join', name: 'gus', skin: 0, code }));
      const gus = (g.got.at(-1) as unknown as { you: number }).you;
      sa.onText(JSON.stringify({ t: 'kick', id: gus }));
      expect(g.got.at(-1)).toEqual({ t: 'kicked' });
      // Back from the same address, on a new socket too: told why, and not seated.
      sg.onText(JSON.stringify({ t: 'join', name: 'gus', skin: 0, code }));
      expect(g.got.at(-1)).toEqual({ t: 'no_room', code, removed: true });
      svc.open(g2.link).onText(JSON.stringify({ t: 'join', name: 'gus2', skin: 0, code }));
      expect(g2.got.at(-1)).toEqual({ t: 'no_room', code, removed: true });
      // Anybody else still comes in, and gus can host a room of his own.
      const sh = svc.open(h.link);
      sh.onText(JSON.stringify({ t: 'join', name: 'hal', skin: 0, code }));
      expect(h.got.at(-1)).toMatchObject({ t: 'room', code });
      sg.onText(JSON.stringify({ t: 'join', name: 'gus', skin: 0, host: true }));
      expect(g.got.at(-1)).toMatchObject({ t: 'room', members: [{ name: 'GUS' }] });
      // In a match: the host's KICK takes hal out of it too.
      sa.onText(JSON.stringify({ t: 'set', set: { bots: false } }));
      sa.onText(JSON.stringify({ t: 'start' }));
      expect(h.got.some((m) => m.t === 'hello')).toBe(true);
      const hal = (h.got.find((m) => m.t === 'room') as unknown as { you: number }).you;
      sa.onText(JSON.stringify({ t: 'kick', id: hal }));
      expect(h.got.at(-1)).toEqual({ t: 'kicked' });
      expect(svc.players).toBe(2);
    } finally {
      svc.stop();
    }
  });
  it("a trainer's career rides their seat, whole numbers or nothing", () => {
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 0, cap: 30, now: () => 0, log: () => undefined });
    try {
      const a = phone(), g = phone();
      svc.open(a.link).onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true, rec: { wins: 3, played: 9, best: 1 } }));
      const code = (a.got.at(-1) as unknown as { code: string }).code;
      svc.open(g.link).onText(JSON.stringify({ t: 'join', name: 'gus', skin: 0, code, rec: { wins: 'lots', played: 2 } }));
      expect(g.got.at(-1)).toMatchObject({ members: [{ name: 'ALICE', rec: { wins: 3, played: 9, best: 1 } }, { name: 'GUS' }] });
      expect((g.got.at(-1) as unknown as { members: { rec?: unknown }[] }).members[1].rec).toBeUndefined();
    } finally {
      svc.stop();
    }
  });
  it('LEAVE mid-match: out of the room and the match (left), and the socket can come back in', () => {
    let t = 0;
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 0, cap: 30, now: () => t, log: () => undefined });
    try {
      const a = phone(), g = phone();
      const sa = svc.open(a.link), sg = svc.open(g.link);
      sa.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true }));
      const code = (a.got.at(-1) as unknown as { code: string }).code;
      sg.onText(JSON.stringify({ t: 'join', name: 'gus', skin: 0, code }));
      svc.open(phone().link).onText(JSON.stringify({ t: 'join', name: 'hal', skin: 0, code }));
      sa.onText(JSON.stringify({ t: 'start' }));
      sg.onText(JSON.stringify({ t: 'leave' }));
      expect(a.got.at(-1)).toMatchObject({ t: 'room', members: [{ name: 'ALICE' }, { name: 'HAL' }] });
      svc.pump();
      const fell = () => (svc as unknown as { rooms: Map<string, { host: { room: { results: { fallen: { left?: boolean }[] } } } }> }).rooms.get(code)!.host.room.results.fallen;
      for (let i = 0; i < 30 && !fell().length; i++) { t += 100; svc.pump(); }
      expect(fell()).toMatchObject([{ left: true }]);
      sg.onText(JSON.stringify({ t: 'join', name: 'gus', skin: 0, host: true }));
      expect(g.got.at(-1)).toMatchObject({ t: 'room', members: [{ name: 'GUS' }] });
    } finally {
      svc.stop();
    }
  });
  it("a trainer's team goes to the room, sane or not at all", () => {
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 0, cap: 30, now: () => 0, log: () => undefined });
    try {
      const a = phone(), b = phone();
      const sa = svc.open(a.link), sb = svc.open(b.link);
      sa.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true }));
      const code = (a.got.at(-1) as unknown as { code: string }).code;
      sb.onText(JSON.stringify({ t: 'join', name: 'bob', skin: 0, code }));
      sa.onText(JSON.stringify({ t: 'start' }));
      const id = (a.got.find((m) => m.t === 'hello') as unknown as { id: number }).id;
      const mons = [{ species: 252, nickname: 'TAMY', level: 9, hp: 20, maxHp: 27, moves: [{ id: 1 }, { id: 43 }, { id: 'x' }] }];
      sa.onText(JSON.stringify({ t: 'team', mons }));
      expect(b.got.at(-1)).toEqual({ t: 'team', id, mons: [{ ...mons[0], moves: [{ id: 1 }, { id: 43 }] }] });
      const n = b.got.length;
      sa.onText(JSON.stringify({ t: 'team', mons: [{ species: 0, level: 5 }] }));
      sa.onText(JSON.stringify({ t: 'team', mons: Array(7).fill({ species: 1, level: 5 }) }));
      sa.onText(JSON.stringify({ t: 'team', mons: [{ species: 1, level: 101 }] }));
      expect(b.got.length).toBe(n);
      const teams = () => [...(svc as unknown as { rooms: Map<string, { members: Map<number, { team?: unknown }> }> }).rooms.get(code)!.members.values()].map((p) => p.team);
      expect(teams().filter(Boolean)).toHaveLength(1);
      // In mid-match, to watch: the teams told so far come with the hello.
      const c = phone();
      svc.open(c.link).onText(JSON.stringify({ t: 'join', name: 'cy', skin: 0, code }));
      expect(c.got.find((m) => m.t === 'team')).toEqual({ t: 'team', id, mons: [{ ...mons[0], moves: [{ id: 1 }, { id: 43 }] }] });
    } finally {
      svc.stop();
    }
  });
  it("a team row keeps its personality and OT id, for the champion's parade on everybody's ROM", () => {
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 0, cap: 30, now: () => 0, log: () => undefined });
    try {
      const a = phone(), b = phone();
      const sa = svc.open(a.link), sb = svc.open(b.link);
      sa.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true }));
      const code = (a.got.at(-1) as unknown as { code: string }).code;
      sb.onText(JSON.stringify({ t: 'join', name: 'bob', skin: 0, code }));
      sa.onText(JSON.stringify({ t: 'start' }));
      const id = (a.got.find((m) => m.t === 'hello') as unknown as { id: number }).id;
      sa.onText(JSON.stringify({ t: 'team', mons: [{ species: 43, level: 9, personality: 0xdeadbeef, otId: 12345, moves: [] }] }));
      expect(b.got.at(-1)).toEqual({ t: 'team', id, mons: [{ species: 43, level: 9, personality: 0xdeadbeef, otId: 12345, moves: [] }] });
      sa.onText(JSON.stringify({ t: 'team', mons: [{ species: 43, level: 9, personality: -1, otId: 2 ** 32, moves: [] }] }));
      expect(b.got.at(-1)).toEqual({ t: 'team', id, mons: [{ species: 43, level: 9, moves: [] }] });
    } finally {
      svc.stop();
    }
  });
  it("a trainer's bag rides with their team, for a watcher's START, sane or not at all", () => {
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 0, cap: 30, now: () => 0, log: () => undefined });
    try {
      const a = phone(), b = phone();
      const sa = svc.open(a.link), sb = svc.open(b.link);
      sa.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true }));
      const code = (a.got.at(-1) as unknown as { code: string }).code;
      sb.onText(JSON.stringify({ t: 'join', name: 'bob', skin: 0, code }));
      sa.onText(JSON.stringify({ t: 'start' }));
      const id = (a.got.find((m) => m.t === 'hello') as unknown as { id: number }).id;
      const mons = [{ species: 252, level: 9, moves: [] }];
      const bag = { items: [{ id: 13, n: 3 }, { id: 4, n: 1 }], money: 2500 };
      sa.onText(JSON.stringify({ t: 'team', mons, bag }));
      expect(b.got.at(-1)).toEqual({ t: 'team', id, mons, bag });
      // A bag that will not read goes as none; the team still goes.
      for (const bad of [{ items: [{ id: 0, n: 1 }], money: 0 }, { items: [{ id: 13, n: 1000 }], money: 0 }, { items: [], money: -1 }, { items: Array(121).fill({ id: 1, n: 1 }), money: 0 }, 'x']) {
        sa.onText(JSON.stringify({ t: 'team', mons, bag: bad }));
        expect(b.got.at(-1)).toEqual({ t: 'team', id, mons });
      }
      sa.onText(JSON.stringify({ t: 'team', mons, bag }));
      // In mid-match, to watch: the bag comes with the hello's teams.
      const c = phone();
      svc.open(c.link).onText(JSON.stringify({ t: 'join', name: 'cy', skin: 0, code }));
      expect(c.got.find((m) => m.t === 'team')).toEqual({ t: 'team', id, mons, bag });
    } finally {
      svc.stop();
    }
  });
  it("a hidden tab's 'here' keeps it in; out and watching, a dropped socket comes back to watching", () => {
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
      // Walked away: no frames for three minutes, only the hidden tab's 'here'.
      for (let i = 0; i < 9; i++) { t += 20_000; sa.onText(JSON.stringify({ t: 'here' })); sb.onText(JSON.stringify({ t: 'here' })); svc.pump(); }
      expect(a.closed).toBe(false);
      // Out, watching: the socket drops (a reload, the wifi) and comes back inside the minute.
      sa.onText(JSON.stringify({ t: 'out' }));
      t += 1000; svc.pump();
      sa.onClose();
      t += 20_000; svc.pump();
      const a2 = phone();
      svc.open(a2.link).onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, code, again: { code, id: hello.id, key: hello.key } }));
      const back = a2.got.find((m) => m.t === 'hello') as unknown as { id: number; state: { bench: { id: number }[] } };
      expect(back.id).toBe(hello.id);
      expect(back.state.bench.map((x) => x.id)).toContain(hello.id);
    } finally {
      svc.stop();
    }
  });
  it('a new socket with the key takes the trainer over before the old one is seen to close', () => {
    let t = 0;
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 3, cap: 30, now: () => t, log: () => undefined });
    try {
      const a = phone(), b = phone();
      const sa = svc.open(a.link), sb = svc.open(b.link);
      sa.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true }));
      const room = a.got.at(-1) as unknown as { code: string; you: number; key: string };
      sb.onText(JSON.stringify({ t: 'join', name: 'bob', skin: 0, code: room.code }));
      // In the room: the seat itself, not a second ALICE.
      const a2 = phone();
      const sa2 = svc.open(a2.link);
      sa2.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, code: room.code, again: { code: room.code, id: room.you, key: room.key } }));
      expect(b.got.at(-1)).toMatchObject({ t: 'room', members: [{ name: 'ALICE' }, { name: 'BOB' }], owner: room.you });
      expect(a.closed).toBe(true);
      sa.onClose();
      expect(b.got.at(-1)).toMatchObject({ t: 'room', members: [{ name: 'ALICE' }, { name: 'BOB' }] });
      sa2.onText(JSON.stringify({ t: 'start' }));
      const hello = a2.got.find((m) => m.t === 'hello') as unknown as { id: number; key: string };
      expect(hello.id).toBe(room.you);
      t += 1000; svc.pump();
      // Mid-match, the old socket still open: the new one is the same trainer, at once.
      const a3 = phone();
      svc.open(a3.link).onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, code: room.code, again: { code: room.code, id: hello.id, key: hello.key } }));
      expect(a3.got.find((m) => m.t === 'hello')).toMatchObject({ id: hello.id });
      sa2.onClose();
      t += 1000; svc.pump();
      const rooms = (svc as unknown as { rooms: Map<string, { members: Map<number, { away: number }>; host: { room: { actor(id: number): unknown } } }> }).rooms;
      expect(rooms.get(room.code)!.members.get(hello.id)!.away).toBe(0);
      expect(rooms.get(room.code)!.host.room.actor(hello.id)).toBeTruthy();
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
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 3, cap: 30, now: () => t, log: () => undefined });
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

  it('a link block goes to the trainer you are fighting, and nobody else', () => {
    let t = 0;
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 0, cap: 30, now: () => t, log: () => undefined });
    try {
      const [a, b, c] = [phone(), phone(), phone()];
      const [sa, sb, sc] = [a, b, c].map((p) => svc.open(p.link));
      sa.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true }));
      const code = (a.got.at(-1) as unknown as { code: string }).code;
      sb.onText(JSON.stringify({ t: 'join', name: 'bob', skin: 0, code }));
      sc.onText(JSON.stringify({ t: 'join', name: 'cara', skin: 0, code }));
      sa.onText(JSON.stringify({ t: 'start' }));
      t += 200;
      svc.pump();
      const [alice, bob] = [a, b].map((p) => (p.got.find((m) => m.t === 'hello') as unknown as { id: number }).id);
      const bt = (p: ReturnType<typeof phone>) => p.got.filter((m) => m.t === 'bt');
      // Not fighting anybody: dropped.
      sa.onText(JSON.stringify({ t: 'bt', q: 1, d: [1, 2, 3] }));
      expect(bt(b)).toEqual([]);
      const room = [...(svc as unknown as { rooms: Map<string, { host: { room: { actor(id: number): { battling: boolean; foe: number } } } }> }).rooms.values()][0].host.room;
      Object.assign(room.actor(alice), { battling: true, foe: bob });
      Object.assign(room.actor(bob), { battling: true, foe: alice });
      sa.onText(JSON.stringify({ t: 'bt', q: 1, d: [9, 8, 7, 300] }));
      expect(bt(b)).toEqual([{ t: 'bt', q: 1, d: [9, 8, 7, 300 & 0xff] }]);
      sb.onText(JSON.stringify({ t: 'bt', q: 1, d: [5] }));
      expect(bt(a)).toEqual([{ t: 'bt', q: 1, d: [5] }]);
      expect(bt(c)).toEqual([]);
      // A block too big is refused.
      sa.onText(JSON.stringify({ t: 'bt', q: 2, d: Array(2000).fill(0) }));
      expect(bt(b)).toHaveLength(1);
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
  it("hands on a bots' fight from its judge's page, to its watchers and the judge watching too", () => {
    let t = 0;
    const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots: 2, cap: 30, now: () => t, log: () => undefined });
    try {
      const a = phone(), b = phone();
      const sa = svc.open(a.link), sb = svc.open(b.link);
      sa.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true }));
      const code = (a.got.at(-1) as unknown as { code: string }).code;
      sb.onText(JSON.stringify({ t: 'join', name: 'bob', skin: 1, code }));
      sa.onText(JSON.stringify({ t: 'start' }));
      const alice = (a.got.find((m) => m.t === 'hello') as unknown as { id: number }).id;
      t += 200;
      svc.pump();
      type Bot = { id: number; bot: boolean; battling: boolean; foe: number; judge?: number };
      const room = [...(svc as unknown as { rooms: Map<string, { host: { room: { actors: Bot[] } } }> }).rooms.values()][0];
      const [x, y] = room.host.room.actors.filter((o) => o.bot);
      Object.assign(x, { battling: true, foe: y.id, judge: alice });
      Object.assign(y, { battling: true, foe: x.id, judge: alice });
      const sp = (p: ReturnType<typeof phone>) => p.got.filter((m) => m.t === 'sp') as unknown as { from: number; m: { t: string } }[];
      sa.onText(JSON.stringify({ t: 'watch', id: y.id }));
      sb.onText(JSON.stringify({ t: 'watch', id: x.id }));
      // Not its judge: bob publishes nothing as a bot.
      sb.onText(JSON.stringify({ t: 'sp', as: x.id, m: { t: 'bstart', battle: x.id | (y.id << 8), data: [1] } }));
      expect(sp(a)).toHaveLength(0);
      sa.onText(JSON.stringify({ t: 'sp', as: x.id, m: { t: 'bstart', battle: x.id | (y.id << 8), data: [1] } }));
      sa.onText(JSON.stringify({ t: 'sp', as: x.id, m: { t: 'turn', battle: x.id | (y.id << 8), data: [0, 1, 4] } }));
      expect(sp(b).map((m) => [m.from, m.m.t])).toEqual([[x.id, 'bstart'], [x.id, 'turn']]);
      expect(sp(a).map((m) => [m.from, m.m.t]), 'the judge watching the other bot').toEqual([[x.id, 'bstart'], [x.id, 'turn']]);

      // The fight over, x fights bob: a new watcher of x is not handed x's fight with y.
      const bob = (b.got.find((m) => m.t === 'hello') as unknown as { id: number }).id;
      const xb = room.host.room.actors.find((o) => o.id === bob)!;
      Object.assign(y, { battling: false, foe: 0, judge: 0 });
      Object.assign(x, { battling: true, foe: bob, judge: 0 });
      Object.assign(xb, { battling: true, foe: x.id });
      const c = phone();
      const sc = svc.open(c.link);
      sc.onText(JSON.stringify({ t: 'join', name: 'carol', skin: 2, code }));
      sc.onText(JSON.stringify({ t: 'watch', id: x.id }));
      expect(sp(c), 'no old fight').toHaveLength(0);
      // ...and once bob publishes theirs, that is the one.
      sb.onText(JSON.stringify({ t: 'sp', m: { t: 'bstart', battle: x.id | (bob << 8), data: [2] } }));
      expect(sp(c).map((m) => m.from)).toEqual([bob]);
      const d = phone();
      const sd = svc.open(d.link);
      sd.onText(JSON.stringify({ t: 'join', name: 'dan', skin: 3, code }));
      sd.onText(JSON.stringify({ t: 'watch', id: x.id }));
      expect(sp(d).map((m) => m.from), 'a late watcher of x gets the fight with bob').toEqual([bob]);
    } finally {
      svc.stop();
    }
  });
  describe('battle logs (bl)', () => {
    const mon = { species: 280, level: 12, hp: 31, maxHp: 31, status: 0 };
    const start = (seat = 1, foe = 2) => ({ e: 'start', a: { seat, name: 'A', skin: 0, team: [mon] }, b: { seat: foe, name: 'B', skin: 1, team: [mon] }, map: 'MAP_ROUTE101' });
    type Actor = { id: number; bot: boolean; battling: boolean; foe: number; since?: number; judge?: number };
    function rig(bots = 0) {
      let t = 0;
      const svc = new WorldService({ maps: MAPS, patches: PATCHES, bots, cap: 30, now: () => t, log: () => undefined });
      const [a, b, c] = [phone(), phone(), phone()];
      const sa = svc.open(a.link), sb = svc.open(b.link), sc = svc.open(c.link);
      sa.onText(JSON.stringify({ t: 'join', name: 'alice', skin: 0, host: true }));
      const code = (a.got.at(-1) as unknown as { code: string }).code;
      sb.onText(JSON.stringify({ t: 'join', name: 'bob', skin: 1, code }));
      sc.onText(JSON.stringify({ t: 'join', name: 'carol', skin: 2, code }));
      sa.onText(JSON.stringify({ t: 'start' }));
      const alice = (a.got.find((m) => m.t === 'hello') as unknown as { id: number }).id;
      const bob = (b.got.find((m) => m.t === 'hello') as unknown as { id: number }).id;
      t += 200;
      svc.pump();
      const room = [...(svc as unknown as { rooms: Map<string, { host: { room: { actors: Actor[]; actor(id: number): Actor } } }> }).rooms.values()][0];
      const bl = (p: ReturnType<typeof phone>) => p.got.filter((m) => m.t === 'bl') as unknown as { from: number; f: number; events: { e: string; text?: string; [k: string]: unknown }[]; ago?: number }[];
      return { svc, t: (ms: number) => { t += ms; }, code, a, b, c, sa, sb, sc, alice, bob, room, bl };
    }

    it("hands a fighter's events to who watches them, and the whole log so far, with its age, to who comes late", () => {
      const r = rig();
      try {
        r.sb.onText(JSON.stringify({ t: 'watch', id: r.alice }));
        // Not in a battle: nothing is kept or sent.
        r.sa.onText(JSON.stringify({ t: 'bl', f: 5, events: [start()] }));
        expect(r.bl(r.b)).toHaveLength(0);
        r.room.host.room.actor(r.alice).battling = true;
        // Events with no start before them are of no fight.
        r.sa.onText(JSON.stringify({ t: 'bl', f: 5, events: [{ e: 'text', text: 'lost' }] }));
        expect(r.bl(r.b)).toHaveLength(0);
        r.sa.onText(JSON.stringify({ t: 'bl', f: 5, events: [start(77, 88), { e: 'send', side: 0, slot: 0 }] }));
        r.t(3000);
        r.sa.onText(JSON.stringify({ t: 'bl', f: 5, events: [{ e: 'text', text: 'Foe used TACKLE!' }, { e: 'nonsense' }, null, { e: 'hp', side: 0, hp: 20 }] }));
        const got = r.bl(r.b);
        expect(got.map((m) => m.events.map((e) => e.e))).toEqual([['start', 'send'], ['text', 'hp']]);
        expect(got[0].from).toBe(r.alice);
        // The seats are the room's, not the page's.
        expect((got[0].events[0] as unknown as { a: { seat: number } }).a.seat).toBe(r.alice);
        expect((got[0].events[0] as unknown as { b: { seat: number } }).b.seat).toBe(0);
        // Another fight's id is not this one's.
        r.sa.onText(JSON.stringify({ t: 'bl', f: 6, events: [{ e: 'text', text: 'stray' }] }));
        expect(r.bl(r.b)).toHaveLength(2);
        // The fighter hears nothing of its own fight back.
        expect(r.bl(r.a)).toHaveLength(0);

        r.sc.onText(JSON.stringify({ t: 'watch', id: r.alice }));
        const late = r.bl(r.c);
        expect(late).toHaveLength(1);
        expect(late[0].events.map((e) => e.e)).toEqual(['start', 'send', 'text', 'hp']);
        expect(late[0].ago).toBe(3000);

        // Its end, and the next watcher has nothing to start from.
        r.sa.onText(JSON.stringify({ t: 'bl', f: 5, events: [{ e: 'end', winner: r.alice }] }));
        r.sa.onText(JSON.stringify({ t: 'end' }));
        expect(r.bl(r.b).at(-1)!.events).toEqual([{ e: 'end', winner: r.alice }]);
        expect(r.bl(r.b)).toHaveLength(3);
        const before = r.bl(r.c).length;
        r.sc.onText(JSON.stringify({ t: 'watch', id: 0 }));
        r.sc.onText(JSON.stringify({ t: 'watch', id: r.alice }));
        expect(r.bl(r.c)).toHaveLength(before);
      } finally {
        r.svc.stop();
      }
    });

    it('survives any junk a phone sends, and keeps within its caps', () => {
      const r = rig();
      try {
        r.room.host.room.actor(r.alice).battling = true;
        r.sb.onText(JSON.stringify({ t: 'watch', id: r.alice }));
        for (const junk of [{ t: 'bl' }, { t: 'bl', f: 'x', events: [] }, { t: 'bl', f: 1, events: 'no' }, { t: 'bl', f: 1, events: [null, 4, {}] }, { t: 'bl', f: 1, events: [{ e: 'start', a: 5, b: 6 }] }]) {
          expect(() => r.sa.onText(JSON.stringify(junk))).not.toThrow();
        }
        expect(r.bl(r.b)).toHaveLength(0);
        // A whole message past the cap (the socket's own is 4096 bytes) is none.
        r.sa.onText(JSON.stringify({ t: 'bl', f: 1, events: [start(), ...Array.from({ length: 2000 }, () => ({ e: 'text', text: 'x'.repeat(100) }))] }));
        expect(r.bl(r.b)).toHaveLength(0);
        // The log kept for a late watcher is capped, though every event still goes live.
        r.sa.onText(JSON.stringify({ t: 'bl', f: 2, events: [start()] }));
        for (let i = 0; i < 80; i++) r.sa.onText(JSON.stringify({ t: 'bl', f: 2, events: Array.from({ length: 40 }, () => ({ e: 'text', text: 'y'.repeat(60) })) }));
        expect(r.bl(r.b).flatMap((m) => m.events)).toHaveLength(1 + 3200);
        r.sc.onText(JSON.stringify({ t: 'watch', id: r.alice }));
        const kept = r.bl(r.c)[0].events.length;
        expect(kept).toBeGreaterThan(100);
        expect(kept).toBeLessThanOrEqual(1500);
      } finally {
        r.svc.stop();
      }
    });

    it('ends a log whose page went (a reload) or left the fight without saying so', () => {
      const r = rig();
      try {
        r.sb.onText(JSON.stringify({ t: 'watch', id: r.alice }));
        r.room.host.room.actor(r.alice).battling = true;
        r.sa.onText(JSON.stringify({ t: 'bl', f: 1, events: [start()] }));
        r.sa.onClose();
        expect(r.bl(r.b).at(-1)!.events).toEqual([{ e: 'end', winner: 0 }]);
      } finally {
        r.svc.stop();
      }
      // ...and a trainer put out says so too.
      const r2 = rig();
      try {
        r2.sb.onText(JSON.stringify({ t: 'watch', id: r2.alice }));
        r2.room.host.room.actor(r2.alice).battling = true;
        r2.sa.onText(JSON.stringify({ t: 'bl', f: 1, events: [start()] }));
        r2.sa.onText(JSON.stringify({ t: 'out' }));
        expect(r2.bl(r2.b).at(-1)!.events).toEqual([{ e: 'end', winner: 0 }]);
      } finally {
        r2.svc.stop();
      }
    });

    it('one side of a fight between two trainers logs it: the first to start', () => {
      const r = rig();
      try {
        const [x, y] = [r.room.host.room.actor(r.alice), r.room.host.room.actor(r.bob)];
        Object.assign(x, { battling: true, foe: r.bob });
        Object.assign(y, { battling: true, foe: r.alice });
        r.sc.onText(JSON.stringify({ t: 'watch', id: r.bob }));
        r.sa.onText(JSON.stringify({ t: 'bl', f: 1, events: [start(), { e: 'text', text: 'from alice' }] }));
        r.sb.onText(JSON.stringify({ t: 'bl', f: 1, events: [start(), { e: 'text', text: 'from bob' }] }));
        r.sb.onText(JSON.stringify({ t: 'bl', f: 1, events: [{ e: 'text', text: 'more from bob' }] }));
        // Watching bob, carol gets alice's log of their fight, once.
        expect(r.bl(r.c).map((m) => [m.from, m.events.map((e) => e.e)])).toEqual([[r.alice, ['start', 'text']]]);
      } finally {
        r.svc.stop();
      }
    });

    it("serves a rematch of the same pair its own fight, not the old one's (the room's `since`)", () => {
      const r = rig(2);
      try {
        const [x, y] = r.room.host.room.actors.filter((o) => o.bot);
        const meet = (since: number) => {
          Object.assign(x, { battling: true, foe: y.id, judge: r.alice, since });
          Object.assign(y, { battling: true, foe: x.id, judge: r.alice, since });
        };
        meet(100);
        // A bots' fight, judged by alice's page, as the old stream and the new log both carry it.
        r.sa.onText(JSON.stringify({ t: 'sp', as: x.id, m: { t: 'bstart', battle: 9, data: [1] } }));
        r.sb.onText(JSON.stringify({ t: 'watch', id: x.id }));
        expect(r.svc.publishLog(r.code, x.id, [start(x.id, y.id) as never, { e: 'text', text: 'first meeting' }])).toBe(true);
        const sp = (p: ReturnType<typeof phone>) => p.got.filter((m) => m.t === 'sp');
        expect(sp(r.b)).toHaveLength(1);
        expect(r.bl(r.b)).toHaveLength(1);
        // The same two meet again: the room says so by `since`, no BSTART or start yet.
        meet(900);
        r.sc.onText(JSON.stringify({ t: 'watch', id: x.id }));
        expect(sp(r.c), 'no old stream').toHaveLength(0);
        expect(r.bl(r.c), 'no old log').toHaveLength(0);
        // The new fight's own, once it is published, is what a later watcher gets.
        r.sa.onText(JSON.stringify({ t: 'sp', as: x.id, m: { t: 'bstart', battle: 10, data: [2] } }));
        expect(r.svc.publishLog(r.code, x.id, [start(x.id, y.id) as never, { e: 'text', text: 'second meeting' }])).toBe(true);
        expect(sp(r.c).map((m) => (m as unknown as { m: { battle: number } }).m.battle)).toEqual([10]);
        expect(r.bl(r.c)[0].events.map((e) => e.text ?? e.e)).toEqual(['start', 'second meeting']);
        const d = phone();
        const sd = r.svc.open(d.link);
        sd.onText(JSON.stringify({ t: 'join', name: 'dan', skin: 3, code: r.code }));
        sd.onText(JSON.stringify({ t: 'watch', id: y.id }));
        expect(r.bl(d)[0].events.map((e) => e.text ?? e.e), 'watching the other bot of it').toEqual(['start', 'second meeting']);
      } finally {
        r.svc.stop();
      }
    });

    it('publishLog (for the simulator) refuses what is not a fight of this room', () => {
      const r = rig(2);
      try {
        const x = r.room.host.room.actors.find((o) => o.bot)!;
        expect(r.svc.publishLog('NOPE', x.id, [start() as never])).toBe(false);
        expect(r.svc.publishLog(r.code, 999999, [start() as never])).toBe(false);
        expect(r.svc.publishLog(r.code, x.id, [{ e: 'text', text: 'no start' }])).toBe(false);
        expect(r.svc.publishLog(r.code, x.id, [])).toBe(false);
        expect(r.svc.publishLog(r.code.toLowerCase(), x.id, [start() as never])).toBe(true);
      } finally {
        r.svc.stop();
      }
    });
  });
});
