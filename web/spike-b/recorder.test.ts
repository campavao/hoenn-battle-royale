// A recording run again is the match it recorded, hash for hash: on the page's own world
// and from the relay's frames, with the ring's head gone, and a wrong frame gets caught.
import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldMap } from '../src/bots/world';
import type { PatchTable } from '../src/bots/patches';
import worldJson from './data/world.json';
import patchJson from '../src/data/patches.json';
import { Online, soloLink } from './net';
import { FORMAT, RECORD_MS, SNAPSHOT_MS, recorder, Recorder, fileName, type Playtest } from './recorder';
import { bitsText, parseFile, replay } from './replay';
import { Host } from './shared/host';
import { KEY_A, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_UP, makeRoom } from './shared/room';
import type { WireFrame, WorldDown } from './shared/wire';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const PATCHES = patchJson as unknown as PatchTable;
const make = (seed: number) => makeRoom(MAPS, PATCHES, seed);
const SEED = 4242;
const WALK = [KEY_RIGHT, KEY_RIGHT, KEY_DOWN, KEY_LEFT, KEY_UP, KEY_A, 0];
/** A thumb that keeps moving: each key held for a stride. */
const thumb = (i: number) => WALK[Math.floor(i / 20) % WALK.length];

let clock = 0;
const useClock = (r: Recorder) => { clock = 1000; r.now = () => clock; };
const saved = (r: Recorder): Playtest => parseFile(r.text());

beforeEach(() => {
  recorder.clear();
  useClock(recorder);
});

