import { describe, expect, it } from 'vitest';
import { Bots, health, STEP_MS, type BotsOptions, type PlayerView } from './brain';
import { dealBots, Grade, MAX_SEATS } from './roster';
import { dealParty, grownUp, rungForPhase } from './party';
import { World, type Spot, type WorldMap } from './world';
import { pageCell } from './space';
import { mulberry32 } from '../match/clock';
import type { MapRef, Msg, PackedMon } from '../net/wire';
import type { Stack } from './bag';

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

  it('goes out and drops everything when the fight comes back with a wiped team', () => {
    const bag: Stack[] = [{ id: 13, n: 2 }];
    const { sent, dealt, bots } = meeting({ seat: 0, mapId: 'FIELD', x: 1, y: 3, dir: 2 }, [MON], bag);
    const seat = dealt[0].seat;

    expect(sent.some((m) => m.t === 'spill')).toBe(false);
    // What the ROM that fought it says when it has finished it: the same team, face down.
    bots.setParty(seat, [{ ...MON, hp: 0 }]);

    const spill = sent.find((m) => m.t === 'spill') as { seat: number; mons: unknown[]; bag?: { items: unknown[] } };
    expect(spill, 'its team is on the ground where it fell').toBeDefined();
    expect(spill.seat).toBe(seat);
    expect(spill.mons).toHaveLength(1);
    expect(spill.bag?.items, 'and the bag it never got to spend').toHaveLength(1);
    expect(sent.some((m) => m.t === 'out' && m.seat === seat)).toBe(true);
    expect(bots.count(), 'and it stops being walked around').toBe(0);
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

  it('walks to whoever is left once the field is down to three', () => {
    expect(field(3)).toContainEqual({ map: 'PATH', x: FAR.x, y: FAR.y });
  });

  it('does not hunt while the room is full', () => {
    expect(field(12)).not.toContainEqual({ map: 'PATH', x: FAR.x, y: FAR.y });
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
