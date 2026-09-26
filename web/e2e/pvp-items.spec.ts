// POK-331 #7: a POTION in a link battle heals the same mon on both ROMs, whoever drinks it.
//
// Two people in one room, a real link battle between them over the relay, and each takes
// a turn to drink while the other LEERs (Treecko's second move, which deals no damage, so
// the only HP that moves in a turn is the potion's). After each turn both ROMs are asked
// for both mons: the drinker's own party, the other ROM's copy of it, the challenger's
// engine (gBattleMons, which the next move is dealt against) and the other screen's
// healthbar for it.
//
// What it found, before the fix (the ROM at 40041d1bf):
//   - the challenged player's potion healed their own ROM only. The challenger's copy of
//     the mon and its engine stayed at 5 HP: after turn one, 20 on one screen, 5 on the
//     other, and the next hit dealt off the 5 would have written it back over the 20.
//   - the challenger's potion froze the fight on both ROMs for good: the bag's answer sat
//     in the link queue behind a request the party menu had sent to the controller still
//     holding the bag. Nothing ever timed it out.
// tools/br/drivers/pvp-items.txt is the one-ROM half of this.
//
// And the other screen says whose potion it was (Kanto's "RED used POTION!"): the ROM
// used to heal the mon with no line at all, and the healthbar just jumped.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';
import { encodeGen3 } from '../src/text/gen3';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');

/** struct Pokemon: current and max HP, the offsets every driver reads. */
const PARTY_HP = 0x56;
const PARTY_MAX_HP = 0x58;
/** struct BattlePokemon (include/battle.h): its size, and hp inside it. */
const MON_SIZE = 0x58;
const MON_HP = 0x28;
/** gBattleSpritesDataPtr->battleBars (the 4th pointer), each a 20-byte BattleBarInfo
 *  whose oldValue is the HP an opponent's healthbar last settled on. (A player's shares
 *  its row with the EXP bar, which is set after it.) */
const BARS_PTR = 12;
const BAR_SIZE = 20;
const BAR_OLD = 8;
const ITEM_POTION = 13;
/** SaveBlock1's ITEMS pocket, and SaveBlock2's key its quantities are XORed with. */
const ITEMS_POCKET = 0x560;
const ENCRYPTION_KEY = 0xac;
/** gBrBattle.menu (include/br/br_battle.h). */
const BR_MENU_ACTION = 1;
const BR_MENU_MOVE = 2;
const HURT = 5;
/** What the watching screen's message box says as the other trainer drinks: every ROM's
 *  link partner is RIVAL (br_netlink.c's FillLinkPlayers), and the line breaks after
 *  "used" (0xFE) and ends in EOS (0xFF). */
const RIVAL_USED_POTION = [...encodeGen3('RIVAL used'), 0xfe, ...encodeGen3('POTION!'), 0xff];

type Ram = { read(addr: number, width: 8 | 16 | 32): number; write(addr: number, value: number, width: 8 | 16 | 32): void };
type RamWindow = { __br: { mailbox: { ram: Ram } } };

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

const read = (page: Page, addr: number, width: 8 | 16 | 32) =>
  page.evaluate(([a, w]) => (window as unknown as RamWindow).__br.mailbox.ram.read(a, w as 8 | 16 | 32), [addr, width] as const);
const write = (page: Page, addr: number, value: number, width: 8 | 16 | 32) =>
  page.evaluate(([a, v, w]) => (window as unknown as RamWindow).__br.mailbox.ram.write(a, v, w as 8 | 16 | 32), [addr, value, width] as const);

/** One press the way a thumb makes it: down four frames, up six. Frames, not wall time --
 *  a slow frame would otherwise make a tap two presses, or none. */
async function tap(page: Page, key: string): Promise<void> {
  await page.evaluate(
    (k) =>
      new Promise<void>((resolve) => {
        type Emu = { press(k: string): void; release(k: string): void; onFrame(fn: () => void): () => void };
        const emu = (window as unknown as { __hbr: { emu: Emu } }).__hbr.emu;
        let n = 0;
        emu.press(k);
        const off = emu.onFrame(() => {
          n++;
          if (n === 4) emu.release(k);
          if (n >= 10) {
            off();
            resolve();
          }
        });
      }),
    key,
  );
}

