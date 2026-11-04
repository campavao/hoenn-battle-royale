// Cam, 11-03: "Bot should follow the same rules as a player, not sure why we'd take short cuts."
// Each of these held a bot to less than a trainer until it was changed; the first describes the one
// that was already so.
import { describe, expect, it } from 'vitest';
import { decodeGrid, sameSpot, type Spot, type WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import { dealParty, rungForPhase, speciesName, teamField } from '../../src/bots/party';
import { findPath } from '../../src/bots/path';
import encounters from '../../src/data/encounters.json';
import { gradeOf } from '../../src/bots/roster';
import { WEATHER_DOWNPOUR } from '../../src/match/events';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';
import { HURT, botKeys, health, type Brain } from './bots';
import { Host, play } from './host';
import { simulate } from './battlesim';
import type { BattleEvent } from './battlelog';
import { cleanEvents } from './logwire';
import { ITEM_SAFARI_BALL, nationalOn, patchBalls, rollWild, wildDice, wildMon, zoneBalls, zoneFight, zoneRate } from './wild';
import { BOT_BITE, FIELD_SURF, HOST_JUDGE, KEY_A, KEY_B, KEY_RIGHT, KEY_UP, LEGEND_CATCH, LEGEND_FOE, RELEASED_SPILL, SAFARI, SPILL_KEY, botParty, legendMon, makeRoom, type Actor, type Room } from './room';
import type { PackedMon } from '../../src/net/wire';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const PATCHES = patchJson as unknown as PatchTable;
const OLDALE = 'MAP_OLDALE_TOWN';
const SEED = 4242;
const evolvesInto = (species: number) => !(encounters as unknown as { zone: number[] }).zone.includes(species);
const KEY = 1 << 20;
const ROYALE = 4, MASTER = 1;

function stage(simBots = true, seed = SEED): Room {
  const room = makeRoom(MAPS, PATCHES, seed);
  room.opening = 0;
  room.simBots = simBots;
  return room;
}

function bot(room: Room, spot: Spot, id = 7, facing = 1): Actor {
  room.apply({ c: 'join', id, bot: true, name: `B${id}`, skin: 0, spot, facing });
  const a = room.actor(id)!;
  a.calm = 0;
  return a;
}

/** A seat whose team, dealt on `map`, passes. */
function seat(pass: (bits: number) => boolean, map: string, seed = SEED): number {
  for (let id = 1; id < 400; id++) {
    if (pass(teamField(dealParty(seed, id, 1, map, gradeOf(seed, id))))) return id;
  }
  throw new Error('no such seat');
}

const cellOf = (cls: number): Spot => {
  for (const m of MAPS) {
    const g = decodeGrid(m.grid, m.w * m.h);
    for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) {
      if (g[y * m.w + x] === cls && g[(y + 1) * m.w + x] === 0) return { map: m.id, x, y };
    }
  }
  throw new Error(`no cell of class ${cls}`);
};

/** Frames on a Host, until `until`. */
const run = (host: Host, frames: number, until: () => boolean = () => false, mirror?: Room) => {
  for (let i = 0; i < frames && !until(); i++) {
    const { frame } = host.advance();
    if (mirror) play(mirror, frame);
  }
};

describe('already the same: a tree and a boulder', () => {
  it.each([[9, 1], [10, 2]])('class %i takes the team\'s own field move, for a bot as for a trainer, and neither pauses or fells it', (cls, bit) => {
    const at = cellOf(cls);
    const below = { map: at.map, x: at.x, y: at.y + 1 };
    for (const bits of [0, bit]) {
      const room = stage();
      const b = bot(room, below, 7), t = bot(room, { map: at.map, x: at.x + 40, y: at.y }, 8);
      t.bot = false;
      b.field = t.field = bits;
      const go = (a: Actor) => !!room.stepFor(a, true)(below, 2);
      expect(go(b), `bot, field ${bits}`).toBe(bits !== 0);
      expect(go(b)).toBe(go(t));
    }
  });
});

describe('a bot keeps the team it has', () => {
  it('it does not turn with the map under it', () => {
    const room = stage();
    const a = bot(room, { map: 'MAP_ROUTE103', x: 10, y: 10 });
    const before = botParty(room.seed, a, 5).map((m) => m.species);
    for (const map of ['MAP_ROUTE119', 'MAP_ROUTE111', 'MAP_LILYCOVE_CITY']) {
      a.m = { ...a.m, spot: { map, x: 10, y: 10 } };
      expect(botParty(room.seed, a, 5).map((m) => m.species), map).toEqual(before);
    }
  });

  it('out of the Zone, what it landed on deals it, and the Zone\'s field moves are gone with its Zone team', () => {
    const room = makeRoom(MAPS, PATCHES, SEED);
    room.ringPhase = 7200;
    room.opening = 60;
    const host = new Host(room, 5, MAPS, 0);
    host.lock();
    run(host, 70);
    for (const a of room.actors) {
      expect(a.m.spot.map.startsWith('MAP_SAFARI')).toBe(false);
      expect(a.field ?? 0, `${a.name} on ${a.m.spot.map}`).toBe(teamField(botParty(room.seed, a, 1)));
    }
  }, 60_000);
});

describe('a trainer played on by a bot', () => {
  const two = (room: Room) => {
    const host = new Host(room, 0, MAPS, 0);
    const id = host.join('ME', 0, { map: OLDALE, x: 10, y: 12 });
    host.lock();
    host.advance();
    return { host, id };
  };

  it('carries their own team, wounds and bag, and nothing dealt on top of it', () => {
    const room = stage();
    const { host, id } = two(room);
    const mirror = makeRoom(MAPS, PATCHES, room.seed);
    mirror.load(structuredClone(room.state()));
    host.toBot(id, [{ species: 280, level: 15, hp: 10, maxHp: 40, moves: [{ id: 52 }] }, { species: 25, level: 15, hp: 0, maxHp: 30, moves: [] }], { items: [{ id: 13, n: 3 }], money: 500 });
    run(host, 1, undefined, mirror);
    const a = room.actor(id)!;
    expect(a.bot).toBe(true);
    const party = botParty(room.seed, a, 6);
    expect(party.length, 'not the rows a bot is dealt by the sixth phase').toBe(2);
    expect(party.map((m) => m.species)).toEqual([282, 25]); // grown to the rung, as a trainer's are
    expect(a.wear).toEqual([0.25, 0]);
    expect(a.loot).toEqual({ items: [{ id: 13, n: 3 }], money: 500 });
    expect(party[0].moves.map((m) => m.id)).toEqual([52]);
    expect(party[0].romMoves).toBe(true);
    expect(mirror.hash()).toBe(room.hash());
    expect(mirror.actor(id)!.loot).toEqual(a.loot);
  });

  it('with nothing told yet, it is dealt a team as a bot is', () => {
    const room = stage();
    const { host, id } = two(room);
    host.toBot(id);
    host.advance();
    expect(botParty(room.seed, room.actor(id)!, 1).length).toBeGreaterThan(0);
  });

  it('a new round is a new team', () => {
    const room = stage();
    const { host, id } = two(room);
    host.toBot(id, [{ species: 280, level: 15, hp: 10, maxHp: 40, moves: [] }]);
    host.advance();
    (room as unknown as { newRound(n: number): void }).newRound(room.results.round + 1);
    const a = room.actor(id)!;
    expect(a.caught).toBeUndefined();
    expect(a.wear).toBeUndefined();
  });
});

