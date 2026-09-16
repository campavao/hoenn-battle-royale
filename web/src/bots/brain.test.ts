import { describe, expect, it } from 'vitest';
import { Bots, STEP_MS } from './brain';
import { dealBots, MAX_SEATS } from './roster';
import { World, type WorldMap } from './world';
import { mulberry32 } from '../match/clock';
import type { MapRef, Msg } from '../net/wire';

function grid(rows: string[]): string {
  const cells = rows.join('').split('').map(Number);
  const tokens: string[] = [];
  for (let i = 0; i < cells.length; ) {
    let n = 1;
    while (i + n < cells.length && cells[i + n] === cells[i]) n++;
    tokens.push(`${n}x${cells[i]}`);
    i += n;
  }
  return tokens.join(';');
}

// An open 6x6 field and a corridor east of it, so a bot has somewhere to go and a
// seam to cross getting there.
const FIELD: WorldMap = {
  id: 'FIELD', group: 0, num: 1, w: 6, h: 6, section: 'S', outdoor: true,
  grid: grid(['000000', '000000', '000000', '000000', '000000', '000000']),
  seams: [{ dir: 'east', to: 'PATH', offset: 0 }],
};
const PATH: WorldMap = {
  id: 'PATH', group: 0, num: 2, w: 4, h: 6, section: 'S', outdoor: true,
  grid: grid(['0000', '0000', '0000', '0000', '0000', '0000']),
  seams: [{ dir: 'west', to: 'FIELD', offset: 0 }],
};

const REFS: Record<string, MapRef> = { FIELD: { group: 0, num: 1 }, PATH: { group: 0, num: 2 } };

function targets() {
  const out: { mapId: string; x: number; y: number }[] = [];
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 6; x++) out.push({ mapId: 'FIELD', x, y });
    for (let x = 0; x < 4; x++) out.push({ mapId: 'PATH', x, y });
  }
  return out;
}

function run(botCount: number, seconds: number, inside?: (mapId: string) => boolean) {
  const world = new World([FIELD, PATH]);
  const sent: Msg[] = [];
  const bots = new Bots({
    world,
    targets: targets(),
    mapRef: (id) => REFS[id],
    send: (m) => void sent.push(m),
    rng: mulberry32(7),
    inside,
  });
  const dealt = dealBots(99, botCount, [0, 1], targets().slice(0, 8).map((t) => ({
    mapId: t.mapId, map: REFS[t.mapId], x: t.x, y: t.y,
  })));
  bots.start(dealt, 0);
  for (let t = STEP_MS; t <= seconds * 1000; t += STEP_MS) bots.tick(t);
  return { world, sent, dealt, bots };
}

describe('dealing bots', () => {
  it('gives every bot a seat of its own, counting down from the top', () => {
    const spawns = [{ mapId: 'FIELD', map: REFS.FIELD, x: 1, y: 1 }];
    const bots = dealBots(1, 4, [0, 1], spawns);
    expect(bots.map((b) => b.seat)).toEqual([MAX_SEATS - 1, MAX_SEATS - 2, MAX_SEATS - 3, MAX_SEATS - 4]);
  });

  it('never takes a seat a person is already in', () => {
    const spawns = [{ mapId: 'FIELD', map: REFS.FIELD, x: 1, y: 1 }];
    const taken = [MAX_SEATS - 1, MAX_SEATS - 3];
    const bots = dealBots(1, 3, taken, spawns);
    for (const bot of bots) expect(taken).not.toContain(bot.seat);
    expect(new Set(bots.map((b) => b.seat)).size).toBe(3);
  });

  it('deals the same room twice from the same seed', () => {
    const spawns = targets().map((t) => ({ mapId: t.mapId, map: REFS[t.mapId], x: t.x, y: t.y }));
    expect(dealBots(4242, 6, [], spawns)).toEqual(dealBots(4242, 6, [], spawns));
  });

  it('gives them distinct names while it has them', () => {
    const spawns = [{ mapId: 'FIELD', map: REFS.FIELD, x: 1, y: 1 }];
    const bots = dealBots(3, 10, [], spawns);
    expect(new Set(bots.map((b) => b.name)).size).toBe(10);
  });
});

