import { describe, expect, it } from 'vitest';
import { ARRIVES, FLIGHT_LEN, SWOOP, dollShows, flew, flightFade, flightPose, poisonLook } from './looks';
import { FLY_SPOTS } from './flyspots';
import { DOCKS } from './shared/room';

describe('poisoned in the fog (Status_Poison)', () => {
  it('blends up to 12 and back in steps of 2, and rests', () => {
    const blends = Array.from({ length: 36 }, (_, t) => poisonLook(t).blend);
    expect(blends.slice(0, 3)).toEqual([0, 0, 0]);
    expect(Math.max(...blends)).toBe(12);
    expect(blends[17]).toBe(10);
    expect(blends[18]).toBe(12);
    expect(blends[35]).toBe(2);
    expect(poisonLook(36)).toEqual({ blend: 0, dx: 0 });
    expect(poisonLook(89)).toEqual({ blend: 0, dx: 0 });
    expect(poisonLook(90 + 18).blend).toBe(12);
  });

  it('shakes a pixel each way while it plays', () => {
    expect([0, 1, 2, 3].map((t) => poisonLook(t).dx)).toEqual([-1, -1, 1, 1]);
  });
});

describe('the doll over a trainer who ran', () => {
  const ran = { battling: false, shun: 5, shunUntil: 600 };
  it('blinks, for as long as the one they ran from is kept off', () => {
    expect(dollShows(ran, 100, 0)).toBe(true);
    expect(dollShows(ran, 100, 8)).toBe(false);
    expect(dollShows(ran, 100, 16)).toBe(true);
    expect(dollShows(ran, 600, 0)).toBe(false);
  });
  it('is not over somebody who never ran, nor in their next fight', () => {
    expect(dollShows({ battling: false, shun: 0, shunUntil: 0 }, 100, 0)).toBe(false);
    expect(dollShows({ ...ran, battling: true }, 100, 0)).toBe(false);
  });
});

describe('a flight', () => {
  it('starts with the bird off the top right of the trainer, lowest at them, gone top left', () => {
    const start = flightPose(0).bird!, low = flightPose(SWOOP / 2).bird!, end = flightPose(SWOOP - 1).bird!;
    expect(start.x).toBeGreaterThan(120);
    expect(start.y).toBeCloseTo(-72, 0);
    expect(low.x).toBeCloseTo(0, 0);
    expect(low.y).toBeCloseTo(0, 0);
    expect(end.x).toBeLessThan(-100);
    expect(end.y).toBeLessThan(-60);
  });

  it('has them on the ground, then on the bird, then gone', () => {
    expect(flightPose(0)).toMatchObject({ rider: { x: 0, y: 0 }, mounted: false, at: 'from', gone: false });
    expect(flightPose(20).mounted).toBe(true);
    expect(flightPose(20).rider.x).toBeLessThan(0);
    expect(flightPose(SWOOP + 1)).toMatchObject({ gone: true, bird: null });
  });

  it('lands them on their cell, and it ends with them standing', () => {
    expect(flightPose(ARRIVES).at).toBe('to');
    expect(flightPose(ARRIVES).rider.x).toBeGreaterThan(100);
    const end = flightPose(FLIGHT_LEN);
    expect(end.rider).toEqual({ x: 0, y: 0 });
    expect(end.mounted).toBe(false);
    // The jump off's last line sets them down where the ride's 8 over them ends.
    expect(flightPose(FLIGHT_LEN - 1).rider.y).toBe(0);
  });

  it('fades out between the two ends and back', () => {
    expect(flightFade(SWOOP - 1)).toBe(0);
    expect(flightFade(ARRIVES - 1)).toBeGreaterThan(0.9);
    expect(flightFade(ARRIVES)).toBe(1);
    expect(flightFade(FLIGHT_LEN)).toBe(0);
  });
});

describe('what is a flight', () => {
  const [ox, oy] = FLY_SPOTS.MAP_OLDALE_TOWN;
  const oldale = { map: 'MAP_OLDALE_TOWN', x: ox, y: oy };
  it('a jump onto a town\'s spot, from another map or across the town', () => {
    expect(flew({ map: 'MAP_ROUTE110', x: 10, y: 30 }, oldale, false, FLY_SPOTS)).toBe(true);
    expect(flew({ map: 'MAP_OLDALE_TOWN', x: 1, y: 1 }, oldale, false, FLY_SPOTS)).toBe(true);
  });
  it('not a step onto it, a door, the drop out of the Zone, or anywhere else', () => {
    expect(flew({ map: 'MAP_OLDALE_TOWN', x: ox, y: oy - 1 }, oldale, false, FLY_SPOTS)).toBe(false);
    expect(flew({ map: 'MAP_OLDALE_TOWN_POKEMON_CENTER_1F', x: 7, y: 8 }, oldale, true, FLY_SPOTS)).toBe(false);
    expect(flew({ map: 'MAP_SAFARI_ZONE_SOUTH', x: 23, y: 30 }, oldale, false, FLY_SPOTS)).toBe(false);
    expect(flew({ map: 'MAP_ROUTE110', x: 10, y: 30 }, { map: 'MAP_OLDALE_TOWN', x: 1, y: 1 }, false, FLY_SPOTS)).toBe(false);
  });
  it('no ferry lands on one', () => {
    for (const d of Object.values(DOCKS)) expect(FLY_SPOTS[d.map]?.join()).not.toBe(`${d.x},${d.y}`);
  });
});
