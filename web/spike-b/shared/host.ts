// The one machine that runs a Room for real: the relay (relay/world.js), or the page
// itself when nobody else is there. It decides each frame's keys -- a trainer's from
// what their phone sent, a bot's from its thumb on the pad -- steps the Room, and keeps
// a record of the frame for everybody who mirrors it (net.ts).

import type { Spot, WorldMap } from '../../src/bots/world';
import { botKeys, botSpawns, type Brain } from './bots';
import { BOT_DUEL_MAX, HOST_JUDGE, LEGEND_CATCH, LEGEND_FOE, Room, botParty, legendMon, wornParty, type Bag, type Command, type RoomEvent } from './room';
import { within } from './items';
import { logMs, type BattleEvent } from './battlelog';
import { speciesName } from '../../src/bots/party';
import { battleItems } from '../../src/bots/bag';
import type { SimOutcome, SimSide, simulation as Simulation } from './battlesim';

/** One frame as a mirror needs it: what changed before anybody moved, the bots whose
 *  keys changed, and the trainers' inputs the frame used. Most frames a trainer uses one
 *  input, the same keys as the last, so only the rest are written: `ins` [id, ...bits]
 *  for a trainer who used other keys or two inputs, `stall` for one who used none. The
 *  service adds, per phone, the number of the last of its own inputs used. */
export interface Frame {
  tick: number;
  cmds?: Command[];
  keys?: [number, number][];
  ins?: number[][];
  stall?: number[];
  ack?: number;
}

interface Player {
  id: number;
  /** Inputs, one per phone frame, in order, not used yet; and the number of the last one
   *  used. */
  queue: number[];
  seq: number;
  started: boolean;
  /** Frames stood with inputs in hand, waiting for the cushion. */
  waited: number;
}

/** A trainer waits for this many inputs in hand before moving again, so a late packet
 *  rarely leaves it a frame short (spectators see a pause, not a stutter). Past
 *  JITTER + CATCH_UP it takes two every fourth frame until it is back. Nothing is ever
 *  dropped: every input moves the trainer exactly once, so the relay's walk is the
 *  thumb's. */
const JITTER = 3;
const CATCH_UP = 3;
/** A phone this far behind (ten seconds of keys) is not catching up: the oldest go. */
const MAX_QUEUE = 600;

/** A bot-vs-bot fight the host is simulating (Room.simBots). */
interface SimFight {
  a: number;
  b: number;
  /** The meeting, as the room has it: an answer for an earlier one must not end a later one. */
  since: number;
  /** `b` LEGEND_FOE: the legendary it is, not a bot. */
  legend?: { key: number; species: number };
  /** The fight, a turn at a time. */
  run?: Generator<void, SimOutcome, void>;
  /** The answer and the frame it is due, once it has run. */
  out?: SimOutcome;
  due?: number;
}

/** A frame spends about this long on simulating at most, in ms, and always a turn. What does not
 *  fit waits a frame, and its bots stand busy meanwhile, as they would in a fight. */
const SIM_BUDGET_MS = 4;
/** A fight's bots are let go at BOT_DUEL_MAX (Room.step), so the answer lands before it. */
const SIM_LAST_FRAME = BOT_DUEL_MAX - 60;

export interface HostOptions {
  /** A simulated fight's log, whole, the moment it is known and once for each of its two seats:
   *  whoever watches either bot plays it from the frame the fight began. */
  onLog?: (seat: number, events: BattleEvent[]) => void;
}

export class Host {
  readonly room: Room;
  private players = new Map<number, Player>();
  /** Each bot's mind, by id (the host's alone: the room only ever sees its keys). */
  readonly brains = new Map<number, Brain>();
  private pending: Command[] = [];
  private nextId = 1;
  /** Bot-vs-bot fights underway (Room.simBots), and the simulator once it has loaded: a chunk of
   *  its own, on a page that never turns it on. */
  private fights: SimFight[] = [];
  private simulation: typeof Simulation | null = null;
  private simLoad: Promise<void> | null = null;
  private simFailed = false;
  onLog?: HostOptions['onLog'];

