// The match director (POK-222 Safari opening clock, POK-223 drop dealing, POK-224
// ring phases, POK-228 elimination order/winner) -- the page-side rules engine for
// one match. Runs on the HOST only: in a room, the seat that started it; in solo,
// the one local seat (there is no one else to run it). It never touches the
// emulator directly -- it owns no RAM, just a `send(msg)` it hands wire.ts `Msg`s to
// (the bridge's `relay.all` in a room, or a local mailbox-only push in solo, see
// app.ts) and a `now()` it reads the match clock from. That split is what makes this
// file testable without a browser: a test hands in a fake `now()` and a `send` that
// records what would have gone out.
//
// Design choices this ticket left ambiguous, resolved here (see docs/DESIGN.md
// §6-§7, docs/WIRE.md's `ring`/`clock`/`start`/`win` rows):
//  - The ring's centre (`sx`/`sy`/`place`) is chosen ONCE, when the Safari opening
//    ends, and every later phase re-sends it with a smaller `r` -- a fog ring that
//    recentres every shrink would not read as a shrinking ring.
//  - `clock.left` counts down in 5s steps starting at `safariSecs - 5` (the first
//    tick is 5s after `start`, not an immediate echo of `safariSecs` itself); the
//    tick that reaches 0 is the same one that begins the ring.
//  - A one-seat match (solo) never auto-emits `win`: the check only runs inside the
//    `out` handler, and solo has no other seat left to send `out` for this one to
//    react to. Bots are not wire seats (DESIGN.md §6: "bots move in JS"), so they
//    cannot trigger it either.
//  - `state.clockLeft` is computed from `now()` on every read, not cached from the
//    last emitted `clock`/`ring` -- the ROM's own `BrMatch`/`BrHud` count seconds
//    locally between wire ticks (br_match.h's `clockLeft`/`clockFrames`), and the
//    page's HUD mirror should look just as live.
import { mulberry32, pickIndex, RING_RADII, isFinalRingPhase } from './clock';
import type { MapRef, Msg, Pace } from '../net/wire';

const DEFAULT_SAFARI_SECS = 120;
const DEFAULT_FOG_SECS = 120;
const CLOCK_STEP_MS = 5000;
const DEAL_RETRY_LIMIT = 200; // generous: real world.json has thousands of landing cells for <=32 seats

// ---- world data (regionmap.json + landing.json + world.json's `maps`) -----------

/** The handful of world.json per-map fields the director needs to place a seat --
 *  not the exporter's full `MapEntry` (grid/seams/warps/centre), which nothing here
 *  reads. A wider object (the real JSON import) satisfies this structurally. */
export interface DirectorMapEntry {
  id: string;
  group: number;
  num: number;
  section: string;
  outdoor: boolean;
}

/** One landing.json row: a walkable cell on `map`, map coords with no MAP_OFFSET. */
export interface LandingCell {
  map: string;
  x: number;
  y: number;
  /** Set by `tools/br/landing-reach.ts` on a cell with no route to the rest of Hoenn
   *  -- a map's border filler, or a genuinely gated corner. app.ts filters these out
   *  before the Director ever sees them (POK-251). */
  off?: 1;
}

/** One regionmap.json section: a rectangle on the 28x15 Hoenn region map. */
export interface RegionSection {
  x: number;
  y: number;
  w: number;
  h: number;
  name?: string;
  /** The MAPSEC_* value, which is what the ROM puts on the wire when a trainer picks
   *  where to drop (POK-223). regionmap.json carries it for every section. */
  num?: number;
}

export interface DirectorWorld {
  maps: DirectorMapEntry[]; // world.json's `.maps`
  landing: LandingCell[]; // landing.json
  sections: Record<string, RegionSection>; // regionmap.json's `.sections`
}

interface SectionCells {
  id: string;
  section: RegionSection;
  cells: { map: MapRef; x: number; y: number }[];
}

