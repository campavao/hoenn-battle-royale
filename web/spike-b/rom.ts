// Spike B's battles: the real ROM, asked to fight and nothing else.
//
// The page owns the overworld; this ROM stands parked in Littleroot behind it, hidden.
// A fight is the path a bot fight already takes (br_bot.c, the bot-fight driver): a
// TRAINER card puts the other side's party in gEnemyParty, a PLACE puts their ghost on
// our map, and a CHALLENGE starts an ordinary trainer battle. When the ROM is back on
// the field the fight is over, and the page takes the screen back.
//
// Dev only: the ROM and its symbols come from web/public/spike-rom/ (gitignored, never
// committed), written by `make modern` + tools/br/symbols.py.

import { Emulator, type GbaKey } from '../src/emu';
import { Mailbox, MAILBOX } from '../src/net/mailbox';
import { packSlot } from '../src/net/slots';
import { PROTOCOL, type PackedMon } from '../src/net/wire';

const BOOT_MAP_TESTMON = 0x81;
const ME = 0;
const FOE_SEAT = 31;
/** How long the last fight took to start: from the TRAINER card to the battle running. */
export let lastStart: { ms: number; frames: number } | null = null;

export interface RomBattles {
  /** Fight `name`'s party. Resolves when the ROM is back on the field. */
  fight(name: string, mons: PackedMon[]): Promise<void>;
  press(k: GbaKey): void;
  release(k: GbaKey): void;
  emu: Emulator;
}

function gen3(text: string): number[] {
  // A..Z, 0..9 and space: enough for a name card.
  const out: number[] = [];
  for (const ch of text.toUpperCase()) {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) out.push(0xbb + c - 65);
    else if (c >= 48 && c <= 57) out.push(0xa1 + c - 48);
    else out.push(0x00);
  }
  return out;
}

/** The player's ROM and the build's symbols. In the spike both are dev files; the real
 *  page would take the ROM from IndexedDB with the patch applied, as the shell does now. */
export async function loadRom(): Promise<{ rom: Uint8Array; sym: (name: string) => number }> {
  const [rom, symbols] = await Promise.all([
    fetch('/spike-rom/rom.gba').then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
    fetch('/spike-rom/br-symbols.json').then((r) => r.json() as Promise<Record<string, string>>),
  ]);
  return { rom, sym: (n: string) => Number(symbols[n]) };
}

export async function bootRom(canvas: HTMLCanvasElement, rom: Uint8Array, sym: (name: string) => number): Promise<RomBattles> {
  const emu = await Emulator.create(canvas);
  await emu.startBytes(rom);
  const box = new Mailbox(emu, sym('gBrMailbox'));

  // Power-on, then the boot block: a fresh game in Littleroot (0,9) at 5,8 with a
  // level 5 Treecko, name "YOU".
  await frames(emu, 30);
  const boot = [BOOT_MAP_TESTMON, 0, 0, 9, 5, 0, 8, 0, ...gen3('YOU'), 0xff];
  emu.bytes(box.base + MAILBOX.OFF_BOOT, boot.length).set(boot);
  await frames(emu, 400);
  emu.write(sym('gBrMatch'), 2, 8); // mid-match: fights are allowed
  emu.pause();

  const fightAt = sym('gBrBotFight');
  return {
    emu,
    press: (k) => emu.press(k),
    release: (k) => emu.release(k),
    async fight(name, mons) {
      emu.resume();
      const send = (msg: Parameters<typeof packSlot>[0]) => {
        for (const s of packSlot(msg)) box.push(s.type, s.payload);
      };
      send({ t: 'trainer', seat: FOE_SEAT, name, mons });
      await frames(emu, 10);
      send({ t: 'place', v: PROTOCOL, seat: FOE_SEAT, map: { group: 0, num: 9 }, x: 20, y: 8, f: 1, st: 'alive' });
      send({ t: 'challenge', seat: FOE_SEAT, opponent: ME, nonce: 0 });
      // In, then out: the bot fight's own running flag.
      const t0 = performance.now();
      let n = 0;
      const count = emu.onFrame(() => { n++; });
      await until(emu, () => emu.read(fightAt + 2, 8) === 1, 600);
      count();
      lastStart = { ms: performance.now() - t0, frames: n };
      await until(emu, () => emu.read(fightAt + 2, 8) === 0, 60 * 60 * 10);
      await frames(emu, 30);
      emu.pause();
    },
  };
}

function frames(emu: Emulator, n: number): Promise<void> {
  return new Promise((done) => {
    let left = n;
    const off = emu.onFrame(() => {
      if (--left <= 0) { off(); done(); }
    });
  });
}

function until(emu: Emulator, ok: () => boolean, max: number): Promise<boolean> {
  return new Promise((done) => {
    let left = max;
    const off = emu.onFrame(() => {
      if (ok()) { off(); done(true); }
      else if (--left <= 0) { off(); done(false); }
    });
  });
}
