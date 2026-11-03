import { describe, expect, it } from 'vitest';
import { applyEvent, emptyState, logMs, type BattleEvent } from './battlelog';
import { movesFor, simulate, simulation, TURN_CAP, type SimSide } from './battlesim';
import { heldId } from './simnames';
import { LEVEL_UP } from './engine/gen3.mjs';
import FIXES from './learnset-fixes.json';
import { dealParty } from '../../src/bots/party';
import { Grade } from '../../src/bots/roster';
import type { PackedMon } from '../../src/net/wire';

const card = (species: number, level: number, extra: Partial<PackedMon> = {}): PackedMon => ({
  species, level, hp: 100, maxHp: 100, status: 0, moves: [], heldItem: 0, otId: 0, personality: 0, exp: 0, nickname: '', ot: 'BR', ...extra,
});
const side = (seat: number, party: PackedMon[], items?: number[]): SimSide => ({ seat, name: seat === 1 ? 'BRENDAN' : 'WALLY', skin: 0, party, ...(items ? { items } : {}) });

/** A fight between two dealt teams, as the room deals them. */
const dealt = (seed: number, phase: number) => [
  side(1, dealParty(seed, 1, phase, 'MAP_ROUTE119', Grade.Regular)),
  side(2, dealParty(seed, 2, phase, 'MAP_ROUTE101', Grade.Ace)),
] as const;