describe('a bot at a legendary', () => {
  const legendAt = (room: Room, x: number, y: number, species = 404) =>
    room.spills.set(KEY, { key: KEY, map: OLDALE, x, y, name: '', legend: true, bag: { items: [], money: 0, mons: [{ species, level: 5 }] } });
  const atIt = (room: Room, items = [{ id: ROYALE, n: 6 }]) => {
    legendAt(room, 11, 12);
    const a = bot(room, { map: OLDALE, x: 10, y: 12 }, 7, 4);
    a.loot = { items, money: 0 };
    a.keys = KEY_RIGHT | KEY_A | KEY_B;
    room.step();
    return a;
  };

  it('loses, and is out of the match as a trainer is: its bag where it stood, the legendary back and whole', () => {
    const room = stage();
    bot(room, { map: OLDALE, x: 3, y: 3 }, 8).calm = 1e9;
    const a = atIt(room);
    expect(a.battling).toBe(true);
    room.results.entrants = [[7, 'B7'], [8, 'B8'], [9, 'B9']];
    room.apply({ c: 'bots', id: HOST_JUDGE, a: 7, b: LEGEND_FOE, winner: LEGEND_FOE, hp: [0.1] });
    expect(room.actor(7), 'out').toBeUndefined();
    expect(room.results.fallen).toMatchObject([{ id: 7, wild: true, bot: true }]);
    expect(room.spills.get(SPILL_KEY + 7)?.bag.mons?.length).toBeGreaterThan(0);
    expect(room.spillAt(OLDALE, 11, 12)?.legend, 'it stands').toBe(true);
    expect(legendMon(404, 1).hp, 'as whole as a trainer finds it').toBe(legendMon(404, 1).maxHp);
  });

  it('with no ball it leaves it be: nothing to catch it with', () => {
    const room = stage();
    const a = atIt(room, []);
    expect(a.battling).toBe(false);
    expect(room.spillAt(OLDALE, 11, 12)?.legend).toBe(true);
  });

  /** A legendary and a team that will beat it; the fight as the host runs it. */
  const mon = (species: number, level: number, hp = 1): PackedMon => {
    const m = legendMon(species, 1);
    const max = 40;
    return { ...m, species, level, hp: Math.max(1, Math.round(max * hp)), maxHp: max };
  };
  const wild = { catchRate: 3, catchAt: 1 / 3 };
  const side = (party: PackedMon[], balls?: { id: number; n: number }[]) => ({ seat: 7, name: 'B', skin: 0, party, balls });
  const foe = (party: PackedMon[]) => ({ seat: LEGEND_FOE, name: 'KYOGRE', skin: 0, party });

  it('a MASTER BALL takes it at the first throw, and is spent', () => {
    const out = simulate(side([mon(25, 50)], [{ id: MASTER, n: 1 }]), foe([mon(404, 50)]), { seed: 5, wild });
    expect(out.caught).toBe(true);
    expect(out.usedA).toEqual([MASTER]);
    expect(out.log.some((e) => e.e === 'text' && /caught/.test(e.text))).toBe(true);
    expect(out.log.at(-1)?.e).toBe('end');
  });

  it('a fight the bot lost with the legendary low is lost: it had no throw left in it', () => {
    let lost = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const out = simulate(side([mon(25, 5, 0.1)]), foe([mon(404, 80, 0.05)]), { seed, wild });
      if (!out.caught && out.winner === LEGEND_FOE) lost++;
      expect(out.caught ?? false, 'no balls').toBe(false);
    }
    expect(lost).toBeGreaterThan(0);
  });

  it('out of balls it runs by the ROM\'s odds, and gets away with what the fight left it', () => {
    let ran = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const out = simulate(side([mon(382, 60)]), foe([mon(404, 60)]), { seed, wild });
      if (out.ran) {
        ran++;
        expect(out.winner).toBe(0);
        expect(out.log.some((e) => e.e === 'text' && /away/.test(e.text))).toBe(true);
      }
    }
    expect(ran).toBeGreaterThan(0);
  });

  it('the same fight for the same seed, balls and all', () => {
    const go = () => simulate(side([mon(382, 60)], [{ id: ROYALE, n: 6 }]), foe([mon(404, 60)]), { seed: 9, wild });
    expect(go()).toEqual(go());
  });

  it('knocked out, it is not caught: it stands again for the next, as a trainer\'s does', async () => {
    const room = stage();
    const a = atIt(room);
    room.apply({ c: 'bots', id: HOST_JUDGE, a: 7, b: LEGEND_FOE, winner: 0, drew: [[0.4], [0]] });
    expect(room.actor(7)).toBe(a);
    expect(a.wear).toEqual([0.4]);
    expect(a.caught).toBeUndefined();
    expect(room.spillAt(OLDALE, 11, 12)?.legend).toBe(true);
  });

  it('the balls it threw are gone from its bag, six and more', () => {
    const room = stage();
    const a = atIt(room, [{ id: ROYALE, n: 12 }]);
    room.apply({ c: 'bots', id: HOST_JUDGE, a: 7, b: LEGEND_FOE, winner: 0, used: [Array(8).fill(ROYALE), []] });
    expect(a.loot?.items).toEqual([{ id: ROYALE, n: 4 }]);
  });
});

