// What the roster may spend on thinking in one tick (POK-330 #49).
//
// The budget was two decisions a tick, whatever they cost: a forty-node walk across a
// field counted the same as a stuck bot's whole ladder of failing searches. It is A*
// nodes now -- so cheap decisions no longer queue, and an expensive one is what makes
// the rest of the tick wait.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Bots, STEP_MS, type Decision } from './brain';
import { Grade, type Bot } from './roster';
import { findPath, findPathToAny } from './path';
import { World, type WorldMap } from './world';
import { mulberry32 } from '../match/clock';

// The real searches, counted.
vi.mock('./path', async (importOriginal) => {
  const real = await importOriginal<typeof import('./path')>();
  return { ...real, findPath: vi.fn(real.findPath), findPathToAny: vi.fn(real.findPathToAny) };
});

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

function field(id: string, num: number, rows: string[], seams: WorldMap['seams'] = []): WorldMap {
  return { id, group: 0, num, w: rows[0].length, h: rows.length, section: 'S', outdoor: true, grid: grid(rows), seams };
}

function bot(seat: number, mapId: string, x: number, y: number): Bot {
  return { seat, name: `BOT${seat}`, grade: Grade.Regular, skin: 0, map: { group: 0, num: 1 }, mapId, x, y };
}

function roster(maps: WorldMap[], targets: { mapId: string; x: number; y: number }[], dealt: Bot[]) {
  const decisions: Decision[] = [];
  const bots = new Bots({
    world: new World(maps),
    targets,
    mapRef: (id) => ({ group: 0, num: maps.findIndex((m) => m.id === id) + 1 }),
    send: () => {},
    rng: mulberry32(49),
    onDecision: (d) => void decisions.push(d),
  });
  bots.start(dealt, 0);
  return { bots, decisions };
}

beforeEach(() => {
  vi.mocked(findPath).mockClear();
  vi.mocked(findPathToAny).mockClear();
});

describe('the tick budget', () => {
  it('lets every bot with a cheap route decide in the same tick', () => {
    // Four bots in the corners of an open field, all wanting somewhere else on it. Each
    // route is a few dozen nodes. At two decisions a tick, two of them stood and waited.
    const OPEN = field('OPEN', 1, Array.from({ length: 10 }, () => '0000000000'));
    const cells = Array.from({ length: 100 }, (_, i) => ({ mapId: 'OPEN', x: i % 10, y: Math.floor(i / 10) }));
    const { bots, decisions } = roster([OPEN], cells, [
      bot(31, 'OPEN', 0, 0),
      bot(30, 'OPEN', 9, 0),
      bot(29, 'OPEN', 0, 9),
      bot(28, 'OPEN', 9, 9),
    ]);
    bots.tick(STEP_MS);
    expect(decisions.map((d) => d.rule)).toEqual(['wander', 'wander', 'wander', 'wander']);
  });

  it('makes the rest of the tick wait once a decision has spent it -- and lets that one finish', () => {
    // A big open field, and the only target walled into a pocket in its far corner. A
    // bot asking for it runs four searches that each settle their whole 1,500 nodes and
    // find nothing: more than a tick's budget. The next bot waits for the next tick; the
    // first is not cut off halfway, or "the budget ran out" would read as "no way there".
    const rows = Array.from({ length: 60 }, () => '0'.repeat(60).split(''));
    for (let i = 57; i < 60; i++) {
      rows[57][i] = '1';
      rows[i][57] = '1';
    }
    const BIG = field('BIG', 1, rows.map((r) => r.join('')));
    const { bots, decisions } = roster([BIG], [{ mapId: 'BIG', x: 59, y: 59 }], [bot(31, 'BIG', 0, 0), bot(30, 'BIG', 0, 2)]);
    bots.tick(STEP_MS);
    expect(decisions.map((d) => `${d.seat} ${d.rule}`)).toEqual(['31 stuck', '30 wait']);
    const searches = vi.mocked(findPath).mock.results.map((r) => (r.value as { visited: number }).visited);
    expect(searches).toEqual([1500, 1500, 1500, 1500]);
    // The next tick is the waiting bot's turn to find the same nothing. The first is
    // backing off after its own, so it steps without searching.
    decisions.length = 0;
    vi.mocked(findPath).mockClear();
    bots.tick(2 * STEP_MS);
    expect(decisions.map((d) => `${d.seat} ${d.rule}`)).toEqual(['31 stuck', '30 stuck']);
    expect(vi.mocked(findPath)).toHaveBeenCalledTimes(4);
  });
});

describe('a stuck bot heading across maps', () => {
  it('searches the way to each next map once, not once for every goal behind it', () => {
    // HOME's west corner is walled off, and every goal map -- three of them -- is
    // reached through HUB. The route to HUB's edge fails the same way whichever goal
    // asked for it, and used to be searched three times.
    const HOME = field('HOME', 1, ['01000', '11000', '00000'], [{ dir: 'east', to: 'HUB', offset: 0 }]);
    const HUB = field('HUB', 2, ['000', '000', '000'], [
      { dir: 'north', to: 'G1', offset: 0 },
      { dir: 'east', to: 'G2', offset: 0 },
      { dir: 'south', to: 'G3', offset: 0 },
    ]);
    const G = (id: string, num: number) => field(id, num, ['000', '000', '000']);
    const targets = ['G1', 'G2', 'G3'].map((mapId) => ({ mapId, x: 1, y: 1 }));
    const { bots, decisions } = roster([HOME, HUB, G('G1', 3), G('G2', 4), G('G3', 5)], targets, [bot(31, 'HOME', 0, 0)]);
    bots.tick(STEP_MS);
    expect(decisions.map((d) => d.rule)).toEqual(['stuck']);
    expect(vi.mocked(findPathToAny)).toHaveBeenCalledTimes(1);
  });
});

// POK-331 #27: Route 114's west edge is joined to Route 115, and no cell of it crosses.
// The map-level plan counted the seam as a hop, so every bot there was aimed at a
// crossing that is not there -- and never at Meteor Falls, the real way round.
describe('a seam nobody can cross', () => {
  it('goes round by the way that is there', () => {
    // HOME's east edge is rock and joined to GOAL anyway; the way to GOAL is the door in
    // HOME's far corner, through TUNNEL. HOME is too big for a plain search to cross.
    const rows = Array.from({ length: 50 }, () => '0'.repeat(49) + '1');
    const HOME: WorldMap = {
      ...field('HOME', 1, rows, [{ dir: 'east', to: 'GOAL', offset: 0 }]),
      warps: [{ x: 0, y: 49, to: 'TUNNEL', toX: 0, toY: 0, kind: 'door' }],
    };
    const TUNNEL = field('TUNNEL', 2, ['00'], [{ dir: 'east', to: 'GOAL', offset: 0 }]);
    const GOAL = field('GOAL', 3, ['000', '000', '000'], [{ dir: 'west', to: 'TUNNEL', offset: 0 }]);
    const { bots, decisions } = roster([HOME, TUNNEL, GOAL], [{ mapId: 'GOAL', x: 1, y: 1 }], [bot(31, 'HOME', 48, 0)]);
    bots.tick(STEP_MS);
    expect(decisions.map((d) => `${d.rule} ${d.detail}`)).toEqual(['wander -> TUNNEL (for GOAL)']);
  });
});
