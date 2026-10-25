import { describe, expect, it } from 'vitest';
import { Bots, health, STEP_MS, WALKUP_DELAY_MS, type BotsOptions, type Decision, type DuelOutcome, type PlayerView } from './brain';
import { dealBots, Grade, MAX_SEATS } from './roster';
import { dealParty, grownUp, rungForPhase } from './party';
import { World, type Spot, type WorldMap } from './world';
import { pageCell, toRom } from './space';
import { mulberry32 } from '../match/clock';
import type { MapRef, Msg, PackedMon } from '../net/wire';
import type { Stack } from './bag';
import { restoreBots, snapBots } from '../match/hostsnap';

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
        all: () => [...ground].map(([key, at]) => ({ key, mapId: at.mapId, ...pageCell(at.x, at.y) })),
        at: (mapId, { x, y }) => {
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

  // Cam, 2026-10-18: "let's make all items collidable". A piece stops a step in the ROM
  // (BrGhosts_Passable), so a bot takes one from the cell beside it, turned to it.
  it('takes a piece from beside it, turned to it, and never steps onto it', () => {
    const ground = new Map<number, { mapId: string; x: number; y: number }>([[0x0100, { mapId: 'FIELD', x: 5, y: 5 }]]);
    const sent: Msg[] = [];
    const bots = new Bots({
      world: new World([FIELD, PATH]),
      targets: targets(),
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(3),
      inside: (id) => id === 'FIELD',
      loot: {
        all: () => [...ground].map(([key, at]) => ({ key, mapId: at.mapId, ...pageCell(at.x, at.y) })),
        at: (mapId, { x, y }) => [...ground].find(([, c]) => c.mapId === mapId && c.x === x && c.y === y)?.[0],
      },
    });
    const dealt = dealBots(8, 1, [], [{ mapId: 'FIELD', map: REFS.FIELD, x: 0, y: 0 }]);
    bots.start(dealt, 0);
    let at: Spot | undefined;
    for (let t = STEP_MS; t <= 30_000 && !at; t += STEP_MS) {
      bots.tick(t);
      if (sent.some((m) => m.t === 'pickup')) at = bots.spotOf(dealt[0].seat);
    }
    expect(sent.some((m) => m.t === 'step' && m.x === 5 && m.y === 5)).toBe(false);
    const took = sent.findIndex((m) => m.t === 'pickup' && m.key === 0x0100);
    expect(took).toBeGreaterThan(0);
    const face = sent[took - 1];
    expect(face.t).toBe('face');
    const toward: Record<number, [number, number]> = { 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] };
    const [dx, dy] = toward[(face as { f: number }).f];
    expect({ x: at!.x + dx, y: at!.y + dy }).toEqual({ x: 5, y: 5 });
  });

  it('goes round a person it cannot deal with, and walks over a ball it cannot have', () => {
    const LANE: WorldMap = {
      id: 'LANE', group: 0, num: 3, w: 5, h: 3, section: 'S', outdoor: true,
      grid: grid(['00000', '00000', '00000']), seams: [],
    };
    const run = (person: boolean) => {
      const ground = new Map<number, { mapId: string; x: number; y: number }>([[0xb000, { mapId: 'LANE', x: 2, y: 1 }]]);
      const sent: Msg[] = [];
      const bots = new Bots({
        world: new World([LANE]),
        targets: [{ mapId: 'LANE', x: 4, y: 1 }],
        mapRef: () => ({ group: 0, num: 3 }),
        send: (m) => void sent.push(m),
        rng: mulberry32(5),
        loot: {
          all: () => [...ground].map(([key, at]) => ({ key, mapId: at.mapId, ...pageCell(at.x, at.y) })),
          at: (mapId, { x, y }) => [...ground].find(([, c]) => c.mapId === mapId && c.x === x && c.y === y)?.[0],
        },
        sealed: () => true,
        person: () => person,
      });
      const dealt = dealBots(8, 1, [], [{ mapId: 'LANE', map: { group: 0, num: 3 }, x: 0, y: 1 }]);
      bots.start(dealt, 0);
      for (let t = STEP_MS; t <= 20_000; t += STEP_MS) bots.tick(t);
      return { sent, end: bots.spotOf(dealt[0].seat) };
    };
    const round = run(true);
    expect(round.sent.some((m) => m.t === 'step' && m.x === 2 && m.y === 1)).toBe(false);
    expect(round.sent.some((m) => m.t === 'step' && m.x === 4)).toBe(true);
    const over = run(false);
    expect(over.sent.some((m) => m.t === 'pickup')).toBe(false);
    expect(over.sent.some((m) => m.t === 'step' && m.x === 2 && m.y === 1)).toBe(true);
    expect(over.sent.some((m) => m.t === 'step' && m.x === 4)).toBe(true);
  });

  // Speed-up 6: a bot goes for an event the way a player does.
  const eventBots = (over: Partial<BotsOptions>, count = 1) => {
    const sent: Msg[] = [];
    const decisions: Decision[] = [];
    const bots = new Bots({
      world: new World([FIELD, PATH]),
      targets: targets().filter((t) => t.mapId === 'FIELD'),
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(3),
      deal: (bot, phase, mapId) => dealParty(5, bot.seat, phase, mapId),
      onDecision: (d) => void decisions.push(d),
      ...over,
    });
    const dealt = dealBots(8, count, [], [{ mapId: 'FIELD', map: REFS.FIELD, x: 0, y: 0 }]);
    bots.start(dealt, 0);
    return { bots, sent, decisions, dealt };
  };

  it("crosses a map for an event's piece it cannot see from here", () => {
    const ground = new Map<number, { mapId: string; x: number; y: number }>([[0xb001, { mapId: 'PATH', x: 3, y: 5 }]]);
    const { bots, sent, decisions } = eventBots({
      loot: {
        all: () => [...ground].map(([key, at]) => ({ key, mapId: at.mapId, ...pageCell(at.x, at.y) })),
        at: (mapId, { x, y }) => [...ground].find(([, c]) => c.mapId === mapId && c.x === x && c.y === y)?.[0],
      },
    });
    for (let t = STEP_MS; t <= 30_000; t += STEP_MS) {
      bots.tick(t);
      for (const msg of sent) if (msg.t === 'pickup') ground.delete(msg.key);
    }
    expect(decisions.some((d) => d.rule === 'wander' && d.detail === '-> PATH (for PATH)')).toBe(true);
    expect(sent.some((m) => m.t === 'pickup' && m.key === 0xb001)).toBe(true);
  });

  // PR #33 review: a gate's boss is fought for, not walked past. A loss puts the bot out,
  // as it does a player (src/overworld.c); a win leaves it hurt, and the piece is its.
  it("fights a gate's boss before it takes his piece, and goes out if it loses", () => {
    const boss = (level: number): PackedMon[] =>
      [287, 169, 340].map((species) => ({
        species, level, hp: 300, maxHp: 300, status: 0, moves: [{ id: 33, pp: 25, ppUps: 0 }],
        heldItem: 0, otId: 0, personality: 0, exp: 0, nickname: 'BOSS', ot: 'BR',
      }));
    const fight = (level: number) => {
      const ground = new Map<number, { mapId: string; x: number; y: number }>([[0xb000, { mapId: 'FIELD', x: 3, y: 3 }]]);
      const ran = eventBots({
        seed: 11,
        loot: {
          all: () => [...ground].map(([key, at]) => ({ key, mapId: at.mapId, ...pageCell(at.x, at.y) })),
          at: (mapId, { x, y }) => [...ground].find(([, c]) => c.mapId === mapId && c.x === x && c.y === y)?.[0],
        },
        guard: (piece) => (piece.key === 0xb000 ? boss(level) : undefined),
      });
      const before = ran.bots.partyOf(ran.dealt[0].seat).map((mon) => mon.hp);
      for (let t = STEP_MS; t <= 30_000 && ran.bots.count() > 0; t += STEP_MS) {
        ran.bots.tick(t);
        for (const msg of ran.sent) if (msg.t === 'pickup') ground.delete(msg.key);
      }
      return { ...ran, before };
    };

    const lost = fight(100);
    expect(lost.decisions.some((d) => d.rule === 'gate' && d.detail === 'lost at key 45056')).toBe(true);
    expect(lost.sent.some((m) => m.t === 'out' && m.seat === lost.dealt[0].seat)).toBe(true);
    expect(lost.sent.some((m) => m.t === 'pickup' && m.key === 0xb000)).toBe(false);

    const won = fight(1);
    expect(won.decisions.some((d) => d.rule === 'gate' && d.detail === 'won at key 45056')).toBe(true);
    expect(won.sent.some((m) => m.t === 'pickup' && m.key === 0xb000)).toBe(true);
    const after = won.bots.partyOf(won.dealt[0].seat).map((mon) => mon.hp);
    expect(after.some((hp, i) => hp < won.before[i])).toBe(true);
  });

  it("trades with an event's trader once, for the whole room, and keeps his mon up the rungs", () => {
    let standing = [{ key: 0xb00f, species: 131, mapId: 'PATH', ...pageCell(2, 3) }];
    const { bots, sent, dealt } = eventBots({ traders: () => standing }, 2);
    bots.ringMoved(2);
    for (let t = STEP_MS; t <= 40_000; t += STEP_MS) bots.tick(t);
    const trades = sent.filter((m) => m.t === 'pickup' && m.key === 0xb00f);
    expect(trades).toHaveLength(1); // this page's bots leave him be once one has traded
    const trader = (trades[0] as { seat: number }).seat;
    // He keeps the one he was given and offers it next (#9): his key names it.
    expect(trades[0]).toMatchObject({ n: 1 });
    expect((trades[0] as { item?: number }).item).toBeGreaterThan(0);
    expect(bots.partyOf(trader).map((m) => m.species)).not.toContain((trades[0] as { item?: number }).item);
    const lapras = grownUp(131, rungForPhase(2));
    expect(bots.partyOf(trader).map((m) => m.species)).toContain(lapras);
    expect(bots.partyOf(dealt.find((b) => b.seat !== trader)!.seat).map((m) => m.species)).not.toContain(lapras);
    standing = []; // the room heard
    const slot = bots.partyOf(trader).findIndex((m) => m.species === lapras);
    bots.ringMoved(4);
    expect(bots.partyOf(trader)[slot]).toMatchObject({ species: grownUp(131, rungForPhase(4)), level: rungForPhase(4) });
  });

  it('hands a trader a legendary like any other mon (Cam, 2026-10-23)', () => {
    const standing = [{ key: 0xb00f, species: 131, mapId: 'FIELD', ...pageCell(0, 1) }];
    const latias: PackedMon = { ...dealParty(5, 0, 0, undefined)[0], species: 407, hp: 1, maxHp: 40 };
    const { bots, sent } = eventBots({
      traders: () => standing,
      deal: (bot, phase) => [latias, ...dealParty(5, bot.seat, phase, undefined).slice(0, 1)],
    });
    for (let t = STEP_MS; t <= 5_000; t += STEP_MS) bots.tick(t);
    const trade = sent.find((m) => m.t === 'pickup' && m.key === 0xb00f) as { item?: number } | undefined;
    expect(trade?.item).toBe(407); // the most hurt goes, legendary or not
  });

  it("keeps FLY on the slot it trades away, at the trade and up the rungs", () => {
    const standing = [{ key: 0xb00f, species: 131, mapId: 'FIELD', ...pageCell(0, 1) }];
    const { bots, sent, dealt } = eventBots({
      traders: () => standing,
      deal: (bot, phase) => dealParty(5, bot.seat, phase, undefined).map((m) => ({ ...m, moves: [{ id: 33, pp: 25, ppUps: 0 }, { id: 19, pp: 15, ppUps: 0 }] })),
    });
    for (let t = STEP_MS; t <= 5_000; t += STEP_MS) bots.tick(t);
    expect(sent.some((m) => m.t === 'pickup' && m.key === 0xb00f)).toBe(true);
    const seat = dealt[0].seat;
    expect(bots.partyOf(seat).every((m) => m.moves.some((mv) => mv.id === 19))).toBe(true);
    bots.ringMoved(4);
    expect(bots.partyOf(seat).every((m) => m.moves.some((mv) => mv.id === 19))).toBe(true);
  });

  it("takes a bag's last item with a bare pickup, so every ROM lets go of it (a gift-giver)", () => {
    const bags = new Map<number, { id: number; n: number }[]>([[0xc001, [{ id: 200, n: 1 }]], [0x05ff, [{ id: 13, n: 2 }]]]);
    const cells = new Map([[0xc001, pageCell(0, 1)], [0x05ff, pageCell(1, 0)]]);
    const { bots, sent, dealt } = eventBots({
      targets: [{ mapId: 'FIELD', x: 0, y: 0 }],
      loot: {
        all: () => [...bags.keys()].map((key) => ({ key, mapId: 'FIELD', ...cells.get(key)! })),
        at: (mapId, { x, y }) => [...cells].find(([k, c]) => bags.has(k) && mapId === 'FIELD' && c.x === x && c.y === y)?.[0],
        bagAt: (key) => bags.get(key)?.[0]?.id,
        bagLeft: (key) => (bags.get(key) ?? []).reduce((n, st) => n + st.n, 0),
      },
    });
    const log: Msg[] = [];
    for (let t = STEP_MS; t <= 20_000; t += STEP_MS) {
      bots.tick(t);
      // The page's Loot table, as notePickup plays it.
      for (const m of sent.splice(0)) {
        if (m.t !== 'pickup') continue;
        log.push(m);
        const bag = bags.get(m.key);
        if (!bag) continue;
        if (m.item === undefined) bags.delete(m.key);
        else if (--bag[0].n <= 0) bag.shift();
      }
    }
    expect(log.filter((m) => m.t === 'pickup' && m.key === 0xc001)).toEqual([{ t: 'pickup', seat: dealt[0].seat, key: 0xc001 }]);
    expect(log.filter((m) => m.t === 'pickup' && m.key === 0x05ff)).toEqual([
      { t: 'pickup', seat: dealt[0].seat, key: 0x05ff, item: 13 },
      { t: 'pickup', seat: dealt[0].seat, key: 0x05ff },
    ]);
    expect(bots.bagOf(dealt[0].seat)).toEqual(expect.arrayContaining([{ id: 13, n: 2 }]));
    expect(bots.partyOf(dealt[0].seat)[0].heldItem).toBe(200); // the Leftovers went straight onto the lead
  });

  it('forgets a bot that goes out', () => {
    const { bots, dealt } = run(3, 1);
    bots.remove(dealt[0].seat);
    expect(bots.count()).toBe(2);
    expect(bots.spotOf(dealt[0].seat)).toBeUndefined();
  });
});

