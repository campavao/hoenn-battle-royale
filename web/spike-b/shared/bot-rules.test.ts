// Cam, 11-03: "Bot should follow the same rules as a player, not sure why we'd take short cuts."
// Each of these held a bot to less than a trainer until it was changed; the first describes the one
// that was already so.
import { describe, expect, it } from 'vitest';
import { decodeGrid, type Spot, type WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import { dealParty, teamField } from '../../src/bots/party';
import { gradeOf } from '../../src/bots/roster';
import { WEATHER_DOWNPOUR } from '../../src/match/events';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';
import { botKeys, type Brain } from './bots';
import { Host, play } from './host';
import { simulate } from './battlesim';
import { BOT_BITE, FIELD_SURF, HOST_JUDGE, KEY_A, KEY_B, KEY_RIGHT, KEY_UP, LEGEND_FOE, RELEASED_SPILL, SPILL_KEY, botParty, legendMon, makeRoom, type Actor, type Room } from './room';
import type { PackedMon } from '../../src/net/wire';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const PATCHES = patchJson as unknown as PatchTable;
const OLDALE = 'MAP_OLDALE_TOWN';
const SEED = 4242;
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