// Cam, 11-04: "an actual player when they stepped over a tile would initiate a battle and then leaving
// that tile would leave it no longer with a wild Pokemon, that's how a bot should do it too ... if we
// don't treat bots like normal players then we run into issues that we don't even know about."
describe('a bot on a wild patch', () => {
  /** A marked spot on `map` whose cell to the west is open ground, to step onto it from. */
  const spotOn = (room: Room, map = 'MAP_ROUTE101') => {
    for (const p of room.patchesOn(map)) {
      if (room.world.cell(map, p.x, p.y) !== 0 && room.world.cell(map, p.x, p.y) !== 7) continue;
      const west = { map, x: p.x - 1, y: p.y };
      if (room.stepFor(bot(room, { map: 'MAP_LITTLEROOT_TOWN', x: 3, y: 3 }, 900), true)(west, 4)) { room.apply({ c: 'leave', id: 900 }); return { p, west }; }
      room.apply({ c: 'leave', id: 900 });
    }
    throw new Error(`no way onto a spot on ${map}`);
  };
  /** One bot, a step from a spot, and the frames of the step: what the frames started. */
  const step = (room: Room, a: Actor) => {
    const out: ReturnType<Room['step']> = [];
    a.keys = KEY_RIGHT | KEY_B;
    out.push(...room.step());
    a.keys = 0;
    for (let i = 0; i < 40 && a.m.action; i++) out.push(...room.step());
    return out.filter((e) => e.type === 'bots' || e.type === 'wild');
  };
  const onIt = (room: Room, id = 7) => {
    const { p, west } = spotOn(room);
    const a = bot(room, west, id, 4);
    return { a, p, events: step(room, a) };
  };

  it('its step takes the spot and starts the fight, on the frame a trainer\'s would', () => {
    const r1 = stage(), r2 = stage();
    const { p, west } = spotOn(r1);
    const b = bot(r1, west, 7, 4);
    const t = bot(r2, west, 7, 4);
    t.bot = false;
    t.calm = 0;
    const seen = step(r1, b);
    const heard: ReturnType<Room['step']> = [];
    heard.push(...r2.step(new Map([[7, [KEY_RIGHT | KEY_B]]])));
    for (let i = 0; i < 40 && !heard.some((e) => e.type === 'wild'); i++) heard.push(...r2.step(new Map([[7, [0]]])));
    expect(r1.isTaken(p.key)).toBe(true);
    expect(r2.isTaken(p.key)).toBe(true);
    expect(r1.taken.get(p.key), 'the same frame').toBe(r2.taken.get(p.key));
    expect(b.battling).toBe(true);
    expect(b.judge).toBe(HOST_JUDGE);
    expect(seen).toMatchObject([{ type: 'bots', id: HOST_JUDGE, a: 7, b: LEGEND_FOE, legend: { key: p.key, patch: true } }]);
    expect(heard).toMatchObject([{ type: 'wild', id: 7, key: p.key }]);
  });

  it('a mirror has the spot gone and the same mon, from the keys alone', () => {
    const room = stage();
    const mirror = makeRoom(MAPS, PATCHES, room.seed);
    mirror.opening = 0;
    const { p, west } = spotOn(room);
    const a = bot(room, west, 7, 4);
    mirror.load(structuredClone(room.state()));
    mirror.simBots = true;
    a.keys = mirror.actor(7)!.keys = KEY_RIGHT | KEY_B;
    for (let i = 0; i < 40; i++) {
      room.step();
      mirror.step();
      if (i === 0) a.keys = mirror.actor(7)!.keys = 0;
    }
    expect(mirror.isTaken(p.key)).toBe(true);
    expect(mirror.actor(7)!.wildFight).toEqual(a.wildFight);
    expect(mirror.hash()).toBe(room.hash());
  });

  it('taken, the next over it gets nothing, and nor does a trainer', () => {
    const room = stage();
    const { a, p } = onIt(room);
    room.apply({ c: 'bots', id: HOST_JUDGE, a: 7, b: LEGEND_FOE, winner: 0, drew: [[1], [0]] });
    expect(a.battling).toBe(false);
    a.m = { ...a.m, spot: { map: 'MAP_ROUTE101', x: 3, y: 3 } };
    const west = { map: 'MAP_ROUTE101', x: p.x - 1, y: p.y };
    const c = bot(room, west, 8, 4);
    expect(step(room, c)).toEqual([]);
    expect(c.battling).toBe(false);
    expect(c.m.spot).toMatchObject({ x: p.x, y: p.y });
    c.m = { ...c.m, spot: { map: 'MAP_ROUTE101', x: 4, y: 3 } };
    const t = bot(room, west, 9, 4);
    t.bot = false;
    const heard = [...room.step(new Map([[9, [KEY_RIGHT | KEY_B]]]))];
    for (let i = 0; i < 40; i++) heard.push(...room.step(new Map([[9, [0]]])));
    expect(heard.filter((e) => e.type === 'wild')).toEqual([]);
    expect(t.battling).toBe(false);
  });

  it('it is back on the next phase, as a trainer\'s is (br_patch.c Regrow)', () => {
    const room = stage();
    room.ringPhase = 600;
    const { p } = onIt(room);
    expect(room.isTaken(p.key)).toBe(true);
    const was = room.ring().phase;
    for (let i = 0; i < 1300 && room.ring().phase === was; i++) room.step();
    expect(room.ring().phase).toBeGreaterThan(was);
    expect(room.isTaken(p.key)).toBe(false);
  });

  it('what lives there is the map\'s own table at Emerald\'s odds, or this match\'s stand-in for it', () => {
    const counts = new Map<number, number>();
    const m = { id: 'MAP_ROUTE101', group: 0, num: 16 };
    const rng = wildDice(SEED, 3, 5);
    // The seed's stand-ins aside: a seed of 0 has none (BrZone_NationalOn), so this is the table.
    for (let i = 0; i < 20000; i++) { const s = rollWild(0, m, false, rng); counts.set(s, (counts.get(s) ?? 0) + 1); }
    // src/data/wild_encounters.json's ROUTE101 slot by slot: WURMPLE, POOCHYENA, WURMPLE (20+10+...).
    const [wurmple, poochyena, zigzagoon] = [290, 286, 288];
    expect([...counts.keys()].sort()).toEqual([poochyena, zigzagoon, wurmple].sort());
    expect(counts.get(wurmple)! / 20000).toBeCloseTo(0.45, 1);
    expect(counts.get(poochyena)! / 20000).toBeCloseTo(0.45, 1);
    expect(counts.get(zigzagoon)! / 20000).toBeCloseTo(0.10, 1);
    expect(rollWild(0, { id: 'MAP_ROUTE101', group: 0, num: 16 }, true, rng), 'no water table: nothing').toBe(0);
  });

  it('a water spot rolls the water table', () => {
    const rng = wildDice(SEED, 3, 5);
    const m = { id: 'MAP_ROUTE103', group: 0, num: 18 };
    const seen = new Set(Array.from({ length: 2000 }, () => rollWild(0, m, true, rng)));
    // src/data/wild_encounters.json's ROUTE103 water_mons: TENTACOOL, WINGULL, PELIPPER.
    expect([...seen].sort((p, q) => p - q)).toEqual([72, 309, 310]);
  });

  it('the stand-in is br_zone.c\'s: half stay, the rest share a type and a weight, and a route keeps its one all match', () => {
    let swapped = 0, same = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const s = nationalOn(seed, 0, 16, 288);
      expect(nationalOn(seed, 0, 16, 288)).toBe(s);
      if (s === 288) { same++; continue; }
      swapped++;
      const [total, a, b] = (encounters as unknown as { stats: Record<string, number[]> }).stats[s];
      const [t0, t1, t2] = (encounters as unknown as { stats: Record<string, number[]> }).stats[288];
      expect(Math.abs(total - t0)).toBeLessThanOrEqual(60);
      expect([a, b].some((v) => v === t1 || v === t2)).toBe(true);
    }
    expect(same / 400).toBeGreaterThan(0.4);
    expect(swapped / 400).toBeGreaterThan(0.4);
    // Nothing that is no wild mon stands in: a legendary's stats would have it level with a pseudo.
    expect((encounters as unknown as { stats: Record<string, number[]> }).stats[404]).toBeUndefined();
  });

  it('what it met is at the rung and not grown: a level 50 ZIGZAGOON is a ZIGZAGOON', () => {
    const m = wildMon(288, 5);
    expect(m.species).toBe(288);
    expect(m.level).toBe(rungForPhase(5));
    expect(m.hp).toBe(m.maxHp);
  });

  describe('the fight', () => {
    /** A bot on a spot, a Host running it, and everything that comes of the fight. */
    const fought = async (seed = SEED, set?: (a: Actor) => void) => {
      const room = stage(true, seed);
      const logs: BattleEvent[][] = [];
      const host = new Host(room, 0, MAPS, 0, { onLog: (_s, l) => logs.push(l) });
      await host.simReady();
      const { p, west } = spotOn(room);
      const a = bot(room, west, 7, 4);
      set?.(a);
      host.brains.set(7, { rng: 5, wait: 1e9, dir: 1, goal: null });
      room.apply({ c: 'lock' });
      a.keys = KEY_RIGHT | KEY_B;
      room.step();
      a.keys = 0;
      const mirror = makeRoom(MAPS, PATCHES, room.seed);
      mirror.load(structuredClone(room.state()));
      for (let i = 0; i < 40 && a.m.action; i++) play(mirror, host.advance().frame);
      expect(a.battling).toBe(true);
      const species = a.wildFight!.species;
      for (let i = 0; i < 60 * 60 * 4 && room.actor(7)?.battling; i++) play(mirror, host.advance().frame);
      return { room, mirror, a, p, logs, species };
    };

    it('is simulated, turn by turn, and leaves the bot its wounds', async () => {
      const { a, logs, room, mirror, species } = await fought();
      expect(logs.length).toBe(1);
      const log = logs[0];
      const text = log.filter((e) => e.e === 'text').map((e) => (e as { text: string }).text);
      expect(text[0]).toBe(`Wild ${speciesName(species)} appeared!`);
      expect(log.some((e) => e.e === 'hp')).toBe(true);
      expect(a.battling).toBe(false);
      expect(a.foe).toBe(0);
      expect(a.wildFight).toBeUndefined();
      expect(a.wear?.length).toBeGreaterThan(0);
      expect(mirror.hash(), 'and a mirror has it from the frames').toBe(room.hash());
    }, 60_000);

    it('uses its wear: it goes in with what it had left', async () => {
      const { logs } = await fought(SEED, (a) => { a.wear = [0.25]; });
      const start = logs[0][0] as Extract<BattleEvent, { e: 'start' }>;
      expect(start.a.team[0].hp / start.a.team[0].maxHp).toBeCloseTo(0.25, 1);
    }, 60_000);

    it('a ball and room: a throw on the first turn, by the ROM\'s odds, and what it catches is its own', async () => {
      // Whichever a seed's roll is: every one of these throws, and most take it.
      let took = 0;
      for (const seed of [SEED, SEED + 1, SEED + 2, SEED + 3]) {
        const { a, logs, species } = await fought(seed, (b) => { b.loot = { items: [{ id: ROYALE, n: 5 }], money: 0 }; });
        const text = logs[0].filter((e) => e.e === 'text').map((e) => (e as { text: string }).text);
        const threw = text.filter((t) => /used ROYALE BALL/.test(t)).length;
        expect(threw, text.join(' / ')).toBeGreaterThan(0);
        expect(a.loot?.items, 'spent').toEqual(threw === 5 ? [] : [{ id: ROYALE, n: 5 - threw }]);
        if (text.some((t) => /^Gotcha/.test(t))) {
          took++;
          expect(a.caught).toEqual([species]);
          expect(botParty(SEED, a, 1)[0].species).toBe(species);
        }
      }
      expect(took).toBeGreaterThan(0);
    }, 120_000);

    it('never a MASTER BALL on what lives in the grass, and no throw with no room', () => {
      expect(patchBalls(3, [{ id: 1, n: 1 }, { id: ROYALE, n: 2 }])).toEqual([{ id: ROYALE, n: 2 }]);
      expect(patchBalls(6, [{ id: ROYALE, n: 2 }])).toEqual([]);
    });

    it('a win is no catch, and the spot stays taken', () => {
      const room = stage();
      const { a, p } = onIt(room);
      room.apply({ c: 'bots', id: HOST_JUDGE, a: 7, b: LEGEND_FOE, winner: 0, drew: [[0.6], [0]] });
      expect(a.caught).toBeUndefined();
      expect(a.wear).toEqual([0.6]);
      expect(a.battling).toBe(false);
      expect(room.isTaken(p.key)).toBe(true);
    });

    it('its whole team lost is the match, as a trainer\'s is: out, by a wild POKeMON, its bag where it stood', () => {
      const room = stage();
      bot(room, { map: OLDALE, x: 3, y: 3 }, 8).calm = 1e9;
      const { a } = onIt(room);
      const at = { ...a.m.spot };
      room.results.entrants = [[7, 'B7'], [8, 'B8'], [9, 'B9']];
      room.apply({ c: 'bots', id: HOST_JUDGE, a: 7, b: LEGEND_FOE, winner: LEGEND_FOE });
      expect(room.actor(7)).toBeUndefined();
      expect(room.results.fallen).toMatchObject([{ id: 7, wild: true, bot: true }]);
      const bag = room.spills.get(SPILL_KEY + 7)!;
      expect(bag.map).toBe(at.map);
    });

    it('with the last of its team low it runs for it, by the ROM\'s odds, and it can fail', () => {
      const mon = (species: number, level: number, hp = 1): PackedMon => { const m = wildMon(species, 1); return { ...m, species, level, hp: Math.max(1, Math.round(m.maxHp * hp)), maxHp: m.maxHp }; };
      const wild = { catchRate: 255, catchAt: LEGEND_CATCH, patch: true };
      let ran = 0, lost = 0;
      for (let seed = 1; seed <= 24; seed++) {
        const out = simulate({ seat: 7, name: 'B', skin: 0, party: [mon(290, 8, 0.2)] }, { seat: LEGEND_FOE, name: 'X', skin: 0, party: [mon(382, 40)] }, { seed, wild });
        if (out.ran) ran++;
        if (out.winner === LEGEND_FOE) lost++;
        expect(out.caught ?? false).toBe(false);
      }
      expect(ran).toBeGreaterThan(0);
      expect(lost).toBeGreaterThan(0);
    });

    it('a whole team with no ball fights it out rather than run', () => {
      const mon = (species: number, level: number): PackedMon => ({ ...wildMon(species, 1), species, level });
      const wild = { catchRate: 255, catchAt: LEGEND_CATCH, patch: true };
      for (let seed = 1; seed <= 6; seed++) {
        const out = simulate({ seat: 7, name: 'B', skin: 0, party: [mon(382, 40)] }, { seat: LEGEND_FOE, name: 'X', skin: 0, party: [mon(290, 5)] }, { seed, wild });
        expect(out.ran ?? false, `seed ${seed}`).toBe(false);
        expect(out.winner).toBe(7);
      }
    });

    it('a page\'s hidden ROM runs it with no simulator, and with no page free the bot walks on and the spot stands', () => {
      const room = stage(false);
      const { p, west } = spotOn(room);
      const a = bot(room, west, 7, 4);
      expect(step(room, a)).toEqual([]);
      expect(a.battling).toBe(false);
      expect(room.isTaken(p.key)).toBe(false);
      a.m = { ...a.m, spot: west };
      const t = bot(room, { map: OLDALE, x: 3, y: 3 }, 8);
      t.bot = false;
      t.calm = 1e9;
      a.keys = KEY_RIGHT | KEY_B;
      const heard = [...room.step(new Map([[8, [0]]]))];
      a.keys = 0;
      for (let i = 0; i < 40 && a.m.action; i++) heard.push(...room.step(new Map([[8, [0]]])));
      expect(heard.filter((e) => e.type === 'bots')).toMatchObject([{ id: 8, a: 7, b: LEGEND_FOE, legend: { key: p.key, patch: true } }]);
      expect(room.isTaken(p.key)).toBe(true);
      // Its answer: beaten and not caught, what the fight left the team, and it walks on.
      room.apply({ c: 'bots', id: 8, a: 7, b: LEGEND_FOE, winner: 0, hp: [0.3] });
      expect(a.wear).toEqual([0.3]);
      expect(a.battling).toBe(false);
      // A page's ROM has duels to fight: not another of these for a minute.
      const other = spotOn(room, 'MAP_ROUTE102');
      const c = bot(room, other.west, 9, 4);
      expect(step(room, c)).toEqual([]);
      expect(c.battling).toBe(false);
      expect(room.isTaken(other.p.key)).toBe(false);
    });
  });

  describe('in the Zone', () => {
    const ZONE = 'MAP_SAFARI_ZONE_SOUTH';
    const inZone = () => {
      const room = makeRoom(MAPS, PATCHES, SEED);
      room.opening = 60 * 60;
      room.simBots = true;
      return room;
    };

    it('its step takes the spot, and the Zone\'s roll is any first stage', () => {
      const room = inZone();
      expect(room.ring().safari).toBe(true);
      const { p, west } = spotOn(room, ZONE);
      const a = bot(room, west, 7, 4);
      const seen = step(room, a);
      expect(room.isTaken(p.key)).toBe(true);
      expect(seen).toMatchObject([{ type: 'bots', b: LEGEND_FOE, legend: { key: p.key, patch: true, zone: true } }]);
      expect(evolvesInto(a.wildFight!.species), 'no evolved mon').toBe(false);
    });

    it('a battle of balls: thrown until it is caught or runs, the ROM\'s sums, and nobody hurt', () => {
      const side = { seat: 7, name: 'B', skin: 0, party: [wildMon(290, 1)], balls: zoneBalls(1) };
      let caught = 0, ran = 0, thrown = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const out = zoneFight(side, 1, { seed }); // BULBASAUR: 45 to the ROM, 38 by way of its share of 1275
        if (out.caught) caught++;
        if (out.ran) ran++;
        thrown += out.usedA.length;
        expect(out.shareA).toEqual([1]);
        expect(out.log[0].e).toBe('start');
        expect(out.log.at(-1)).toEqual({ e: 'end', winner: out.caught ? 7 : 0 });
      }
      expect(caught + ran).toBe(400);
      // With 15% to run a turn and 20%, then 11%, to take it (battle_ai_script_commands.c, atkcatch).
      expect(caught / 400).toBeGreaterThan(0.35);
      expect(caught / 400).toBeLessThan(0.6);
      expect(thrown / 400).toBeGreaterThan(2.5);
      expect(thrown / 400).toBeLessThan(4.5);
    });

    it('its log goes down the wire to a watcher, with nobody on the near side', () => {
      const out = zoneFight({ seat: 7, name: 'B', skin: 4, party: [wildMon(290, 1)], balls: zoneBalls(1) }, 1, { seed: 3, map: 'MAP_SAFARI_ZONE_SOUTH' });
      expect(cleanEvents(JSON.parse(JSON.stringify(out.log)), 400)).toEqual(out.log);
    });

    it('255 goes round its share of 1275 whole, and a common mon goes at the first throw', () => {
      expect(zoneRate(290)).toBe(255);
      expect(zoneFight({ seat: 7, name: 'B', skin: 0, party: [], balls: zoneBalls(1) }, 290, { seed: 5 }).usedA.length).toBe(1);
    });

    it('no balls left or no room: away, with no throw', () => {
      const out = zoneFight({ seat: 7, name: 'B', skin: 0, party: [], balls: [] }, 290, { seed: 5 });
      expect(out.ran).toBe(true);
      expect(out.usedA).toEqual([]);
      expect(zoneBalls(6)).toEqual([]);
      expect(zoneBalls(1, 30)).toEqual([{ id: ITEM_SAFARI_BALL, n: 0 }]);
    });

    it('what it catches is its team, off what it was dealt for it, and its thirty balls go down', async () => {
      const room = inZone();
      const host = new Host(room, 0, MAPS, 0);
      await host.simReady();
      const { west } = spotOn(room, ZONE);
      const a = bot(room, west, 7, 4);
      const dealt = botParty(room.seed, a, 1).length;
      host.brains.set(7, { rng: 5, wait: 1e9, dir: 1, goal: null });
      a.keys = KEY_RIGHT | KEY_B;
      room.step();
      a.keys = 0;
      for (let i = 0; i < 40 && a.m.action; i++) host.advance();
      const species = a.wildFight!.species;
      for (let i = 0; i < 60 * 60 && a.battling; i++) host.advance();
      expect(a.battling).toBe(false);
      expect(a.zoneThrown).toBeGreaterThan(0);
      expect(a.loot?.items ?? [], 'none out of its bag').toEqual([]);
      if (a.caught) {
        expect(a.caught).toEqual([species]);
        expect(a.zoneCaught).toBe(1);
        expect(botParty(room.seed, a, 1).length, 'in place of a dealt row').toBe(Math.max(1, dealt));
      }
    }, 60_000);

    it('it goes for grass nobody has been through, and past it with a full team', () => {
      const room = inZone();
      const { p, west } = spotOn(room, ZONE);
      const a = bot(room, west, 7, 4);
      a.calm = 1e9;
      const others = room.patchesOn(ZONE);
      for (const q of others) if (q.key !== p.key) room.taken.set(q.key, room.tick);
      for (const g of room.ground().values()) if (g.map === ZONE) room.picked.set(g.key, 99);
      const goalOf = () => {
        const brain: Brain = { rng: 7, wait: 0, dir: 1 };
        for (let i = 0; i < 30 && !brain.goal; i++) { botKeys(room, a, brain); room.step(); }
        return brain.goal;
      };
      expect(goalOf()).toEqual({ map: ZONE, x: p.x, y: p.y });
      room.taken.set(p.key, room.tick);
      expect(goalOf(), 'all taken: nothing to go for').toBeFalsy();
      room.taken.delete(p.key);
      a.caught = [277, 280, 283, 286, 288, 290];
      expect(goalOf(), 'nothing to catch it with').toBeFalsy();
    });

    it('the buzzer pulls it out of a battle, as a trainer\'s does, and an answer after it is nobody\'s', () => {
      const room = inZone();
      room.opening = 200;
      const { west } = spotOn(room, ZONE);
      const a = bot(room, west, 7, 4);
      step(room, a);
      expect(a.battling).toBe(true);
      for (let i = 0; i < 260 && room.ring().safari; i++) room.step();
      room.step();
      expect(a.m.spot.map.startsWith(SAFARI)).toBe(false);
      expect(a.battling).toBe(false);
      expect(a.wildFight).toBeUndefined();
      room.apply({ c: 'bots', id: HOST_JUDGE, a: 7, b: LEGEND_FOE, winner: 7, caught: 1 });
      expect(a.caught).toBeUndefined();
    });

    it('a new round has its balls back', () => {
      const room = inZone();
      const a = bot(room, { map: ZONE, x: 10, y: 10 });
      a.zoneThrown = 12;
      a.zoneCaught = 2;
      (room as unknown as { newRound(n: number): void }).newRound(room.results.round + 1);
      expect(a.zoneThrown).toBeUndefined();
      expect(a.zoneCaught).toBeUndefined();
    });
  });

  describe('going round it', () => {
    /** A spot on an open row, with an open row beside it: the straight way is over it, and there is
     *  another. */
    const line = () => {
      const room = stage();
      const open = (map: string, x: number, y: number) => { const c = room.world.cell(map, x, y); return (c === 0 || c === 7) && !room.groundAt(map, x, y) && !room.patchesOn(map).some((q) => q.x === x && q.y === y); };
      for (const map of ['MAP_ROUTE101', 'MAP_ROUTE102', 'MAP_ROUTE103', 'MAP_ROUTE104', 'MAP_ROUTE110', 'MAP_ROUTE117']) {
        for (const p of room.patchesOn(map)) {
          const xs = [-2, -1, 1, 2, 3, 4];
          if (!xs.every((d) => open(map, p.x + d, p.y))) continue;
          if (![-2, -1, 0, 1, 2, 3, 4].every((d) => open(map, p.x + d, p.y + 1))) continue;
          return { room, p, west: { map, x: p.x - 1, y: p.y }, far: { map, x: p.x + 4, y: p.y } };
        }
      }
      throw new Error('no open row with a spot on it');
    };
    const walked = (room: Room, a: Actor, to: Spot, p: { key: number }) => {
      const brain: Brain = { rng: 7, wait: 0, dir: 1, goal: to, plan: `${room.ring().round}:${room.ring().phase}:${room.events.length}${health(a) < HURT ? ':hurt' : ''}` };
      for (let i = 0; i < 1200 && !sameSpot(a.m.spot, to) && !a.battling; i++) { a.keys = botKeys(room, a, brain); room.step(); }
      return room.isTaken(p.key);
    };

    it('whole, it walks over what is in the way', () => {
      const { room, p, west, far } = line();
      const a = bot(room, west, 7, 4);
      a.calm = 1e9;
      expect(findPath(room.world, west, far, 2000).steps.some((s) => s.to.x === p.x && s.to.y === p.y), 'the straight way').toBe(true);
      expect(walked(room, a, far, p)).toBe(true);
    });

    it('hurt, it does not, when there is a way round', () => {
      const { room, p, west, far } = line();
      const a = bot(room, west, 7, 4);
      a.calm = 1e9;
      a.wear = [0.2];
      expect(walked(room, a, far, p)).toBe(false);
      expect(a.m.spot, 'and it got there').toEqual(far);
    });
  });
});

