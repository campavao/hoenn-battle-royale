// The offline match (POK-331 #25): what tools/br/bots-replay.ts and zone-occupancy.ts
// print is only worth reading if it is the match a room plays. These pin it to the two
// things a room runs -- createHostBots and the Director -- rather than to a Bots and a
// ring of the tools' own, which is what both tools had until now.
import { describe, expect, it } from 'vitest';
import { BEAT_MS, offlineMatch, type OfflineMatch } from './offline';
import { botGround } from './host';
import { HOENN } from './hoenn';
import { dealBots } from './roster';
import type { Decision } from './brain';
import { RING_RADII } from '../match/clock';
import { Director, type DirectorWorld } from '../match/director';
import { DOORSTEPS, HAND, LANDING } from '../match/landing';
import { SAFARI_CELLS } from '../match/safari';
import { MAP_OFFSET } from '../net/cells';
import type { Msg, PlaceMsg, RingMsg } from '../net/wire';
import regionmapData from '../data/regionmap.json';

const SEED = 20260925;
const BOTS = 8;
const SAFARI = 10;
const FOG = 10;

interface Heard {
  msg: Msg;
  at: number;
}

/** One quick match, played to the director's verdict and written down as it went. */
function play(seed = SEED, until = Number.POSITIVE_INFINITY) {
  const heard: Heard[] = [];
  const decisions: Decision[] = [];
  const m = offlineMatch({
    seed,
    bots: BOTS,
    safariSecs: SAFARI,
    fogSecs: FOG,
    onMsg: (msg, at) => heard.push({ msg, at }),
    onDecision: (d) => decisions.push(d),
  });
  // Long enough for the last ring to take everybody: a draw is an answer too.
  const end = Math.min(until, (SAFARI + FOG * RING_RADII.length + 120) * 1000);
  for (let t = BEAT_MS; t <= end && m.winner === undefined; t += BEAT_MS) m.tick(t);
  return { m, heard, decisions };
}

const run = play();
const rings = run.heard.filter((h): h is { msg: RingMsg; at: number } => h.msg.t === 'ring');
const outs = run.heard.filter((h) => h.msg.t === 'out').map((h) => (h.msg as { seat: number }).seat);

describe('the offline match is the host\'s (POK-331 #25)', () => {
  it('deals the field createHostBots deals, into the Zone for the opening', () => {
    const m: OfflineMatch = offlineMatch({ seed: SEED, bots: BOTS, safariSecs: SAFARI });
    expect(m.host.seats).toEqual(dealBots(SEED, BOTS, [], botGround().spawns).map((b) => b.seat));
    const zone = new Set(SAFARI_CELLS.map((c) => c.map));
    for (const at of m.host.bots.positions()) expect(zone.has(at.map)).toBe(true);
    // Nobody fights in the Zone: not one duel before the buzzer.
    expect(run.decisions.filter((d) => d.rule === 'duel' && d.at < SAFARI * 1000)).toEqual([]);
  });

  it("rings the director's rings: its radii, its centre, one every fogSecs after the opening", () => {
    expect(rings.length).toBeGreaterThanOrEqual(3);
    expect(rings.map((h) => h.msg.r)).toEqual(RING_RADII.slice(0, rings.length));
    expect(rings.map((h) => h.msg.phase)).toEqual(rings.map((_, i) => i + 1));
    expect(rings.map((h) => h.at)).toEqual(rings.map((_, i) => (SAFARI + i * FOG) * 1000));
    // The centre is the one a Director dealt the same field on app.ts's world picks.
    const world: DirectorWorld = {
      maps: HOENN.maps,
      landing: LANDING,
      doorsteps: DOORSTEPS,
      hand: HAND,
      sections: regionmapData.sections as DirectorWorld['sections'],
    };
    let now = 0;
    const said: Msg[] = [];
    const director = new Director({
      seats: run.m.host.seats,
      seed: SEED,
      options: { safariSecs: SAFARI, fogSecs: FOG },
      world,
      send: (msg) => said.push(msg),
      now: () => now,
      onOut: () => () => {},
    });
    director.start();
    now = SAFARI * 1000;
    director.tick();
    const first = said.find((msg): msg is RingMsg => msg.t === 'ring')!;
    for (const h of rings) expect({ sx: h.msg.sx, sy: h.msg.sy, place: h.msg.place }).toEqual({ sx: first.sx, sy: first.sy, place: first.place });
  });

  it('drops each bot at the first ring onto the cell the seed dealt it, in the wire\'s space', () => {
    const buzzer = rings[0].at;
    const dropped = run.heard
      .filter((h) => h.at === buzzer && h.msg.t === 'place')
      .map((h) => h.msg as PlaceMsg)
      .map((p) => ({ seat: p.seat, map: p.map, x: p.x, y: p.y }));
    const landing = dealBots(SEED, BOTS, [], botGround().spawns).map((b) => ({
      seat: b.seat,
      map: b.map,
      x: b.x + MAP_OFFSET,
      y: b.y + MAP_OFFSET,
    }));
    expect(dropped).toEqual(landing);
  });

  it('ends at the director\'s win, which goes to the one bot nobody put out', () => {
    expect(run.m.winner).not.toBeUndefined();
    const standing = run.m.host.seats.filter((s) => !outs.includes(s)).sort((a, b) => a - b);
    expect(outs).toHaveLength(new Set(outs).size); // out once each
    expect(run.m.winner).toBe(standing.length === 1 ? standing[0] : null);
    // ...and the roster, which is the host's count of the field, agrees.
    expect(run.m.roster.alive().map((e) => e.seat)).toEqual(standing);
  });

  it("puts a fallen bot's team on the ground, where the next bot comes to take it", () => {
    const spilled = new Set(
      run.heard.flatMap((h) =>
        h.msg.t === 'spill' ? [...h.msg.mons.map((mon) => mon.key), ...(h.msg.bag ? [h.msg.bag.key] : [])] : [],
      ),
    );
    expect(spilled.size).toBeGreaterThan(0);
    const taken = run.heard.filter((h) => h.msg.t === 'pickup').map((h) => (h.msg as { key: number }).key);
    expect(taken.some((key) => spilled.has(key))).toBe(true);
  });

  it('plays the same match twice from the same seed', () => {
    const again = play(SEED, (SAFARI + 2 * FOG) * 1000);
    const cut = run.heard.filter((h) => h.at <= (SAFARI + 2 * FOG) * 1000);
    expect(again.heard).toEqual(cut);
  });

  it('deals the whole field onto one map when asked, and starts it there with no opening', () => {
    const m = offlineMatch({ seed: SEED, bots: BOTS, safariSecs: 0, onMap: 'MAP_ROUTE104' });
    expect(m.host.bots.positions().map((p) => p.map)).toEqual(Array(BOTS).fill('MAP_ROUTE104'));
    expect(() => offlineMatch({ seed: SEED, bots: BOTS, onMap: 'MAP_NOWHERE' })).toThrow(/no landing cells/);
  });
});