// POK-302's drift, for a bot that can route nowhere: a greedy step towards the targets
// rather than a random walk. Towards the targets INSIDE the ring (POK-330 #41).
describe('a bot with nowhere it can route to', () => {
  // Three maps in a row. The bot is walled into the west column of MID -- the only way
  // anywhere is back west into FOG, which is a landing map the fog has taken. IN, east
  // of the wall, is the ring.
  const FOG: WorldMap = { id: 'FOG', group: 0, num: 4, w: 3, h: 3, section: 'S', outdoor: true, grid: '9x0', seams: [{ dir: 'east', to: 'MID', offset: 0 }] };
  const MID: WorldMap = {
    id: 'MID', group: 0, num: 5, w: 3, h: 3, section: 'S', outdoor: true,
    grid: grid(['010', '010', '010']),
    seams: [{ dir: 'west', to: 'FOG', offset: 0 }, { dir: 'east', to: 'IN', offset: 0 }],
  };
  const IN: WorldMap = { id: 'IN', group: 0, num: 6, w: 3, h: 3, section: 'S', outdoor: true, grid: '9x0', seams: [{ dir: 'west', to: 'MID', offset: 0 }] };
  const cells = (id: string) => [0, 1, 2].flatMap((y) => [0, 1, 2].map((x) => ({ mapId: id, x, y })));

  it('drifts towards the ring, not towards the nearest landing map in the fog', () => {
    const world = new World([FOG, MID, IN]);
    const bots = new Bots({
      world,
      // The fogged map first: the nearest landing map, and the one the drift used to pick.
      targets: [...cells('FOG'), ...cells('IN')],
      mapRef: (id) => ({ group: 0, num: id === 'FOG' ? 4 : id === 'MID' ? 5 : 6 }),
      send: () => {},
      rng: mulberry32(7),
      inside: (id) => id === 'IN',
    });
    const [bot] = dealBots(1, 1, [], [{ mapId: 'MID', map: { group: 0, num: 5 }, x: 0, y: 1 }]);
    bots.start([bot], 0);
    const maps = new Set<string>();
    for (let t = STEP_MS; t <= 30_000; t += STEP_MS) {
      bots.tick(t);
      maps.add(bots.spotOf(bot.seat)!.map);
    }
    // Stuck, but never a step further from the ring than it started.
    expect([...maps]).toEqual(['MID']);
    expect(world.hops(bots.spotOf(bot.seat)!.map, 'IN')).toBe(1);
  });

  // The ring can close past every landing cell. chooseTarget then has nothing to aim at
  // and returned without touching the route it had just walked to the end of, so the
  // next tick read the step after the last one -- a TypeError every tick, for every bot,
  // for the rest of the match (seen in the merged play-again e2e).
  it('walks on when the ring has no landing cell left in it', () => {
    let inside: (mapId: string) => boolean = () => true;
    const { bots, dealt } = run(4, 0, (id) => inside(id));
    for (let t = STEP_MS; t <= 20_000; t += STEP_MS) bots.tick(t);
    inside = () => false;
    expect(() => {
      for (let t = 20_000 + STEP_MS; t <= 60_000; t += STEP_MS) bots.tick(t);
    }).not.toThrow();
    for (const bot of dealt) expect(bots.spotOf(bot.seat)).toBeDefined();
  });
});

// POK-330 #49 review: the route to the next map ended ON this map, at the cells that
// step across. A door tile is never one a route can end on -- stepping onto it lands on
// the other side -- so a hop only a door led to was never found, and a bot already on a
// seam's edge was "there", with nowhere to walk and no step over.
describe('a bot heading for another map', () => {
  // TOWN is a big open field whose only way out is a door in its far corner, into a
  // CAVE whose east edge is GOAL, the one map anybody lands on. From TOWN's other corner
  // the door is 78 steps and near 1,600 settled cells away: past a wander pick's budget,
  // inside a hop's.
  const TOWN: WorldMap = {
    id: 'TOWN', group: 0, num: 7, w: 40, h: 40, section: 'S', outdoor: true, grid: '1600x0', seams: [],
    warps: [{ x: 39, y: 39, to: 'CAVE', toX: 0, toY: 1, kind: 'door' }],
  };
  const CAVE: WorldMap = {
    id: 'CAVE', group: 0, num: 8, w: 3, h: 3, section: 'S', outdoor: false, grid: '9x0',
    seams: [{ dir: 'east', to: 'GOAL', offset: 0 }],
    warps: [{ x: 0, y: 1, to: 'TOWN', toX: 39, toY: 39, kind: 'door' }],
  };
  const GOAL: WorldMap = {
    id: 'GOAL', group: 0, num: 9, w: 3, h: 3, section: 'S', outdoor: true, grid: '9x0',
    seams: [{ dir: 'west', to: 'CAVE', offset: 0 }],
  };
  const NUM: Record<string, number> = { TOWN: 7, CAVE: 8, GOAL: 9 };

  function head(from: Spot, seconds: number) {
    const sent: Msg[] = [];
    const decisions: Decision[] = [];
    const bots = new Bots({
      world: new World([TOWN, CAVE, GOAL]),
      targets: [0, 1, 2].flatMap((y) => [0, 1, 2].map((x) => ({ mapId: 'GOAL', x, y }))),
      mapRef: (id) => ({ group: 0, num: NUM[id] }),
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      onDecision: (d) => void decisions.push(d),
    });
    const [bot] = dealBots(1, 1, [], [{ mapId: from.map, map: { group: 0, num: NUM[from.map] }, x: from.x, y: from.y }]);
    bots.start([bot], 0);
    for (let t = STEP_MS; t <= seconds * 1000; t += STEP_MS) bots.tick(t);
    return { bots, sent, decisions, seat: bot.seat };
  }

  it('walks through a door when a door is the only way to the next map', () => {
    const { bots, decisions, seat } = head({ map: 'TOWN', x: 0, y: 0 }, 40);
    // It used to be stuck: the route to the door found nothing, and so did every pick.
    expect(decisions[0]).toMatchObject({ rule: 'wander', detail: '-> CAVE (for GOAL)' });
    expect(bots.spotOf(seat)?.map).toBe('GOAL');
  });

  it('takes the step over when it is already standing on the edge', () => {
    const { sent, decisions } = head({ map: 'CAVE', x: 2, y: 1 }, 1);
    expect(decisions[0]).toMatchObject({ rule: 'wander', detail: '-> GOAL (for GOAL)' });
    // The first move after the one that put it down is the crossing.
    const moves = sent.filter((m) => m.t === 'place' || m.t === 'step');
    expect(moves[1]).toMatchObject({ t: 'place', map: { num: 9 }, x: 0, y: 1 });
  });

  it('walks the map it is on when there is somewhere on it to go, not to the next and back', () => {
    // FIELD and PATH both have targets. A route that crosses, asked before this map's own
    // pick, took a bot over the seam and straight back again every couple of steps.
    const { sent } = run(1, 60);
    const crossings = sent.filter((m) => m.t === 'place').length - 1; // the first put it down
    expect(crossings).toBeLessThan(4);
  });
});