  /** `jitter` 0 is the page hosting itself: a key is used the frame it is pressed. */
  constructor(room: Room, bots: number, maps: readonly WorldMap[], private readonly jitter = JITTER, opts: HostOptions = {}) {
    this.room = room;
    this.onLog = opts.onLog;
    if (room.simBots) void this.loadSim();
    for (const b of botSpawns(room, maps, bots)) {
      const id = this.nextId++;
      this.brains.set(id, b.brain);
      // The opening: in the Zone with everybody, as the live host deals its bots (bots/host.ts).
      const spot = room.ring().safari ? room.zone(id)[0] ?? b.spot : b.spot;
      room.apply({ c: 'join', id, bot: true, name: b.name, skin: b.skin, spot, facing: b.facing });
    }
  }

  /** A new trainer, in Littleroot by the truck (or at `spot`), standing on the next frame
   *  (or on the bench until the next round, when the fog has closed on this one). No name:
   *  TRAINER and their number. */
  join(name: string, skin: number, spot?: Spot, given?: number): number {
    const id = given ?? this.nextId++;
    if (given !== undefined && given >= this.nextId) this.nextId = given + 1;
    if (!spot) {
      // Not where somebody stands, nor where a join this frame will put them.
      const used = (s: Spot) =>
        this.room.actors.some((a) => a.m.spot.map === s.map && a.m.spot.x === s.x && a.m.spot.y === s.y) ||
        this.pending.some((c) => c.c === 'join' && c.spot.map === s.map && c.spot.x === s.x && c.spot.y === s.y);
      const near = this.room.truck(id);
      spot = near.find((s) => !used(s)) ?? near[0];
    }
    this.pending.push({ c: 'join', id, bot: false, name: name || `TRAINER ${id}`.slice(0, 10), skin, spot, facing: 1 });
    this.players.set(id, { id, queue: [], seq: 0, started: false, waited: 0 });
    return id;
  }

  /** START: who is on the map once this frame's joins are in is the match. */
  lock(): void {
    this.pending.push({ c: 'lock' });
  }

  leave(id: number): void {
    this.players.delete(id);
    this.pending.push({ c: 'leave', id });
  }

  /** How many inputs a phone has sent that no frame has used yet. */
  backlog(id: number): number {
    return this.players.get(id)?.queue.length ?? 0;
  }

  /** The number of the last of a phone's inputs a frame has used. */
  acked(id: number): number {
    return this.players.get(id)?.seq ?? 0;
  }

  /** A phone's keys for its next frames, numbered: `first` is the number of k[0]. */
  input(id: number, first: number, k: number[]): void {
    const p = this.players.get(id);
    if (!p) return;
    const known = p.seq + p.queue.length;
    // Resent or overlapping: only the frames not seen yet.
    const skip = Math.max(0, known + 1 - first);
    for (let i = skip; i < k.length; i++) p.queue.push(k[i] & 127);
    while (p.queue.length > MAX_QUEUE) { p.queue.shift(); p.seq += 1; }
  }

  /** The phone's battle is over: its trainer (and the bot) walk again. */
  /** The page's team could now do these on the field. */
  field(id: number, bits: number): void {
    if (this.players.has(id)) this.pending.push({ c: 'field', id, bits: bits & 15 });
  }

  /** The page fought two bots for the room (a `bots` event): who won, 0 for nobody. */
  bots(id: number, a: number, b: number, winner: number, hp?: number[], used?: [number[] | undefined, number[] | undefined]): void {
    if (this.players.has(id)) this.pending.push({ c: 'bots', id, a, b, winner, ...(hp ? { hp } : {}), ...(used?.some(Boolean) ? { used: [used[0] ?? [], used[1] ?? []] as [number[], number[]] } : {}) });
  }