/** Joins the three world files into "every outdoor section that has at least one
 *  landing cell", the pool both the drop (POK-223) and the ring (POK-224) draw from
 *  -- landing.json names a map by its world.json `id`, not by group/num, and does
 *  not carry the section itself, so this is the one place that lookup happens. */
function buildOutdoorSections(world: DirectorWorld): SectionCells[] {
  const byId = new Map(world.maps.map((m) => [m.id, m]));
  const bySection = new Map<string, SectionCells>();
  for (const cell of world.landing) {
    const m = byId.get(cell.map);
    if (!m || !m.outdoor) continue;
    const section = world.sections[m.section];
    if (!section) continue;
    let entry = bySection.get(m.section);
    if (!entry) {
      entry = { id: m.section, section, cells: [] };
      bySection.set(m.section, entry);
    }
    entry.cells.push({ map: { group: m.group, num: m.num }, x: cell.x, y: cell.y });
  }
  return Array.from(bySection.values());
}

function sectionCentre(section: RegionSection): { sx: number; sy: number } {
  return { sx: section.x + Math.floor(section.w / 2), sy: section.y + Math.floor(section.h / 2) };
}

// ---- the director itself ----------------------------------------------------------

export interface DirectorOptions {
  /** Every seat in this match (roster order). Solo: exactly one, this client's own. */
  seats: number[];
  /** This director's own seat -- stamped on `ring`/`clock`/`win` as wire.ts requires
   *  (docs/WIRE.md: those three are "host-only" messages but still carry a `seat`).
   *  Defaults to `seats[0]`. */
  hostSeat?: number;
  /** The match seed -- also sent in `start` so every client deals/rings identically. */
  seed: number;
  options?: { safariSecs?: number; fogSecs?: number; pace?: Pace };
  world: DirectorWorld;
  /** Ships one wire.ts `Msg` -- the bridge's `relay.all` in a room, a local
   *  mailbox-only push in solo (app.ts). */
  send: (msg: Msg) => void;
  /** Monotonic milliseconds. Real code: `() => performance.now()`. Tests: a fake
   *  that the test advances by hand between `tick()` calls. */
  now: () => number;
  /** Subscribes to eliminations from ANY seat, however they reach this client (the
   *  bridge's relay `recv` stream in a room; solo wires nothing in, see app.ts).
   *  Returns an unsubscribe, mirroring `EmulatorLike.onFrame`'s shape elsewhere in
   *  this codebase (bridge.ts). */
  onOut: (handler: (seat: number) => void) => () => void;
}

export type DirectorPhase = 'idle' | 'safari' | 'ring' | 'ended';

export interface DirectorRingState {
  phase: number; // 1-based, matches wire.ts RingMsg.phase
  sx: number;
  sy: number;
  r: number;
  place?: string;
}

export interface DirectorState {
  phase: DirectorPhase;
  ring?: DirectorRingState;
  /** Seconds: the Safari countdown while `phase === 'safari'`, then seconds to the
   *  next ring move while `phase === 'ring'`; 0 once `ended`. */
  clockLeft: number;
  alive: number;
  /** Elimination order, first-out first. The winner (if any) is never in this list. */
  placements: number[];
  /** Set once the match is decided. Absent + `phase === 'ended'` = a draw (every
   *  seat out at once). */
  winner?: number;
}

export class Director {
  private readonly rng: () => number;
  private readonly sections: SectionCells[];
  /** Every cell handed out this match, so no two trainers land on the same tile --
   *  the START's own deal and every `pick` answered afterwards share it. */
  private readonly dealtCells = new Set<string>();
  private readonly safariSecs: number;
  private readonly fogSecs: number;
  private readonly hostSeat: number;

  private phase: DirectorPhase = 'idle';
  private startedAt = 0;
  private clockTicksSent = 0;
  private ringStartedAt = 0;
  private ringIndex = -1; // -1 = ring not begun
  private ringCentre?: { sx: number; sy: number; place?: string };
  private readonly aliveSeats: Set<number>;
  private readonly placements: number[] = [];
  private winner: number | undefined;
  private unsubOut: (() => void) | undefined;