describe('a bot and a player on one tile', () => {
  // HBR-37 (Cam's 10-20 play-test): after Cam's fight, DRAKE walked onto Cam's tile and
  // stood there. A corridor one cell wide, the bot at its west end, the only place to go
  // its east end, and a player in a battle (busy, so not a fight) in the middle of it.
  it('never steps onto a player, busy or not (HBR-37)', () => {
    const LANE: WorldMap = {
      id: 'LANE', group: 0, num: 3, w: 8, h: 1, section: 'S', outdoor: true,
      grid: grid(['00000000']), seams: [],
    };
    const world = new World([LANE]);
    const sent: Msg[] = [];
    const bots = new Bots({
      world,
      targets: [{ mapId: 'LANE', x: 7, y: 0 }],
      mapRef: () => ({ group: 0, num: 3 }),
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      engage: { players: () => [{ seat: 0, mapId: 'LANE', x: 3, y: 0, dir: 3, busy: true }] },
    });
    const dealt = dealBots(1, 1, [0], [{ mapId: 'LANE', map: { group: 0, num: 3 }, x: 0, y: 0 }]);
    bots.start(dealt, 0);
    for (let t = STEP_MS; t <= 30_000; t += STEP_MS) bots.tick(t);
    const steps = sent.filter((m) => m.t === 'step') as { x: number }[];
    expect(steps.map((m) => m.x)).toContain(2);
    expect(steps.map((m) => m.x)).not.toContain(3);
  });
});