  /** A page gone for now (`on`), or back. Back, it numbers its keys from 1 again. */
  away(id: number, on: boolean): void {
    const p = this.players.get(id);
    if (!p) return;
    if (!on) { p.queue = []; p.seq = 0; p.started = false; p.waited = 0; }
    this.pending.push({ c: 'away', id, on });
  }

  /** Drop the page's trainer on `map` when the Safari ends. */
  pick(id: number, map: string): void {
    if (this.players.has(id) && typeof map === 'string') this.pending.push({ c: 'pick', id, map });
  }

  /** The page's trade with event `n`'s trader is done: it gave him `given` (0, none). */
  traded(id: number, n: number, given: number): void {
    if (this.players.has(id)) this.pending.push({ c: 'traded', id, n, given });
  }

  /** The page's catch with a full party let `mons` go (room.ts `released`). */
  released(id: number, mons: { species: number; level: number }[]): void {
    if (this.players.has(id) && mons.length) this.pending.push({ c: 'released', id, mons: mons.slice(0, 6) });
  }

  /** The page saw a Flying-type in its team at event `n`'s REGI wall. */
  open(id: number, n: number): void {
    if (this.players.has(id)) this.pending.push({ c: 'open', id, n });
  }

  /** What trainer `id`'s fight left of bot `bot`'s team: each slot's HP share. */
  wear(id: number, bot: number, hp: number[], spent?: number[]): void {
    if (this.players.has(id)) this.pending.push({ c: 'wear', id, bot, hp, ...(spent ? { spent } : {}) });
  }

  /** FLY off the page's MAP landed it on `map` at x, y. */
  fly(id: number, map: string, x: number, y: number): void {
    if (this.players.has(id)) this.pending.push({ c: 'fly', id, to: { map, x, y } });
  }

  /** The page asked the ferry for story `to`'s island ('' home). */
  sail(id: number, to: string): void {
    if (this.players.has(id) && typeof to === 'string' && to.length <= 32) this.pending.push({ c: 'sail', id, to });
  }

  end(id: number, fled = false, won = false): void {
    if (this.players.has(id) && this.room.actor(id)?.battling) this.pending.push({ c: 'end', id, ...(fled ? { fled: true } : {}), ...(won ? { won: true } : {}) });
  }

  /** The ball `key` would not go in the phone's bag: back on the ground. A bag goes back
   *  with what did not fit, never more than it held. */
  drop(id: number, key: number, rest?: Bag): void {
    if (!this.players.has(id) || this.room.picked.get(key) !== id) return;
    const was = this.room.spills.get(key)?.bag;
    this.pending.push(was && rest ? { c: 'drop', id, key, rest: within(rest, was) } : { c: 'drop', id, key });
  }

  /** The phone's team is down: its trainer leaves the map, what they carried where they
   *  stood, and the phone watches. `by` the trainer or bot that beat them, `wild` a wild
   *  POKeMON did. */
  out(id: number, bag?: Bag, by?: number, wild?: boolean): void {
    if (!this.players.has(id) || !this.room.actor(id)) return;
    const c: Extract<Command, { c: 'out' }> = { c: 'out', id };
    if (bag) c.bag = bag;
    if (by) c.by = by;
    if (wild) c.wild = true;
    this.pending.push(c);
  }

