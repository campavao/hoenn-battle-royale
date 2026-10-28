// Spike B's battles: the real ROM, asked to fight and nothing else.
//
// The page owns the overworld; this ROM stands parked in Littleroot behind it, hidden.
// A fight is the path a bot fight already takes (br_bot.c, the bot-fight driver): a
// TRAINER card puts the other side's party in gEnemyParty, a PLACE puts their ghost on
// our map, and a CHALLENGE starts an ordinary trainer battle. A wild battle is asked for
// in gBrWildAsk (br_wild.h): the map the page's marked spot is on, and the ROM rolls it
// from that map's own table. When the ROM is back on the field the battle is over, the
// page takes the screen back, and the ROM is put back where it was parked -- with the
// party and the bag the battle left (a catch, a used POTION, a level), so the trainer's
// team is theirs from battle to battle (carry.ts).
//
// The ROM is the player's own, patched the way the game patches it (loadRom). In dev,
// web/public/spike-rom/ (gitignored, never committed) can stand in for it.

import { Emulator, type GbaKey } from '../src/emu';
import { Mailbox, MAILBOX } from '../src/net/mailbox';
import { packSlot } from '../src/net/slots';
import { PROTOCOL, type PackedMon } from '../src/net/wire';
import { loadCheckedRelease } from '../src/release';
import { BAG_AT, BAG_LEN, DEX2_AT, DEX2_LEN, KEY_AT, PARTY_LEN, SEEN1_AT, SEEN2_AT, SEEN_LEN, arrived, rekey } from './carry';
import type { PatchWorkerRequest, PatchWorkerResponse } from '../src/patch/bps.worker';

const BOOT_MAP_TESTMON = 0x81;
const ME = 0;
const FOE_SEAT = 31;
// include/br/br_wild.h.
const WILD_ASKED = 1;
const WILD_FIGHTING = 2;
const WILD_DONE = 3;
// gBattleOutcome.
const LOST = 2;
// include/br/br_ring.h: BR_FOG_TICK_FRAMES.
const FOG_TICK = 240;
/** gBrRing's first ten bytes (active, phase, cx, cy, r, outside, applied, out,
 *  damageTimer): fog everywhere (r = 0xFF, -1), and no ring at all. */
const FOGGED = [1, 1, 0, 0, 0xff, 0, 0, 0, FOG_TICK & 0xff, FOG_TICK >> 8];
const CLEAR = [0, 0, 0, 0, 0, 0, 0, 0, FOG_TICK & 0xff, FOG_TICK >> 8];
const DREW = 3;
/** How long the last fight took to start: from the TRAINER card to the battle running. */
export let lastStart: { ms: number; frames: number } | null = null;

/** How a battle the page asked for went. `ok` false: the ROM never got into it (the page
 *  keeps the screen, and nothing showed). */
export interface Fought { ok: boolean; outcome: number; species: number; level: number }

export interface Given { items: { id: number; n: number }[]; money: number; used: boolean }