describe('a hunter that has given up on a cell', () => {
  it('still has when it looks for its quarry again, though it forgets on a new phase', () => {
    const room = stage();
    const a = bot(room, { map: OLDALE, x: 10, y: 12 }, 7);
    const q = bot(room, { map: OLDALE, x: 10, y: 3 }, 8);
    a.calm = q.calm = 1e9;
    room.results.entrants = [[7, 'A'], [8, 'Q']];
    const ring = room.ring();
    const brain: Brain = { rng: 7, wait: 0, dir: 1, plan: `${ring.round}:${ring.phase}:0`, avoid: new Set([123]) };
    for (let i = 0; i < 300; i++) { brain.steps = undefined; a.keys = 0; botKeys(room, a, brain); room.step(); }
    expect(brain.avoid?.has(123)).toBe(true);
    brain.plan = 'an old one';
    for (let i = 0; i < 300 && brain.plan === 'an old one'; i++) { botKeys(room, a, brain); room.step(); }
    expect(brain.avoid?.has(123) ?? false).toBe(false);
  });
});

describe('a draw', () => {
  it('both teams down: both out, as a trainer who draws is', () => {
    const room = stage();
    const a = bot(room, { map: OLDALE, x: 9, y: 12 }, 7, 4), b = bot(room, { map: OLDALE, x: 10, y: 12 }, 8, 3);
    bot(room, { map: OLDALE, x: 3, y: 3 }, 9).calm = 1e9;
    room.results.entrants = [[7, 'B7'], [8, 'B8'], [9, 'B9']];
    a.battling = b.battling = true;
    a.foe = 8; b.foe = 7;
    a.judge = b.judge = HOST_JUDGE;
    a.since = b.since = room.tick;
    room.apply({ c: 'bots', id: HOST_JUDGE, a: 7, b: 8, winner: 0, drew: [[0], [0]] });
    expect(room.actor(7)).toBeUndefined();
    expect(room.actor(8)).toBeUndefined();
  });
});