  /** One frame. The record goes to every mirror; `acks` is each phone's last input used. */
  advance(): { frame: Frame; acks: Map<number, number>; events: RoomEvent[] } {
    const room = this.room;
    const cmds = this.pending;
    this.pending = [];
    for (const c of cmds) room.apply(c);
    const keys: [number, number][] = [];
    const ins: number[][] = [];
    const stall: number[] = [];
    const used = new Map<number, number[]>();
    const acks = new Map<number, number>();
    for (const a of room.actors) {
      if (a.bot) {
        const brain = this.brains.get(a.id);
        const bits = brain && !a.battling ? botKeys(room, a, brain) : 0;
        if (bits !== a.keys) { keys.push([a.id, bits]); a.keys = bits; }
        // Its team can FLY and the fog has it (bots.ts flyGoal): a `fly` for every mirror, next frame.
        if (brain?.flyTo) { this.pending.push({ c: 'fly', id: a.id, to: brain.flyTo }); brain.flyTo = undefined; }
        continue;
      }
      const p = this.players.get(a.id);
      if (!p) { stall.push(a.id); continue; }
      // Moving again once the cushion is in hand, or once what is in hand has waited as
      // long as a cushion would have (a lone tap after a quiet spell).
      if (!p.started && p.queue.length) {
        if (p.queue.length >= Math.max(1, this.jitter) || p.waited >= this.jitter) { p.started = true; p.waited = 0; }
        else p.waited += 1;
      }
      if (p.started) {
        // Catching up, a second input every fourth frame: the trainer a quarter fast for a
        // moment as others see it, not double speed.
        const n = p.queue.length > this.jitter + CATCH_UP && room.tick % 4 === 0 ? 2 : p.queue.length ? 1 : 0;
        if (!n) p.started = false; // ran dry: stand, and wait for a cushion again
        const take = p.queue.splice(0, n);
        p.seq += n;
        if (n) used.set(a.id, take);
      }
      const take = used.get(a.id);
      if (!take) stall.push(a.id);
      else if (take.length !== 1 || take[0] !== a.keys) ins.push([a.id, ...take]);
      acks.set(a.id, p.seq);
    }
    // A phone on the bench walks nobody: its keys are spent as they come, so it comes
    // back at the next round with nothing old to replay.
    for (const p of this.players.values()) {
      if (acks.has(p.id)) continue;
      p.seq += p.queue.length;
      p.queue.length = 0;
      p.started = false;
      p.waited = 0;
      acks.set(p.id, p.seq);
    }
    const events = room.step(used);
    if (room.simBots) this.simFrame(events);
    const frame: Frame = { tick: room.tick };
    if (cmds.length) frame.cmds = cmds;
    if (keys.length) frame.keys = keys;
    if (ins.length) frame.ins = ins;
    if (stall.length) frame.stall = stall;
    return { frame, acks, events };
  }

  private loadSim(): Promise<void> {
    // A page's chunk that will not load: what is waiting walks on, and the next fight tries again.
    this.simLoad ??= import('./battlesim').then(
      (m) => { this.simulation = m.simulation; },
      (err) => { console.error(`no battle simulator: ${String(err)}`); this.simLoad = null; this.simFailed = true; },
    );
    return this.simLoad;
  }

  /** Resolves when the simulator has loaded: a test's wait, and the only async in all this. */
  simReady(): Promise<void> {
    return this.loadSim();
  }

  /** A bot's side of a fight, as a trainer's page deals it (main.ts judgeBots had this). */
  private simSide(id: number): SimSide {
    const r = this.room, b = r.actor(id);
    return {
      seat: id,
      name: b?.name ?? '',
      skin: b?.skin ?? 0,
      party: b ? wornParty(botParty(r.seed, b, r.ring().phase + 1), b.wear) : [],
      items: battleItems(b?.loot?.items ?? []),
    };
  }

  /** A legendary's side: its one mon at the rung. */
  private legendSide({ key, species }: { key: number; species: number }): SimSide {
    return { seat: LEGEND_FOE, name: speciesName(species), skin: 0, party: [legendMon(this.room.spills.get(key), species, this.room.ring().phase + 1)] };
  }

  /** The meeting this fight is for is still on. */
  private simWanted(f: SimFight): boolean {
    const a = this.room.actor(f.a), b = this.room.actor(f.b);
    if (f.legend) return !!a && a.since === f.since && a.judge === HOST_JUDGE && a.foe === LEGEND_FOE;
    return !!a && !!b && a.since === f.since && a.judge === HOST_JUDGE && a.foe === f.b && b.foe === f.a;
  }