describe('bots walking', () => {
  it('says where each one is the moment it starts', () => {
    const { sent, dealt } = run(3, 0);
    const places = sent.filter((m) => m.t === 'place');
    expect(places).toHaveLength(3);
    expect(new Set(places.map((m) => (m as { seat: number }).seat))).toEqual(
      new Set(dealt.map((b) => b.seat)),
    );
  });

  it('walks a tile at a time, and every step is a real step', () => {
    const { world, sent, dealt } = run(2, 20);
    const at = new Map(dealt.map((b) => [b.seat, { map: b.mapId, x: b.x, y: b.y }]));
    let steps = 0;
    for (const msg of sent) {
      if (msg.t === 'place') {
        at.set(msg.seat, { map: msg.map!.num === 1 ? 'FIELD' : 'PATH', x: msg.x!, y: msg.y! });
        continue;
      }
      if (msg.t !== 'step') continue;
      steps++;
      const from = at.get(msg.seat)!;
      const dir = ({ 1: 'south', 2: 'north', 3: 'west', 4: 'east' } as const)[msg.d];
      const landed = world.step(from, dir);
      expect(landed, `seat ${msg.seat} step ${dir} from ${from.map}:${from.x},${from.y}`).not.toBeNull();
      expect({ x: landed!.x, y: landed!.y }).toEqual({ x: msg.x, y: msg.y });
      at.set(msg.seat, landed!);
    }
    expect(steps).toBeGreaterThan(20);
  });

  it('never stands anywhere it could not stand', () => {
    const { world, sent } = run(4, 30);
    for (const msg of sent) {
      if (msg.t !== 'step' && msg.t !== 'place') continue;
      const mapId = msg.map!.num === 1 ? 'FIELD' : 'PATH';
      expect(world.standable(mapId, msg.x!, msg.y!)).toBe(true);
    }
  });

  it('paces itself: four tiles a second, whatever the caller does', () => {
    const { sent } = run(1, 10);
    const steps = sent.filter((m) => m.t === 'step').length;
    // 10 seconds at 4/s, minus whatever it spent standing still choosing a new target.
    expect(steps).toBeLessThanOrEqual(40);
    expect(steps).toBeGreaterThan(20);
  });

  it('crosses a seam as a place, not a step', () => {
    const { sent } = run(4, 40);
    const crossings = sent.filter((m) => m.t === 'place').length;
    expect(crossings).toBeGreaterThan(4); // the four openers, plus seam crossings
  });

  it('only ever aims at somewhere inside the fog', () => {
    // FIELD is out of the ring, PATH is in it. Wherever a bot starts, it ends up on
    // PATH and stays there -- which is the fog rule doing its whole job.
    const { sent } = run(4, 60, (mapId) => mapId === 'PATH');
    const last = new Map<number, string>();
    for (const msg of sent) {
      if (msg.t === 'place' || msg.t === 'step') {
        last.set(msg.seat, msg.map!.num === 1 ? 'FIELD' : 'PATH');
      }
    }
    expect([...last.values()].every((m) => m === 'PATH')).toBe(true);
  });

  it('re-aims when the ring moves', () => {
    const world = new World([FIELD, PATH]);
    const sent: Msg[] = [];
    let inside: (mapId: string) => boolean = (mapId) => mapId === 'FIELD';
    const bots = new Bots({
      world,
      targets: targets(),
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(11),
      inside: (id) => inside(id),
    });
    bots.start(
      dealBots(5, 2, [], [{ mapId: 'FIELD', map: REFS.FIELD, x: 0, y: 0 }]),
      0,
    );
    for (let t = STEP_MS; t <= 20_000; t += STEP_MS) bots.tick(t);
    inside = (mapId: string) => mapId === 'PATH';
    bots.ringMoved();
    const before = sent.length;
    for (let t = 20_000 + STEP_MS; t <= 60_000; t += STEP_MS) bots.tick(t);
    const after = sent.slice(before);
    const ends = new Map<number, string>();
    for (const msg of after) {
      if (msg.t === 'place' || msg.t === 'step') {
        ends.set(msg.seat, msg.map!.num === 1 ? 'FIELD' : 'PATH');
      }
    }
    expect(ends.size).toBeGreaterThan(0);
    expect([...ends.values()].every((m) => m === 'PATH')).toBe(true);
  });

  it('walks to loot and picks it up', () => {
    const world = new World([FIELD, PATH]);
    const sent: Msg[] = [];
    // One ball, on the far side of the field from where the bot starts.
    const ground = new Map<number, { mapId: string; x: number; y: number }>([
      [0x0100, { mapId: 'FIELD', x: 5, y: 5 }],
    ]);
    const bots = new Bots({
      world,
      targets: targets(),
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(3),
      inside: (id) => id === 'FIELD',
      loot: {
        all: () => [...ground].map(([key, at]) => ({ key, ...at })),
        at: (mapId, x, y) => {
          for (const [key, cell] of ground) {
            if (cell.mapId === mapId && cell.x === x && cell.y === y) return key;
          }
          return undefined;
        },
      },
    });
    bots.start(dealBots(8, 1, [], [{ mapId: 'FIELD', map: REFS.FIELD, x: 0, y: 0 }]), 0);
    for (let t = STEP_MS; t <= 30_000; t += STEP_MS) {
      bots.tick(t);
      // The page takes it off the ground when the pickup goes out, the way the real
      // Loot table does.
      for (const msg of sent) if (msg.t === 'pickup') ground.delete(msg.key);
    }
    expect(sent.some((m) => m.t === 'pickup' && m.key === 0x0100)).toBe(true);
  });

  it('forgets a bot that goes out', () => {
    const { bots, dealt } = run(3, 1);
    bots.remove(dealt[0].seat);
    expect(bots.count()).toBe(2);
    expect(bots.spotOf(dealt[0].seat)).toBeUndefined();
  });
});