describe('the weather a bot fights in', () => {
  const mon = (species: number, moves: number[]): PackedMon => ({ ...legendMon(species, 3), moves: moves.map((id) => ({ id, pp: 20, ppUps: 0 })), romMoves: true, level: 30, hp: 80, maxHp: 80 });

  it('the fight has it: rain every turn', () => {
    const a = { seat: 1, name: 'A', skin: 0, party: [mon(280, [33])] }, b = { seat: 2, name: 'B', skin: 0, party: [mon(25, [33])] };
    const out = simulate(a, b, { seed: 3, weather: 'raindance' });
    const lines = out.log.filter((e) => e.e === 'text' && /rain/i.test(e.text));
    expect(lines.length, 'rain is falling').toBeGreaterThan(out.turns - 2);
    expect(out.unknown).toEqual([]);
    expect(simulate(a, b, { seed: 3 }).log.some((e) => e.e === 'text' && /rain/i.test(e.text))).toBe(false);
  });

  it('a Host hands it the weather a trainer would fight in there, from the room', async () => {
    const room = stage();
    const logs: { e: string; text?: string }[][] = [];
    const host = new Host(room, 0, MAPS, 0, { onLog: (_s, l) => logs.push(l) });
    await host.simReady();
    room.weatherAt = () => WEATHER_DOWNPOUR;
    room.apply({ c: 'join', id: 1, bot: true, name: 'ONE', skin: 4, spot: { map: OLDALE, x: 9, y: 12 }, facing: 4 });
    room.apply({ c: 'join', id: 2, bot: true, name: 'TWO', skin: 5, spot: { map: OLDALE, x: 11, y: 12 }, facing: 3 });
    room.actor(1)!.calm = room.actor(2)!.calm = 0;
    room.apply({ c: 'lock' });
    run(host, 900, () => logs.length > 0);
    expect(logs[0].some((e) => e.e === 'text' && /rain/i.test(e.text ?? ''))).toBe(true);
  });
});