describe('battlesim', () => {
  it('runs the same for the same seed, and differently for another', () => {
    const [a, b] = dealt(77, 5);
    const one = simulate(a, b, { seed: 123, map: 'MAP_ROUTE101' });
    const two = simulate(a, b, { seed: 123, map: 'MAP_ROUTE101' });
    expect(two).toEqual(one);
    const others = [1, 2, 3, 4, 5].map((seed) => simulate(a, b, { seed }).log);
    expect(others.some((l) => JSON.stringify(l) !== JSON.stringify(one.log))).toBe(true);
  });

  it('a team with a mon already down loses when its last one faints, not at the turn cap', () => {
    // The fight after a fight: the engine counts a team when it starts, wounds or no, so the last
    // mon's faint left it one short of over. Nobody on the field, no switch to make, and the winner
    // used every move on nothing ("But it failed!") until TURN_CAP: 11% of the fights in a standard
    // match, 39% of their time on screen (2026-11-03).
    const out = simulate(side(1, [card(16, 5, { hp: 0 }), card(16, 5)]), side(2, [card(130, 50)]), { seed: 9 }); // PIDGEY, GYARADOS
    expect(out.winner).toBe(2);
    expect(out.capped).toBe(false);
    expect(out.turns).toBeLessThan(10);
    const said = out.log.filter((e) => e.e === 'text').map((e) => (e as { text: string }).text);
    expect(said.filter((x) => x === 'But it failed!')).toEqual([]);
    // ...and the same the other way round: the side with the gap is the winner's.
    const back = simulate(side(1, [card(130, 50, { hp: 0 }), card(130, 50)]), side(2, [card(16, 5)]), { seed: 9 });
    expect(back.winner).toBe(1);
    expect(back.capped).toBe(false);
  });

  it('a turn at a time is the same fight', () => {
    const [a, b] = dealt(5, 7);
    const run = simulation(a, b, { seed: 44 });
    let steps = 0;
    let step = run.next();
    while (!step.done) { steps++; step = run.next(); }
    expect(steps).toBeGreaterThan(1);
    expect(step.value).toEqual(simulate(a, b, { seed: 44 }));
  });

  it('a log parses to the outcome it reports', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const [a, b] = dealt(seed * 31, 1 + (seed % 6));
      const out = simulate(a, b, { seed, map: 'MAP_ROUTE119' });
      const state = out.log.reduce(applyEvent, emptyState());
      expect(state.winner).toBe(out.winner);
      expect(state.map).toBe('MAP_ROUTE119');
      expect(out.log[0].e).toBe('start');
      expect(out.log.at(-1)).toEqual({ e: 'end', winner: out.winner });
      // Every mon that fainted in the log is down in the report, and the other way about.
      const report = [out.shareA, out.shareB];
      for (const [i, team] of [state.a!.team, state.b!.team].entries()) {
        team.forEach((m, slot) => {
          // Bench mons a log never touches stay as they went in, so only "down" is compared.
          if (report[i][slot] === 0) expect(m.hp).toBe(0);
          else expect(m.hp).toBeGreaterThan(0);
        });
      }
      expect(logMs(out.log)).toBeGreaterThan(0);
    }
  });

  it('reads like Emerald', () => {
    const out = simulate(side(1, [card(44, 50)]), side(2, [card(16, 50)]), { seed: 5 }); // GLOOM, PIDGEY
    const lines = out.log.flatMap((e) => (e.e === 'text' ? [e.text] : []));
    expect(lines[0]).toMatch(/^WALLY sent out P[A-Z]+!$/);
    expect(lines[1]).toMatch(/^Go! GLOOM!$/);
    expect(lines.some((l) => /^Foe \S+ used [A-Z -]+!$/.test(l) || /^GLOOM used [A-Z -]+!$/.test(l))).toBe(true);
    expect(lines.at(-1)).toMatch(/ defeated /);
    expect(out.unknown).toEqual([]);
  });

  it('says who INTIMIDATE came from', () => {
    const out = simulate(side(1, [card(44, 50)]), side(2, [card(130, 50)]), { seed: 8 }); // GYARADOS
    const lines = out.log.flatMap((e) => (e.e === 'text' ? [e.text] : []));
    expect(lines).toContain("Foe GYARADOS's INTIMIDATE cuts GLOOM's ATTACK!");
  });

  it('speaks the battle view\'s numbers: status bits, ROM species and move ids, a full start', () => {
    const BITS = new Set([0, 1, 8, 16, 32, 64, 128]);
    let hits = 0, statuses = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const out = simulate(side(1, [card(331, 50)]), side(2, [card(286, 50), card(295, 50)]), { seed, map: 'MAP_ROUTE117' }); // SHARPEDO, POOCHYENA, LOTAD
      const start = out.log[0] as Extract<BattleEvent, { e: 'start' }>;
      expect(start.map).toBe('MAP_ROUTE117');
      expect(start.a.team[0]).toMatchObject({ species: 331, level: 50, status: 0, shiny: false });
      expect(start.b.team.map((m) => m.species)).toEqual([286, 295]);
      expect(start.a.skin).toBe(0);
      for (const m of [...start.a.team, ...start.b.team]) expect([0, 1, 2]).toContain(m.gender);
      for (const e of out.log) {
        if (e.e === 'hit' && e.move) { hits++; expect(e.move).toBeGreaterThan(0); expect(e.move).toBeLessThanOrEqual(354); }
        if (e.e === 'status') { statuses++; expect(BITS.has(e.status)).toBe(true); }
      }
      for (const row of [...out.a, ...out.b]) expect(BITS.has(row.status)).toBe(true);
    }
    expect(hits).toBeGreaterThan(30);
    expect(statuses).toBeGreaterThanOrEqual(0);
  });

  it('a side with nothing standing loses, at once', () => {
    const down = [card(44, 50, { hp: 0 })];
    const out = simulate(side(1, down), side(2, [card(16, 50)]), { seed: 1 });
    expect(out).toMatchObject({ winner: 2, loser: 1, turns: 0 });
    expect(out.log.map((e) => e.e)).toEqual(['start', 'end']);
    expect(simulate(side(1, down), side(2, down), { seed: 1 }).winner).toBe(0);
    expect(simulate(side(1, []), side(2, [card(16, 50)]), { seed: 1 }).winner).toBe(2);
    // An unknown species is no mon: the same as nobody.
    expect(simulate(side(1, [card(260, 50)]), side(2, [card(16, 50)]), { seed: 1 }).winner).toBe(2);
  });

  it('a hurt team goes in hurt: a fainted slot stays down, and the next one leads', () => {
    const out = simulate(side(1, [card(44, 50, { hp: 0 }), card(45, 50, { hp: 40 })]), side(2, [card(16, 50)]), { seed: 3 });
    const start = out.log[0] as Extract<BattleEvent, { e: 'start' }>;
    expect(start.a.team[0].hp).toBe(0);
    expect(start.a.team[1].hp).toBeCloseTo(start.a.team[1].maxHp * 0.4, -1);
    expect(out.log.find((e) => e.e === 'send' && e.side === 0)).toMatchObject({ slot: 1 });
    expect(out.shareA[0]).toBe(0);
  });

  it('ends a fight that will not: the cap, nobody the winner', () => {
    const out = simulate(side(1, [card(44, 100), card(45, 100)]), side(2, [card(16, 100), card(17, 100)]), { seed: 9, turnCap: 1 });
    expect(out.capped).toBe(true);
    expect(out.turns).toBe(2);
    // Judged on the HP left, not a coin: the same fight has the same answer.
    expect(out.log.at(-1)).toEqual({ e: 'end', winner: out.winner });
    expect(simulate(side(1, [card(44, 100), card(45, 100)]), side(2, [card(16, 100), card(17, 100)]), { seed: 9, turnCap: 1 }).winner).toBe(out.winner);
    // A fight nobody has touched is level: nobody won.
    const untouched = simulate(side(1, [card(44, 100)]), side(2, [card(16, 100)]), { seed: 9, turnCap: 0 });
    expect(untouched).toMatchObject({ capped: true, winner: 0, loser: 0 });
    expect(TURN_CAP).toBe(100);
  });

  it('the fog hurts but never finishes anybody (br_ring.c)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { log } = simulate(side(1, [card(44, 50)]), side(2, [card(16, 50)]), { seed, fog: true });
      log.forEach((e, i) => {
        if (e.e !== 'text' || !/hurt by the fog!$/.test(e.text)) return;
        const hp = log.slice(i + 1).find((x) => x.e === 'hp');
        if (hp?.e === 'hp') expect(hp.hp, `seed ${seed}`).toBeGreaterThan(0);
      });
    }
  });

  it('the fog bites each turn', () => {
    const fought = simulate(side(1, [card(44, 50)]), side(2, [card(16, 50)]), { seed: 2, fog: true });
    const lines = fought.log.flatMap((e) => (e.e === 'text' ? [e.text] : []));
    expect(lines.some((l) => /is hurt by the fog!$/.test(l))).toBe(true);
    expect(fought.unknown).toEqual([]);
    expect(simulate(side(1, [card(44, 50)]), side(2, [card(16, 50)]), { seed: 2 }).log.flatMap((e) => (e.e === 'text' ? [e.text] : [])).some((l) => /fog/.test(l))).toBe(false);
  });

  it('spends the bag, and reports what went', () => {
    const POTION = 13, X_ATTACK = 75, FULL_RESTORE = 19;
    let used = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const out = simulate(side(1, [card(44, 40)], [POTION, FULL_RESTORE]), side(2, [card(16, 40)], [X_ATTACK]), { seed });
      const lines = out.log.flatMap((e) => (e.e === 'text' ? [e.text] : []));
      for (const id of out.usedA) expect(lines.some((l) => l === `BRENDAN used ${id === POTION ? 'POTION' : 'FULL RESTORE'}!`)).toBe(true);
      used += out.usedA.length + out.usedB.length;
      expect(out.usedB).toEqual([X_ATTACK]); // first turn out, every time
      expect(lines.some((l) => /ATTACK rose!$/.test(l))).toBe(true);
      expect(out.unknown).toEqual([]);
    }
    expect(used).toBeGreaterThan(12);
  });

  it('teaches the best four of what the level gave (br_levels.c)', () => {
    // A SCEPTILE at 75 knows LEAF BLADE; the last four written would not (POK-311).
    const moves = movesFor('sceptile', 75, { atk: 200, spa: 220, types: ['Grass'] });
    expect(moves).toContain(348);
    expect(moves.length).toBe(4);
  });

  it("knows the ROM's learnset where the engine has another game's", () => {
    // tools/br/learnset-fixes.mjs (pinned to the headers in scripts/learnset-fixes.test.ts): the
    // engine's CACTURNE has REVENGE, and the ROM's has none and PIN MISSILE.
    const moves = movesFor('cacturne', 50, { atk: 120, spa: 120, types: ['Grass', 'Dark'] });
    expect(moves).toContain(42);
    expect(moves).not.toContain(279);
    expect(LEVEL_UP.cacturne).toContain(279);
    expect((FIXES as Record<string, number[]>).cacturne).not.toContain(279);
  });

  it('maps the ROM item table to the engine', () => {
    expect(heldId(200)).toBe('leftovers');
    expect(heldId(219)).toBe('shellbell');
    expect(heldId(186)).toBe('choiceband');
    expect(heldId(142)).toBe('sitrusberry');
    expect(heldId(182)).toBe('');
    expect(heldId(5)).toBe('');
  });

  it('has words for everything a sweep of fights says', () => {
    const gaps = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const [a, b] = dealt(seed * 977, 1 + (seed % 6));
      for (const u of simulate(a, b, { seed }).unknown) gaps.add(u);
    }
    expect([...gaps]).toEqual([]);
  }, 120_000);
});
