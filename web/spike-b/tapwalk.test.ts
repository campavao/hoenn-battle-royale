// A tap's route (tapwalk.ts): it goes round a marked spot nobody has taken, because stepping
// on one is a battle that ends the walk where it stands (the e2e "a tap on the map walks the
// trainer there" was stopping 1-4 cells short whenever the dealt spots lay on the way).
import { describe, expect, it } from 'vitest';
import type { Spot } from '../src/bots/world';
import type { Actor } from './shared/room';
import { arrived, routeTo, type TapRoom } from './tapwalk';

const MAP = 'M';
const DXY: Record<number, [number, number]> = { 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] };

/** An open `w` x `h` field, with some cells walled and some marked. */
function field(w: number, h: number, o: { wall?: string[]; marked?: string[]; taken?: number[]; others?: Spot[] } = {}): { room: TapRoom; me: Actor } {
  const wall = new Set(o.wall ?? []);
  const marked = (o.marked ?? []).map((k, i) => ({ x: +k.split(',')[0], y: +k.split(',')[1], key: i }));
  const me = { id: 1, m: { spot: { map: MAP, x: 0, y: 0 } } } as unknown as Actor;
  const others = (o.others ?? []).map((spot, i) => ({ id: 2 + i, m: { spot } }) as unknown as Actor);
  const room = {
    actors: [me, ...others],
    patchesOn: (map: string) => (map === MAP ? marked : []),
    isTaken: (key: number) => !!o.taken?.includes(key),
    stepFor: () => (at: Spot, d: number) => {
      const x = at.x + DXY[d][0], y = at.y + DXY[d][1];
      return x < 0 || y < 0 || x >= w || y >= h || wall.has(`${x},${y}`) ? null : { to: { map: MAP, x, y } };
    },
  } as unknown as TapRoom;
  return { room, me };
}

/** The cells a route lands on, from the start. */
function cells(room: TapRoom, me: Actor, dirs: number[]): string[] {
  const out: string[] = [];
  let at = me.m.spot;
  for (const d of dirs) {
    const r = room.stepFor(me)(at, d)!;
    at = r.to;
    out.push(`${at.x},${at.y}`);
  }
  return out;
}

describe('a tap\'s route', () => {
  it('goes round a marked spot on the straight way', () => {
    const { room, me } = field(5, 3, { marked: ['2,0'] });
    const r = routeTo(room, me, { map: MAP, x: 4, y: 0 })!;
    expect(r.press).toBe(false);
    const c = cells(room, me, r.dirs);
    expect(c[c.length - 1]).toBe('4,0');
    expect(c).not.toContain('2,0');
    expect(r.dirs.length).toBe(6);
  });

  it('walks straight over a spot somebody has taken, which is only ground now', () => {
    const { room, me } = field(5, 3, { marked: ['2,0'], taken: [0] });
    expect(routeTo(room, me, { map: MAP, x: 4, y: 0 })!.dirs).toEqual([4, 4, 4, 4]);
  });

  it('walks over one when it is the goal', () => {
    const { room, me } = field(5, 3, { marked: ['2,0'] });
    const r = routeTo(room, me, { map: MAP, x: 2, y: 0 })!;
    expect(cells(room, me, r.dirs)).toEqual(['1,0', '2,0']);
  });

  it('walks over one when every way there crosses one', () => {
    // A corridor along the top, the rest walled off.
    const wall = ['0,1', '1,1', '2,1', '3,1', '4,1'];
    const { room, me } = field(5, 2, { wall, marked: ['2,0'] });
    const r = routeTo(room, me, { map: MAP, x: 4, y: 0 })!;
    expect(r.dirs).toEqual([4, 4, 4, 4]);
  });

  it('still walks up to a trainer standing on the goal, round a spot', () => {
    const { room, me } = field(5, 3, { marked: ['2,0'], others: [{ map: MAP, x: 4, y: 0 }] });
    const r = routeTo(room, me, { map: MAP, x: 4, y: 0 })!;
    expect(r.press).toBe(true);
    const c = cells(room, me, r.dirs.slice(0, -1));
    expect(c[c.length - 1]).toBe('3,0');
    expect(c).not.toContain('2,0');
  });
});


describe('a tap\'s walk over a ledge', () => {
  // A one-wide street running south, with a ledge at (0,1): a step south from (0,0) hops to
  // (0,2). The trainer's cell is the ledge at the hop's start and (0,2) at its halfway frame.
  const street = (me: Actor): TapRoom => ({
    actors: [me],
    patchesOn: () => [],
    isTaken: () => false,
    stepFor: () => (at: Spot, d: number) => {
      if (d === 1 && at.y === 0) return { to: { map: MAP, x: 0, y: 2 }, hop: true };
      if (d === 1 && at.y >= 2 && at.y < 5) return { to: { map: MAP, x: 0, y: at.y + 1 } };
      if (d === 2 && at.y > 2) return { to: { map: MAP, x: 0, y: at.y - 1 } };
      return null;
    },
  }) as unknown as TapRoom;

  it('names the cell each step lands on, the hop\'s far side and not its ledge', () => {
    const me = { id: 1, m: { spot: { map: MAP, x: 0, y: 0 } } } as unknown as Actor;
    const r = routeTo(street(me), me, { map: MAP, x: 0, y: 4 })!;
    expect(r.dirs).toEqual([1, 1, 1]);
    expect(r.cells).toEqual(['M:0:2', 'M:0:3', 'M:0:4']);
  });

  it('counts the hop as one step though the trainer is on two cells for it', () => {
    const me = { id: 1, m: { spot: { map: MAP, x: 0, y: 0 } } } as unknown as Actor;
    const walk = routeTo(street(me), me, { map: MAP, x: 0, y: 4 })!;
    arrived(walk, 'M:0:1'); // the ledge, as the hop starts
    expect(walk.dirs).toEqual([1, 1, 1]);
    arrived(walk, 'M:0:2'); // the far side, at its halfway frame
    expect(walk.dirs).toEqual([1, 1]);
    arrived(walk, 'M:0:3');
    arrived(walk, 'M:0:4');
    expect(walk.dirs).toEqual([]);
  });
});