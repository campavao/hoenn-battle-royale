// The battle reader on a fake memory: a Gen 3 party with its encryption and checksums, the two
// BattlePokemon the battle keeps, and the line the box holds.
import { describe, expect, it } from 'vitest';
import { encodeGen3 } from '../src/text/gen3';
import { BattleReader, battleText, statusKind, statusOf, type Mem, type ReaderSyms } from './battlereader';
import { applyEvent, emptyState, type BattleEvent } from './shared/battlelog';

const BASE = 0x02000000;
const SYM: Required<ReaderSyms> = {
  mons: BASE + 0x1000, partyIdx: BASE + 0x1200, text: BASE + 0x1400, player: BASE + 0x2000, enemy: BASE + 0x3000,
  count: BASE + 0x1210, mainFunc: BASE + 0x1220, flags: BASE + 0x1230, positions: BASE + 0x1240, move: BASE + 0x1250, menu: BASE + 0x1260,
};

class Fake implements Mem {
  readonly ram = new Uint8Array(0x8000);
  read(addr: number, bits: 8 | 16 | 32): number {
    const o = addr - BASE;
    let v = 0;
    for (let i = bits / 8 - 1; i >= 0; i--) v = (v << 8) | this.ram[o + i];
    return v >>> 0;
  }
  bytes(addr: number, len: number): Uint8Array { return this.ram.subarray(addr - BASE, addr - BASE + len); }
  w(addr: number, v: number, bits: 8 | 16 | 32): void { for (let i = 0; i < bits / 8; i++) this.ram[addr - BASE + i] = (v >>> (8 * i)) & 0xff; }
}

const ORDERS = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG'];

interface M { species: number; level: number; hp: number; maxHp: number; status?: number; personality: number; nick?: string }

/** A mon as struct Pokemon keeps it: the 48 bytes of substructures XORed with personality ^ otId. */
function putParty(f: Fake, at: number, mons: M[], opts: { tear?: number } = {}): void {
  f.ram.fill(0, at - BASE, at - BASE + 600);
  mons.forEach((m, i) => {
    const o = at - BASE + i * 100;
    const v = new DataView(f.ram.buffer, o, 100);
    const otId = 0x12345678;
    v.setUint32(0, m.personality, true);
    v.setUint32(4, otId, true);
    if (m.nick) f.ram.set([...encodeGen3(m.nick), 0xff], o + 8);
    const plain = new DataView(new ArrayBuffer(48));
    plain.setUint16(12 * ORDERS[m.personality % 24].indexOf('G'), m.species, true);
    let sum = 0;
    for (let h = 0; h < 24; h++) sum = (sum + plain.getUint16(h * 2, true)) & 0xffff;
    v.setUint16(28, sum, true);
    const key = (m.personality ^ otId) >>> 0;
    for (let w = 0; w < 12; w++) v.setUint32(32 + w * 4, (plain.getUint32(w * 4, true) ^ key) >>> 0, true);
    v.setUint32(80, m.status ?? 0, true);
    v.setUint8(84, m.level);
    v.setUint16(86, m.hp, true);
    v.setUint16(88, m.maxHp, true);
  });
  if (opts.tear !== undefined) f.ram[at - BASE + 32 + opts.tear] ^= 0x5a; // a block caught halfway
}

function putMon(f: Fake, battler: number, m: M | null, slot: number): void {
  const o = SYM.mons - BASE + battler * 0x58;
  f.ram.fill(0, o, o + 0x58);
  f.w(SYM.partyIdx + battler * 2, slot, 16);
  if (!m) return;
  f.w(SYM.mons + battler * 0x58 + 0x00, m.species, 16);
  f.w(SYM.mons + battler * 0x58 + 0x28, m.hp, 16);
  f.w(SYM.mons + battler * 0x58 + 0x2a, m.level, 8);
  f.w(SYM.mons + battler * 0x58 + 0x2c, m.maxHp, 16);
  f.w(SYM.mons + battler * 0x58 + 0x48, m.personality, 32);
  f.w(SYM.mons + battler * 0x58 + 0x4c, m.status ?? 0, 32);
}

function say(f: Fake, text: string): void {
  f.ram.fill(0xff, SYM.text - BASE, SYM.text - BASE + 300);
  f.ram.set([...encodeGen3(text)], SYM.text - BASE);
  f.ram[SYM.text - BASE + text.length] = 0xff;
}

