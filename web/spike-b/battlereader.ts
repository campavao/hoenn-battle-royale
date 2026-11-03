// A battle, read off the ROM's memory as it happens, and said as battlelog.ts's events (Cam,
// 11-02: a watcher used to replay a fight from its seed and choices on their own ROM, and any
// difference ended it; now the fighter's page says what happened and nobody works it out twice).
//
// One frame at a time, `frame()` looks at what the battle keeps in plain memory:
//   gBattleMons[battler]       species, HP, status and personality of each mon on the field
//   gBattlerPartyIndexes       which party slot each of them is
//   gDisplayedStringBattle     the line the message box was last given
// and, once, at the start, both parties (gPlayerParty, gEnemyParty). A change becomes an event.
//
// Safe mid-frame. A frame can end in the middle of the ROM writing a thing, so:
//  - a field of gBattleMons or the text is only believed once it reads the same on two frames
//    in a row (a torn line or a half-copied mon is gone a frame later);
//  - the parties are encrypted (pokemon.c), and a mon is only read once its checksum adds up
//    (carry.ts partyWhole) and the party has stopped changing: the BAD EGG lesson, partySettled.
//
// It costs a few hundred bytes of reads a frame (`stats` says how many ms).

import { decodeGen3 } from '../src/text/gen3';
import { teamMembers, partyWhole, PARTY_LEN } from './carry';
import type { BattleEvent, LogMon, LogSide, Side } from './shared/battlelog';

/** struct BattlePokemon (include/pokemon.h): 0x58 bytes, and where the fields are. */
const MON_SIZE = 0x58;
const M_SPECIES = 0x00;
const M_HP = 0x28;
const M_LEVEL = 0x2a;
const M_MAX_HP = 0x2c;
const M_PERSONALITY = 0x48;
const M_STATUS1 = 0x4c;
/** gDisplayedStringBattle is 300 bytes; the longest line is under a hundred. */
const TEXT_READ = 128;
const TERMINATOR = 0xff;
/** include/constants/battle.h. */
const BATTLE_TYPE_SAFARI = 1 << 7;
/** B_POSITION_PLAYER_LEFT: where the local player stands (touch.ts localBattler). */
const POSITION_PLAYER_LEFT = 0;
/** Frames the foe is up before a side that has no mon (the Safari) is believed to have none. */
const WAIT_FOR_ME = 90;
/** Frames to wait for a party to settle before it is read as it is. */
const WAIT_FOR_PARTY = 120;
/** Frames between messages while something is waiting: about a third of a second. */
const FLUSH_FRAMES = 20;

/** Memory as the emulator gives it (emu/index.ts). */
export interface Mem {
  read(addr: number, bits: 8 | 16 | 32): number;
  bytes(addr: number, len: number): Uint8Array;
}

/** The addresses it reads (rom.ts `sym`); a missing one is NaN or undefined. `mons`, `partyIdx`,
 *  `text`, `player` and `enemy` are needed; the rest only sharpen it. */
export interface ReaderSyms {
  mons: number;
  partyIdx: number;
  text: number;
  player: number;
  enemy: number;
  /** gBattlersCount */
  count?: number;
  /** gBattleMainFunc: set once the battle itself runs */
  mainFunc?: number;
  /** gBattleTypeFlags */
  flags?: number;
  /** gBattlerPositions, to find the local player's battler */
  positions?: number;
  /** gCurrentMove, for a hit's move */
  move?: number;
  /** gBrBattle.menu: not 0 while a choice menu is up, and the strings the menu's windows print
   *  (the move's PP and type, "What will X do?") are the menu's, not the story's. */
  menu?: number;
}

/** Who is fighting and where, as the page knows it (the reader cannot): side 0 is the page's own
 *  trainer. A wild POKeMON has seat 0 and no name. */
export interface ReaderCtx {
  me: { seat: number; name: string; skin: number };
  foe: { seat: number; name: string; skin: number };
  map: string;
  /** A mon's gender from its species and personality (0 male, 1 female, 2 neither), out of the
   *  ROM's gSpeciesInfo, which the reader's memory does not hold. None: not said. */
  genderOf?: (species: number, personality: number) => number;
}