describe('a bot meeting a player', () => {
  // One bot, parked where the player is standing right in front of it. The room is
  // told its team and then challenged -- in that order, because the ROM has to have
  // the party in hand before the challenge that starts the battle arrives.
  function meeting(player: PlayerView, party: PackedMon[] = [MON], bag?: Stack[]) {
    const world = new World([FIELD, PATH]);
    const sent: Msg[] = [];
    const bots = new Bots({
      world,
      targets: targets(),
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      engage: { players: () => [player] },
      deal: () => party,
      ...(bag ? { bagFor: () => bag.map((s) => ({ ...s })) } : {}),
    });
    const dealt = dealBots(1, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 1, y: 1 }]);
    bots.start(dealt, 0);
    for (let t = STEP_MS; t <= 4000; t += STEP_MS) bots.tick(t);
    return { sent, dealt, bots };
  }

  const MON: PackedMon = {
    species: 277, level: 5, hp: 19, maxHp: 19, status: 0,
    moves: [{ id: 1, pp: 35, ppUps: 0 }],
    heldItem: 0, otId: 0, personality: 0, exp: 0, nickname: 'TREECKO', ot: 'BR',
  };

  it('stages its party and challenges, in that order', () => {
    // A bot dealt at (1, 1) facing south sees anyone in the column below it.
    const { sent, dealt } = meeting({ seat: 0, mapId: 'FIELD', x: 1, y: 3, dir: 2 });
    const trainer = sent.findIndex((m) => m.t === 'trainer');
    const challenge = sent.findIndex((m) => m.t === 'challenge');
    expect(trainer).toBeGreaterThanOrEqual(0);
    expect(challenge).toBeGreaterThan(trainer);
    const card = sent[trainer] as { seat: number; name: string; mons: PackedMon[] };
    expect(card.seat).toBe(dealt[0].seat);
    expect(card.name.length).toBeLessThanOrEqual(7);
    expect(card.mons).toHaveLength(1);
    expect((sent[challenge] as { opponent: number }).opponent).toBe(0);
  });

  it('walks up to the player after the "!", like a trainer that spotted them (POK-409)', () => {
    // Facing south at a player three cells down its column: two steps, to the cell
    // next to them, and none of them before the ROM's bubble has had its second.
    const { sent, dealt, bots } = meeting({ seat: 0, mapId: 'FIELD', x: 1, y: 4, dir: 2 });
    const seat = dealt[0].seat;
    const challenge = sent.findIndex((m) => m.t === 'challenge');
    const walk = sent.slice(challenge).filter((m) => m.t === 'step' && (m as { seat: number }).seat === seat);
    expect(walk).toMatchObject([
      { d: 1, x: 1, y: 2 },
      { d: 1, x: 1, y: 3 },
    ]);
    expect(bots.spotOf(seat)).toEqual({ map: 'FIELD', x: 1, y: 3 });
  });

  it('waits for the bubble before the first step of the walk-up', () => {
    const world = new World([FIELD, PATH]);
    const sent: { at: number; m: Msg }[] = [];
    let now = 0;
    const bots = new Bots({
      world,
      targets: targets(),
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push({ at: now, m }),
      rng: mulberry32(7),
      engage: { players: () => [{ seat: 0, mapId: 'FIELD', x: 1, y: 4, dir: 2 }] },
      deal: () => [MON],
    });
    const dealt = dealBots(1, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 1, y: 1 }]);
    bots.start(dealt, 0);
    for (now = 50; now <= 4000; now += 50) bots.tick(now);
    const challengedAt = sent.find((e) => e.m.t === 'challenge')!.at;
    const steps = sent.filter((e) => e.at >= challengedAt && e.m.t === 'step');
    expect(steps).toHaveLength(2);
    expect(steps[0].at - challengedAt).toBeGreaterThanOrEqual(WALKUP_DELAY_MS);
    expect(steps[1].at - steps[0].at).toBeGreaterThanOrEqual(STEP_MS);
  });

  it('walks to where the player is now, not where they were at the challenge', () => {
    // Their ROM can land one more step before it freezes. Toward the bot: it stops next
    // to them, never on them. Away: it still ends next to them, not two cells short.
    for (const [moveTo, endY] of [[3, 2], [5, 4]] as const) {
      const player: PlayerView = { seat: 0, mapId: 'FIELD', x: 1, y: 4, dir: 2 };
      const world = new World([FIELD, PATH]);
      const sent: Msg[] = [];
      const bots = new Bots({
        world,
        targets: targets(),
        mapRef: (id) => REFS[id],
        send: (m) => void sent.push(m),
        rng: mulberry32(7),
        engage: { players: () => [player] },
        deal: () => [MON],
      });
      const dealt = dealBots(1, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 1, y: 1 }]);
      bots.start(dealt, 0);
      bots.tick(STEP_MS);
      expect(sent.some((m) => m.t === 'challenge')).toBe(true);
      player.y = moveTo;
      for (let t = 2 * STEP_MS; t <= 6000; t += STEP_MS) bots.tick(t);
      expect(bots.spotOf(dealt[0].seat)).toEqual({ map: 'FIELD', x: 1, y: endY });
    }
  });

  it('turns round to a player on its row it was not facing, then walks up (POK-444)', () => {
    // Facing south; the player is three cells east on its row, looking south too, so
    // neither eyeline meets. The bot turns east first -- the ROM reads that facing to
    // decide who walks -- then stages, challenges and walks the row.
    const { sent, dealt, bots } = meeting({ seat: 0, mapId: 'FIELD', x: 4, y: 1, dir: 1 });
    const seat = dealt[0].seat;
    const face = sent.findIndex((m) => m.t === 'face' && (m as { seat: number }).seat === seat);
    const challenge = sent.findIndex((m) => m.t === 'challenge');
    expect(face).toBeGreaterThanOrEqual(0);
    expect(sent[face]).toMatchObject({ f: 4 });
    expect(challenge).toBeGreaterThan(face);
    const walk = sent.slice(challenge).filter((m) => m.t === 'step' && (m as { seat: number }).seat === seat);
    expect(walk).toMatchObject([
      { d: 4, x: 2, y: 1 },
      { d: 4, x: 3, y: 1 },
    ]);
    expect(bots.spotOf(seat)).toEqual({ map: 'FIELD', x: 3, y: 1 });
  });

  it('does not turn to a player its look could not reach', () => {
    // Its row, but behind a wall: a look stops on collision, a turn does not see through it.
    const WALLED: WorldMap = { ...FIELD, grid: grid(['000000', '001000', '000000', '000000', '000000', '000000']) };
    const world = new World([WALLED, PATH]);
    const sent: Msg[] = [];
    const bots = new Bots({
      world,
      targets: targets(),
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      engage: { players: () => [{ seat: 0, mapId: 'FIELD', x: 4, y: 1, dir: 1 }] },
      deal: () => [MON],
    });
    bots.start(dealBots(1, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 1, y: 1 }]), 0);
    bots.tick(STEP_MS);
    expect(sent.some((m) => m.t === 'challenge')).toBe(false);
  });

  it('stays put when the player is the one who looked: their ROM walks them up', () => {
    // On its row, looking west at it, while the bot faces south: their look, their walk.
    const { sent, dealt, bots } = meeting({ seat: 0, mapId: 'FIELD', x: 4, y: 1, dir: 3 });
    const seat = dealt[0].seat;
    const challenge = sent.findIndex((m) => m.t === 'challenge');
    expect(challenge).toBeGreaterThanOrEqual(0);
    expect(sent.slice(challenge).some((m) => m.t === 'step' && (m as { seat: number }).seat === seat)).toBe(false);
    expect(bots.spotOf(seat)).toEqual({ map: 'FIELD', x: 1, y: 1 });
  });

  it('answers a challenge from a player who spotted it first', () => {
    // Nobody in the eyeline: the player is on another map, so nothing here has staged
    // anything. Their ROM saw the bot's ghost and challenged it anyway, which is the
    // half of the engage that used to leave them linking with a seat that has no ROM
    // behind it (POK-238).
    const { sent, dealt, bots } = meeting({ seat: 0, mapId: 'PATH', x: 1, y: 1, dir: 2 });
    expect(sent.some((m) => m.t === 'trainer')).toBe(false);

    expect(bots.challenged(dealt[0].seat, 0)).toBe(true);
    const card = sent.find((m) => m.t === 'trainer') as { seat: number; mons: PackedMon[] };
    expect(card.seat).toBe(dealt[0].seat);
    expect(card.mons).toHaveLength(1);
    // Their challenge is already waiting in their ROM: sending one back would start
    // the same fight twice.
    expect(sent.some((m) => m.t === 'challenge')).toBe(false);
    expect(sent.some((m) => m.t === 'busy' && (m as { kind?: string }).kind === 'battle')).toBe(true);
    // And it only answers once: a second challenge lands while it is already fighting.
    expect(bots.challenged(dealt[0].seat, 0)).toBe(false);
    // A seat nobody here walks is not ours to answer for.
    expect(bots.challenged(99, 0)).toBe(false);
  });

  it('goes out and drops its bag when the fight comes back with a wiped team', () => {
    const bag: Stack[] = [{ id: 13, n: 2 }];
    const { sent, dealt, bots } = meeting({ seat: 0, mapId: 'FIELD', x: 1, y: 3, dir: 2 }, [MON], bag);
    const seat = dealt[0].seat;

    expect(sent.some((m) => m.t === 'spill')).toBe(false);
    // What the ROM that fought it says when it has finished it: the same team, face down.
    bots.setParty(seat, [{ ...MON, hp: 0 }]);

    const spill = sent.find((m) => m.t === 'spill') as {
      seat: number;
      mons: unknown[];
      bag?: { items: unknown[]; x: number; y: number };
    };
    expect(spill, 'its bag is on the ground where it fell').toBeDefined();
    expect(spill.seat).toBe(seat);
    // The team is the winner's ROM's to put down, round its own trainer, from a box that
    // asks which one to take (br_loot.c's spoils): two spills of it was a ball taken from
    // one coming back from the other.
    expect(spill.mons).toHaveLength(0);
    expect(spill.bag?.items, 'the bag it never got to spend').toHaveLength(1);
    expect(sent.some((m) => m.t === 'out' && m.seat === seat)).toBe(true);
    expect(bots.count(), 'and it stops being walked around').toBe(0);
  });

  it('drops the items its mons were holding with its bag (#22)', () => {
    const { sent, dealt, bots } = meeting({ seat: 0, mapId: 'FIELD', x: 1, y: 3, dir: 2 }, [MON], []);
    const seat = dealt[0].seat;
    // The ROM that beat it reports the team as it fought: the lead still holding its Leftovers.
    bots.setParty(seat, [{ ...MON, hp: 0, heldItem: 200 }]);
    const spill = sent.find((m) => m.t === 'spill') as { bag?: { items: Stack[] } };
    expect(spill.bag?.items, 'the Leftovers it was holding').toEqual([{ id: 200, n: 1 }]);
  });

  it('stakes its bag on the card, and spends only what the fight used (POK-237)', () => {
    const bag: Stack[] = [{ id: 13, n: 2 }, { id: 75, n: 1 }];
    const { sent, dealt, bots } = meeting({ seat: 0, mapId: 'FIELD', x: 1, y: 3, dir: 2 }, [MON], bag);
    const card = sent.find((m) => m.t === 'trainer') as { items?: number[] };
    // One POTION, then the X ATTACK: bag.ts's own order, so a bag of potions never
    // crowds the booster out and nobody drinks four of them in one fight.
    expect(card.items).toEqual([13, 75]);
    // Still in the bag until the ROM says otherwise.
    expect(bots.bagOf(dealt[0].seat)).toEqual([{ id: 13, n: 2 }, { id: 75, n: 1 }]);
    bots.noteSpent(dealt[0].seat, [13, 75]);
    expect(bots.bagOf(dealt[0].seat)).toEqual([{ id: 13, n: 1 }]);
  });

  it('drops what is left of the bag where it falls (POK-237)', () => {
    const world = new World([FIELD, PATH]);
    const sent: Msg[] = [];
    const hurt: PackedMon = { ...MON, hp: 1, maxHp: 19 };
    const bots = new Bots({
      world,
      targets: targets(),
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      deal: () => [hurt],
      bagFor: () => [{ id: 75, n: 1 }],
      // Nowhere is inside the ring, so the fog takes it where it stands.
      inside: () => false,
    });
    const dealt = dealBots(1, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 1, y: 1 }]);
    bots.start(dealt, 0);
    for (let t = STEP_MS; t <= 60_000; t += STEP_MS) bots.tick(t);
    const spill = sent.find((m) => m.t === 'spill') as { bag?: { items: Stack[]; money: number } };
    expect(spill?.bag?.items).toEqual([{ id: 75, n: 1 }]);
    expect(spill?.bag?.money).toBeGreaterThan(0);
  });

  // A bot's bag starts empty (POK-322). Beating one still pays its purse: the bag goes
  // down with the cash in it and nothing else, which the ROM pays out like any other.
  // The empty bag comes in through bagFor, as the host's dealt one did: the ring's old
  // restock ran only for a Bots with a bagFor, so without one the ring check could not fail.
  it('drops its purse as a bag with no items when it had nothing (POK-322)', () => {
    const { sent, dealt, bots } = meeting({ seat: 0, mapId: 'FIELD', x: 1, y: 3, dir: 2 }, [MON], []);
    const seat = dealt[0].seat;
    expect(bots.bagOf(seat)).toEqual([]);
    const card = sent.find((m) => m.t === 'trainer') as { items?: number[] };
    expect(card.items, 'nothing to stake').toBeUndefined();
    bots.ringMoved(3);
    expect(bots.bagOf(seat), 'and the ring moving is no Mart').toEqual([]);
    bots.setParty(seat, [{ ...MON, hp: 0 }]);
    const spill = sent.find((m) => m.t === 'spill') as { bag?: { items: Stack[]; money: number } };
    expect(spill?.bag?.items).toEqual([]);
    expect(spill?.bag?.money).toBeGreaterThan(0);
  });

  // ...and what it does carry is what it went and got: a POTION off a bag on the ground
  // is in its next fight, and on the ground where it falls (POK-322).
  it('carries what it picked up off the ground into its next fight, and drops it (POK-322)', () => {
    const world = new World([FIELD, PATH]);
    const sent: Msg[] = [];
    const KEY = 0x01ff;
    let lying = true;
    const bots = new Bots({
      world,
      targets: targets(),
      mapRef: (id) => REFS[id],
      send: (m) => {
        sent.push(m);
        if (m.t === 'pickup' && m.key === KEY) lying = false;
      },
      rng: mulberry32(7),
      deal: () => [MON],
      // Empty, but there: the ring's old restock ran only for a Bots with a bagFor.
      bagFor: () => [],
      // A bag lying on the cell the bot was dealt onto.
      loot: {
        all: () => (lying ? [{ key: KEY, mapId: 'FIELD', ...pageCell(1, 1) }] : []),
        at: (mapId, cell) => (lying && mapId === 'FIELD' && cell.x === 1 && cell.y === 1 ? KEY : undefined),
        bagAt: (key) => (key === KEY ? 13 : undefined),
      },
    });
    const dealt = dealBots(1, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 1, y: 1 }]);
    const seat = dealt[0].seat;
    bots.start(dealt, 0);
    bots.tick(STEP_MS);
    expect(sent.filter((m) => m.t === 'pickup')).toEqual([{ t: 'pickup', seat, key: KEY, item: 13 }]);
    expect(bots.bagOf(seat)).toEqual([{ id: 13, n: 1 }]);
    // The ring moving used to put a free potion in every standing bot's bag.
    bots.ringMoved(1);
    expect(bots.bagOf(seat)).toEqual([{ id: 13, n: 1 }]);
    expect(bots.challenged(seat, 0)).toBe(true);
    const card = sent.find((m) => m.t === 'trainer') as { items?: number[] };
    // One POTION in the bag is one in the fight.
    expect(card.items).toEqual([13]);
    bots.setParty(seat, [{ ...MON, hp: 0 }]);
    const spill = sent.find((m) => m.t === 'spill') as { bag?: { items: Stack[] } };
    expect(spill?.bag?.items).toEqual([{ id: 13, n: 1 }]);
  });

  it('drinks from its own bag rather than walk to a Centre (POK-237)', () => {
    const world = new World([FIELD, PATH]);
    const sent: Msg[] = [];
    const hurt: PackedMon = { ...MON, hp: 4, maxHp: 40 };
    const bots = new Bots({
      world,
      targets: targets(),
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      deal: () => [hurt],
      bagFor: () => [{ id: 13, n: 1 }],
      inside: () => true,
    });
    const dealt = dealBots(1, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 1, y: 1 }]);
    bots.start(dealt, 0);
    for (let t = STEP_MS; t <= 4000; t += STEP_MS) bots.tick(t);
    // One POTION drunk, and only one -- the cooldown is what stops a hurt bot
    // emptying the bag in four steps.
    expect(bots.bagOf(dealt[0].seat)).toEqual([]);
    expect(bots.partyOf(dealt[0].seat)[0].hp).toBe(24);
  });

  it('stands still while the fight runs, and walks again on the result', () => {
    const world = new World([FIELD, PATH]);
    const sent: Msg[] = [];
    const bots = new Bots({
      world,
      targets: targets(),
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      engage: { players: () => [{ seat: 0, mapId: 'FIELD', x: 1, y: 3, dir: 2 }] },
      deal: () => [MON],
    });
    const dealt = dealBots(1, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 1, y: 1 }]);
    bots.start(dealt, 0);
    for (let t = STEP_MS; t <= 3000; t += STEP_MS) bots.tick(t);
    expect(sent.some((m) => m.t === 'busy' && m.kind === 'battle')).toBe(true);
    const stepsWhileFighting = sent.filter((m) => m.t === 'step').length;
    for (let t = 3250; t <= 6000; t += STEP_MS) bots.tick(t);
    expect(sent.filter((m) => m.t === 'step').length).toBe(stepsWhileFighting);
    bots.noteResult(dealt[0].seat);
    expect(sent.some((m) => m.t === 'busy' && m.kind === undefined)).toBe(true);
  });

  // The fights nobody reports on (POK-330 #8). Each of these used to hold the bot as
  // `fighting`, and `busy` on every client, until the fog took it.
  describe('a fight nobody reports on', () => {
    function engaged() {
      const world = new World([FIELD, PATH]);
      const sent: Msg[] = [];
      const them: PlayerView = { seat: 0, mapId: 'FIELD', x: 1, y: 3, dir: 2 };
      let field: PlayerView[] = [them];
      const bots = new Bots({
        world,
        targets: targets(),
        mapRef: (id) => REFS[id],
        send: (m) => void sent.push(m),
        rng: mulberry32(7),
        engage: { players: () => field },
        deal: () => [MON],
      });
      const dealt = dealBots(1, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 1, y: 1 }]);
      bots.start(dealt, 0);
      let now = 0;
      const run = (ms: number) => {
        for (const end = now + ms; now < end; ) bots.tick((now += STEP_MS));
      };
      run(1000);
      expect(sent.some((m) => m.t === 'challenge')).toBe(true);
      const free = () => sent.some((m) => m.t === 'busy' && m.kind === undefined);
      return { run, free, them, leave: () => void (field = []) };
    }

    it('lets go of a fight that never started', () => {
      const { run, free } = engaged();
      run(10_000);
      expect(free()).toBe(false); // their ROM may still be finishing a sign or a menu
      run(15_000);
      expect(free()).toBe(true);
    });

    it('lets go when the other side leaves the match', () => {
      const { run, free, them, leave } = engaged();
      them.busy = true;
      run(2000);
      expect(free()).toBe(false);
      leave();
      run(STEP_MS);
      expect(free()).toBe(true);
    });

    it('waits out a long fight, and gives up on one that never ends', () => {
      const { run, free, them } = engaged();
      them.busy = true;
      run(4 * 60_000);
      expect(free(), 'six-a-side on the shot clock takes a while').toBe(false);
      run(2 * 60_000);
      expect(free()).toBe(true);
    });
  });

  it('leaves alone a player already in a battle', () => {
    const { sent } = meeting({ seat: 0, mapId: 'FIELD', x: 1, y: 3, dir: 2, busy: true });
    expect(sent.some((m) => m.t === 'challenge')).toBe(false);
  });

  it('does not challenge across a map', () => {
    const { sent } = meeting({ seat: 0, mapId: 'PATH', x: 1, y: 1, dir: 2 });
    expect(sent.some((m) => m.t === 'challenge')).toBe(false);
  });

  it('challenges once and then keeps the ROM grace', () => {
    const { sent } = meeting({ seat: 0, mapId: 'FIELD', x: 1, y: 3, dir: 2 });
    // 4 s of ticks against a 2 s cooldown: twice, never once a step.
    expect(sent.filter((m) => m.t === 'challenge').length).toBeLessThanOrEqual(2);
  });
});