  constructor(private readonly opts: DirectorOptions) {
    this.rng = mulberry32(opts.seed);
    this.sections = buildOutdoorSections(opts.world);
    if (this.sections.length === 0) throw new Error('director: no outdoor landing sections in world data');
    this.safariSecs = opts.options?.safariSecs ?? DEFAULT_SAFARI_SECS;
    this.fogSecs = opts.options?.fogSecs ?? DEFAULT_FOG_SECS;
    this.hostSeat = opts.hostSeat ?? opts.seats[0];
    this.aliveSeats = new Set(opts.seats);
  }

  /** Deals spawns, sends `start`, and begins the Safari countdown. Call once. */
  start(): void {
    this.startedAt = this.opts.now();
    this.phase = 'safari';
    const spawns = this.dealSpawns();
    this.opts.send({
      t: 'start',
      seed: this.opts.seed,
      spawns,
      safari: this.safariSecs,
      fog: this.fogSecs,
      // The host's pace goes out with the deal, and every ROM in the room applies it
      // (POK-241): one room reads at one speed, or the shot clock means different
      // things to different people.
      pace: this.opts.options?.pace,
    });
    this.unsubOut = this.opts.onOut((seat) => this.handleOut(seat));
  }

  /** Stops listening for eliminations. Idempotent. */
  stop(): void {
    this.unsubOut?.();
    this.unsubOut = undefined;
  }

  /** Call frequently (app.ts: about once a second is plenty, since the coarsest
   *  cadence here is the 5s clock tick) -- emits whatever `clock`/`ring` messages
   *  have come due since the last call, in order, none skipped. */
  tick(): void {
    if (this.phase === 'safari') this.tickSafari();
    else if (this.phase === 'ring') this.tickRing();
  }

  get state(): DirectorState {
    return {
      phase: this.phase,
      ring: this.currentRingState(),
      clockLeft: this.computeClockLeft(),
      alive: this.aliveSeats.size,
      placements: [...this.placements],
      winner: this.winner,
    };
  }

  // ---- dealing (POK-223) -----------------------------------------------------------

  /** Answers a `pick`: a cell in the section that trainer chose, that nobody has been
   *  given yet. A section with nothing standable in it (POK-251 marks those) falls back
   *  to anywhere, because a trainer who picked one is owed a drop regardless. */
  landFor(seat: number, section: number): { seat: number; map: MapRef; x: number; y: number } {
    const wanted = this.sections.find((s) => s.section.num === section);
    const pool = wanted && wanted.cells.length > 0 ? [wanted] : this.sections;
    for (let attempt = 0; attempt < DEAL_RETRY_LIMIT; attempt++) {
      const from = pool[pickIndex(this.rng, pool.length)];
      const cell = from.cells[pickIndex(this.rng, from.cells.length)];
      const key = `${cell.map.group}:${cell.map.num}:${cell.x}:${cell.y}`;
      if (this.dealtCells.has(key) && attempt < DEAL_RETRY_LIMIT - 1) continue;
      this.dealtCells.add(key);
      return { seat, map: cell.map, x: cell.x, y: cell.y };
    }
    const fallback = this.sections[0].cells[0];
    return { seat, map: fallback.map, x: fallback.x, y: fallback.y };
  }

  private dealSpawns() {
    const used = this.dealtCells;
    return this.opts.seats.map((seat) => {
      let map: MapRef = { group: 0, num: 0 };
      let x = 0;
      let y = 0;
      for (let attempt = 0; attempt < DEAL_RETRY_LIMIT; attempt++) {
        const section = this.sections[pickIndex(this.rng, this.sections.length)];
        const cell = section.cells[pickIndex(this.rng, section.cells.length)];
        const key = `${cell.map.group}:${cell.map.num}:${cell.x}:${cell.y}`;
        if (used.has(key) && attempt < DEAL_RETRY_LIMIT - 1) continue;
        used.add(key);
        map = cell.map;
        x = cell.x;
        y = cell.y;
        break;
      }
      return { seat, map, x, y };
    });
  }