export interface ReaderStats { frames: number; ms: number; maxMs: number }

const present = (n: number | undefined): n is number => n !== undefined && !Number.isNaN(n);

// ---- the text --------------------------------------------------------------------------------

/** The bytes of an extended control code (0xFC) take this many more (charmap.txt / characters.h). */
const CTRL_ARGS: Record<number, number> = { 1: 1, 2: 1, 3: 1, 4: 3, 5: 1, 6: 1, 7: 0, 8: 1, 9: 0, 10: 0, 11: 2, 12: 1, 13: 1, 14: 1, 15: 1, 16: 2, 17: 1, 18: 1, 19: 1, 20: 1, 21: 0, 22: 0, 23: 0, 24: 0 };
/** Bytes the wire charmap (text/gen3.ts) lacks that a battle line holds. */
const EXTRA: Record<number, string> = { 0x1b: 'é', 0xb1: '"', 0xb2: '"', 0xb3: "'", 0x34: 'Lv', 0xaf: '.', 0xb7: '$', 0xb9: '.', 0xf1: '%', 0xf2: ' ', 0xf3: ' ' };

/** A line of the message box as the player reads it: one line, the ROM's own letters, its
 *  control codes (colour, pause, a new line) gone. */
export function battleText(raw: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i];
    if (b === TERMINATOR) break;
    if (b === 0xfc) { i += CTRL_ARGS[raw[i + 1]] ?? 1; i++; continue; }
    // A new line, a scroll and a paragraph are all a space in one line of text.
    if (b === 0xfe || b === 0xfa || b === 0xfb) { out += ' '; continue; }
    if (b === 0xfd) { i++; continue; } // a placeholder the ROM did not expand
    try { out += decodeGen3(Uint8Array.of(b)); } catch { out += EXTRA[b] ?? ''; }
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** The menu asking what to do is not a thing that happened. */
const PROMPT = /^What will\b.*\bdo\?$/;
/** What the move menu's windows leave in the buffer after it closes (gBrBattle.menu is already 0):
 *  the PP label and count, and the move's type with its numbers. A line of the story is never
 *  only one of these. */
const UI_LINE = /^(PP|-|\d+\/\d+|(NORMAL|FIGHT|FLYING|POISON|GROUND|ROCK|BUG|GHOST|STEEL|\?\?\?|FIRE|WATER|GRASS|ELECTR|PSYCHC|ICE|DRAGON|DARK)\b[ ./\d]*)$/;
const M_NICKNAME = 0x30;

// ---- a mon ---------------------------------------------------------------------------------

/** The log's `status`: the ROM's status1 as gBattleMons holds it, its low byte -- sleep's turns in
 *  bits 0-2, poison 0x08, burn 0x10, freeze 0x20, paralysis 0x40, toxic 0x80 (the toxic counter
 *  above it is left out). */
export function statusOf(status1: number): number {
  return status1 & 0xff;
}

/** Which status it is, not how long: sleep's counter ticks down every turn, and a turn is not a
 *  change of status. A `status` event is said when this changes, with the raw value. */
export function statusKind(status: number): number {
  return (status & 7 ? 1 : 0) | (status & 0xf8);
}

interface Field {
  species: number;
  hp: number;
  maxHp: number;
  level: number;
  status: number;
  personality: number;
  slot: number;
}

const sameField = (a: Field | null, b: Field | null): boolean =>
  a === b || (!!a && !!b && a.species === b.species && a.hp === b.hp && a.maxHp === b.maxHp && a.status === b.status && a.personality === b.personality && a.slot === b.slot && a.level === b.level);