/** Waits `n` of this page's emulated frames. */
async function frames(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const emu = (window as unknown as { __hbr: { emu: { onFrame(fn: () => void): () => void } } }).__hbr.emu;
        let seen = 0;
        const off = emu.onFrame(() => {
          if (++seen < count) return;
          off();
          resolve();
        });
      }),
    n,
  );
}

/** Holds a direction until this page's own trainer is on the next tile (gBrOwnPos, what
 *  the ROM read off its own object at the end of the last tick), and lets go that frame.
 *  FALSE if a second of holding went nowhere. */
async function step(page: Page, own: number, key: string): Promise<boolean> {
  return page.evaluate(
    ([k, addr]) =>
      new Promise<boolean>((resolve) => {
        type W = { __hbr: { emu: { press(k: string): void; release(k: string): void; onFrame(fn: () => void): () => void } } } & RamWindow;
        const w = window as unknown as W;
        const at = () => `${w.__br.mailbox.ram.read(addr + 2, 16)},${w.__br.mailbox.ram.read(addr + 4, 16)}`;
        const from = at();
        let left = 60;
        w.__hbr.emu.press(k);
        const off = w.__hbr.emu.onFrame(() => {
          const moved = at() !== from;
          if (!moved && --left > 0) return;
          w.__hbr.emu.release(k);
          off();
          resolve(moved);
        });
      }),
    [key, own] as const,
  );
}

/** The screen on top once it is a new one and has sat still: gMain.callback2 not one of
 *  `was`, and the same for 45 frames running -- a menu's setup walks through several
 *  callbacks before the one that reads the pad (br_netlink.c's BR_MENU_SETTLE idea).
 *  Returns that callback. */
async function settled(page: Page, cb2: number, was: number[]): Promise<number> {
  return page.evaluate(
    ([addr, prior]) =>
      new Promise<number>((resolve, reject) => {
        type W = { __hbr: { emu: { onFrame(fn: () => void): () => void } } } & RamWindow;
        const w = window as unknown as W;
        let last = -1;
        let still = 0;
        let left = 60 * 20;
        const off = w.__hbr.emu.onFrame(() => {
          const now = w.__br.mailbox.ram.read(addr, 32) >>> 0;
          still = now === last ? still + 1 : 0;
          last = now;
          if (!prior.includes(now) && still >= 45) {
            off();
            resolve(now);
          } else if (--left <= 0) {
            off();
            reject(new Error(`no new screen settled (callback2 0x${now.toString(16)}, was ${prior.map((v) => v.toString(16))}, still ${still})`));
          }
        });
      }),
    [cb2, was.map((v) => v >>> 0)] as const,
  );
}