describe('a CENTER heals a bot as it does a trainer', () => {
  const STEP = { map: OLDALE, x: 6, y: 17 };
  const COUNTER = { map: 'MAP_OLDALE_TOWN_POKEMON_CENTER_1F', x: 7, y: 4 };

  it('standing on the doorstep heals nobody', () => {
    const room = stage();
    const a = bot(room, STEP);
    a.calm = 1e9;
    a.wear = [0.1];
    room.step();
    expect(a.wear).toEqual([0.1]);
  });

  it('it walks in, up to the counter, and A at the nurse heals it', () => {
    const room = stage();
    const a = bot(room, { map: OLDALE, x: 10, y: 12 });
    a.calm = 1e9;
    a.wear = [0.2, 0];
    const brain: Brain = { rng: 7, wait: 0, dir: 1 };
    let inside = false;
    for (let i = 0; i < 60 * 60 && a.wear; i++) {
      a.keys = botKeys(room, a, brain);
      room.step();
      inside ||= a.m.spot.map === COUNTER.map;
    }
    expect(inside, 'through the door').toBe(true);
    expect(a.wear, 'whole').toBeUndefined();
    expect(a.m.spot).toEqual(COUNTER);
  });

  it('the fog on the town closes it', () => {
    const room = stage();
    const a = bot(room, COUNTER);
    a.calm = 1e9;
    a.wear = [0.2];
    room.inFog = () => true;
    a.keys = KEY_UP | KEY_B | KEY_A;
    room.step();
    expect(a.wear?.[0]).toBeLessThanOrEqual(0.2);
    expect(a.wear).toBeDefined();
  });
});