/** A party as it sits in memory, as the teams of a `start`: the slots that hold a mon. */
export function logTeam(party: Uint8Array, genderOf?: ReaderCtx['genderOf']): LogMon[] {
  const v = new DataView(party.buffer, party.byteOffset, party.byteLength);
  const out: LogMon[] = [];
  for (const m of teamMembers(party, 6, () => '')) {
    out.push({ species: m.species, level: m.level, hp: m.hp, maxHp: m.maxHp, status: statusOf(m.status), ...(m.name ? { nickname: m.name.slice(0, 10) } : {}) });
  }
  // Shininess and the real slot of each mon, from the raw party (empty slots skipped alike).
  let n = 0;
  for (let i = 0; i < 6 && n < out.length; i++) {
    const at = i * 100;
    const personality = v.getUint32(at, true), otId = v.getUint32(at + 4, true);
    if (!personality && !otId) continue;
    if (((otId >>> 16) ^ (otId & 0xffff) ^ (personality >>> 16) ^ (personality & 0xffff)) < 8) out[n].shiny = true;
    if (genderOf) out[n].gender = genderOf(out[n].species, personality);
    n++;
  }
  return out;
}

// ---- the reader --------------------------------------------------------------------------------

/** A line of the box's bytes, up to its terminator. */
class Line {
  n = 0;
  readonly b = new Uint8Array(TEXT_READ);
  copy(o: Line): void { this.n = o.n; this.b.set(o.b.subarray(0, o.n)); }
  equals(o: Line): boolean {
    if (this.n !== o.n) return false;
    for (let i = 0; i < this.n; i++) if (this.b[i] !== o.b[i]) return false;
    return true;
  }
}

export class BattleReader {
  readonly stats: ReaderStats = { frames: 0, ms: 0, maxMs: 0 };
  /** The events said so far (what a watcher folds to the state now). */
  readonly said: BattleEvent[] = [];
  private frames = 0;
  private started = false;
  private over = false;
  private broken = false;
  private foeSeenAt = -1;
  private waitedForParty = 0;
  private party: { me: Uint8Array | null; foe: Uint8Array | null } = { me: null, foe: null };
  private teams: [LogMon[], LogMon[]] = [[], []];
  /** What a watcher believes of each side's mon on the field. */
  private shown: [Field | null, Field | null] = [null, null];
  private cand: [Field | null, Field | null] = [null, null];
  /** The line the box last held, as believed (`seen`), and as read on the last frame (`cand`). */
  private seenText = new Line();
  private candText = new Line();
  private pending: BattleEvent[] = [];
  private sinceFlush = 0;
  private local = 0;
  private readonly scratch = new Line();

  constructor(
    private readonly mem: Mem,
    private readonly sym: ReaderSyms,
    private readonly ctx: ReaderCtx,
    private readonly emit: (events: BattleEvent[]) => void,
    /** Read the clock, for stats (performance.now in a page). */
    private readonly now: () => number = () => 0,
  ) {
    // Whatever line the box last held is not this fight's.
    this.readText(this.seenText);
    this.candText.copy(this.seenText);
  }

  /** Has `start` been said. */
  get running(): boolean { return this.started && !this.over; }

  /** One frame. Never throws: a reader that goes wrong stops, and the fight goes on. */
  frame(): void {
    if (this.over || this.broken) return;
    const t0 = this.now();
    try {
      this.frames++;
      if (!this.started) this.tryStart();
      else this.poll();
      if (this.pending.length && ++this.sinceFlush >= FLUSH_FRAMES) this.flush();
    } catch (e) {
      this.broken = true;
      console.warn('spike: the battle reader stopped', e);
    }
    const ms = this.now() - t0;
    this.stats.frames++;
    this.stats.ms += ms;
    if (ms > this.stats.maxMs) this.stats.maxMs = ms;
  }

  /** The fight is over; `winner` is a seat (0: nobody). Flushes everything left. Nothing, if the
   *  fight never got going. */
  finish(winner: number): void {
    if (this.over) return;
    if (this.started) this.say({ e: 'end', winner });
    this.over = true;
    this.flush();
  }

  // ---- reading ---------------------------------------------------------------------------

  private say(ev: BattleEvent): void {
    this.said.push(ev);
    this.pending.push(ev);
    if (ev.e === 'start') this.flush();
  }