describe('a bot that is hurt', () => {
  // FIELD with a door at (5, 5) into a one-room Centre whose counter is at (2, 1).
  const DOOR: WorldMap = {
    ...FIELD,
    warps: [{ x: 5, y: 5, to: 'CENTRE', toX: 2, toY: 3, kind: 'centre' }],
  };
  const CENTRE: WorldMap = {
    id: 'CENTRE', group: 0, num: 3, w: 4, h: 4, section: 'S', outdoor: false,
    grid: grid(['0000', '0000', '0000', '0000']),
    seams: [],
    warps: [{ x: 2, y: 3, to: 'FIELD', toX: 5, toY: 4, kind: 'door' }],
    centre: { counterX: 2, counterY: 1 },
  };

  const HURT_MON: PackedMon = {
    species: 277, level: 5, hp: 3, maxHp: 19, status: 0,
    moves: [{ id: 1, pp: 35, ppUps: 0 }],
    heldItem: 0, otId: 0, personality: 0, exp: 0, nickname: 'TREECKO', ot: 'BR',
  };

  function hurtBot(mon: PackedMon) {
    const world = new World([DOOR, CENTRE]);
    const sent: Msg[] = [];
    const bots = new Bots({
      world,
      targets: targets(),
      mapRef: (id) => ({ ...REFS, CENTRE: { group: 0, num: 3 } })[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      deal: () => [{ ...mon }],
      centres: () => world.centres(),
    });
    const dealt = dealBots(1, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 1, y: 1 }]);
    bots.start(dealt, 0);
    for (let t = STEP_MS; t <= 20000; t += STEP_MS) bots.tick(t);
    return { bots, sent, seat: dealt[0].seat };
  }

  it('walks through the door to the counter and comes out whole', () => {
    const { bots, seat } = hurtBot(HURT_MON);
    expect(health(bots.partyOf(seat))).toBe(1);
  });

  it('does not go to a Centre it does not need', () => {
    const { bots, seat } = hurtBot({ ...HURT_MON, hp: 19 });
    // Untouched: it wanders, and never ends up standing at a counter.
    expect(health(bots.partyOf(seat))).toBe(1);
    expect(bots.spotOf(seat)?.map).toBe('FIELD');
  });

  it('keeps the share of its health when the rung climbs', () => {
    const { bots, seat } = hurtBot({ ...HURT_MON, hp: 10 });
    bots.setParty(seat, [{ ...HURT_MON, hp: 10 }]);
    bots.ringMoved(3);
    const mon = bots.partyOf(seat)[0];
    expect(mon.hp / mon.maxHp).toBeCloseTo(10 / 19, 1);
  });
});

// The rung climbing, on the real deal (POK-330 #30). The stub deals above hand back the
// same species every time, which is why nothing saw what the real one does to a team:
// evolve it, and draw its extra slots from whatever table the bot is standing on.
describe('the rung climbing, with the real deal', () => {
  const R101: WorldMap = { ...FIELD, id: 'MAP_ROUTE101', seams: [{ dir: 'east', to: 'MAP_ROUTE110', offset: 0 }] };
  const R110: WorldMap = { ...PATH, id: 'MAP_ROUTE110', seams: [{ dir: 'west', to: 'MAP_ROUTE101', offset: 0 }] };
  const REF: Record<string, MapRef> = { MAP_ROUTE101: REFS.FIELD, MAP_ROUTE110: REFS.PATH };
  const SEED = 4242;
  const deal = (seat: number, phase: number, mapId: string) => dealParty(SEED, seat, phase, mapId, Grade.Ace);
  /** The first seat whose team passes `ok` -- the deal is seeded, so a test picks the
   *  bot it needs rather than hoping for it. */
  const seatWhere = (ok: (seat: number) => boolean) => {
    for (let seat = MAX_SEATS - 1; seat >= 0; seat--) if (ok(seat)) return seat;
    throw new Error('no seat deals that');
  };

  function ace(seat: number, targets: { mapId: string; x: number; y: number }[] = [{ mapId: 'MAP_ROUTE101', x: 0, y: 0 }]) {
    const bots = new Bots({
      world: new World([R101, R110]),
      targets,
      mapRef: (id) => REF[id],
      send: () => {},
      rng: mulberry32(7),
      // app.ts's own deal, minus the Zone pool.
      deal: (bot, phase, mapId) => dealParty(SEED, bot.seat, phase, mapId, bot.grade),
    });
    bots.start([{ seat, name: 'MAY', grade: Grade.Ace, skin: 0, map: REF.MAP_ROUTE101, mapId: 'MAP_ROUTE101', x: 1, y: 1 }], 0);
    return bots;
  }

  it('carries a hurt mon through its evolution, still hurt', () => {
    // A WURMPLE up front at the drop, which by rung 15 has grown all the way up.
    const seat = seatWhere((s) => deal(s, 0, 'MAP_ROUTE101')[0].species === 290);
    const bots = ace(seat);
    const [lead, ...rest] = bots.partyOf(seat);
    bots.setParty(seat, [{ ...lead, hp: Math.floor(lead.maxHp / 2) }, ...rest]);
    bots.ringMoved(2);
    const after = bots.partyOf(seat)[0];
    expect(after.species).not.toBe(290);
    expect(after.species).toBe(grownUp(290, rungForPhase(2)));
    expect(after.hp / after.maxHp).toBeCloseTo(0.5, 1);
  });

  it('leaves a fainted mon fainted', () => {
    const seat = seatWhere(() => true);
    const bots = ace(seat);
    const [lead, ...rest] = bots.partyOf(seat);
    expect(rest.length, 'an ace has a second mon to still be standing').toBeGreaterThan(0);
    bots.setParty(seat, [{ ...lead, hp: 0 }, ...rest]);
    bots.ringMoved(3);
    expect(bots.partyOf(seat)[0].hp).toBe(0);
  });

  it('deals the new slots from where the drop put it, not from where it has walked', () => {
    const species = (mapId: string, s: number) => deal(s, 3, mapId).map((m) => m.species);
    const seat = seatWhere((s) => species('MAP_ROUTE101', s).join() !== species('MAP_ROUTE110', s).join());
    // Somewhere to go on the next map over, so it walks there before the ring moves.
    const bots = ace(seat, [{ mapId: 'MAP_ROUTE110', x: 3, y: 3 }]);
    for (let t = STEP_MS; t <= 15_000 && bots.spotOf(seat)?.map !== 'MAP_ROUTE110'; t += STEP_MS) bots.tick(t);
    expect(bots.spotOf(seat)?.map).toBe('MAP_ROUTE110');
    bots.ringMoved(3);
    expect(bots.partyOf(seat).map((m) => m.species)).toEqual(species('MAP_ROUTE101', seat));
  });
});

describe('the hunt', () => {
  // A player parked in the far corner of PATH, facing away so the eyeline never
  // fires: the only thing that can bring a bot there is the hunt rule.
  const FAR: PlayerView = { seat: 0, mapId: 'PATH', x: 3, y: 5, dir: 2 };

  function field(alive: number) {
    const world = new World([FIELD, PATH]);
    const bots = new Bots({
      world,
      targets: [{ mapId: 'FIELD', x: 0, y: 0 }],
      mapRef: (id) => REFS[id],
      send: () => {},
      rng: mulberry32(7),
      alive: () => alive,
      engage: { players: () => [FAR] },
      deal: () => [],
    });
    const dealt = dealBots(1, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 0, y: 5 }]);
    bots.start(dealt, 0);
    // Every cell it stood on, not just the last: it walks on once it gets there.
    const visited: Spot[] = [];
    for (let t = STEP_MS; t <= 30000; t += STEP_MS) {
      bots.tick(t);
      const at = bots.spotOf(dealt[0].seat);
      if (at) visited.push(at);
    }
    return visited;
  }

  // Next to them, never on them (HBR-37): a trainer's tile is nobody else's.
  const beside = (s: Spot): boolean => s.map === 'PATH' && Math.abs(s.x - FAR.x) + Math.abs(s.y - FAR.y) === 1;

  it('walks to whoever is left once the field is down to three', () => {
    const visited = field(3);
    expect(visited.some(beside)).toBe(true);
    expect(visited).not.toContainEqual({ map: 'PATH', x: FAR.x, y: FAR.y });
  });

  it('does not hunt while the room is full', () => {
    expect(field(12).some(beside)).toBe(false);
  });
});