test('a potion in a link battle heals the same mon on both ROMs, whoever drinks it', async ({ browser }) => {
  test.setTimeout(240_000);
  const rom = romHashParam();
  const symbols = loadSymbols();
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();

  try {
    const host = await hostCtx.newPage();
    await host.goto(`/#host&noauto&nobots&testmon&rom=${rom}`);
    await host.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 30_000 });
    const codeEl = host.locator('#room-code');
    await expect(codeEl).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 30_000 });
    const code = ((await codeEl.textContent()) ?? '').match(/Room ([A-Z0-9]{6})/)?.[1];
    if (!code) throw new Error('could not parse a room code');

    const guest = await guestCtx.newPage();
    await guest.goto(`/#join=${code}&noauto&nobots&testmon&rom=${rom}`);
    await guest.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 30_000 });
    const pages = [host, guest];

    // Each ROM has booted with its Treecko and stands on the field; hurt the mon, and put
    // three POTIONs in the bag. On the field and still, because Emerald moves the save
    // blocks on every map load: an item written through gSaveBlock1Ptr while the boot's
    // map was loading went to where the bag used to be.
    for (const p of pages) {
      await p.waitForFunction(
        ([count, cb2, overworld]) => {
          const ram = (window as unknown as RamWindow).__br.mailbox.ram;
          return ram.read(count, 8) === 1 && ((ram.read(cb2, 32) >>> 0) & ~1) === overworld;
        },
        [symbols.gPlayerPartyCount, symbols.gMain + 4, symbols.CB2_Overworld] as const,
        { timeout: 30_000 },
      );
      await frames(p, 60);
      await write(p, symbols.gPlayerParty + PARTY_HP, HURT, 16);
      const items = (await read(p, symbols.gSaveBlock1Ptr, 32)) + ITEMS_POCKET;
      const key = (await read(p, (await read(p, symbols.gSaveBlock2Ptr, 32)) + ENCRYPTION_KEY, 32)) & 0xffff;
      await write(p, items, ITEM_POTION, 16);
      await write(p, items + 2, 3 ^ key, 16);
      await frames(p, 30);
      expect(await read(p, (await read(p, symbols.gSaveBlock1Ptr, 32)) + ITEMS_POCKET, 16), 'the POTION is in the bag').toBe(ITEM_POTION);
    }

    // Into each other's eyeline. Both boot on one Littleroot tile facing south, and a
    // look starts from the next tile along (br_engage.c's Sees), so on one tile nobody
    // sees anybody: the guest steps a tile south, into the host's look.
    expect(await step(guest, symbols.gBrOwnPos, 'down'), 'the guest stepped south').toBe(true);
    // Then into the match (spectate.spec.ts's way), where the eyeline is a rule.
    for (const p of pages) await write(p, symbols.gBrMatch, 2, 8);
    for (const p of pages) {
      await p.waitForFunction(
        (addr) => (window as unknown as RamWindow).__br.mailbox.ram.read(addr, 8) === 1,
        symbols.gBrNetlink,
        { timeout: 40_000 },
      );
    }
    // Link id 0 is the challenger, whose ROM runs the fight's engine; 1 is challenged.
    const ids = await Promise.all(pages.map((p) => read(p, symbols.gBrNetlink + 1, 8)));
    expect([...ids].sort(), 'one challenger and one challenged').toEqual([0, 1]);
    const challenger = ids[0] === 0 ? host : guest;
    const challenged = challenger === host ? guest : host;

    /** B through the intro and the turn's text (it advances a line as A does, and does
     *  nothing on the action menu), until this ROM's action menu is up. */
    const toActionMenu = async (p: Page) => {
      for (let i = 0; i < 200; i++) {
        if ((await read(p, symbols.gBrBattle + 8, 8)) === BR_MENU_ACTION) return;
        await tap(p, 'b');
        await p.waitForTimeout(150);
      }
      const hex = async (addr: number, w: 8 | 16 | 32) => '0x' + ((await read(p, addr, w)) >>> 0).toString(16);
      const state = {
        myId: await hex(symbols.gBrNetlink + 1, 8),
        cb2: await hex(symbols.gMain + 4, 32),
        mainFunc: await hex(symbols.gBattleMainFunc, 32),
        comm: await hex(symbols.gBattleCommunication, 32),
        exec: await hex(symbols.gBattleControllerExecFlags, 32),
        bufB: [await hex(symbols.gBattleBufferB, 32), await hex(symbols.gBattleBufferB + 0x200, 32)],
        hp: [await read(p, symbols.gPlayerParty + PARTY_HP, 16), await read(p, symbols.gEnemyParty + PARTY_HP, 16)],
      };
      throw new Error(`the action menu never came back: ${JSON.stringify(state)}`);
    };
    const drink = async (p: Page) => {
      const cb2 = symbols.gMain + 4;
      const battle = await read(p, cb2, 32);
      const hurt = await read(p, symbols.gPlayerParty + PARTY_HP, 16);
      // BAG, and the bag up and still.
      await tap(p, 'right');
      await tap(p, 'a');
      const bag = await settled(p, cb2, [battle]);
      // The POTION, USE, and the party menu up. A second of each: the bag fades in after
      // its callback settles, and a press into a fade is a press nobody reads.
      await frames(p, 60);
      await tap(p, 'a');
      await frames(p, 60);
      await tap(p, 'a');
      await settled(p, cb2, [battle, bag]);
      await frames(p, 60);
      // The one mon: the party menu uses it there and then, and the bar climbs.
      await tap(p, 'a');
      await p.waitForFunction(
        ([addr, was]) => (window as unknown as RamWindow).__br.mailbox.ram.read(addr, 16) !== was,
        [symbols.gPlayerParty + PARTY_HP, hurt] as const,
        { timeout: 10_000 },
      );
      // "...restored by 15 points" waits for a press, then the menu closes on the battle.
      for (let i = 0; i < 40 && (await read(p, cb2, 32)) !== battle; i++) {
        await tap(p, 'a');
        await p.waitForTimeout(400);
      }
    };
    const leer = async (p: Page) => {
      // FIGHT (the cursor may still be on BAG from a turn ago), then LEER, top right.
      await tap(p, 'left');
      await tap(p, 'a');
      await p.waitForFunction(
        ([addr, m]) => (window as unknown as RamWindow).__br.mailbox.ram.read(addr, 8) === m,
        [symbols.gBrBattle + 8, BR_MENU_MOVE] as const,
        { timeout: 10_000 },
      );
      await tap(p, 'right');
      await tap(p, 'a');
    };
    /** Everything this ROM believes about both mons, keyed by battler: battler myId is
     *  its own trainer's mon, myId ^ 1 the other one's. */
    const view = async (p: Page) => {
      const myId = await read(p, symbols.gBrNetlink + 1, 8);
      const bars = await read(p, (await read(p, symbols.gBattleSpritesDataPtr, 32)) + BARS_PTR, 32);
      const party = [symbols.gPlayerParty, symbols.gEnemyParty];
      const out = { myId, max: await read(p, symbols.gPlayerParty + PARTY_MAX_HP, 16), party: [0, 0], engine: [0, 0], bar: [0, 0] };
      for (const battler of [0, 1]) {
        out.party[battler] = await read(p, party[battler === myId ? 0 : 1] + PARTY_HP, 16);
        out.engine[battler] = await read(p, symbols.gBattleMons + battler * MON_SIZE + MON_HP, 16);
        out.bar[battler] = await read(p, bars + battler * BAR_SIZE + BAR_OLD, 32);
      }
      return out;
    };
    /** From now on, every frame: has this page's battle message box said `line`? */
    const watchLine = (p: Page, line: number[]) =>
      p.evaluate(
        ([addr, want]) => {
          type W = { __hbr: { emu: { onFrame(fn: () => void): () => void } }; __sawLine?: boolean } & RamWindow;
          const w = window as unknown as W;
          w.__sawLine = false;
          const off = w.__hbr.emu.onFrame(() => {
            for (let i = 0; i < want.length; i++) if (w.__br.mailbox.ram.read(addr + i, 8) !== want[i]) return;
            w.__sawLine = true;
            off();
          });
        },
        [symbols.gDisplayedStringBattle, line] as const,
      );
    const sawLine = (p: Page) => p.evaluate(() => (window as unknown as { __sawLine?: boolean }).__sawLine === true);
    const turn = async (drinker: Page, label: string) => {
      const other = drinker === challenger ? challenged : challenger;
      await watchLine(other, RIVAL_USED_POTION);
      await Promise.all([drink(drinker), leer(other)]);
      await Promise.all(pages.map(toActionMenu));
      expect(await sawLine(other), `${label}: the other screen said whose potion it was`).toBe(true);
      const [d, o] = [await view(drinker), await view(other)];
      const c = drinker === challenger ? d : o;
      console.log(label, JSON.stringify({ drinker: d, other: o }));
      const hp = d.max; // 5 + 20 is all of a level 5 Treecko
      const who = d.myId;
      expect(d.party[who], `${label}: the drinker's own party`).toBe(hp);
      expect(o.party[who], `${label}: the other ROM's copy of the drinker's mon`).toBe(hp);
      expect(c.engine[who], `${label}: the challenger's engine`).toBe(hp);
      expect(o.bar[who], `${label}: the other screen's healthbar for it`).toBe(hp);
    };

    await Promise.all(pages.map(toActionMenu));
    // The challenged ROM first: its potion is the one the engine never heard of.
    await turn(challenged, 'challenged-drinks');
    // Then the challenger's, the one that froze both.
    await turn(challenger, 'challenger-drinks');
    // Both at full on both ROMs, and still fighting: a LEER each is one more turn.
    await Promise.all([leer(challenger), leer(challenged)]);
    await Promise.all(pages.map(toActionMenu));
  } finally {
    await hostCtx.close().catch(() => {});
    await guestCtx.close().catch(() => {});
  }
});