  private flush(): void {
    this.sinceFlush = 0;
    if (!this.pending.length) return;
    const events = this.pending;
    this.pending = [];
    this.emit(events);
  }

  private readText(into: Line): void {
    const raw = this.mem.bytes(this.sym.text, TEXT_READ);
    let n = 0;
    while (n < raw.length && raw[n] !== TERMINATOR) n++;
    into.n = n;
    into.b.set(raw.subarray(0, n));
  }

  /** The local battler: whoever stands at PLAYER_LEFT (a link battle's second player is 1). */
  private localBattler(): number {
    const at = this.sym.positions;
    if (!present(at)) return 0;
    for (let i = 0; i < 4; i++) if (this.mem.read(at + i, 8) === POSITION_PLAYER_LEFT) return i;
    return 0;
  }

  private fieldOf(battler: number, view: DataView): Field | null {
    const o = battler * MON_SIZE;
    const species = view.getUint16(o + M_SPECIES, true);
    if (!species) return null;
    return {
      species,
      hp: view.getUint16(o + M_HP, true),
      maxHp: view.getUint16(o + M_MAX_HP, true),
      level: view.getUint8(o + M_LEVEL),
      status: statusOf(view.getUint32(o + M_STATUS1, true)),
      personality: view.getUint32(o + M_PERSONALITY, true),
      slot: this.mem.read(this.sym.partyIdx + battler * 2, 16),
    };
  }

  private readFields(): [Field | null, Field | null] {
    const raw = this.mem.bytes(this.sym.mons, MON_SIZE * 2);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    return [this.fieldOf(this.local, view), this.fieldOf(this.local ^ 1, view)];
  }

  /** The party at `at`, once whole and still; null while it is not. */
  private readParty(at: number, which: 'me' | 'foe'): Uint8Array | null {
    const now = this.mem.bytes(at, PARTY_LEN).slice();
    const was = this.party[which];
    this.party[which] = now;
    if (!was || !partyWhole(now, 6)) return null;
    return now.every((b, i) => b === was[i]) ? now : null;
  }

  private tryStart(): void {
    const s = this.sym;
    if (present(s.mainFunc) && this.mem.read(s.mainFunc, 32) === 0) return;
    if (present(s.count) && this.mem.read(s.count, 8) < 2) return;
    this.local = this.localBattler();
    const [mine, foe] = this.readFields();
    if (!foe) { this.foeSeenAt = -1; return; }
    if (this.foeSeenAt < 0) this.foeSeenAt = this.frames;
    const safari = present(s.flags) && (this.mem.read(s.flags, 32) & BATTLE_TYPE_SAFARI) !== 0;
    // The player's side may have nobody out (the Safari): so, after a while, it is believed.
    if (!mine && !safari && this.frames - this.foeSeenAt < WAIT_FOR_ME) return;
    // Both mons believed: the same on two frames.
    const first = this.cand[0] === null && this.cand[1] === null;
    const stable = sameField(this.cand[0], mine) && sameField(this.cand[1], foe);
    this.cand = [mine, foe];
    if (first || !stable) return;
    // The teams: read once whole and settled, or as they are after a while.
    const me = this.readParty(s.player, 'me'), fo = this.readParty(s.enemy, 'foe');
    if ((!me || !fo) && ++this.waitedForParty < WAIT_FOR_PARTY) return;
    this.teams = [logTeam(me ?? this.party.me!, this.ctx.genderOf), logTeam(fo ?? this.party.foe!, this.ctx.genderOf)];
    // What a watcher believes of a mon on the field starts as its team entry.
    const side = (x: ReaderCtx['me'], team: LogMon[]): LogSide => ({ seat: x.seat, name: x.name, skin: x.skin, team });
    this.started = true;
    this.say({ e: 'start', a: side(this.ctx.me, structuredClone(this.teams[0])), b: side(this.ctx.foe, structuredClone(this.teams[1])), map: this.ctx.map });
    this.poll();
  }