describe('a bot caught in the fog', () => {
  const MON: PackedMon = {
    species: 277, level: 5, hp: 20, maxHp: 20, status: 0,
    moves: [{ id: 1, pp: 35, ppUps: 0 }],
    heldItem: 0, otId: 0, personality: 0, exp: 0, nickname: 'TREECKO', ot: 'BR',
  };

  function fog(inside: boolean, seconds: number) {
    const world = new World([FIELD, PATH]);
    const sent: Msg[] = [];
    const bots = new Bots({
      world,
      targets: targets(),
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      deal: () => [{ ...MON }],
      inside: () => inside,
    });
    const dealt = dealBots(1, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 1, y: 1 }]);
    bots.start(dealt, 0);
    // The bleed is on a four-second wall clock, not on the step cadence -- so the
    // last tick lands exactly on the second asked for, whatever STEP_MS happens to be.
    for (let t = STEP_MS; t < seconds * 1000; t += STEP_MS) bots.tick(t);
    bots.tick(seconds * 1000);
    return { bots, sent, seat: dealt[0].seat };
  }

  it('loses a tenth of its team every four seconds, like the ROM does to a player', () => {
    // 12 s outside = three bites of 2 HP off a 20 HP mon.
    const { bots, seat } = fog(false, 12);
    expect(bots.partyOf(seat)[0].hp).toBe(14);
  });

  it('loses nothing inside the ring', () => {
    const { bots, seat } = fog(true, 12);
    expect(bots.partyOf(seat)[0].hp).toBe(20);
  });

  it('goes out when the fog takes the last of it, and says so', () => {
    const { bots, sent, seat } = fog(false, 60);
    expect(sent.some((m) => m.t === 'out' && m.seat === seat)).toBe(true);
    expect(bots.count()).toBe(0);
  });

  // The last ring bleeds every bot in it at one rate, so a field of bots falls on one
  // tick -- and the director crowns whoever is left once the rest are out, in the middle
  // of that tick's pass. The pass went on and put the winner out too: a champion the
  // room's roster and results had as eliminated (bots/offline.test.ts's seed found it).
  it('puts nobody out once the match is decided, not even in the pass that decided it', () => {
    const sent: Msg[] = [];
    const bots: Bots = new Bots({
      world: new World([FIELD, PATH]),
      targets: targets(),
      mapRef: (id) => REFS[id],
      // The director, for two bots: the first `out` leaves one standing, and that is the win.
      send: (m) => {
        sent.push(m);
        if (m.t === 'out') bots.decide();
      },
      rng: mulberry32(7),
      deal: () => [{ ...MON }],
      inside: () => false,
    });
    const spawns = [1, 2].map((x) => ({ mapId: 'FIELD', map: REFS.FIELD, x, y: 1 }));
    bots.start(dealBots(1, 2, [0], spawns), 0);
    for (let t = STEP_MS; t <= 60_000; t += STEP_MS) bots.tick(t);
    expect(sent.filter((m) => m.t === 'out')).toHaveLength(1);
    expect(bots.count()).toBe(1);
  });

  // A bot the fog takes at sea drops its team on the water, the way a player beaten
  // while surfing does -- it used to drop nothing (POK-330 #67). And its bag goes down
  // under the ROM's own key for a bag, 0xFF, not the page's old 6.
  it('drops everything where it falls, even out at sea', () => {
    const SEA: WorldMap = { id: 'SEA', group: 0, num: 7, w: 5, h: 5, section: 'S', outdoor: true, grid: '25x2', seams: [] };
    const sent: Msg[] = [];
    const surfer: PackedMon = { ...MON, moves: [{ id: 57, pp: 15, ppUps: 0 }] }; // SURF
    const bots = new Bots({
      world: new World([SEA]),
      targets: [{ mapId: 'SEA', x: 0, y: 0 }],
      mapRef: () => ({ group: 0, num: 7 }),
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      deal: () => [{ ...surfer }, { ...surfer }],
      bagFor: () => [{ id: 13, n: 1 }],
      inside: () => false,
    });
    const [bot] = dealBots(1, 1, [], [{ mapId: 'SEA', map: { group: 0, num: 7 }, x: 2, y: 2 }]);
    bots.start([bot], 0);
    for (let t = STEP_MS; t <= 60_000; t += STEP_MS) bots.tick(t);
    const spill = sent.find((m) => m.t === 'spill') as { mons: unknown[]; bag?: { key: number } } | undefined;
    expect(spill?.mons).toHaveLength(2);
    expect(spill?.bag?.key).toBe((bot.seat << 8) | 0xff);
  });

  // POK-388: a winner's spoils were lying where the bot fell, and its spill went on top
  // of them -- BrLoot_At answers with the first row on a cell, so the spoils vanished
  // under it. The cells already holding a piece are skipped, as the ROM's CellFree does.
  it('keeps its spill off cells that already hold a ball', () => {
    const SEA: WorldMap = { id: 'SEA', group: 0, num: 7, w: 5, h: 5, section: 'S', outdoor: true, grid: '25x2', seams: [] };
    const sent: Msg[] = [];
    const surfer: PackedMon = { ...MON, moves: [{ id: 57, pp: 15, ppUps: 0 }] }; // SURF
    const balls = new Set(['2,2', '3,2']); // its own cell and the first one out
    const bots = new Bots({
      world: new World([SEA]),
      targets: [{ mapId: 'SEA', x: 2, y: 2 }],
      mapRef: () => ({ group: 0, num: 7 }),
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      deal: () => [{ ...surfer }],
      bagFor: () => [{ id: 13, n: 1 }],
      inside: () => false,
      loot: {
        all: () => [],
        at: (_mapId, cell) => (balls.has(`${cell.x},${cell.y}`) ? 1 : undefined),
      },
    });
    const [bot] = dealBots(1, 1, [], [{ mapId: 'SEA', map: { group: 0, num: 7 }, x: 2, y: 2 }]);
    bots.start([bot], 0);
    for (let t = STEP_MS; t <= 60_000 && !sent.some((m) => m.t === 'spill'); t += STEP_MS) bots.tick(t);
    const spill = sent.find((m) => m.t === 'spill') as { mons: { x: number; y: number }[]; bag?: { x: number; y: number } };
    const where = [...spill.mons, spill.bag!].map((c) => `${c.x},${c.y}`);
    expect(where).toHaveLength(2);
    for (const cell of where) expect(balls.has(cell), `${cell} already had a ball`).toBe(false);
  });

  // FogReachesThisBattle in br_ring.c: a fight between contestants is theirs to lose,
  // and a bot is a contestant (POK-262, POK-330 #15).
  it('leaves a bot alone while a player is fighting it', () => {
    const world = new World([FIELD, PATH]);
    const sent: Msg[] = [];
    const them: PlayerView = { seat: 0, mapId: 'FIELD', x: 1, y: 3, dir: 2 };
    const bots = new Bots({
      world,
      targets: targets(),
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      deal: () => [{ ...MON }],
      inside: () => false,
      engage: { players: () => [them] },
    });
    const dealt = dealBots(1, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 1, y: 1 }]);
    bots.start(dealt, 0);
    bots.tick(STEP_MS);
    expect(sent.some((m) => m.t === 'challenge'), 'it saw them before the first bite').toBe(true);
    them.busy = true;
    // A minute outside is fifteen bites, which is this mon three times over.
    for (let t = 2 * STEP_MS; t <= 60_000; t += STEP_MS) bots.tick(t);
    expect(bots.partyOf(dealt[0].seat)[0].hp).toBe(20);
    expect(sent.some((m) => m.t === 'out')).toBe(false);
  });

  it('lets two bots in the fog finish a duel in the instance', async () => {
    const world = new World([FIELD, PATH]);
    const sent: Msg[] = [];
    let answer: ((v: { winner: number; loser: number; a: { hp: number; status: number }[]; b: { hp: number; status: number }[] }) => void) | undefined;
    const bots = new Bots({
      world,
      targets: targets(),
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      deal: () => [{ ...MON }],
      seed: 4242,
      inside: () => false,
      settle: () => new Promise((resolve) => (answer = resolve)),
    });
    const dealt = dealBots(1, 2, [0], [
      { mapId: 'FIELD', map: REFS.FIELD, x: 2, y: 1 },
      { mapId: 'FIELD', map: REFS.FIELD, x: 2, y: 2 },
    ]);
    bots.start(dealt, 0);
    for (let t = STEP_MS; t <= 60_000; t += STEP_MS) bots.tick(t);
    expect(answer, 'they met and the instance has the fight').toBeDefined();
    expect(bots.count()).toBe(2);

    const [a, b] = dealt.map((d) => d.seat);
    answer!({ winner: b, loser: a, a: [{ hp: 0, status: 0 }], b: [{ hp: 7, status: 0 }] });
    await Promise.resolve();
    await Promise.resolve();
    // The duel stands, not the fog: the loser is out and the winner has what it had left.
    expect(bots.count()).toBe(1);
    expect(sent.filter((m) => m.t === 'out').map((m) => (m as { seat: number }).seat)).toEqual([a]);
    expect(bots.partyOf(b)[0].hp).toBe(7);
  });
});