const mine: M[] = [
  { species: 280, level: 12, hp: 31, maxHp: 31, personality: 1000, nick: 'RALTS' },
  { species: 263, level: 10, hp: 28, maxHp: 28, personality: 2001 },
];
const theirs: M[] = [
  { species: 261, level: 9, hp: 24, maxHp: 24, personality: 3000 },
  { species: 304, level: 9, hp: 30, maxHp: 30, personality: 4003, status: 0x40 },
];
const CTX = { me: { seat: 1001, name: 'CAM', skin: 3 }, foe: { seat: 7, name: 'YOUNGSTER', skin: 9 }, map: 'MAP_ROUTE101', genderOf: (species: number, personality: number) => (species === 261 ? 2 : personality % 2) };

function rig() {
  const f = new Fake();
  const out: BattleEvent[][] = [];
  const r = new BattleReader(f, SYM, CTX, (evs) => out.push(evs));
  putParty(f, SYM.player, mine);
  putParty(f, SYM.enemy, theirs);
  f.w(SYM.count, 2, 8);
  const run = (n: number) => { for (let i = 0; i < n; i++) r.frame(); };
  /** Everything said so far, flushed or not. */
  const all = () => r.said;
  return { f, r, out, run, all };
}

describe('battleText', () => {
  it('reads a line as the box shows it, control codes and new lines gone', () => {
    const bytes = [...encodeGen3('Foe GLOOM used'), 0xfe, ...encodeGen3('TOXIC!'), 0xfc, 0x06, 0x01, 0xfb, ...encodeGen3('Ok'), 0xff, 0xd5];
    expect(battleText(bytes)).toBe('Foe GLOOM used TOXIC! Ok');
    // POKéMON: the e is 0x1B, which the wire charmap lacks.
    expect(battleText([0xca, 0xc9, 0xc5, 0x1b, 0xc7, 0xc9, 0xc8, 0xff])).toBe('POKéMON');
  });
  it("says the ROM's status1 low byte as it is, and tells one status from the next by kind", () => {
    expect(statusOf(0)).toBe(0);
    expect(statusOf(0x1248)).toBe(0x48);
    expect(statusOf(3)).toBe(3);
    // Sleep's turns tick down; that is not a change of status.
    expect(statusKind(3)).toBe(statusKind(1));
    expect(statusKind(0)).not.toBe(statusKind(1));
    expect(statusKind(0x48)).not.toBe(statusKind(0x08));
  });
});