describe('the recording', () => {
  it('replays a scripted solo match with every hash the same', () => {
    const link = soloLink(MAPS, PATCHES, undefined as never, SEED, { bots: 8, name: 'CAM', ringFrames: 600, openingFrames: 300 });
    const hashes: number[] = [];
    for (let i = 0; i < 900; i++) {
      clock += 1000 / 60;
      link.frame(thumb(i));
      hashes.push(link.room.hash());
      if (i === 400) recorder.mark('key', { map: 'MAP_LITTLEROOT_TOWN', x: 5, y: 6 });
    }
    const file = saved(recorder);
    const r = replay(file, make, 2000);
    expect(r.frames).toBe(901);
    expect(r.held).toBe(901);
    expect(r.mismatches).toEqual([]);
    expect(r.matches).toBe(1);
    // The page's own hash after each frame is the recording's, not just the recording's own.
    const frames = file.log.filter((e) => e.k === 'f');
    expect(frames.slice(1).map((e) => e.h)).toEqual(hashes);
    // The mark comes back where it was made, with what was going on around it.
    expect(r.marks).toHaveLength(1);
    expect(r.marks[0].mark).toMatchObject({ n: 1, via: 'key', map: 'MAP_LITTLEROOT_TOWN', x: 5, y: 6 });
    expect(r.marks[0].mine).toEqual(link.room.actor(link.me) ? expect.objectContaining({ map: expect.any(String) }) : null);
    expect(r.marks[0].around.some((m) => m.text.startsWith('keys '))).toBe(true);
  });

  it('replays the frames a relay sent, through the page\'s link, resync included', () => {
    const host = new Host(make(SEED), 6, MAPS);
    const id = host.join('CAM', 0);
    host.advance();
    const ws = { readyState: 1, send: () => undefined, addEventListener: () => undefined } as unknown as WebSocket;
    const link = new Online(ws, make);
    const receive = (m: WorldDown) => link.receive(m, () => undefined);
    receive({ t: 'hello', id, state: host.room.state(), key: 'SECRET-KEY' });
    let seq = 0;
    const relayFrame = (i: number) => {
      host.input(id, ++seq, [thumb(i)]);
      const { frame, acks } = host.advance();
      const f: WireFrame = { ...frame, a: acks.get(id) };
      if (frame.tick % 60 === 0) f.h = host.room.hash();
      return f;
    };
    for (let i = 0; i < 300; i++) {
      clock += 1000 / 60;
      receive({ t: 'f', f: [relayFrame(i)] });
      link.frame(thumb(i));
    }
    // A gap: this page's frame never came, it asks again and the relay sends the room.
    relayFrame(300);
    receive({ t: 'f', f: [relayFrame(301), relayFrame(302), relayFrame(303)] });
    for (let i = 0; i < 8; i++) link.frame(0);
    receive({ t: 'state', state: host.room.state() });
    for (let i = 304; i < 500; i++) {
      clock += 1000 / 60;
      receive({ t: 'f', f: [relayFrame(i)] });
      link.frame(thumb(i));
    }
    for (let i = 0; i < 30 && link.room.tick < host.room.tick; i++) link.frame(0);
    const text = recorder.text();
    const file = parseFile(text);
    const r = replay(file, make);
    expect(r.frames).toBeGreaterThan(450);
    expect(r.mismatches).toEqual([]);
    expect(r.statesLost).toBe(0);
    expect(file.log.some((e) => e.k === 'net' && e.what === 'gap')).toBe(true);
    expect(file.log.some((e) => e.k === 'state')).toBe(true);
    // And it ended where the relay's room is.
    expect(link.room.hash()).toBe(host.room.hash());
    // The rejoin key the hello carried stays out of the file.
    expect(text).not.toContain('SECRET-KEY');
  });

  it('notices a frame that is not the one played', () => {
    const link = soloLink(MAPS, PATCHES, undefined as never, SEED, { bots: 4, name: 'CAM' });
    for (let i = 0; i < 200; i++) { clock += 16; link.frame(thumb(i)); }
    const file = saved(recorder);
    const f = file.log.find((e) => e.k === 'f' && e.f.tick === 100);
    if (f?.k !== 'f') throw new Error('no frame 100');
    // The trainer with other keys than they had.
    f.f.ins = [[link.me, KEY_DOWN]];
    f.f.stall = [];
    const r = replay(file, make);
    expect(r.mismatches.length).toBeGreaterThan(0);
    expect(r.mismatches[0].tick).toBe(100);
  });

  it('runs from a snapshot once the ring has lost the start of the match', () => {
    const link = soloLink(MAPS, PATCHES, undefined as never, SEED, { bots: 8, name: 'CAM' });
    // Well past the ring's length, at a coarse clock so the test stays short.
    const step = (RECORD_MS * 1.5) / 3000;
    for (let i = 0; i < 3000; i++) { clock += step; link.frame(thumb(i)); }
    const file = saved(recorder);
    expect(file.log[0].k).toBe('snap');
    expect(clock - file.log[0].t).toBeLessThanOrEqual(RECORD_MS + SNAPSHOT_MS + 256 * step);
    expect(clock - file.log[0].t).toBeGreaterThanOrEqual(RECORD_MS - 256 * step);
    const r = replay(file, make);
    expect(r.frames).toBeGreaterThan(1000);
    expect(r.frames).toBeLessThan(3000);
    expect(r.mismatches).toEqual([]);
    expect(r.statesLost).toBe(0);
    expect(r.statesHeld).toBeGreaterThan(8);
  });

  it('keeps a mark past the ring, and says it fell outside', () => {
    const link = soloLink(MAPS, PATCHES, undefined as never, SEED, { bots: 2, name: 'CAM' });
    recorder.mark('eye', { map: 'MAP_ROUTE101', x: 1, y: 2 });
    const step = (RECORD_MS * 1.5) / 3000;
    for (let i = 0; i < 3000; i++) { clock += step; link.frame(0); }
    const r = replay(saved(recorder), make);
    expect(r.marks[0].inLog).toBe(false);
    expect(r.marks[0].mark.via).toBe('eye');
  });

  it('takes errors and spikes and battle messages in order, the version with them', () => {
    const r = new Recorder();
    useClock(r);
    r.setVersion({ line: 'spike B · rom abc1234', romSha1: 'abc1234', world: '6d1b84dd' });
    r.error('console', 'x'.repeat(5000));
    clock += 5;
    r.spike(83.4);
    r.sp('out', { t: 'bstart', battle: 3, data: [1, 2, 3] });
    r.visibility(true);
    const file = saved(r);
    expect(file.format).toBe(FORMAT);
    expect(file.version?.romSha1).toBe('abc1234');
    expect(file.log.map((e) => e.k)).toEqual(['err', 'spike', 'sp', 'vis']);
    const err = file.log[0];
    expect(err.k === 'err' && err.msg.length).toBe(800);
    const spike = file.log[1];
    expect(spike.k === 'spike' && spike.ms).toBe(83);
  });

  it('holds only the kinds of thing it says it does', () => {
    const link = soloLink(MAPS, PATCHES, undefined as never, SEED, { bots: 2, name: 'CAM' });
    link.sp({ t: 'bstart', battle: 1, data: [9] }, 2);
    link.frame(0);
    const text = recorder.text();
    const file = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(file).sort()).toEqual(['format', 'log', 'marks', 'origin', 'saved', 'version'].sort());
    // Nothing from a ROM's own bytes has a field here: no rom, sav or save, and no long byte array.
    expect(text).not.toMatch(/"(rom|sav|save|bytes|sram)":/);
    const longest = Math.max(0, ...[...text.matchAll(/\[(\d+(?:,\d+)*)\]/g)].map((m) => m[1].split(',').length));
    expect(longest).toBeLessThan(2000);
  });

  it('names a file by the clock, gzipped or not', () => {
    const d = new Date(2026, 10, 1, 9, 5, 7);
    expect(fileName(d, false)).toBe('hoenn-playtest-2026-11-01-090507.json');
    expect(fileName(d, true)).toBe('hoenn-playtest-2026-11-01-090507.json.gz');
  });

  it("says a thumb's keys in words", () => {
    expect(bitsText(KEY_UP | KEY_A)).toBe('UP+A');
    expect(bitsText(0)).toBe('none');
  });

  it('costs next to nothing a frame, and a minute\'s snapshot stays small', () => {
    const r = new Recorder();
    const room = make(SEED);
    const host = new Host(room, 64, MAPS);
    host.join('CAM', 0);
    host.advance();
    for (let i = 0; i < 300; i++) host.advance();
    const t0 = performance.now();
    const { frame } = host.advance();
    for (let i = 0; i < 1000; i++) r.frame(frame, room);
    const perFrame = (performance.now() - t0) / 1000;
    const t1 = performance.now();
    const state = JSON.stringify(room.state());
    console.log(`recorder: ${perFrame.toFixed(3)} ms a frame; snapshot ${state.length} bytes in ${(performance.now() - t1).toFixed(2)} ms`);
    // A 60 Hz frame is 16.7 ms: the recorder's share has to be a rounding error of it.
    expect(perFrame).toBeLessThan(1);
    expect(state.length).toBeLessThan(500_000);
  });
});
