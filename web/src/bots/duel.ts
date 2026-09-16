// Two bots fighting (POK-238, the resolver half).
//
// The ticket's real answer is a second, hidden emulator running the battle for real, so
// a spectator can watch it on the battle screen. This is the fallback that ticket
// already names -- and until the proxy exists it is the only thing that lets two bots
// settle anything, which matters more than it sounds: without it bots only ever die to
// the fog, and a battle royale where nobody beats anybody is a waiting room.
//
// The rules are the fight's shape, not its detail: a team's weight is what it has left
// standing, the seed decides the coin-flip inside that, and the winner comes out hurt.
// Deterministic from (seed, the two seats, the turn count), so every client that cares
// can arrive at the same answer without being told.
import { mulberry32 } from '../match/clock';
import type { PackedMon } from '../net/wire';

/** What a team is worth in a fight: level and the health it still has, which is why a
 *  bot that just fought is easy pickings and one fresh out of a Centre is not. */
export function weight(party: PackedMon[]): number {
  let total = 0;
  for (const mon of party) {
    if (mon.hp <= 0) continue;
    total += mon.level * (0.5 + (mon.maxHp > 0 ? mon.hp / mon.maxHp : 1) / 2);
  }
  return total;
}

export interface DuelResult {
  /** The seat that won. */
  winner: number;
  loser: number;
  /** The winner's team afterwards: it fought, so it is hurt. */
  winnerParty: PackedMon[];
}

/** Resolves one fight. `nonce` makes two bots meeting twice two different fights. */
export function duel(
  seed: number,
  a: { seat: number; party: PackedMon[] },
  b: { seat: number; party: PackedMon[] },
  nonce: number,
): DuelResult {
  // Seat order in the key, not argument order: whoever spotted whom must not change
  // who wins, or two clients watching the same pair disagree.
  const [lo, hi] = a.seat < b.seat ? [a, b] : [b, a];
  const rng = mulberry32((seed ^ (lo.seat * 0x9e37) ^ (hi.seat * 0x85eb) ^ (nonce * 0xc2b2)) >>> 0);
  const wLo = weight(lo.party);
  const wHi = weight(hi.party);
  const total = wLo + wHi;
  // The stronger team usually wins and not always: a coin weighted by the two
  // weights, which at equal strength is an even one.
  const loWins = total <= 0 ? rng() < 0.5 : rng() < wLo / total;
  const winner = loWins ? lo : hi;
  const loser = loWins ? hi : lo;

  // What it cost. A fight against somebody stronger leaves less behind, and the
  // winner never comes out of one untouched.
  const theirs = weight(loser.party);
  const mine = weight(winner.party);
  const bite = Math.min(0.9, 0.25 + (mine > 0 ? Math.min(1, theirs / mine) : 1) * 0.5);
  let taken = 0;
  const winnerParty = winner.party.map((mon) => {
    if (mon.hp <= 0) return mon;
    // Spent front to back, the way a real battle goes through a team.
    const share = taken === 0 ? bite : bite / 2;
    taken++;
    return { ...mon, hp: Math.max(1, Math.round(mon.hp * (1 - share))) };
  });

  return { winner: winner.seat, loser: loser.seat, winnerParty };
}
