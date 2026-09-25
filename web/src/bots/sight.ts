// The eyeline, on the page (POK-238).
//
// `Sees` in src/br/br_engage.c, ported byte for byte: a straight look from where you
// stand, at most BR_SIGHT_RANGE cells, stopped by the first cell with collision on it.
// It has to be the same rule on both sides, because a bot and a player can each be the
// one who spots the other and the room has to agree that they did.
import type { World } from './world';

/** BR_SIGHT_RANGE in include/br/br_engage.h. */
export const SIGHT_RANGE = 5;

/** The wire's facing: 1 south, 2 north, 3 west, 4 east (DIR_* in the ROM). */
export type Facing = 1 | 2 | 3 | 4;

const DELTA: Record<Facing, { dx: number; dy: number }> = {
  1: { dx: 0, dy: 1 },
  2: { dx: 0, dy: -1 },
  3: { dx: -1, dy: 0 },
  4: { dx: 1, dy: 0 },
};

export interface Look {
  map: string;
  x: number;
  y: number;
  dir: Facing;
}

/** Does `from`, facing the way it is, see (tx, ty) on the same map? */
export function sees(world: World, from: Look, tx: number, ty: number): boolean {
  const d = DELTA[from.dir];
  if (!d) return false;
  let x = from.x;
  let y = from.y;
  for (let i = 1; i <= SIGHT_RANGE; i++) {
    x += d.dx;
    y += d.dy;
    if (x === tx && y === ty) return true;
    // The ROM stops on collision and nothing else (World.clear): a look crosses water,
    // a ledge and a cuttable tree. It used to stop on anything nobody could walk on,
    // so a bot never saw across a pond that a player's ROM saw it across (POK-330 #67).
    if (!world.clear(from.map, x, y)) return false;
  }
  return false;
}

/** Either of them spotting the other is an engage -- the ROM tries both looks too. */
export function eitherSees(world: World, a: Look, b: Look): boolean {
  if (a.map !== b.map) return false;
  return sees(world, a, b.x, b.y) || sees(world, b, a.x, a.y);
}