describe('two bots meeting', () => {
  const MON: PackedMon = {
    species: 277, level: 20, hp: 40, maxHp: 40, status: 0,
    moves: [{ id: 1, pp: 35, ppUps: 0 }],
    heldItem: 0, otId: 0, personality: 0, exp: 0, nickname: 'TREECKO', ot: 'BR',
  };

  function pair() {
    const world = new World([FIELD, PATH]);
    const sent: Msg[] = [];
    const bots = new Bots({
      world,
      targets: targets(),
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      deal: () => [{ ...MON }],
      seed: 4242,
    });
    // Two of them dealt a tile apart, so one is in the other's eyeline on the first
    // step whichever way either is facing.
    const dealt = dealBots(1, 2, [0], [
      { mapId: 'FIELD', map: REFS.FIELD, x: 2, y: 1 },
      { mapId: 'FIELD', map: REFS.FIELD, x: 2, y: 2 },
    ]);
    bots.start(dealt, 0);
    for (let t = STEP_MS; t <= 5000; t += STEP_MS) bots.tick(t);
    return { bots, sent, seats: dealt.map((b) => b.seat) };
  }

  /** The same pair, but the host has a proxy instance: the fight is handed over and
   *  the answer comes back a tick later (POK-238). */
  function pairWithProxy(settle: NonNullable<BotsOptions['settle']>) {
    const world = new World([FIELD, PATH]);
    const sent: Msg[] = [];
    const bots = new Bots({
      world,
      targets: targets(),
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      deal: () => [{ ...MON }],
      seed: 4242,
      settle,
    });
    const dealt = dealBots(1, 2, [0], [
      { mapId: 'FIELD', map: REFS.FIELD, x: 2, y: 1 },
      { mapId: 'FIELD', map: REFS.FIELD, x: 2, y: 2 },
    ]);
    bots.start(dealt, 0);
    for (let t = STEP_MS; t <= 5000; t += STEP_MS) bots.tick(t);
    return { bots, sent, seats: dealt.map((b) => b.seat) };
  }

  it('hands the fight to the proxy when there is one, and takes its answer (POK-238)', async () => {
    let asked: { a: number; b: number } | null = null;
    const { bots, sent, seats } = pairWithProxy(async (a, b) => {
      asked = { a: a.seat, b: b.seat };
      // The seat that was spotted wins, with one mon left on 7 HP.
      return { winner: b.seat, loser: a.seat, a: [{ hp: 0, status: 0 }], b: [{ hp: 7, status: 0 }] };
    });
    // Both are held while it runs, and neither walks off mid-fight.
    expect(sent.some((m) => m.t === 'busy' && (m as { kind?: string }).kind === 'battle')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(asked).not.toBeNull();
    expect(bots.count()).toBe(1);
    const left = seats.find((s) => bots.spotOf(s) !== undefined) as number;
    // The winner is carrying exactly what the instance said it had left, not what a
    // formula guessed.
    expect(bots.partyOf(left)[0].hp).toBe(7);
    expect(sent.some((m) => m.t === 'out')).toBe(true);
  });

  // A pair three cells apart down one column; the north one faces south, at the other.
  function apart(settle: NonNullable<BotsOptions['settle']>) {
    const world = new World([FIELD, PATH]);
    const sent: { at: number; m: Msg }[] = [];
    let now = 0;
    const bots = new Bots({
      world,
      targets: targets(),
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push({ at: now, m }),
      rng: mulberry32(7),
      deal: () => [{ ...MON }],
      seed: 4242,
      settle,
    });
    const dealt = dealBots(1, 2, [0], [
      { mapId: 'FIELD', map: REFS.FIELD, x: 2, y: 0 },
      { mapId: 'FIELD', map: REFS.FIELD, x: 2, y: 3 },
    ]);
    bots.start(dealt, 0);
    // North first, whichever seat the deal put there.
    const seats = dealt.map((b) => b.seat).sort((a, b) => bots.spotOf(a)!.y - bots.spotOf(b)!.y);
    const run = (until: number) => {
      for (now += 50; now <= until; now += 50) bots.tick(now);
      now -= 50;
    };
    return { bots, sent, seats, run, clock: () => now };
  }

  it('walks up to the other before the duel starts (HBR-36)', async () => {
    let askedAt: number | undefined;
    let where: (Spot | undefined)[] = [];
    const t = apart(async () => {
      askedAt = t.clock();
      where = t.seats.map((s) => t.bots.spotOf(s));
      return null;
    });
    t.run(5000);
    const [north, south] = t.seats;
    const walk = t.sent.filter((e) => e.m.t === 'step' && (e.m as { seat: number }).seat === north);
    expect(walk.map((e) => (e.m as { y: number }).y)).toEqual([1, 2]);
    expect(askedAt, 'the duel starts once it is beside the other').toBeGreaterThanOrEqual(walk[1].at);
    expect(where).toEqual([{ map: 'FIELD', x: 2, y: 2 }, { map: 'FIELD', x: 2, y: 3 }]);
    expect(t.sent.some((e) => e.m.t === 'step' && (e.m as { seat: number }).seat === south)).toBe(false);
  });

  it('holds the outcome until the fight has played out at real speed (HBR-43)', async () => {
    // 600 of the instance's frames is ten seconds of fight; it ran them in one.
    let answer: ((v: DuelOutcome) => void) | undefined;
    const t = apart((a, b) => new Promise((resolve) => (answer = () => resolve({
      winner: b.seat, loser: a.seat, a: [{ hp: 0, status: 0 }], b: [{ hp: 7, status: 0 }], frames: 600, ranMs: 1000,
    }))));
    t.run(5000);
    expect(answer, 'the duel is in the instance').toBeDefined();
    answer!({} as DuelOutcome);
    await Promise.resolve();
    await Promise.resolve();
    const answeredAt = t.clock();
    t.run(answeredAt + 9000 + 3000 - 100);
    expect(t.bots.count(), 'the watched fight is still on').toBe(2);
    expect(t.sent.some((e) => e.m.t === 'out')).toBe(false);
    t.run(answeredAt + 9000 + 3000 + 100);
    expect(t.bots.count()).toBe(1);
    expect(t.sent.filter((e) => e.m.t === 'out')).toHaveLength(1);
  });

  it('lands what the instance said over a host reload mid play-out, not a seeded guess (HBR-43)', async () => {
    let answer: (() => void) | undefined;
    const t = apart((a, b) => new Promise((resolve) => (answer = () => resolve({
      winner: b.seat, loser: a.seat, a: [{ hp: 0, status: 0 }], b: [{ hp: 7, status: 0 }], frames: 600, ranMs: 1000,
    }))));
    t.run(5000);
    answer!();
    await Promise.resolve();
    await Promise.resolve();
    const snap = JSON.parse(JSON.stringify(snapBots(t.bots, t.clock())));

    const sent: Msg[] = [];
    const back = new Bots({
      world: new World([FIELD, PATH]),
      targets: targets(),
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      deal: () => [{ ...MON }],
      seed: 4242,
      settle: () => new Promise(() => {}),
    });
    restoreBots(back, snap, 0);
    for (let now = 50; now <= 11_000; now += 50) back.tick(now);
    expect(back.count(), 'still playing out after the reload').toBe(2);
    for (let now = 11_050; now <= 13_000; now += 50) back.tick(now);
    expect(back.count()).toBe(1);
    const winner = t.seats.find((s) => back.spotOf(s) !== undefined)!;
    expect(back.partyOf(winner)[0].hp).toBe(7);
  });

  it('keeps a bot in its fight with a player over a host reload, through JSON (#128 review)', () => {
    const player: PlayerView = { seat: 0, mapId: 'FIELD', x: 2, y: 3, dir: 2 };
    const opts = (sent: Msg[]): BotsOptions => ({
      world: new World([FIELD, PATH]),
      targets: targets(),
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      deal: () => [{ ...MON }],
      engage: { players: () => [player] },
    });
    const bots = new Bots(opts([]));
    const dealt = dealBots(1, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 2, y: 1 }]);
    bots.start(dealt, 0);
    for (let t = STEP_MS; t <= 4000; t += STEP_MS) bots.tick(t);
    player.busy = true; // the fight is on in their ROM
    bots.tick(4000 + STEP_MS);
    const snap = JSON.parse(JSON.stringify(snapBots(bots, 4000 + STEP_MS)));
    expect(snap.fights, 'a fight with the player, no nonce').toEqual([[dealt[0].seat, 0, expect.any(Number), true, null]]);

    const sent: Msg[] = [];
    const back = new Bots(opts(sent));
    restoreBots(back, snap, 0);
    for (let now = 50; now <= 10_000; now += 50) back.tick(now);
    expect(sent.filter((m) => m.t === 'step'), 'still standing in its fight').toEqual([]);
    expect(sent.some((m) => m.t === 'busy' && (m as { kind?: string }).kind === undefined)).toBe(false);
  });

  it('walks round a player standing in open ground, not up to them and stuck (HBR-37 review)', () => {
    const OPEN: WorldMap = {
      id: 'OPEN', group: 0, num: 4, w: 9, h: 3, section: 'S', outdoor: true,
      grid: grid(['000000000', '000000000', '000000000']), seams: [],
    };
    const bots = new Bots({
      world: new World([OPEN]),
      targets: [{ mapId: 'OPEN', x: 8, y: 1 }],
      mapRef: () => ({ group: 0, num: 4 }),
      send: () => {},
      rng: mulberry32(7),
      engage: { players: () => [{ seat: 0, mapId: 'OPEN', x: 4, y: 1, dir: 3, busy: true }] },
    });
    const dealt = dealBots(1, 1, [0], [{ mapId: 'OPEN', map: { group: 0, num: 4 }, x: 0, y: 1 }]);
    bots.start(dealt, 0);
    const visited: Spot[] = [];
    for (let t = STEP_MS; t <= 60_000; t += STEP_MS) {
      bots.tick(t);
      visited.push(bots.spotOf(dealt[0].seat)!);
    }
    expect(visited.some((v) => v.x > 4), 'past the player').toBe(true);
    expect(visited).not.toContainEqual({ map: 'OPEN', x: 4, y: 1 });
  });

  it('falls back to the seeded resolver when the proxy cannot (POK-238)', async () => {
    const { bots } = pairWithProxy(async () => null);
    await Promise.resolve();
    await Promise.resolve();

    expect(bots.count()).toBe(1);
  });

  it('settles it anyway when the instance never answers (POK-330 #8)', async () => {
    // A core that crashed or stopped drawing: the promise simply never settles.
    let late: ((v: null) => void) | undefined;
    const { bots, sent } = pairWithProxy(() => new Promise((resolve) => (late = resolve)));
    for (let t = 5000 + STEP_MS; t <= 60_000; t += STEP_MS) bots.tick(t);
    expect(bots.count(), 'still waiting on it a minute in').toBe(2);
    for (let t = 60_000 + STEP_MS; t <= 3 * 60_000; t += STEP_MS) bots.tick(t);
    expect(bots.count()).toBe(1);
    expect(sent.filter((m) => m.t === 'out')).toHaveLength(1);
    // ...and an answer that turns up after all is too late to fight it twice.
    late?.(null);
    await Promise.resolve();
    await Promise.resolve();
    expect(sent.filter((m) => m.t === 'out')).toHaveLength(1);
  });

  it('settles it: one of them is out, and drops what it carried', () => {
    const { bots, sent } = pair();
    expect(bots.count()).toBe(1);
    const out = sent.filter((m) => m.t === 'out');
    expect(out).toHaveLength(1);
    const spill = sent.find((m) => m.t === 'spill') as { seat: number; mons: unknown[] } | undefined;
    expect(spill?.seat).toBe((out[0] as { seat: number }).seat);
    expect(spill?.mons).toHaveLength(1);
  });

  it('leaves the winner hurt', () => {
    const { bots, seats } = pair();
    const alive = seats.map((s) => bots.partyOf(s)).find((p) => p.length > 0)!;
    expect(alive[0].hp).toBeLessThan(MON.hp);
  });
});