export interface RomBattles {
  /** Fight `name`'s party. Resolves when the ROM is back on the field. */
  fight(name: string, mons: PackedMon[], skin: number, onStart: () => void, fog?: boolean): Promise<Fought>;
  /** The wild battle a marked spot on map (group, num) starts; `behavior` is the spot's
   *  metatile behaviour (water or land, and the backdrop). */
  wild(group: number, num: number, behavior: number, onStart: () => void, fog?: boolean): Promise<Fought>;
  /** The fog's bite between battles (br_ring.c Bleed): a tenth of each mon's max HP, at
   *  least 1, a fainted one's status cleared. How many are still standing. */
  bleed(): Promise<number>;
  /** The ring closed on the trainer in the middle of a battle: from the next turn's end
   *  that battle is fought in the fog. Nothing between battles. */
  fogNow(): void;
  /** An item ball picked up: into the bag the ROM's own way (a match's GIVE, so a vitamin
   *  is used and a nugget sold as in a match). What went in, as the ROM filed it; `used`
   *  when it went on the team; null when it did not fit. */
  give(item: number, n: number): Promise<Given | null>;
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

export async function bootRom({ emu, rom, sym }: RomFiles, seed: number): Promise<RomBattles> {
  await emu.startBytes(rom);
  const box = new Mailbox(emu, sym('gBrMailbox'));

  // Power-on, then the boot block: a fresh game in Littleroot (0,9) at 5,8 with a
  // level 5 Treecko, name "YOU".
  await frames(emu, 30);
  const boot = [BOOT_MAP_TESTMON, 0, 0, 9, 5, 0, 8, 0, ...gen3('YOU'), 0xff];
  emu.bytes(box.base + MAILBOX.OFF_BOOT, boot.length).set(boot);
  await frames(emu, 400);
  const match = sym('gBrMatch');
  emu.write(match, 2, 8); // mid-match: fights are allowed
  // The page's match seed: the national stand-ins on the routes are this match's
  // (BrZone_NationalOn), as the spots the page deals are (bots/patches.ts).
  emu.write(match + 8, seed >>> 0, 32);
  await frames(emu, 2);
  // Parked: every battle starts from here and comes back to it. Whatever a battle leaves
  // on the hidden field -- a whiteout's walk home, a story flag -- is undone, so the next
  // one is never refused (review of #157). The party, the bag (prize money too) and the
  // Pokédex are carried (carry.ts).
  const parked = emu.snapshot();
  if (!parked) throw new Error('the core would not save a state');

  const fightAt = sym('gBrBotFight');
  const askAt = sym('gBrWildAsk');
  const mainFunc = sym('gBattleMainFunc');
  const outcomeAt = sym('gBattleOutcome');
  const catchAt = sym('gBrCatch');
  const ringAt = sym('gBrRing');
  const partyAt = sym('gPlayerParty');
  const countAt = sym('gPlayerPartyCount');
  const save1 = sym('gSaveBlock1Ptr');
  const save2 = sym('gSaveBlock2Ptr');
  /** The trainer's own: party, bag and Pokédex, copied out of the ROM, and back in. The
   *  save blocks move at every battle's start, so each is found through its pointer. */
  const kept = () => {
    const s1 = emu.read(save1, 32), s2 = emu.read(save2, 32);
    return {
      count: emu.read(countAt, 8),
      party: emu.bytes(partyAt, PARTY_LEN).slice(),
      bag: emu.bytes(s1 + BAG_AT, BAG_LEN).slice(),
      key: emu.read(s2 + KEY_AT, 32),
      dex: emu.bytes(s2 + DEX2_AT, DEX2_LEN).slice(),
      seen1: emu.bytes(s1 + SEEN1_AT, SEEN_LEN).slice(),
      seen2: emu.bytes(s1 + SEEN2_AT, SEEN_LEN).slice(),
    };
  };
  const keep = (k: ReturnType<typeof kept>) => {
    const s1 = emu.read(save1, 32), s2 = emu.read(save2, 32);
    emu.write(countAt, k.count, 8);
    emu.bytes(partyAt, PARTY_LEN).set(k.party);
    emu.bytes(s1 + BAG_AT, BAG_LEN).set(rekey(k.bag, k.key, emu.read(s2 + KEY_AT, 32)));
    emu.bytes(s2 + DEX2_AT, DEX2_LEN).set(k.dex);
    emu.bytes(s1 + SEEN1_AT, SEEN_LEN).set(k.seen1);
    emu.bytes(s1 + SEEN2_AT, SEEN_LEN).set(k.seen2);
  };
  const send = (msg: Parameters<typeof packSlot>[0]) => {
    for (const s of packSlot(msg)) box.push(s.type, s.payload);
  };

  /** One battle: `kick` asks for it, `going` says the ROM took it, `over` that it is back
   *  on the field. The page gets the screen at the battle's first frame (onStart) and
   *  never before, so the hidden field never shows through. */
  let broken = false;
  let fighting = false;
  let carried: ReturnType<typeof kept> | null = null;
  // One thing at a time on the ROM: a battle asked for while an item goes in waits for it.
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(f: () => Promise<T>): Promise<T> => {
    const run = queue.then(f, f);
    queue = run.catch(() => undefined);
    return run;
  };
  async function battle(fog: boolean, kick: () => void, going: () => boolean, over: () => boolean, onStart: () => void, after: () => Omit<Fought, 'ok'>): Promise<Fought> {
    if (broken) throw new Error('the parked ROM could not be restored');
    // Every battle from one state would roll the same: a fresh draw each time.
    emu.write(sym('gRngValue'), (Math.random() * 2 ** 32) >>> 0, 32);
    emu.write(mainFunc, 0, 32);
    // Fought in the fog (br_ring.h): a ring with fog everywhere, so the hidden ROM's own
    // map is outside it. The fog hurts each mon on the field a tenth at every turn's end
    // and can knock it out, as in every fog battle (BrRing_FogEndTurn, HBR-11). None: no
    // ring. The ROM asks the ring again each turn, so fogNow() reaches a battle under way.
    emu.bytes(ringAt, 10).set(fog ? FOGGED : CLEAR);
    fighting = true;
    emu.resume();
    const t0 = performance.now();
    let n = 0;
    const count = emu.onFrame(() => { n++; });
    kick();
    const took = await until(emu, going, 600);
    count();
    lastStart = { ms: performance.now() - t0, frames: n };
    // Emerald's battle loop: set once the battle screen itself runs, after the swirl
    // that is drawn over the hidden ROM's own field.
    // A refused ask (DONE at once: no table for that spot) never draws a battle.
    const shown = took && !over() && await until(emu, () => emu.read(mainFunc, 32) !== 0, 600);
    if (!shown) console.warn('spike: no battle', { took, ask: [...emu.bytes(askAt, 8)], fighting: emu.read(fightAt + 2, 8), callback2: emu.read(sym('gMain') + 4, 32).toString(16) });
    let result: Fought = { ok: false, outcome: 0, species: 0, level: 0 };
    // However long it takes: a battle is never pulled out from under the player.
    if (shown) {
      onStart();
      await until(emu, over, Infinity);
      // The ring is the battle's: back on the field nothing of it is left to bleed the
      // hidden ROM's party while a catch prompt waits.
      fighting = false;
      emu.bytes(ringAt, 10).set(CLEAR);
      result = { ok: true, ...after() };
      // A catch with a full party: back on its field the ROM asks which one makes room
      // (br_catch.c). The player answers it on the ROM's screen, as in a match.
      // Ten seconds with the prompt never put up (asked, byte 1, still 0) is a stall, not
      // a slow thumb.
      if (!await until(emu, () => emu.read(catchAt, 8) === 0 || emu.read(catchAt + 1, 8) !== 0, 600))
        console.warn('spike: a catch is still waiting for its prompt after 10 s', { catch: [...emu.bytes(catchAt, 8)], callback2: emu.read(sym('gMain') + 4, 32).toString(16) });
      await until(emu, () => emu.read(catchAt, 8) === 0, Infinity);
      // A loss is a whiteout: in a match the trainer is out. Here the team goes back to
      // how it came in (the ring and elimination are the match's, later).
      if (result.outcome !== LOST && result.outcome !== DREW) carried = kept();
    }
    fighting = false;
    emu.pause();
    // A ROM that could not be put back would start the next battle from whatever this
    // one left on its field: no more battles from it.
    if (!emu.restore(parked!)) broken = true;
    else if (carried) keep(carried);
    return result;
  }

  return {
    emu,
    press: (k) => emu.press(k),
    release: (k) => emu.release(k),
    fight(name, mons, skin, onStart, fog = false) {
      // The path a bot fight takes: its card, its ghost beside us, its challenge. All three
      // go on the ring in one go, on purpose: the ROM reads the ring in order, so the card
      // is staged before the CHALLENGE that needs it (the fight is up in ~80 frames).
      return inTurn(() => battle(fog, () => {
        send({ t: 'trainer', seat: FOE_SEAT, name, mons });
        send({ t: 'place', v: PROTOCOL, seat: FOE_SEAT, map: { group: 0, num: 9 }, x: 20, y: 8, f: 1, st: 'alive', sprite: String(skin) });
        send({ t: 'challenge', seat: FOE_SEAT, opponent: ME, nonce: 0 });
      }, () => emu.read(fightAt + 2, 8) === 1, () => emu.read(fightAt + 2, 8) === 0, onStart,
      () => ({ outcome: emu.read(outcomeAt, 8), species: 0, level: 0 })));
    },
    bleed() {
      return inTurn(async () => {
        if (broken) return 0;
        const n = emu.read(countAt, 8);
        let alive = 0;
        for (let i = 0; i < n; i++) {
          const at = partyAt + i * 100;
          let hp = emu.read(at + 86, 16);
          if (!hp) continue;
          hp -= Math.min(hp, Math.max(1, Math.floor(emu.read(at + 88, 16) / 10)));
          emu.write(at + 86, hp, 16);
          if (hp) alive++;
          else emu.write(at + 80, 0, 32); // a fainted mon has no status (Bleed)
        }
        carried = kept();
        return alive;
      });
    },
    fogNow() {
      if (fighting && !broken && emu.read(ringAt, 8) === 0) emu.bytes(ringAt, 10).set(FOGGED);
    },
    give(item, n) {
      return inTurn(async () => {
        if (broken) return null;
        const before = kept();
        // br_loot.c's HandleGive: straight into AddBagItem when no bag of ours is waiting.
        emu.resume();
        send({ t: 'give', items: [{ id: item, n }] });
        await until(emu, () => box.pending() === 0, 60);
        await frames(emu, 1);
        emu.pause();
        const after = kept();
        // Back to parked with what it left, as after a battle: a refusal's NO ROOM box and
        // the frames it ran are not where the next battle starts.
        if (!emu.restore(parked!)) broken = true;
        else keep(after);
        carried = after;
        const got = arrived(before, after);
        const used = after.party.some((b, i) => b !== before.party[i]);
        return got.items.length || got.money || used ? { ...got, used } : null;
      });
    },
    wild(group, num, behavior, onStart, fog = false) {
      // br_wild.h: the map, then ASKED; FIGHTING once it is under way, DONE when it is over.
      return inTurn(() => battle(fog, () => {
        emu.write(askAt + 1, group, 8);
        emu.write(askAt + 2, num, 8);
        emu.write(askAt + 3, behavior, 8);
        emu.write(askAt, WILD_ASKED, 8);
      }, () => emu.read(askAt, 8) !== WILD_ASKED, () => emu.read(askAt, 8) === WILD_DONE, onStart,
      () => ({ outcome: emu.read(askAt + 7, 8), species: emu.read(askAt + 4, 16), level: emu.read(askAt + 6, 8) })));
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
