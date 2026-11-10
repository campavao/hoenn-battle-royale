// "Sometimes when picking up an item or talking to an NPC, it feels like the first click
// doesn't go through" (Cam, 11-10). Walking into a ball, or turning to face one, is a
// walk in place (sim.ts's 'bump', 32 frames; 'turn', 8), and the room read no A all the
// while: a press that landed in it was spent, and only the next one took the ball.
// Emerald reads A then (UpdatePlayerAvatarTransitionState: a walk in place is
// PlayerAnimIsMultiFrameStationary, so T_NOT_MOVING, and FieldGetPlayerInput takes A);
// only a step between two tiles (T_TILE_TRANSITION) has no A.
import { describe, expect, it } from 'vitest';
import type { WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';
import { Host, play } from './host';
import { KEY_A, KEY_DOWN, KEY_RIGHT, makeRoom, type Room } from './room';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const PATCHES = patchJson as unknown as PatchTable;

/** A room with trainer 1 standing west of a ball, facing `facing`; and the ball. */
function besideBall(facing: number): { room: Room; key: number } {
  const room = makeRoom(MAPS, PATCHES, 4242);
  const b = [...room.ground().values()].find((q) => room.world.cell(q.map, q.x - 1, q.y) === 0 && !room.patchesOn(q.map).some((p) => p.x === q.x - 1 && p.y === q.y))!;
  room.apply({ c: 'join', id: 1, bot: false, name: 'A', skin: 0, spot: { map: b.map, x: b.x - 1, y: b.y }, facing });
  return { room, key: b.key };
}

const press = (room: Room, bits: number) => room.step(new Map([[1, [bits]]]));
const took = (evs: ReturnType<Room['step']>, key: number) => evs.some((e) => e.type === 'item' && e.key === key);

describe('the first A at a ball (Cam, 11-10)', () => {
  it('takes it while the trainer walks into it, the direction still held, on every frame of the bump', () => {
    const missed: number[] = [];
    for (let k = 1; k <= 40; k++) {
      const { room, key } = besideBall(4);
      for (let i = 0; i < k; i++) press(room, KEY_RIGHT);
      expect(room.actor(1)!.m.action?.kind ?? null, `frame ${k}`).toBe(k % 32 === 0 ? null : 'bump');
      if (!took(press(room, KEY_RIGHT | KEY_A), key)) missed.push(k);
    }
    expect(missed).toEqual([]);
  });

  it('takes it when the direction is let go and A pressed while the bump plays out', () => {
    const missed: number[] = [];
    for (let k = 1; k <= 31; k++) {
      const { room, key } = besideBall(4);
      for (let i = 0; i < k; i++) press(room, KEY_RIGHT);
      if (!took(press(room, KEY_A), key)) missed.push(k);
    }
    expect(missed).toEqual([]);
  });

  it('takes it in the turn to face it, as Emerald turning in place does', () => {
    const missed: number[] = [];
    for (let k = 0; k < 8; k++) {
      // Facing south; a tap of RIGHT turns east, in place, over eight frames.
      const { room, key } = besideBall(1);
      press(room, KEY_RIGHT);
      for (let i = 0; i < k; i++) press(room, 0);
      if (!took(press(room, KEY_A), key)) missed.push(k);
    }
    expect(missed).toEqual([]);
  });

  it('still has no A mid-step between two tiles (T_TILE_TRANSITION), as Emerald', () => {
    const room = makeRoom(MAPS, PATCHES, 4242);
    const open = (map: string, x: number, y: number) => room.world.cell(map, x, y) === 0 && !room.patchesOn(map).some((p) => p.x === x && p.y === y) && !room.groundAt(map, x, y);
    const b = [...room.ground().values()].find((q) => open(q.map, q.x - 1, q.y) && open(q.map, q.x - 2, q.y))!;
    expect(b, 'a ball with two open cells west of it').toBeTruthy();
    // Two cells west, facing east: a step to the cell beside the ball, A during it.
    room.apply({ c: 'join', id: 1, bot: false, name: 'A', skin: 0, spot: { map: b.map, x: b.x - 2, y: b.y }, facing: 4 });
    press(room, KEY_RIGHT);
    expect(room.actor(1)!.m.action?.kind).toBe('step');
    expect(took(press(room, KEY_A), b.key)).toBe(false);
  });

  it('a held A from before the bump is not a press (no ball taken without a new one)', () => {
    const { room, key } = besideBall(4);
    press(room, KEY_A | KEY_DOWN); // A held as a turn south begins, with nothing ahead
    for (let i = 0; i < 8; i++) press(room, KEY_A);
    let any = false;
    for (let i = 0; i < 40; i++) any = took(press(room, KEY_A | KEY_RIGHT), key) || any;
    expect(any).toBe(false);
  });

  it("online the same: the relay, the keys late and bunched, and the page's copy of its frames all give the ball", () => {
    let rng = 7;
    const r = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
    const missed: number[] = [];
    for (let k = 1; k <= 40; k += 3) {
      const probe = besideBall(4);
      const spot = probe.room.actor(1)!.m.spot;
      const host = new Host(makeRoom(MAPS, PATCHES, 4242), 0, MAPS);
      const id = host.join('A', 0, spot);
      host.advance();
      const me = host.room.actor(id)!;
      me.m.facing = me.m.moveDir = 4;
      const mirror = makeRoom(MAPS, PATCHES, 4242);
      mirror.load(host.room.state());
      // The phone: walks into the ball k frames, then A with the direction still held.
      const inputs: number[] = [];
      for (let i = 0; i < k; i++) inputs.push(KEY_RIGHT);
      inputs.push(KEY_RIGHT | KEY_A);
      for (let i = 0; i < 10; i++) inputs.push(KEY_RIGHT);
      // The network: each input 0..12 frames late, in order.
      const due: number[] = [];
      let t = 1;
      for (let i = 0; i < inputs.length; i++) { t = Math.max(t, i + Math.floor(r() * 13)); due.push(t); }
      let next = 0, relayGave = false, pageGave = false;
      for (let f = 0; f < inputs.length + 60; f++) {
        while (next < inputs.length && due[next] <= f) { host.input(id, next + 1, [inputs[next]]); next++; }
        const { frame, events } = host.advance();
        relayGave = took(events.filter((e) => e.id === id), probe.key) || relayGave;
        pageGave = took(play(mirror, frame).filter((e) => e.id === id), probe.key) || pageGave;
      }
      if (!relayGave || !pageGave) missed.push(k);
    }
    expect(missed).toEqual([]);
  }, 60_000); // 14 hosts and their mirrors: ~6 s here
});