  // ---- Safari countdown (POK-222) --------------------------------------------------

  private tickSafari(): void {
    const elapsed = this.opts.now() - this.startedAt;
    while (this.phase === 'safari' && (this.clockTicksSent + 1) * CLOCK_STEP_MS <= elapsed) {
      this.clockTicksSent++;
      const left = Math.max(0, this.safariSecs - this.clockTicksSent * (CLOCK_STEP_MS / 1000));
      this.opts.send({ t: 'clock', seat: this.hostSeat, left });
      if (left <= 0) {
        this.beginRing();
        break;
      }
    }
  }

  // ---- the ring (POK-224) -----------------------------------------------------------

  private beginRing(): void {
    this.phase = 'ring';
    this.ringStartedAt = this.opts.now();
    this.ringIndex = 0;
    const section = this.sections[pickIndex(this.rng, this.sections.length)];
    const { sx, sy } = sectionCentre(section.section);
    this.ringCentre = { sx, sy, place: section.section.name };
    this.emitRing();
  }

  private tickRing(): void {
    if (isFinalRingPhase(this.ringIndex)) return; // already "everywhere"; nothing left to shrink
    const elapsed = this.opts.now() - this.ringStartedAt;
    while (!isFinalRingPhase(this.ringIndex) && (this.ringIndex + 1) * this.fogSecs * 1000 <= elapsed) {
      this.ringIndex++;
      this.emitRing();
    }
  }

  private emitRing(): void {
    if (!this.ringCentre) return;
    const elapsedSecs = Math.round((this.opts.now() - this.startedAt) / 1000);
    this.opts.send({
      t: 'ring',
      seat: this.hostSeat,
      phase: this.ringIndex + 1,
      sx: this.ringCentre.sx,
      sy: this.ringCentre.sy,
      r: RING_RADII[this.ringIndex],
      place: this.ringCentre.place,
      elapsed: elapsedSecs,
    });
  }

  private currentRingState(): DirectorRingState | undefined {
    if (this.ringIndex < 0 || !this.ringCentre) return undefined;
    return {
      phase: this.ringIndex + 1,
      sx: this.ringCentre.sx,
      sy: this.ringCentre.sy,
      r: RING_RADII[this.ringIndex],
      place: this.ringCentre.place,
    };
  }

  private computeClockLeft(): number {
    if (this.phase === 'idle' || this.phase === 'ended') return this.phase === 'idle' ? this.safariSecs : 0;
    const elapsed = this.opts.now() - (this.phase === 'safari' ? this.startedAt : this.ringStartedAt);
    if (this.phase === 'safari') return Math.max(0, this.safariSecs - Math.floor(elapsed / 1000));
    if (isFinalRingPhase(this.ringIndex)) return 0;
    const nextMoveMs = (this.ringIndex + 1) * this.fogSecs * 1000;
    return Math.max(0, Math.ceil((nextMoveMs - elapsed) / 1000));
  }

  // ---- elimination order and the winner (POK-228) ----------------------------------

  private handleOut(seat: number): void {
    if (this.phase === 'ended') return;
    if (!this.aliveSeats.has(seat)) return; // already out, or never in this match
    this.aliveSeats.delete(seat);
    this.placements.push(seat);

    // A one-seat match (solo) never decides itself this way -- see the file header.
    if (this.opts.seats.length <= 1) return;
    if (this.aliveSeats.size > 1) return;

    this.winner = this.aliveSeats.size === 1 ? [...this.aliveSeats][0] : undefined;
    this.phase = 'ended';
    this.opts.send({ t: 'win', seat: this.winner });
    this.stop();
  }
}