  private poll(): void {
    const fields = this.readFields();
    // State first (the damage lands before the line that tells of it), then the text.
    for (const side of [0, 1] as Side[]) {
      const f = fields[side];
      if (!sameField(this.cand[side], f)) { this.cand[side] = f; continue; }
      if (!sameField(this.shown[side], f)) this.apply(side, f);
    }
    // The line, believed once it reads the same on two frames.
    const now = this.scratch;
    this.readText(now);
    if (!now.equals(this.candText)) { this.candText.copy(now); return; }
    if (!now.equals(this.seenText)) {
      this.seenText.copy(now);
      // What a menu's windows print into the same buffer is not a line of the box.
      if (present(this.sym.menu) && this.mem.read(this.sym.menu, 8) !== 0) return;
      const line = battleText(now.b.subarray(0, now.n));
      if (line && !PROMPT.test(line) && !UI_LINE.test(line) && !this.isName(line)) this.say({ e: 'text', text: line });
    }
  }

  /** What a watcher believes of `side`'s mon, which is `f` in the ROM now. */
  private apply(side: Side, f: Field | null): void {
    const was = this.shown[side];
    this.shown[side] = f;
    if (!f) return; // the mon left the field's memory: a switch says so by the next one coming
    const team = this.teams[side];
    // Which mon it is, by personality: gBattlerPartyIndexes and gBattleMons are not updated on the
    // same frame when one comes in, so for a frame or two the new slot can hold the old mon's data
    // (and the other way round). Only a different mon is a send-out; its slot is the one whose
    // species it is, whatever the index said when the data changed.
    const same = !!was && was.personality === f.personality && was.species === f.species;
    const slot = team[f.slot]?.species === f.species ? f.slot : Math.max(0, team.findIndex((m) => m.species === f.species));
    const known = team[slot];
    if (!same) {
      // Called back, unless it was already down.
      if (was && was.hp > 0 && this.stillOn(side)) this.say({ e: 'back', side });
      this.say({ e: 'send', side, slot });
      if (known) {
        // The log's copy of this mon has what the watcher folded so far: say what differs.
        if (f.hp !== known.hp) this.say({ e: 'hp', side, hp: f.hp });
        if (statusKind(f.status) !== statusKind(known.status)) this.say({ e: 'status', side, status: f.status });
      }
      if (known) { known.hp = f.hp; known.status = f.status; }
      if (f.hp === 0) this.say({ e: 'faint', side });
      return;
    }
    if (known && f.hp !== known.hp) {
      if (f.hp < known.hp) this.say({ e: 'hit', side, ...(this.moveNow() ? { move: this.moveNow() } : {}) });
      this.say({ e: 'hp', side, hp: f.hp });
      known.hp = f.hp;
      if (f.hp === 0) this.say({ e: 'faint', side });
    }
    if (known && statusKind(f.status) !== statusKind(known.status)) this.say({ e: 'status', side, status: f.status });
    if (known) known.status = f.status;
  }

  /** The side's last said event was not a faint or a back: its mon is on the field to be called back. */
  private stillOn(side: Side): boolean {
    for (let i = this.said.length - 1; i >= 0; i--) {
      const ev = this.said[i];
      if ('side' in ev && ev.side === side) return ev.e !== 'faint' && ev.e !== 'back';
    }
    return true;
  }

  /** A healthbox's name (and gender mark) is printed through the same buffer: not a line of the box. */
  private isName(line: string): boolean {
    for (const b of [this.local, this.local ^ 1]) {
      const raw = this.mem.bytes(this.sym.mons + b * MON_SIZE + M_NICKNAME, 11);
      let n = 0;
      while (n < raw.length && raw[n] !== TERMINATOR) n++;
      const nick = battleText(raw.subarray(0, n));
      if (nick && (line === nick || line === `${nick}♀` || line === `${nick}♂`)) return true;
    }
    return false;
  }

  private moveNow(): number {
    const at = this.sym.move;
    return present(at) ? this.mem.read(at, 16) : 0;
  }
}