describe('BattleReader', () => {
  it('says nothing before the battle runs, then the start, the sends and the lines', () => {
    const { f, run, all } = rig();
    run(5);
    expect(all()).toEqual([]);
    f.w(SYM.mainFunc, 0x08001234, 32);
    putMon(f, 0, mine[0], 0);
    putMon(f, 1, theirs[0], 0);
    run(3);
    const ev = all();
    expect(ev[0]).toMatchObject({ e: 'start', map: 'MAP_ROUTE101', a: { seat: 1001, name: 'CAM', skin: 3 }, b: { seat: 7, name: 'YOUNGSTER' } });
    const s = ev[0] as Extract<BattleEvent, { e: 'start' }>;
    expect(s.a.team.map((m) => [m.species, m.level, m.hp, m.maxHp])).toEqual([[280, 12, 31, 31], [263, 10, 28, 28]]);
    expect(s.a.team[0].nickname).toBe('RALTS');
    // gender, from the species and personality; a shiny one says so.
    expect(s.a.team.map((m) => m.gender)).toEqual([0, 1]);
    expect(s.b.team.map((m) => m.gender)).toEqual([2, 1]);
    expect(s.b.team.map((m) => [m.species, m.status])).toEqual([[261, 0], [304, 0x40]]);
    expect(ev.slice(1)).toEqual([{ e: 'send', side: 0, slot: 0 }, { e: 'send', side: 1, slot: 0 }]);
    say(f, 'Wild ZIGZAGOON appeared!');
    run(3);
    say(f, 'What will RALTS do?');
    run(3);
    say(f, 'Foe ZIGZAGOON used TACKLE!');
    run(3);
    expect(all().slice(3)).toEqual([{ e: 'text', text: 'Wild ZIGZAGOON appeared!' }, { e: 'text', text: 'Foe ZIGZAGOON used TACKLE!' }]);
  });

  it("leaves out what a menu's windows print and the prompt, even with no name in it", () => {
    const { f, run, all } = rig();
    f.w(SYM.mainFunc, 1, 32);
    putMon(f, 0, mine[0], 0);
    putMon(f, 1, theirs[0], 0);
    run(4);
    const n = all().length;
    say(f, 'What will  do?');
    run(3);
    f.w(SYM.menu, 2, 8);
    say(f, 'PP');
    run(3);
    say(f, 'NORMAL/');
    run(3);
    f.w(SYM.menu, 0, 8);
    say(f, 'RALTS used GROWL!');
    run(3);
    expect(all().slice(n)).toEqual([{ e: 'text', text: 'RALTS used GROWL!' }]);
  });

  it('leaves out the healthboxes\' names and the move menu\'s tail, and keeps the story', () => {
    const { f, run, all } = rig();
    f.w(SYM.mainFunc, 1, 32);
    putMon(f, 0, mine[0], 0);
    putMon(f, 1, theirs[0], 0);
    f.ram.set([...encodeGen3('ZIGZAGOON'), 0xff], SYM.mons - BASE + 0x58 + 0x30);
    f.ram.set([...encodeGen3('RALTS'), 0xff], SYM.mons - BASE + 0x30);
    run(4);
    const n = all().length;
    for (const t of ['ZIGZAGOON', 'RALTS', 'PP', '-', '12/25', 'NORMAL', 'Foe ZIGZAGOON used TACKLE!']) { say(f, t); run(3); }
    expect(all().slice(n)).toEqual([{ e: 'text', text: 'Foe ZIGZAGOON used TACKLE!' }]);
  });

  it('turns HP into a hit and an hp, a faint into a faint, and the next mon into a send', () => {
    const { f, run, all } = rig();
    f.w(SYM.mainFunc, 1, 32);
    putMon(f, 0, mine[0], 0);
    putMon(f, 1, theirs[0], 0);
    run(4);
    const n = all().length;
    f.w(SYM.move, 33, 16);
    putMon(f, 0, { ...mine[0], hp: 20 }, 0);
    run(3);
    expect(all().slice(n)).toEqual([{ e: 'hit', side: 0, move: 33 }, { e: 'hp', side: 0, hp: 20 }]);
    putMon(f, 1, { ...theirs[0], hp: 0 }, 0);
    run(3);
    expect(all().slice(n + 2)).toEqual([{ e: 'hit', side: 1, move: 33 }, { e: 'hp', side: 1, hp: 0 }, { e: 'faint', side: 1 }]);
    // It stays fainted in memory until the next one comes in: nothing more said.
    run(5);
    expect(all()).toHaveLength(n + 5);
    putMon(f, 1, theirs[1], 1);
    run(3);
    expect(all().slice(n + 5)).toEqual([{ e: 'send', side: 1, slot: 1 }]);
  });

  it("says a status as the ROM holds it, and not again while only sleep's counter ticks", () => {
    const { f, run, all } = rig();
    f.w(SYM.mainFunc, 1, 32);
    putMon(f, 0, mine[0], 0);
    putMon(f, 1, theirs[0], 0);
    run(4);
    const n = all().length;
    for (const s of [3, 2, 1, 0]) { putMon(f, 0, { ...mine[0], status: s }, 0); run(3); }
    expect(all().slice(n), 'asleep for three turns, then awake').toEqual([{ e: 'status', side: 0, status: 3 }, { e: 'status', side: 0, status: 0 }]);
  });

  it('says one send-out when the party index moves a few frames before the mon does', () => {
    const { f, run, all } = rig();
    f.w(SYM.mainFunc, 1, 32);
    putMon(f, 0, mine[0], 0);
    putMon(f, 1, theirs[0], 0);
    run(4);
    putMon(f, 1, { ...theirs[0], hp: 0 }, 0);
    run(3);
    const n = all().length;
    f.w(SYM.partyIdx + 2, 1, 16); // the slot is the new one's, the data still the fainted mon's
    run(4);
    putMon(f, 1, theirs[1], 1);
    run(4);
    expect(all().slice(n)).toEqual([{ e: 'send', side: 1, slot: 1 }]);
  });

  it('calls a mon back when it is switched out alive, and says a new status', () => {
    const { f, run, all } = rig();
    f.w(SYM.mainFunc, 1, 32);
    putMon(f, 0, mine[0], 0);
    putMon(f, 1, theirs[0], 0);
    run(4);
    const n = all().length;
    putMon(f, 0, { ...mine[0], status: 0x10 }, 0);
    run(3);
    putMon(f, 0, mine[1], 1);
    run(3);
    expect(all().slice(n)).toEqual([{ e: 'status', side: 0, status: 0x10 }, { e: 'back', side: 0 }, { e: 'send', side: 0, slot: 1 }]);
  });

  it('believes a line or a mon only once it reads the same twice (a frame can end mid-write)', () => {
    const { f, run, all } = rig();
    f.w(SYM.mainFunc, 1, 32);
    putMon(f, 0, mine[0], 0);
    putMon(f, 1, theirs[0], 0);
    run(4);
    const n = all().length;
    // A line half written for one frame, a mon with its HP half copied for one frame.
    say(f, 'Foe ZIGZAGO');
    putMon(f, 0, { ...mine[0], hp: 9999 }, 0);
    run(1);
    say(f, 'Foe ZIGZAGOON used TACKLE!');
    putMon(f, 0, { ...mine[0], hp: 25 }, 0);
    run(3);
    expect(all().slice(n)).toEqual([{ e: 'hit', side: 0 }, { e: 'hp', side: 0, hp: 25 }, { e: 'text', text: 'Foe ZIGZAGOON used TACKLE!' }]);
  });

  it('waits for a party the ROM is halfway through writing', () => {
    const { f, run, all } = rig();
    f.w(SYM.mainFunc, 1, 32);
    putMon(f, 0, mine[0], 0);
    putMon(f, 1, theirs[0], 0);
    putParty(f, SYM.player, mine, { tear: 3 });
    run(30);
    expect(all(), 'a mon whose checksum does not add up is not read').toEqual([]);
    putParty(f, SYM.player, mine);
    run(4);
    expect(all()[0].e).toBe('start');
  });

  it('starts a Safari battle with nobody on the player side, and ends it with the winner it is given', () => {
    const { f, r, run, all } = rig();
    f.w(SYM.mainFunc, 1, 32);
    f.w(SYM.flags, 1 << 7, 32);
    putParty(f, SYM.player, []);
    putMon(f, 0, null, 0);
    putMon(f, 1, theirs[0], 0);
    run(5);
    expect(all()[0]).toMatchObject({ e: 'start', a: { team: [] } });
    expect(all().slice(1)).toEqual([{ e: 'send', side: 1, slot: 0 }]);
    r.finish(1001);
    expect(all().at(-1)).toEqual({ e: 'end', winner: 1001 });
  });

  it('finish before the fight ever got going says nothing; frames after it say nothing', () => {
    const { r, run, all } = rig();
    run(3);
    r.finish(0);
    run(3);
    expect(all()).toEqual([]);
  });

  it('folded with applyEvent, the log ends where the memory is', () => {
    const { f, r, run, all } = rig();
    f.w(SYM.mainFunc, 1, 32);
    putMon(f, 0, mine[0], 0);
    putMon(f, 1, theirs[0], 0);
    run(4);
    for (const [hp0, hp1] of [[31, 10], [20, 0]]) {
      putMon(f, 0, { ...mine[0], hp: hp0 }, 0);
      putMon(f, 1, { ...theirs[0], hp: hp1 }, 0);
      say(f, `Turn ${hp0}`);
      run(4);
    }
    putMon(f, 1, theirs[1], 1);
    run(3);
    r.finish(1001);
    const s = emptyState();
    for (const ev of all()) applyEvent(s, ev);
    expect(s.a!.team[0].hp).toBe(20);
    expect(s.b!.team[0].hp).toBe(0);
    expect(s.b!.team[1].hp).toBe(30);
    expect(s.active).toEqual([0, 1]);
    expect(s.text).toBe('Turn 20');
    expect(s.winner).toBe(1001);
  });

  it('batches: the start at once, the rest a third of a second at a time, the end at once', () => {
    const { f, r, out, run } = rig();
    f.w(SYM.mainFunc, 1, 32);
    putMon(f, 0, mine[0], 0);
    putMon(f, 1, theirs[0], 0);
    run(4);
    expect(out).toHaveLength(1); // the start alone
    say(f, 'Line one');
    run(3);
    say(f, 'Line two');
    run(3);
    expect(out.length, 'held until the third of a second is up').toBe(1);
    run(20);
    expect(out).toHaveLength(2);
    expect(out[1].map((e) => e.e)).toEqual(['send', 'send', 'text', 'text']);
    r.finish(0);
    expect(out.at(-1)).toEqual([{ e: 'end', winner: 0 }]);
  });
});