  /** Off the room's step and never in it: new meetings start, what is ready runs, and what is
   *  due goes in as an ordinary `bots` command on the next frame, so every mirror applies it. */
  private simFrame(events: readonly RoomEvent[]): void {
    const r = this.room;
    for (const e of events) if (e.type === 'bots' && e.id === HOST_JUDGE) this.fights.push({ a: e.a, b: e.b, since: r.actor(e.a)?.since ?? e.tick, ...(e.legend ? { legend: e.legend } : {}) });
    if (!this.fights.length) return;
    this.fights = this.fights.filter((f) => this.simWanted(f));
    if (this.simFailed) {
      this.simFailed = false;
      for (const f of this.fights) f.due ??= r.tick;
    } else if (!this.simulation) void this.loadSim();
    else {
      const began = performance.now();
      for (const f of this.fights) {
        while (f.due === undefined && performance.now() - began <= SIM_BUDGET_MS) this.simRun(f);
        if (performance.now() - began > SIM_BUDGET_MS) break;
      }
    }
    this.fights = this.fights.filter((f) => {
      if (f.due === undefined || r.tick < f.due) return true;
      this.simAnswer(f);
      return false;
    });
  }

  /** A turn more of it. */
  private simRun(f: SimFight): void {
    const r = this.room;
    try {
      if (!f.run) {
        // Every number in it from the match: a fight can be run again from its seed.
        const seed = (Math.imul(r.seed ^ f.since, 0x9e3779b1) ^ Math.imul(f.a, 0x85ebca6b) ^ Math.imul(f.b, 0xc2b2ae35)) >>> 0;
        // In the fog where they stand, it bites them as it does a trainer in a fight (Cam, 11-02).
        const at = r.actor(f.a)?.m.spot;
        f.run = this.simulation!(this.simSide(f.a), f.legend ? this.legendSide(f.legend) : this.simSide(f.b), { seed, map: at?.map ?? '', fog: !!at && r.inFog(at) });
      }
      const step = f.run.next();
      if (!step.done) return;
      f.out = step.value;
    } catch (err) {
      // Never a coin flip, and never the room's end: no answer, and both walk on.
      console.error(`bot fight ${f.a} v ${f.b} did not run: ${err instanceof Error ? err.stack : String(err)}`);
      f.due = r.tick;
      return;
    }
    // From the frame they met: the running took a frame or two of that.
    const frames = Math.ceil((logMs(f.out.log) / 1000) * 60);
    f.due = Math.max(r.tick, Math.min(f.since + frames, f.since + SIM_LAST_FRAME));
    this.onLog?.(f.a, f.out.log);
    if (!f.legend) this.onLog?.(f.b, f.out.log);
  }

  private simAnswer(f: SimFight): void {
    const out = f.out;
    if (!out) { this.pending.push({ c: 'bots', id: HOST_JUDGE, a: f.a, b: f.b, winner: 0 }); return; }
    // A legendary it brought low enough to catch is the bot's, however the rest of its team did.
    const winner = f.legend && out.shareB[0] < LEGEND_CATCH ? f.a : out.winner;
    const hp = winner === f.a ? out.shareA : winner === f.b ? out.shareB : undefined;
    this.pending.push({
      c: 'bots',
      id: HOST_JUDGE,
      a: f.a,
      b: f.b,
      winner,
      ...(hp ? { hp } : {}),
      ...(out.usedA.length || out.usedB.length ? { used: [out.usedA, out.usedB] as [number[], number[]] } : {}),
    });
  }
}

/** A mirror's frame: the same order the host used. */
export function play(room: Room, f: Frame): RoomEvent[] {
  for (const c of f.cmds ?? []) room.apply(c);
  for (const [id, bits] of f.keys ?? []) {
    const a = room.actor(id);
    if (a) a.keys = bits;
  }
  const used = new Map<number, number[]>();
  for (const a of room.actors) if (!a.bot) used.set(a.id, [a.keys]);
  for (const id of f.stall ?? []) used.delete(id);
  for (const [id, ...bits] of f.ins ?? []) used.set(id, bits);
  const events = room.step(used);
  if (room.tick !== f.tick) throw new Error(`frame ${f.tick} played as ${room.tick}`);
  return events;
}