describe('the fog on a bot', () => {
  const foggy = () => {
    const room = stage();
    const a = bot(room, { map: OLDALE, x: 10, y: 12 });
    a.calm = 1e9;
    room.inFog = (s) => s.map === OLDALE;
    return { room, a };
  };

  it('a tenth of every mon that stands, every four seconds, which its next fight has', () => {
    const { room, a } = foggy();
    for (let i = 0; i < BOT_BITE + 1; i++) room.step();
    expect(a.wear?.[0]).toBeCloseTo(0.9, 5);
    expect(botParty(room.seed, a, 1).length).toBeGreaterThan(0);
  });

  it('takes a hurt team sooner than a whole one', () => {
    const { room, a } = foggy();
    a.wear = [0.2];
    for (let i = 0; i < BOT_BITE * 2 + 1; i++) room.step();
    expect(room.actor(7), 'two bites from 0.2').toBeUndefined();
    expect(room.results.fallen.length + 1).toBeGreaterThan(0);
  });

  it('a CENTER undoes it: whole, it has its ten again', () => {
    const { room, a } = foggy();
    a.wear = [0.2];
    for (let i = 0; i < BOT_BITE + 1; i++) room.step();
    a.wear = undefined; // the nurse
    for (let i = 0; i < BOT_BITE * 9; i++) room.step();
    expect(room.actor(7)).toBe(a);
  });

  it('a mirror agrees', async () => {
    const { room, a } = foggy();
    const mirror = makeRoom(MAPS, PATCHES, room.seed);
    mirror.opening = 0;
    mirror.load(structuredClone(room.state()));
    mirror.inFog = room.inFog;
    expect(a.id).toBe(7);
    for (let i = 0; i < BOT_BITE * 3 + 2; i++) { room.step(); mirror.step(); }
    expect(mirror.hash()).toBe(room.hash());
  });
});

describe('what lies about', () => {
  it('a ball off the ground is six, as a trainer\'s is', () => {
    const room = stage();
    for (const g of room.ground().values()) {
      if (g.map !== OLDALE || g.gift || g.item !== ROYALE) continue;
      const a = bot(room, { map: OLDALE, x: g.x - 1, y: g.y }, 7, 4);
      a.keys = KEY_RIGHT | KEY_A | KEY_B;
      room.step();
      expect(a.loot?.items).toEqual([{ id: ROYALE, n: 6 }]);
      return;
    }
    // No ball in this deal's Oldale: lay the one that is there out as one.
    const g = [...room.ground().values()].find((q) => q.map === OLDALE && !q.gift)!;
    g.item = ROYALE;
    const a = bot(room, { map: OLDALE, x: g.x - 1, y: g.y }, 7, 4);
    a.keys = KEY_RIGHT | KEY_A | KEY_B;
    room.step();
    expect(a.loot?.items).toEqual([{ id: ROYALE, n: 6 }]);
  });

  const bagAt = (room: Room, x: number, mons: { species: number; level: number }[]) =>
    room.spills.set(RELEASED_SPILL, { key: RELEASED_SPILL, map: OLDALE, x, y: 12, name: 'X', bag: { items: [{ id: 13, n: 1 }], money: 50, mons } });

  it('it takes the Pokemon out of a bag, as a trainer does, with its wounds in the right slots', () => {
    const room = stage();
    bagAt(room, 11, [{ species: 25, level: 5 }]);
    const a = bot(room, { map: OLDALE, x: 10, y: 12 }, 7, 4);
    const had = botParty(room.seed, a, 1).length;
    a.wear = Array(had).fill(0.5);
    a.keys = KEY_RIGHT | KEY_A | KEY_B;
    room.step();
    expect(a.caught).toEqual([25]);
    expect(botParty(room.seed, a, 1)[0].species).toBe(25);
    expect(a.wear).toEqual([1, ...Array(had).fill(0.5)]);
    expect(room.spillAt(OLDALE, 11, 12), 'nothing left in it').toBeUndefined();
    expect(a.loot).toEqual({ items: [{ id: 13, n: 1 }], money: 50 });
  });

  it('no room for one: it stays in the bag, and the bag stays solid, as it does for a trainer', () => {
    const room = stage();
    bagAt(room, 11, [{ species: 25, level: 5 }]);
    const a = bot(room, { map: OLDALE, x: 10, y: 12 }, 7, 4);
    a.caught = [277, 280, 283, 286, 288, 290];
    a.keys = KEY_RIGHT | KEY_A | KEY_B;
    room.step();
    expect(room.spillAt(OLDALE, 11, 12)?.bag.mons?.length).toBe(1);
    expect(room.stepFor(a, true)({ map: OLDALE, x: 10, y: 12 }, 4), 'no stepping over it').toBeNull();
  });

  it('it goes for a bag of nothing but Pokemon, while it has room', () => {
    const room = stage();
    for (const g of room.ground().values()) if (g.map === OLDALE) room.picked.set(g.key, 99);
    room.spills.set(RELEASED_SPILL, { key: RELEASED_SPILL, map: OLDALE, x: 12, y: 12, name: 'X', bag: { items: [], money: 0, mons: [{ species: 25, level: 5 }] } });
    const a = bot(room, { map: OLDALE, x: 10, y: 12 });
    a.calm = 1e9;
    const brain: Brain = { rng: 7, wait: 0, dir: 1 };
    // It thinks of what lies about one thought in four, here.
    for (let i = 0; i < 60 * 60 && !(brain.goal?.x === 12 && brain.goal.y === 12); i++) {
      brain.goal = null;
      brain.steps = undefined;
      brain.plan = undefined;
      botKeys(room, a, brain);
      room.step();
    }
    for (let i = 0; i < 60 * 60 && !a.caught; i++) { a.keys = botKeys(room, a, brain); room.step(); }
    expect(a.caught).toEqual([25]);
  }, 30_000);
});

