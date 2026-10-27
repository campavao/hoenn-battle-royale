// Spike B's battles: the real ROM, asked to fight and nothing else.
//
// The page owns the overworld; this ROM stands parked in Littleroot behind it, hidden.
// A fight is the path a bot fight already takes (br_bot.c, the bot-fight driver): a
// TRAINER card puts the other side's party in gEnemyParty, a PLACE puts their ghost on
// our map, and a CHALLENGE starts an ordinary trainer battle. When the ROM is back on
// the field the fight is over, and the page takes the screen back.
//
// The ROM is the player's own, patched the way the game patches it (loadRom). In dev,
// web/public/spike-rom/ (gitignored, never committed) can stand in for it.

import { Emulator, type GbaKey } from '../src/emu';
import { Mailbox, MAILBOX } from '../src/net/mailbox';
import { packSlot } from '../src/net/slots';
import { PROTOCOL, type PackedMon } from '../src/net/wire';
import { loadCheckedRelease } from '../src/release';
import type { PatchWorkerRequest, PatchWorkerResponse } from '../src/patch/bps.worker';

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

export interface RomFiles { emu: Emulator; rom: Uint8Array; sym: (name: string) => number }

/** The player's ROM, patched, and its build's symbols. Dev: web/public/spike-rom/ when it
 *  is there. Otherwise the game's own way: the ROM the player picked on the main page
 *  (stored in this browser) with the published patch applied and checked. */
export async function loadRom(canvas: HTMLCanvasElement, say: (text: string) => void): Promise<RomFiles> {
  const emu = await Emulator.create(canvas);
  const dev = !import.meta.env.DEV ? null : await fetch('/spike-rom/br-symbols.json').then((r) => (r.ok && !r.headers.get('content-type')?.includes('html') ? r.json() : null), () => null) as Record<string, string> | null;
  if (dev) {
    const rom = new Uint8Array(await (await fetch('/spike-rom/rom.gba')).arrayBuffer());
    return { emu, rom, sym: (n) => Number(dev[n]) };
  }
  if (!emu.hasRom()) {
    say('Pick your ROM on the game page first (it stays in this browser), then come back here.');
    throw new Error('no ROM stored');
  }
  say('Applying the patch to your ROM…');
  const release = await loadCheckedRelease((patch) => applyPatch(emu.readRom(), patch));
  if (release.status !== 'ready') {
    say(`No patch published: ${release.reason}`);
    throw new Error(release.reason);
  }
  const symbols = release.symbols;
  return { emu, rom: release.rom, sym: (n) => symbols.get(n) ?? NaN };
}

function applyPatch(source: Uint8Array, patch: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../src/patch/bps.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<PatchWorkerResponse>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'patch worker crashed'));
    };
    const request: PatchWorkerRequest = { source, patch };
    worker.postMessage(request, [source.buffer, patch.buffer]);
  });
}

export async function bootRom({ emu, rom, sym }: RomFiles): Promise<RomBattles> {
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