describe('pacing (POK-361) and closing in (POK-362)', () => {
  const MON: PackedMon = {
    species: 277, level: 5, hp: 19, maxHp: 19, status: 0,
    moves: [{ id: 1, pp: 35, ppUps: 0 }],
    heldItem: 0, otId: 0, personality: 0, exp: 0, nickname: 'TREECKO', ot: 'BR',
  };

  it('walks in legs of a few steps and stands a moment between them', () => {
    const world = new World([FIELD, PATH]);
    let now = 0;
    const stepsAt: number[] = [];
    const bots = new Bots({
      world,
      targets: targets(),
      mapRef: (id) => REFS[id],
      send: (m) => {
        if (m.t === 'step' || (m.t === 'place' && now > 0)) stepsAt.push(now);
      },
      rng: mulberry32(7),
    });
    bots.start(dealBots(99, 1, [0, 1], [{ mapId: 'FIELD', map: REFS.FIELD, x: 0, y: 0 }]), 0);
    for (now = 100; now <= 60_000; now += 100) bots.tick(now);
    const gaps = stepsAt.slice(1).map((t, i) => t - stepsAt[i]);
    // Some rests, each well past a step's own beat...
    expect(gaps.filter((g) => g >= 300 + STEP_MS - 100).length).toBeGreaterThan(5);
    // ...and never more than six steps on end without one.
    let run = 0;
    let longest = 0;
    for (const g of gaps) {
      run = g < 300 + STEP_MS - 100 ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThanOrEqual(6);
  });

  it('walks up to a player a few tiles off it cannot see yet, and challenges them', () => {
    const world = new World([FIELD, PATH]);
    const sent: Msg[] = [];
    // Facing south from (0,0); the player is at (2,2), four tiles off and on no straight
    // line from it, facing south too, so neither can see the other.
    const player: PlayerView = { seat: 0, mapId: 'FIELD', x: 2, y: 2, dir: 1 };
    const bots = new Bots({
      world,
      targets: [{ mapId: 'PATH', x: 3, y: 5 }],
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      engage: { players: () => [player] },
      deal: () => [MON],
    });
    bots.start(dealBots(99, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 0, y: 0 }]), 0);
    for (let t = STEP_MS; t <= 10_000 && !sent.some((m) => m.t === 'challenge'); t += STEP_MS) bots.tick(t);
    expect(sent.find((m) => m.t === 'challenge')).toMatchObject({ opponent: 0 });
  });
  it('walks in out of the fog before it walks up to anybody (review of #43)', () => {
    const decisions: Decision[] = [];
    const player: PlayerView = { seat: 0, mapId: 'FIELD', x: 2, y: 2, dir: 1 };
    const bots = new Bots({
      world: new World([FIELD, PATH]),
      targets: [{ mapId: 'PATH', x: 3, y: 5 }],
      mapRef: (id) => REFS[id],
      send: () => undefined,
      rng: mulberry32(7),
      engage: { players: () => [player] },
      deal: () => [MON],
      inside: (id) => id === 'PATH', // FIELD is in the fog, the player with it
      onDecision: (d) => void decisions.push(d),
    });
    bots.start(dealBots(99, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 0, y: 0 }]), 0);
    for (let t = STEP_MS; t <= 3_000; t += STEP_MS) bots.tick(t);
    expect(decisions.some((d) => d.rule === 'hunt')).toBe(false);
  });
  it('still closes in when the last phase has closed on everything', () => {
    const sent: Msg[] = [];
    const player: PlayerView = { seat: 0, mapId: 'FIELD', x: 2, y: 2, dir: 1 };
    const bots = new Bots({
      world: new World([FIELD, PATH]),
      targets: [{ mapId: 'PATH', x: 3, y: 5 }],
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      engage: { players: () => [player] },
      deal: () => [MON],
      inside: () => false, // the ring is gone: no map is inside
    });
    bots.start(dealBots(99, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 0, y: 0 }]), 0);
    for (let t = STEP_MS; t <= 10_000 && !sent.some((m) => m.t === 'challenge'); t += STEP_MS) bots.tick(t);
    expect(sent.find((m) => m.t === 'challenge')).toMatchObject({ opponent: 0 });
  });
});

describe('encounter patches (POK-363)', () => {
  const MON: PackedMon = {
    species: 277, level: 5, hp: 19, maxHp: 19, status: 0,
    moves: [{ id: 1, pp: 35, ppUps: 0 }],
    heldItem: 0, otId: 0, personality: 0, exp: 0, nickname: 'TREECKO', ot: 'BR',
  };

  function onPatch(phase: { n: number }) {
    const sent: Msg[] = [];
    const decisions: Decision[] = [];
    // A patch on every cell of the field's top row: wherever the bot walks first, it is on one.
    const patches = [0, 1, 2, 3, 4, 5].map((x) => ({ key: 0x2000 | (3 << 3) | x, x, y: 0 }));
    const bots = new Bots({
      world: new World([FIELD, PATH]),
      targets: [{ mapId: 'FIELD', x: 5, y: 0 }],
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      deal: () => [{ ...MON }],
      patches: (mapId) => (mapId === 'FIELD' ? patches : []),
      ringPhase: () => phase.n,
      onDecision: (d) => void decisions.push(d),
    });
    const dealt = dealBots(99, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 0, y: 1 }]);
    bots.start(dealt, 0);
    return { sent, decisions, bots, seat: dealt[0].seat };
  }

  it('has the battle a player would: the patch goes, the mark goes up, and the lead is hurt', () => {
    const { sent, decisions, bots, seat } = onPatch({ n: 0 });
    let t = STEP_MS;
    for (; t <= 5_000 && !decisions.some((d) => d.rule === 'wild'); t += 100) bots.tick(t);
    const wild = decisions.find((d) => d.rule === 'wild')!;
    expect(wild.spot.y).toBe(0);
    const took = sent.findIndex((m) => m.t === 'pickup' && (m.key & 0xe000) === 0x2000);
    expect(took).toBeGreaterThanOrEqual(0);
    expect(sent[took + 1]).toEqual({ t: 'busy', seat, kind: 'battle' });
    const hp = bots.partyOf(seat)[0].hp;
    expect(hp).toBeLessThan(19);
    expect(hp).toBeGreaterThan(0);
    // It stands there for the battle, then lets the mark go.
    const at = bots.spotOf(seat);
    for (const stop = t + 3_000; t <= stop; t += 100) bots.tick(t);
    expect(bots.spotOf(seat)).toEqual(at);
    for (const stop = t + 2_000; t <= stop; t += 100) bots.tick(t);
    expect(sent.some((m) => m.t === 'busy' && m.seat === seat && m.kind === undefined)).toBe(true);
  });

  // POK-410: a legendary the match put down is a battle, for a bot as for a player.
  it('fights a legendary on the ground instead of picking it up: it goes, the mark goes up, the team is hurt', () => {
    const sent: Msg[] = [];
    const decisions: Decision[] = [];
    const ground = new Map<number, { x: number; y: number }>([[0xb000, { x: 3, y: 1 }]]);
    const bots = new Bots({
      world: new World([FIELD, PATH]),
      targets: [{ mapId: 'FIELD', x: 3, y: 1 }],
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      deal: () => [{ ...MON }, { ...MON }],
      inside: (id) => id === 'FIELD',
      onDecision: (d) => void decisions.push(d),
      loot: {
        all: () => [...ground].map(([key, at]) => ({ key, mapId: 'FIELD', ...pageCell(at.x, at.y) })),
        at: (mapId, { x, y }) => {
          for (const [key, cell] of ground) if (mapId === 'FIELD' && pageCell(cell.x, cell.y).x === x && pageCell(cell.x, cell.y).y === y) return key;
          return undefined;
        },
        legend: (key) => (key === 0xb000 ? { species: 401, level: 20 } : undefined),
      },
    });
    const dealt = dealBots(99, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 0, y: 1 }]);
    bots.start(dealt, 0);
    const seat = dealt[0].seat;
    let t = STEP_MS;
    for (; t <= 20_000 && !decisions.some((d) => d.rule === 'legend'); t += 100) {
      bots.tick(t);
      for (const m of sent) if (m.t === 'pickup') ground.delete(m.key);
    }
    expect(decisions.some((d) => d.rule === 'legend')).toBe(true);
    expect(decisions.some((d) => d.rule === 'pickup')).toBe(false);
    const took = sent.findIndex((m) => m.t === 'pickup' && m.key === 0xb000);
    expect(took).toBeGreaterThanOrEqual(0);
    expect(sent[took + 1]).toEqual({ t: 'busy', seat, kind: 'battle' });
    for (const mon of bots.partyOf(seat)) {
      expect(mon.hp).toBeLessThan(MON.hp);
      expect(mon.hp).toBeGreaterThan(0);
    }
    // It stands there through a long battle, three wild ones' worth.
    const at = bots.spotOf(seat);
    for (const stop = t + 11_000; t <= stop; t += 100) bots.tick(t);
    expect(bots.spotOf(seat)).toEqual(at);
    expect(sent.some((m) => m.t === 'busy' && m.seat === seat && m.kind === undefined)).toBe(false);
    for (const stop = t + 2_000; t <= stop; t += 100) bots.tick(t);
    expect(sent.some((m) => m.t === 'busy' && m.seat === seat && m.kind === undefined)).toBe(true);
    // Then it is the bot's, or back where it stood for everybody (the reviewer's "bots
    // delete legendaries"): never neither.
    const back = sent.find((m) => m.t === 'spill' && m.mons.some((mon) => mon.key === 0xb000));
    const caught = bots.partyOf(seat).some((mon) => mon.species === 401);
    expect(caught !== (back !== undefined)).toBe(true);
    if (back?.t === 'spill') expect(back.mons).toEqual([{ key: 0xb000, ...toRom(pageCell(3, 1)), species: 401, level: 20 }]);
  });

  it('puts a legendary back where it stood when its party has no room for it', () => {
    const sent: Msg[] = [];
    const ground = new Map<number, { x: number; y: number }>([[0xb000, { x: 3, y: 1 }]]);
    const bots = new Bots({
      world: new World([FIELD, PATH]),
      targets: [{ mapId: 'FIELD', x: 3, y: 1 }],
      mapRef: (id) => REFS[id],
      send: (m) => void sent.push(m),
      rng: mulberry32(7),
      deal: () => Array.from({ length: 6 }, () => ({ ...MON })),
      inside: (id) => id === 'FIELD',
      loot: {
        all: () => [...ground].map(([key, at]) => ({ key, mapId: 'FIELD', ...pageCell(at.x, at.y) })),
        at: (mapId, { x, y }) => {
          for (const [key, cell] of ground) if (mapId === 'FIELD' && pageCell(cell.x, cell.y).x === x && pageCell(cell.x, cell.y).y === y) return key;
          return undefined;
        },
        legend: (key) => (key === 0xb000 ? { species: 401, level: 20 } : undefined),
      },
    });
    const dealt = dealBots(99, 1, [0], [{ mapId: 'FIELD', map: REFS.FIELD, x: 0, y: 1 }]);
    bots.start(dealt, 0);
    for (let t = STEP_MS, seen = 0; t <= 40_000; t += 100) {
      bots.tick(t);
      for (; seen < sent.length; seen++) {
        const m = sent[seen];
        if (m.t === 'pickup') ground.delete(m.key);
        if (m.t === 'spill') ground.set(0xb000, { x: 3, y: 1 });
      }
    }
    expect(sent.some((m) => m.t === 'pickup' && m.key === 0xb000)).toBe(true);
    const back = sent.find((m) => m.t === 'spill');
    expect(back).toEqual({ t: 'spill', seat: dealt[0].seat, map: REFS.FIELD, mons: [{ key: 0xb000, ...toRom(pageCell(3, 1)), species: 401, level: 20 }] });
    expect(bots.partyOf(dealt[0].seat)).toHaveLength(6);
    // One try: it does not stand on the one it put back and fight it again.
    expect(sent.filter((m) => m.t === 'pickup' && m.key === 0xb000)).toHaveLength(1);
  });

  it('meets a taken patch only once it has grown back with the ring', () => {
    const phase = { n: 0 };
    const { decisions, bots } = onPatch(phase);
    for (let k = 0; k < 6; k++) bots.notePatch(0x2000 | (3 << 3) | k);
    for (let t = STEP_MS; t <= 20_000; t += 100) bots.tick(t);
    expect(decisions.some((d) => d.rule === 'wild')).toBe(false);
    phase.n = 1;
    for (let t = 20_000; t <= 40_000 && !decisions.some((d) => d.rule === 'wild'); t += 100) bots.tick(t);
    expect(decisions.some((d) => d.rule === 'wild')).toBe(true);
  });
});