describe('the boats', () => {
  const noField = (map: string) => seat((bits) => (bits & FIELD_SURF) === 0, map);
  const aboard = async (id: number, from: Spot, to: Spot, frames: number, arrived: (a: Actor) => boolean) => {
    const room = stage();
    const host = new Host(room, 0, MAPS, 0);
    room.apply({ c: 'join', id, bot: true, name: 'B', skin: 4, spot: from, facing: 1 });
    const a = room.actor(id)!;
    a.calm = 1e9;
    a.field = 0;
    const mirror = makeRoom(MAPS, PATCHES, room.seed);
    mirror.load(structuredClone(room.state()));
    const brain: Brain = { rng: 5, wait: 0, dir: 1, goal: to, byBoat: true, plan: `${room.ring().round}:${room.ring().phase}:0` };
    host.brains.set(id, brain);
    let sailed = 0;
    for (let i = 0; i < frames && !arrived(a); i++) {
      a.field = 0;
      mirror.actor(id)!.field = 0;
      // A goal that stands: the walk is what's under test, not what it would think of next.
      if (!brain.goal) { brain.goal = to; brain.byBoat = true; brain.plan = `${room.ring().round}:${room.ring().phase}:0`; }
      const { frame } = host.advance();
      play(mirror, frame);
      sailed += frame.cmds?.filter((c) => c.c === 'sail').length ?? 0;
    }
    expect(mirror.hash()).toBe(room.hash());
    return { a, sailed };
  };

  it('MR. BRINEY: off Dewford, with no HM, back to Route 104', async () => {
    const { a, sailed } = await aboard(noField('MAP_DEWFORD_TOWN'), { map: 'MAP_DEWFORD_TOWN', x: 5, y: 8 }, { map: 'MAP_RUSTBORO_CITY', x: 16, y: 40 }, 60 * 60 * 3, (q) => q.m.spot.map === 'MAP_RUSTBORO_CITY');
    expect(sailed).toBeGreaterThan(0);
    expect(a.m.spot.map).toBe('MAP_RUSTBORO_CITY');
  }, 60_000);

  it('the SS TIDAL: aboard at Slateport, one rest, off at Lilycove', async () => {
    // Boarded by hand: from Slateport there is a long way round on foot, which is what it would take.
    const room = stage();
    const id = noField('MAP_SLATEPORT_CITY');
    const host = new Host(room, 0, MAPS, 0);
    room.apply({ c: 'join', id, bot: true, name: 'B', skin: 4, spot: { map: 'MAP_SLATEPORT_CITY_HARBOR', x: 8, y: 11 }, facing: 2 });
    const a = room.actor(id)!;
    a.calm = 1e9;
    a.wear = [0.5];
    room.apply({ c: 'sail', id, to: 'lilycove' });
    expect(a.cruise).toMatchObject({ to: 'lilycove', leg: 'board' });
    host.brains.set(id, { rng: 5, wait: 0, dir: 1 });
    let healed = false;
    run(host, 60 * 60 * 2, () => { healed ||= !a.wear; return a.m.spot.map === 'MAP_LILYCOVE_CITY_HARBOR'; });
    expect(a.m.spot.map).toBe('MAP_LILYCOVE_CITY_HARBOR');
    expect(a.cruise).toBeUndefined();
    expect(healed, 'the bed heals').toBe(true);
  }, 60_000);

  it('the SS TIDAL the other way takes two rests, as a trainer\'s does', async () => {
    const id = noField('MAP_LILYCOVE_CITY');
    const { a, sailed } = await aboard(id, { map: 'MAP_LILYCOVE_CITY_HARBOR', x: 8, y: 13 }, { map: 'MAP_SLATEPORT_CITY', x: 20, y: 20 }, 60 * 60 * 4, (q) => q.m.spot.map === 'MAP_SLATEPORT_CITY_HARBOR');
    expect(sailed).toBe(2);
    expect(a.m.spot.map).toBe('MAP_SLATEPORT_CITY_HARBOR');
  }, 60_000);

  it('a bot left with no way on foot to the ring takes one by itself', async () => {
    const room = stage();
    room.ringPhase = 60 * 60 * 2;
    const id = noField('MAP_DEWFORD_TOWN');
    const host = new Host(room, 0, MAPS, 0);
    room.apply({ c: 'join', id, bot: true, name: 'B', skin: 4, spot: { map: 'MAP_DEWFORD_TOWN', x: 5, y: 8 }, facing: 1 });
    room.apply({ c: 'lock' });
    room.results.entrants = [[id, 'B']];
    const a = room.actor(id)!;
    a.calm = 1e9;
    host.brains.set(id, { rng: 5, wait: 0, dir: 1 });
    // The ring's heart is on the mainland, whichever way this seed had it.
    const real = room.inFog.bind(room);
    room.inFog = (s, r) => s.map === 'MAP_DEWFORD_TOWN' || !s.map.includes('RUSTBORO') ? true : real(s, { ...(r ?? room.ring()), r: Infinity });
    let sailed = 0;
    run(host, 60 * 60 * 2, () => {
      a.field = 0;
      a.wear = undefined;
      return a.m.spot.map !== 'MAP_DEWFORD_TOWN' && sailed > 0;
    });
    sailed = 1;
    expect(a.m.spot.map).not.toBe('MAP_DEWFORD_TOWN');
  }, 60_000);

  it('a page cannot sail a bot', () => {
    const room = stage();
    const id = noField('MAP_DEWFORD_TOWN');
    const host = new Host(room, 0, MAPS, 0);
    room.apply({ c: 'join', id, bot: true, name: 'B', skin: 4, spot: { map: 'MAP_DEWFORD_TOWN', x: 11, y: 9 }, facing: 4 });
    host.sail(id, 'petalburg');
    host.advance();
    expect(room.actor(id)!.m.spot.map).toBe('MAP_DEWFORD_TOWN');
  });
});
