// Spike B (engine-path thread, 2026-10-27): the overworld as one world the page owns.
//
// Throwaway. It answers one question: if every trainer -- you, the bots, the people you
// watch -- stands in ONE world model the page simulates, and the ROM is only asked to
// fight, do the sync bugs go away, does it hold 60 fps on a phone, and does walking still
// feel like Emerald?
//
// One source of position: the shared Room (shared/room.ts), run by the relay for every
// phone that opens the page, or by the page itself when there is no relay (net.ts). The
// renderer only reads it. The camera is either glued to a trainer or dragged freely over
// the whole of Hoenn.
//
// Reuses the shell's walkability through bots/world.ts, on data/world.json: the shell's
// world.json regenerated with export-world.py's ledge fix (the shipped one walls every
// ledge, and changing it moves the live bots, so that ships on its own). Every picture is cut from the
// player's ROM in the browser (romart.ts): the site ships none. Nothing here is shell code.

import { WorldIndex } from '../src/bots/hoenn';
import { isTallGrass, isWater, type WorldMap, type Spot } from '../src/bots/world';
import { loadPatches } from '../src/bots/patches';
import { dealParty, rungForPhase } from '../src/bots/party';
import { gradeOf } from '../src/bots/roster';
import { DIR_EAST } from './sim';
import { HOME_N, KEY_A, KEY_B, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_UP, SAFARI, WALKUP_BANG, emptyBag, interiors, makeRoom, type Actor, type Bag, type RoomEvent, type Ring, type Spill } from './shared/room';
type Person = NonNullable<Spill['person']>;
import { SKIN_GFX } from './shared/bots';
import { connectWorld, soloLink, type WorldLink } from './net';
import { over } from './shared/over';
import { Lobby, me, type RoomInfo } from './lobby';
import { recordMatch } from '../src/match/career';
import { OUT_BATCH_MS, outs, won } from '../src/match/ticker';
import { bootRom, loadRom, lastStart, type DuelLink, type Fought, type RomBattles } from './rom';
import { groundCount, isTm, tradedInto } from './shared/items';
import { GIFTS } from '../src/match/gifts';
import { GOLD } from '../src/match/events';
import { FLYING, STORIES } from '../src/match/story';
import hiddenJson from './data/hidden.json';
import { RomArt } from './romart';
import { RingMap } from './ringmap';
import { Watch } from './watch';
import { makeJudge, type Judge } from './judge';
import { LEADERS } from './shared/gyms';
import { CLERKS, priceOf, shelf } from './shared/marts';
import type { GbaKey } from '../src/emu';
import spritesData from '../src/data/sprites.json';
import encounterData from '../src/data/encounters.json';

const TILE = 16;
// include/constants/event_objects.h.
const OBJ_EVENT_GFX_ITEM_BALL = 59;
const OBJ_EVENT_GFX_NURSE = 58;
const OBJ_EVENT_GFX_WOMAN_3 = 24;
const OBJ_EVENT_GFX_MART_EMPLOYEE = 83;
const OBJ_EVENT_GFX_GENTLEMAN = 48;
const OBJ_EVENT_GFX_BRENDAN_SURFING = 2, OBJ_EVENT_GFX_MAY_SURFING = 92;
const OBJ_EVENT_GFX_CUTTABLE_TREE = 82, OBJ_EVENT_GFX_PUSHABLE_BOULDER = 87;
// export-world.py's classes for them.
const CLASS_WATER = 2, CLASS_CUT = 9, CLASS_BOULDER = 10;
const OBJ_EVENT_GFX_BIRCHS_BAG = 97;
const SHEETS = spritesData as Record<string, { name: string; w: number; h: number; frames: number }>;

// ---- layout: every outdoor map at a place in one plane --------------------------------

interface Placed {
  m: WorldMap;
  gx: number; // tiles
  gy: number;
  ground?: HTMLCanvasElement;
  cover?: HTMLCanvasElement;
  border?: HTMLCanvasElement;
  borderTint?: string;
  mips?: HTMLCanvasElement[]; // 1/4, 1/8, 1/16, each averaged from the one before
  /** Painted with its REGI wall open (br_story.c's Open). */
  open?: boolean;
  classes: Uint8Array;
  /** The cut trees and Strength boulders standing on it: [x, y, gfx]. */
  props?: [number, number, number][];
}

function decode(grid: string, cells: number): Uint8Array {
  const out = new Uint8Array(cells);
  let i = 0;
  for (const run of grid.split(';')) {
    if (!run) continue;
    const [n, v] = run.split('x').map(Number);
    out.fill(v, i, i + n);
    i += n;
  }
  return out;
}

/** BFS over the seams from Littleroot: a neighbour's origin is this map's, shifted by the
 *  connection's offset along the shared edge (World.landAcross is the same sum backwards). */
function layout(maps: WorldMap[]): Map<string, Placed> {
  const byId = new Map(maps.map((m) => [m.id, m]));
  const placed = new Map<string, Placed>();
  const start = byId.get('MAP_LITTLEROOT_TOWN')!;
  placed.set(start.id, { m: start, gx: 0, gy: 0, classes: decode(start.grid, start.w * start.h) });
  const queue = [start.id];
  while (queue.length) {
    const p = placed.get(queue.shift()!)!;
    for (const s of p.m.seams) {
      const to = byId.get(s.to);
      if (!to || !to.outdoor || placed.has(to.id)) continue;
      let gx = p.gx;
      let gy = p.gy;
      if (s.dir === 'north') { gx += s.offset; gy -= to.h; }
      else if (s.dir === 'south') { gx += s.offset; gy += p.m.h; }
      else if (s.dir === 'west') { gx -= to.w; gy += s.offset; }
      else { gx += p.m.w; gy += s.offset; }
      placed.set(to.id, { m: to, gx, gy, classes: decode(to.grid, to.w * to.h) });
      queue.push(to.id);
    }
  }
  // The buildings and caves, each on its own, in rows well east of Hoenn: drawn where the
  // camera follows a trainer in, and never in sight of the outdoors.
  let right = 0, top = Infinity;
  for (const p of placed.values()) { right = Math.max(right, p.gx + p.m.w); top = Math.min(top, p.gy); }
  const GAP = 48, ROW = 640;
  let x = right + 200, y = top, rowH = 0;
  for (const [id, { m }] of interiors(maps, placed)) {
    if (x + m.w > right + 200 + ROW) { x = right + 200; y += rowH + GAP; rowH = 0; }
    placed.set(id, { m, gx: x, gy: y, classes: decode(m.grid, m.w * m.h) });
    x += m.w + GAP;
    rowH = Math.max(rowH, m.h);
  }
  // The Safari Zone (the opening's, behind a closed gate), by its own seams, below them.
  const south = byId.get('MAP_SAFARI_ZONE_SOUTH');
  if (south) {
    placed.set(south.id, { m: south, gx: right + 200, gy: y + rowH + 200, classes: decode(south.grid, south.w * south.h) });
    const q = [south.id];
    while (q.length) {
      const p = placed.get(q.shift()!)!;
      for (const s of p.m.seams) {
        const to = byId.get(s.to);
        if (!to || !to.id.startsWith('MAP_SAFARI_ZONE_') || placed.has(to.id)) continue;
        let gx = p.gx, gy = p.gy;
        if (s.dir === 'north') { gx += s.offset; gy -= to.h; }
        else if (s.dir === 'south') { gx += s.offset; gy += p.m.h; }
        else if (s.dir === 'west') { gx -= to.w; gy += s.offset; }
        else { gx += p.m.w; gy += s.offset; }
        placed.set(to.id, { m: to, gx, gy, classes: decode(to.grid, to.w * to.h) });
        q.push(to.id);
      }
    }
  }
  return placed;
}

let art: RomArt | null = null;
/** METATILE_Cave_SealedChamberEntrance_* (metatile_labels.h), where Open lays them. */
const SEALED_CHAMBER: [number, number, number][] = [[7, 19, 0x22a], [8, 19, 0x22b], [9, 19, 0x22c], [7, 20, 0x232], [8, 20, 0x233], [9, 20, 0x234]];
/** METATILE_Cave_EntranceCover over SealedChamberBraille_Mid: the wall before it opens. */
const HIDDEN_CHAMBER: [number, number, number][] = [[7, 19, 0x229], [8, 19, 0x229], [9, 19, 0x229], [7, 20, 0x235], [8, 20, 0x235], [9, 20, 0x235]];
const DOOR_MAPS = new Set(STORIES.filter((s) => s.door).map((s) => s.map));
/** A wall opened since its map was painted: painted again. */
function doorsFrame(): void {
  for (const e of link.room.events) {
    const p = e.opened ? placed.get(e.map) : undefined;
    if (p && !p.open) { p.open = true; p.ground = p.cover = p.mips = undefined; }
  }
  // A new round's walls are shut again.
  for (const p of placed.values()) if (p.open && !link.room.events.some((e) => e.opened && e.map === p.m.id)) { p.open = false; p.ground = p.cover = p.mips = undefined; }
}
let ringMap: RingMap | null = null;
/** A map's pictures, cut from the ROM the first time it is seen (~20 ms a map); the rest
 *  are cut in the background after boot so a zoom-out never waits on them. */
function paint(p: Placed): boolean {
  if (p.ground) return true;
  if (!art) return false;
  // A REGI wall: shut as the map's OnLoad hides it (HideRegiEntrance), or open, the
  // sealed chamber's entrance on its six cells (br_story.c's Open).
  const wall = !DOOR_MAPS.has(p.m.id) ? undefined : p.open ? SEALED_CHAMBER : HIDDEN_CHAMBER;
  const over = wall && new Map(wall.map(([x, y, block]) => [y * p.m.w + x, block]));
  const a = art.map(p.m.group, p.m.num, over);
  p.ground = a.ground;
  p.cover = a.cover;
  p.border = a.border;
  return true;
}

// ---- actors: the one source of position ------------------------------------------------

// sAnim_GoSouth/North/West/East, and the running sheet's (frames 9..17 of BrendanNormal).
const GO = { 1: [3, 0, 4, 0], 2: [5, 1, 6, 1], 3: [7, 2, 8, 2], 4: [7, 2, 8, 2] } as Record<number, number[]>;
const RUN = { 1: [12, 9, 13, 9], 2: [14, 10, 15, 10], 3: [16, 11, 17, 11], 4: [16, 11, 17, 11] } as Record<number, number[]>;
const FACE = { 1: 0, 2: 1, 3: 2, 4: 2 } as Record<number, number>;

// ---- input ----------------------------------------------------------------------------

const held = new Set<string>();
const pressed = new Set<string>();
const KEYMAP: Record<string, string> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', x: 'b', X: 'b', z: 'a', Z: 'a', Shift: 'b', Enter: 'a', ' ': 'a',
};
/** The start card is up: nothing behind it moves (review of #157). */
const intro = () => document.getElementById('intro') !== null;
// The menu and the room (lobby.ts) have the keys while they are up: Emerald's, as the
// live game's stage takes them, and a keyboard's letters for an entry.
const STAGE_KEY: Record<string, GbaKey> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', z: 'a', x: 'b', Enter: 'start' };
addEventListener('keydown', (e) => {
  if (!lobby?.shown) return;
  e.stopImmediatePropagation();
  if (!e.ctrlKey && !e.metaKey && !e.altKey && lobby.stage.char(e.key)) { e.preventDefault(); return; }
  const k = STAGE_KEY[e.key];
  if (k) { e.preventDefault(); if (!e.repeat) lobby.stage.key(k); }
}, true);
addEventListener('keydown', (e) => {
  if (intro()) return;
  if (e.key === 'v' || e.key === 'V') { toggleSpectate(); return; }
  if ((e.key === 'm' || e.key === 'M' || e.key === 'Escape') && !e.repeat) { void openMenu(); return; }
  if ((e.key === 'f' || e.key === 'F') && !e.repeat) { itemfinder(); return; }
  const k = KEYMAP[e.key];
  if (!k) return;
  e.preventDefault();
  if (!held.has(k)) pressed.add(k);
  held.add(k);
});
addEventListener('keyup', (e) => { const k = KEYMAP[e.key]; if (k) held.delete(k); });
addEventListener('blur', () => held.clear());
for (const el of document.querySelectorAll<HTMLElement>('.k')) {
  const k = el.dataset.k!;
  const down = (e: PointerEvent) => { e.preventDefault(); if (intro()) return; el.setPointerCapture(e.pointerId); el.classList.add('down'); if (!held.has(k)) pressed.add(k); held.add(k); };
  const up = () => { el.classList.remove('down'); held.delete(k); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

// ---- the room ------------------------------------------------------------------------

let placed: Map<string, Placed>;
let link: WorldLink;
let frame = 0;

function global(s: Spot): { gx: number; gy: number } | null {
  const p = placed.get(s.map);
  return p ? { gx: p.gx + s.x, gy: p.gy + s.y } : null;
}

function classAt(s: Spot): number {
  const p = placed.get(s.map);
  if (!p || s.x < 0 || s.y < 0 || s.x >= p.m.w || s.y >= p.m.h) return 1;
  return p.classes[s.y * p.m.w + s.x];
}

/** Every trainer as drawn: the room's, with mine where my thumb has it. */
function actors(): Actor[] {
  const me = link.mine();
  return link.room.actors.map((a) => (me && a.id === link.me ? me : a));
}

/** My keys this frame, as the room takes them. Pressing A to talk and walking are the
 *  room's business (a bot you face, a marked spot you land on); the page only keeps a
 *  held A from the last battle's text out of the next one. */
function myBits(): number {
  if (spectating || battle || swapping || romUp || asking || intro()) return 0;
  const bits = (held.has('up') ? KEY_UP : 0) | (held.has('down') ? KEY_DOWN : 0) | (held.has('left') ? KEY_LEFT : 0) |
    (held.has('right') ? KEY_RIGHT : 0) | (held.has('b') ? KEY_B : 0) | (held.has('a') && frame >= calmUntil ? KEY_A : 0);
  return bits;
}

// ---- marked spots: the live game's visible encounters ------------------------------------

// The room deals them from its seed the way every ROM deals them (bots/patches.ts,
// br_patch.c's Pick), and the ROM rolls the national stand-ins off the same seed.

// ---- the battle handoff: the real ROM fights, the page waits ---------------------------

const battleEl = document.getElementById('battle')!;
const fogEl = document.getElementById('ringfog') as HTMLCanvasElement;
document.getElementById('intro-go')!.addEventListener('click', () => document.getElementById('intro')!.remove());
const battleNote = document.getElementById('battle-note')!;
const gbaCanvas = document.getElementById('gba') as HTMLCanvasElement;
let rom: RomBattles | null = null;
/** Bot-vs-bot fights the room gives this page, in a hidden second ROM (judge.ts). */
let judge: Judge | null = null;
let artMs = 0;
let battle: { foe: Actor | null; shownAt: number; foeGone?: boolean; heardAt?: number; round: number; link: WorldLink; boss?: number } | null = null;
/** The ROM has the screen for a dropped bag's team (rom.team). */
let swapping = false;
let calmUntil = 0;
const handoff: number[] = []; // ms from the trigger to the ROM's first battle frame, and back


/** A battle the ROM fights, the page showing it from its first frame and taking the
 *  screen back when it is over. */
function handOff(foe: Actor | null, run: (r: RomBattles, onStart: () => void) => Promise<Fought>): void {
  // One battle at a time: one still running from the match before (its ROM is busy with
  // it) turns this one down, or its end would be credited to this foe.
  if (battle) { link.end(); return; }
  held.clear();
  battle = { foe, shownAt: performance.now(), round: link.room.results.round, link };
  if (!rom) {
    battleEl.classList.add('on');
    battleNote.textContent = 'The game is still loading. Try again in a moment.';
    setTimeout(() => endBattle(null), 1500);
    return;
  }
  battleNote.textContent = '';
  const t0 = performance.now();
  const firstFrame = rom.emu.onFrame(() => { handoff.push(performance.now() - t0); firstFrame(); });
  // The page keeps the screen until the ROM's battle is up: before that the hidden ROM
  // is still standing in its own Littleroot, which is what showed through ("teleported
  // back to my house", Cam). A battle that never starts never takes the screen.
  const r = rom;
  void Promise.resolve()
    .then(() => run(r, () => battleEl.classList.add('on')))
    .then(endBattle, (e) => {
      console.warn('spike battle failed', e);
      endBattle(null);
      lastResult = 'The battle engine stopped working. Reload the page to battle again.';
    });
}

// Item balls (room.ts's ground): what I picked up goes into the ROM's bag, one at a time,
// and waits for the ROM if it is still booting.
const foundEl = document.getElementById('found')!;
let foundUntil = 0;
const toGive: ({ key: number; item: number; gift?: boolean; hidden?: string } | { key: number; bag: Bag; name: string; person?: Person })[] = [];
let giving = false;

function say(text: string): void {
  foundEl.textContent = text;
  foundEl.classList.add('on');
  foundUntil = performance.now() + 2500;
}

function giveNext(): void {
  if (giving || !rom || !toGive.length) return;
  giving = true;
  const next = toGive.shift()!;
  const name = (id: number) => art?.itemName(id) || `item ${id}`;
  if ('bag' in next) {
    (next.person ? meet(next.key, next.bag, next.person) : openBag(next.key, next.bag, next.name)).catch((e) => console.warn('spike bag failed', e)).finally(() => { giving = false; giveNext(); });
    return;
  }
  const { key, item, gift, hidden } = next;
  // A TM is taught and a held item given, there and then, on the ROM's own screens.
  const screen = isTm(item) || GIFTS.includes(item);
  if (screen) { if (gift) say(`A gift: ${name(item)}!`); romUp = true; }
  const took = screen
    ? rom.teach(item, () => battleEl.classList.add('on')).finally(() => { romUp = false; battleEl.classList.remove('on'); })
    : rom.give(item, groundCount(item));
  took.then((got) => {
    // What the ROM made of it (br_items.c's Apply), not what was on the ground.
    if (!got) {
      say(`No room in the bag for ${name(item)}.`);
      if (hidden) dug.delete(hidden); // still buried
      else link.drop(key); // it stays where it lay
    } else if (screen) {
      const kept = got.items.some((g) => g.id === item);
      if (kept) say(`${name(item)} went in the BAG.`);
      else if (!gift) say(`Taught ${name(item)}!`);
    }
    else if (got.items.length) say(`Found ${got.items.map((g) => `${g.n > 1 ? `${g.n} ` : ''}${name(g.id)}`).join(', ')}!`);
    else if (got.money) say(`Sold ${name(item)} for ¥${got.money}.`);
    else say(`${name(item)}! Your team got stronger.`);
  }, (e) => console.warn('spike give failed', e)).finally(() => { giving = false; giveNext(); });
}

// A dropped bag asks what to take (HBR-82): POKéMON, its team on the ROM's BAG screen, or
// BAG, its items. B or CANCEL leaves it lying. The pad drives the question.
const askEl = document.getElementById('ask')!;
let askButtons: HTMLButtonElement[] = [];
let asking: { pick: number; done: (c: string) => void } | null = null;

function askPaint(): void {
  askButtons.forEach((b, i) => b.classList.toggle('on', i === asking?.pick));
  askButtons[asking?.pick ?? -1]?.scrollIntoView({ block: 'nearest' });
}

function askKey(k: string): void {
  if (!asking) return;
  const n = askButtons.length;
  if (k === 'up') asking.pick = (asking.pick + n - 1) % n;
  else if (k === 'down') asking.pick = (asking.pick + 1) % n;
  else if (k === 'a') return asking.done(askButtons[asking.pick].dataset.c!);
  else if (k === 'b') return asking.done('');
  askPaint();
}

/** A question on the page, its rows `[label, answer]`; '' is no (B answers it too). */
function ask(title: string, rows: [string, string][]): Promise<string> {
  document.getElementById('ask-title')!.textContent = title;
  for (const b of askButtons) b.remove();
  askButtons = rows.map(([label, c], i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.dataset.c = c;
    b.addEventListener('click', () => { if (asking) { asking.pick = i; asking.done(c); } });
    askEl.append(b);
    return b;
  });
  askEl.classList.add('on');
  return new Promise((resolve) => {
    asking = { pick: 0, done: (c) => { asking = null; askEl.classList.remove('on'); calmUntil = frame + 30; resolve(c); } };
    askPaint();
  });
}

/** A at a dropped bag: what it holds, the way the match asks (br_loot.c's TryTake). What
 *  is left goes back down as the bag, for somebody else (POK-294: nothing leaves). */
async function openBag(key: number, bag: Bag, who: string): Promise<void> {
  const mons = bag.mons ?? [];
  const things = bag.items.length > 0 || bag.money > 0;
  const c = mons.length && things ? await ask(`${who}'s BAG`, [['POKéMON', 'mons'], ['BAG', 'items'], ['CANCEL', '']]) : mons.length ? 'mons' : 'items';
  if (c === 'items') return takeBag(key, bag, who);
  if (c !== 'mons' || isOut || !rom) { link.drop(key, bag); return; }
  swapping = true;
  held.clear();
  let left = mons;
  try {
    left = await rom.team(mons, who, () => battleEl.classList.add('on'));
  } finally {
    swapping = false;
    battleEl.classList.remove('on');
    held.clear();
    pressed.clear();
    calmUntil = frame + 30;
  }
  const rest: Bag = { items: bag.items, money: bag.money, mons: left };
  if (!emptyBag(rest)) link.drop(key, rest);
}

/** START: the match's own menu rows on the ROM's screens (start_menu.c's MENU_ACTION_*),
 *  asked here first so the hidden field never shows. MAP (13) is the ROM's, standing where
 *  I stand, with this world's fog laid over it (ringmap.ts). */
async function openMenu(): Promise<void> {
  if (!rom || isOut || battle || swapping || asking || spectating) return;
  const c = await ask('MENU', [['POKéMON', '1'], ['BAG', '2'], ...(ringMap ? [['MAP', '13'] as [string, string]] : []), ['CARD', '4'], ['EXIT', '']]);
  if (!c || !rom || isOut || battle || swapping) return;
  const me = link.room.actor(link.me);
  const look = c === '13' && me && ringMap ? ringMap.look(me.m.spot) : undefined;
  let uncover = () => {};
  swapping = true;
  held.clear();
  try {
    await rom.menu(Number(c), () => {
      if (!swapping) return;
      battleEl.classList.add('on');
      if (look) uncover = ringMap!.cover(fogEl, rom!.emu);
    }, () => { uncover(); battleEl.classList.remove('on'); }, look);
  } finally {
    uncover();
    swapping = false;
    battleEl.classList.remove('on');
    held.clear();
    pressed.clear();
    calmUntil = frame + 30;
  }
}

/** A at a REGI chamber's sealed wall (br_story.c): DESERT RUINS' cracks for anybody,
 *  ANCIENT TOMB's for a team with a Flying-type in it, ISLAND CAVE's by itself once the
 *  ring has moved on. */
async function door(n: number, how: string, opened: boolean): Promise<void> {
  if (opened) { say('The wall crumbled away! A way in opened up.'); return; }
  if (how === 'wait') { say("It's sealed tight. It will open when the ring closes in."); return; }
  const mons = rom ? (await rom.spill()).mons : [];
  if (mons.some((m) => FLYING.has(m.species))) {
    link.open(n);
    say('Your Flying-type POKéMON beat its wings... The wall opened!');
  } else say('A gust of wind seems to come from inside. A Flying-type POKéMON could open it.');
}

/** A story's person (story.ts's people): STEVEN hands his over; CAPT. STERN wants the
 *  SCANNER first, out of my bag, as br_story.c's BrStory_Hands asks. */
async function meet(key: number, bag: Bag, person: Person): Promise<void> {
  const item = (id: number) => art?.itemName(id) || `item ${id}`;
  if (person.wants && !(await rom!.take(person.wants))) {
    say(`${person.name} wants the ${item(person.wants)}.`);
    link.drop(key, bag);
    return;
  }
  const given = bag.items.map((r) => item(r.id)).join(', ');
  await takeBag(key, bag, person.name, true);
  say(person.wants ? `${person.name} took the ${item(person.wants)} and gave you ${given}!` : `${person.name} gave you ${given}!`);
}

/** A fallen trainer's bag, row by row into mine the ROM's way, and its money. What did
 *  not fit, and the team, go back down as the bag. */
async function takeBag(key: number, bag: Bag, who: string, quiet = false): Promise<void> {
  const r = rom!;
  const rest: Bag = { items: [], money: 0, mons: bag.mons };
  let took = 0;
  for (const row of bag.items) {
    // A GIVE's count is a byte: a berry stack (up to 999) goes in pieces, and what did not
    // fit of it goes back.
    let left = row.n;
    while (left > 0 && !isOut) {
      const n = Math.min(left, 99);
      if (!await r.give(row.id, n)) break;
      left -= n;
    }
    if (left < row.n) took++;
    if (left) rest.items.push({ id: row.id, n: left });
  }
  // Out by now: the money stays in the bag too, not in a ROM whose spill is already read.
  if (isOut) rest.money = bag.money;
  else await r.addMoney(bag.money);
  const money = bag.money && !isOut ? ` and ¥${bag.money}` : '';
  if (!quiet) say(`Took ${who}'s bag: ${took} item${took === 1 ? '' : 's'}${money}.${rest.items.length ? ' Some would not fit.' : ''}`);
  if (!emptyBag(rest)) link.drop(key, rest);
}

/** What the room started for me: A at a bot, or a marked spot I landed on (the room took
 *  it as the battle started, as BrPatch_Take does), or A at an item ball. */
function startFor(e: RoomEvent): void {
  if (e.type === 'nurse') { void nurse(); return; }
  if (e.type === 'mart') { void mart(e.map); return; }
  if (e.type === 'trade') { void (e.gives ? gift(e.n, e.species) : trade(e.n, e.species)); return; }
  if (e.type === 'door') { void door(e.n, e.how, !!e.opened); return; }
  if (e.type === 'legend') {
    // Its own battle; caught, it is mine, and anything else puts it back where it stood
    // for the next trainer (Cam: losing to one puts you out, and it goes back for retries).
    if (swapping) rom?.leave();
    asking?.done('');
    const l = link, key = e.key, fog = inFogNow();
    handOff(null, (r, onStart) => r.legend(e.species, e.level, onStart, fog).then((f) => {
      if (!(f.ok && f.outcome === CAUGHT)) l.drop(key);
      return f;
    }, (err) => { l.drop(key); throw err; }));
    return;
  }
  if (e.type === 'bots') { void judgeBots(e.a, e.b); return; }
  if (e.type === 'boss') {
    // A gym leader (gyms.ts): their own battle in the hidden ROM; won, the gym's TM and purse.
    if (swapping) rom?.leave();
    asking?.done('');
    const leader = LEADERS[e.n], fog = inFogNow();
    handOff(null, (r, onStart) => r.boss(e.n, onStart, fog).then((f) => {
      if (!f.ok && f.outcome === 0) say(`${leader.name}: Come back with two POKéMON that can battle!`);
      return f;
    }));
    battle!.boss = e.n;
    return;
  }
  if (e.type === 'item' || e.type === 'bag') {
    toGive.push(e.type === 'item' ? { key: e.key, item: e.item, gift: e.gift } : { key: e.key, bag: e.bag, name: e.name, person: e.person });
    giveNext();
    return;
  }
  if (e.type === 'fight') {
    // A bot can come at me now (it saw me): a menu is no hiding place here either.
    if (swapping) rom?.leave();
    asking?.done('');
    const foe = link.room.actor(e.foe);
    if (!foe) { link.end(); return; }
    // A bot's team as the match deals it (bots/party.ts): from the seed and its seat, the
    // map it stands on, at the rung, one more mon every two phases.
    // Its grade too (roster.ts). No Zone pool: the ROM deals one at the Safari opening,
    // which this world has not got yet.
    const party = dealParty(link.room.seed, foe.id, link.room.ring().phase + 1, foe.m.spot.map, gradeOf(link.room.seed, foe.id));
    const fog = inFogNow();
    handOff(foe, (r, onStart) => r.fight(foe.name, party, foe.skin, onStart, fog));
  } else if (e.type === 'duel') {
    // Another trainer: both ROMs fight it out as a link battle, the blocks through the relay.
    // A menu is no hiding place: whatever screen I have open closes, a question goes unanswered.
    if (swapping) rom?.leave();
    asking?.done('');
    const foe = link.room.actor(e.foe);
    const me = link.room.actor(link.me);
    if (!foe || !me) { link.end(); return; }
    const fog = inFogNow();
    // Their blocks can come before our ROM is free to take them: held from now.
    const early: [number, number[]][] = [];
    const heard = () => { if (battle) battle.heardAt = performance.now(); };
    link.onBt = (q, d) => { heard(); early.push([q, d]); };
    const wire: DuelLink = {
      send: (q, d) => link.bt(q, d),
      listen: (take) => {
        link.onBt = take && ((q, d) => { heard(); take(q, d); });
        if (take) for (const [q, d] of early.splice(0)) take(q, d);
      },
    };
    handOff(foe, (r, onStart) => r.duel(me.name, foe.name, foe.skin, e.first, wire, onStart, fog));
  } else {
    const m = placed.get(e.map)!.m;
    const fog = inFogNow();
    handOff(null, (r, onStart) => r.wild(m.group, m.num, art!.behavior(m.group, m.num, e.x, e.y), onStart, fog));
  }
}

/** Two bots met and the room gave me their fight: both teams as the match deals them,
 *  fought out in the hidden ROM, and the winner told to the room. No answer (no ROM, a
 *  fight that would not end, a draw): 0, and both walk on. */
async function judgeBots(ida: number, idb: number): Promise<void> {
  const l = link, r = l.room;
  const side = (id: number) => {
    const b = r.actor(id);
    return { seat: id, party: b ? dealParty(r.seed, id, r.ring().phase + 1, b.m.spot.map, gradeOf(r.seed, id)) : [] };
  };
  const a = side(ida), b = side(idb);
  const out = judge ? await judge(a, b).catch(() => null) : null;
  if (link === l) l.bots(ida, idb, out?.winner ?? 0);
}

/** Once a second, between battles: what my team could do on the field (SURF, CUT,
 *  STRENGTH), told to the room when it changes -- a catch, a swap or a trade can. */
let fieldAsking = false;
function fieldFrame(): void {
  if (frame % 60 || fieldAsking || !rom || battle || swapping || isOut) return;
  const me = link.room.actor(link.me);
  if (!me) return;
  fieldAsking = true;
  const l = link;
  void rom.field().then((bits) => { if (l === link && bits !== (link.room.actor(link.me)?.field ?? 0)) link.field(bits); }).finally(() => { fieldAsking = false; });
}

/** The CENTER's nurse, as the match has her (pkmn_center_nurse.inc): one question, and
 *  closed once the fog is on the town. */
async function nurse(): Promise<void> {
  if (!rom || isOut || battle || swapping || asking) return;
  if (inFogNow()) { say('The fog is here. This CENTER is closed.'); return; }
  const c = await ask('HEAL your party?', [['YES', 'yes'], ['NO', '']]);
  if (c !== 'yes' || isOut || !rom) { say('Good luck.'); return; }
  await rom.heal();
  say('Done. Your POKéMON are fully healed.');
}

/** An event's trader (br_event.c): his offer, and if yes, the party menu on the ROM's
 *  screen to pick which one he gets. He keeps it and offers it next. */
async function trade(n: number, species: number): Promise<void> {
  const l = link;
  let given = 0;
  try {
    if (!rom || isOut || battle || swapping) return;
    if (swapping) rom.leave();
    asking?.done('');
    const name = speciesName(species);
    const c = await ask(`I'll trade you my ${name} for one of yours. Which one?`, [['CHOOSE', 'y'], ['NO, THANKS', '']]);
    // Somebody at home's goes through a trade's evolution on the way over (br_loot.c's
    // BrLoot_HomeTrade); an event's trader's does not (br_event.c's Swap).
    const got = n >= HOME_N ? tradedInto(species) : species;
    if (c !== 'y' || !rom || isOut) return;
    swapping = true;
    held.clear();
    try {
      given = await rom.trade(got, () => battleEl.classList.add('on'));
    } finally {
      swapping = false;
      battleEl.classList.remove('on');
      held.clear();
      pressed.clear();
      calmUntil = frame + 30;
    }
    if (given) say(got === species ? `Traded for ${name}!` : `Traded for ${name}! It evolved into ${speciesName(got)}!`);
  } finally {
    if (link === l) l.traded(n, given);
  }
}

/** Somebody at home with a Pokémon to give (br_balls.c): taken across on the ROM's team
 *  screen, as a dropped bag's team is; taken, he is gone for everybody. */
async function gift(n: number, species: number): Promise<void> {
  const l = link;
  let taken = 0;
  try {
    if (!rom || isOut || battle || swapping) return;
    asking?.done('');
    const name = speciesName(species);
    const c = await ask(`Will you look after my ${name} for me?`, [['YES', 'y'], ['NO, THANKS', '']]);
    if (c !== 'y' || !rom || isOut) return;
    swapping = true;
    held.clear();
    try {
      const left = await rom.team([{ species, level: rungForPhase(link.room.ring().phase + 1) }], 'GIFT', () => battleEl.classList.add('on'));
      if (!left.length) taken = species;
    } finally {
      swapping = false;
      battleEl.classList.remove('on');
      held.clear();
      pressed.clear();
      calmUntil = frame + 30;
    }
    // The team screen takes it across as somebody else's, so a trade evolution goes off.
    if (taken) say(`Took the ${speciesName(tradedInto(species))}!`);
  } finally {
    if (link === l) l.traded(n, taken);
  }
}

/** A MART's clerk (pokemart.inc): the shelf at this rung, or the LILYCOVE DEPARTMENT
 *  STORE's, priced as a match prices it; a row, how many, and into the bag the ROM's own
 *  way. Closed in the fog, as the CENTER is. */
async function mart(map: string): Promise<void> {
  if (!rom || !art || isOut || battle || swapping || asking) return;
  const clerk = CLERKS.find((c) => c.map === map);
  if (!clerk) return;
  if (inFogNow()) { say('The fog is here. This MART is closed.'); return; }
  const a = art;
  const name = (id: number) => a.itemName(id) || `item ${id}`;
  let hi = 'Welcome!';
  for (;;) {
    if (!rom || isOut || battle) return;
    const money = await rom.money();
    const items = shelf(clerk, link.room.ring().phase);
    const c = await ask(`${hi} You have ¥${money}. May I help you?`, [
      ...items.map((id): [string, string] => [`${name(id)}  ¥${priceOf(id, a.itemPrice(id))}`, String(id)]),
      ['SEE YA!', ''],
    ]);
    if (!c || !rom || isOut || battle) { say('Please come again!'); return; }
    const id = Number(c), each = priceOf(id, a.itemPrice(id));
    const counts = [1, 5, 10].filter((n) => n * each <= money);
    if (!counts.length) { hi = "You don't have enough money."; continue; }
    const n = Number(await ask(`${name(id)}? Certainly. How many?`, counts.map((k): [string, string] => [`×${k}  ¥${k * each}`, String(k)])));
    if (!n || !rom) { hi = 'Is there anything else I can do for you?'; continue; }
    const took = await rom.buy(id, n, each);
    hi = took ? `Here you go! ${name(id)} ×${took}. Thank you!` : 'You have no more room for items.';
  }
}

const CAUGHT = 7;
const OUTCOME = ['', 'won', 'lost', 'drew', 'ran', 'teleported', 'it fled', 'caught it', 'out of balls', 'forfeited'];
let lastResult = '';

function endBattle(r: Fought | null): void {
  battleEl.classList.remove('on');
  // A fight with a trainer that never got going, or was run from (a forfeit): we keep
  // apart a while, as the match's fleer does, or the two would engage again at once.
  const duel = !!battle?.foe && !battle.foe.bot;
  // A fight that ran over into a new round was the old round's: it neither beats a bot
  // nor puts anybody out of this one (the new round's fresh team is already on its way).
  // Another round, or another match altogether (each one's rounds count from 0).
  const stale = !!battle && (battle.link !== link || battle.round !== link.room.results.round);
  const boss = battle?.boss;
  (battle?.link ?? link).end(duel && (!r?.ok || [4, 9].includes(r.outcome & 0x7f)), !stale && (!!battle?.foe?.bot || boss !== undefined) && !!r?.ok && r.outcome === 1);
  if (!stale && boss !== undefined && r?.ok && r.outcome === 1) say(`You beat ${LEADERS[boss].name}! Took their TM and ¥1000.`);
  const wild = battle && !battle.foe && boss === undefined;
  const by = battle?.foe?.id;
  battle = null;
  held.clear();
  pressed.clear();
  // A held A from the battle's last text must not walk straight into another one.
  calmUntil = frame + 30;
  if (r && !r.ok) lastResult = 'last battle: the ROM did not start it';
  else if (r) lastResult = `last battle: ${wild ? `wild #${r.species} Lv${r.level}, ` : ''}${OUTCOME[r.outcome] ?? r.outcome}`;
  // A whiteout is the end of a trainer's match (Kanto's rules, DESIGN.md §10).
  if (!stale && r?.ok && (r.outcome === 2 || r.outcome === 3)) goOut(r.outcome === 2 ? 'Your team lost the battle.' : 'Your team went down with theirs.', by, !!wild);
}

/** How long a trainer the room says is no longer fighting me may go quiet before the
 *  fight is mine: their page lost the battle engine, or ended it some other way. */
const FOE_QUIET_MS = 10_000;

/** The trainer I am fighting left the room (closed the tab, or went out elsewhere), or
 *  stopped fighting me and went quiet: the fight is mine, as in a match (BrNetlink_PeerOut). */
function foeFrame(): void {
  const foe = battle?.foe;
  if (!foe || foe.bot || battle!.foeGone) return;
  const now = link.room.actor(foe.id);
  const quiet = performance.now() - (battle!.heardAt ?? battle!.shownAt) > FOE_QUIET_MS;
  if (now && ((now.battling && now.foe === link.me) || !quiet)) return;
  battle!.foeGone = true;
  rom?.foeOut();
}

// ---- the fog (room.ts's ring) ----------------------------------------------------------

const outEl = document.getElementById('out')!;
let isOut = false;
let fogTimer = 0;
let lastPhase = -1;
/** The room's events I have told of. */
let toldEvents = 0;
const NAMES = (encounterData as { names: Record<string, string> }).names;
const speciesName = (id: number) => NAMES[id] ?? 'POKéMON';
let wasInFog = false;
/** br_ring.h: BR_FOG_TICK_FRAMES, a bite every four seconds. */
const FOG_TICK = 240;

/** Which way is out of the fog, as arrows ('' inside, or with nowhere to go). */
function safeWay(): string {
  const me = link.room.actor(link.me);
  return me && ringMap ? ringMap.way(me.m.spot) : '';
}

function inFogNow(): boolean {
  const me = link.room.actor(link.me);
  return !!me && link.room.inFog(me.m.spot);
}

/** Out of the match: off the map, watching, and a way back in. */
function goOut(why: string, by?: number, wild?: boolean): void {
  if (isOut || !link.room.actor(link.me)) return;
  isOut = true;
  forget();
  // Nothing more goes into a trainer who is out: what was on its way stays on the ground.
  for (const g of toGive.splice(0)) link.drop(g.key);
  // What I carried lies where I fell (POK-232), once what was already going in is in.
  if (rom) rom.spill().then((bag) => link.out(bag, by, wild), () => link.out(undefined, by, wild));
  else link.out(undefined, by, wild);
  showOut('OUT', why);
}

function showOut(title: string, why: string): void {
  document.getElementById('out-title')!.textContent = title;
  document.getElementById('out-why')!.textContent = why;
  // From a room, out is out until the room's next match (?solo goes round by round).
  document.getElementById('out-next')!.textContent = lobby ? 'You can watch the rest of the match.' : "You're back at the truck when the fog lifts.";
  // The winner's own panel says it all: no OUT over it.
  if (!winEl.classList.contains('on')) outEl.classList.add('on');
  if (!spectating) toggleSpectate();
}
document.getElementById('out-ok')!.addEventListener('click', () => outEl.classList.remove('on'));

// ---- rounds (room.ts's results) --------------------------------------------------------

const winEl = document.getElementById('win')!;
document.getElementById('win-ok')!.addEventListener('click', () => {
  winEl.classList.remove('on');
  // PLAY AGAIN: the room, for its next START.
  if (!matchOn && lobby) { if (room) lobby.roomIs(room); else lobby.backToRoom(); }
});
/** On the bench: came in after the fog closed on this round. */
let waiting = false;
let seenRound = -1;
let shownWin = false;

/** Once a frame: a new round puts me back at the truck with a fresh team; the bench says
 *  so; the last one standing is announced, with how everybody else went out. */
function roundFrame(): void {
  const res = link.room.results;
  const here = !!link.room.actor(link.me);
  if (res.round !== seenRound) {
    const first = seenRound < 0;
    seenRound = res.round;
    shownWin = false;
    // A parade still running ends with its round: the field is the new round's.
    if (romUp && !battle) rom?.leave();
    winEl.classList.remove('on');
    if (!first && here) {
      if (isOut || waiting) {
        isOut = waiting = false;
        outEl.classList.remove('on');
        if (spectating) toggleSpectate();
      }
      follow = link.me;
      wasInFog = false;
      // Everybody starts again: the team the game began with (after any battle still
      // finishing from the round before).
      void rom?.fresh();
      say('A new round! Back at the truck.');
    }
  }
  if (!here && !isOut && !waiting && link.room.bench.some((b) => b.id === link.me)) {
    waiting = true;
    showOut('WATCHING', lobby ? 'This match had started without you. You are in the next one.' : 'The fog had already closed on this round.');
  }
  if (res.winner && !shownWin) {
    shownWin = true;
    record(res.round);
    // Mine: the Hall of Fame first, as the live winner's ROM runs it, then the standings.
    // The parade outlasts AFTER_WIN, so the next round may have begun: these standings, kept.
    if (res.winner === link.me && rom && !battle) {
      const kept = structuredClone(res), bots = botIds(), during = link;
      // Not over the match's own end (PLAY AGAIN), nor into another match.
      void parade().finally(() => { if (matchOn && link === during && !endingShown) standings(false, kept, bots); });
    }
    else standings(false);
  }
  // The relay said the match is over: once the frames that ended it have played here (or
  // a moment has passed), the standings and PLAY AGAIN.
  if (endingAt && (over(link.room) || performance.now() - endingAt > 1500)) {
    endingAt = 0;
    record(res.round);
    endingShown = true;
    standings(true);
  }
}

/** The round I played, into my career on this device (career.ts, the live game's own):
 *  played, won, best placing. Once a round; not for a round I only watched. */
let recordedRound = -1;
function record(round: number): void {
  const res = link.room.results;
  // ?solo is practice, not a match: it stays out of the career.
  if (!link.online || recordedRound === round || !res.entrants.some(([id]) => id === link.me)) return;
  recordedRound = round;
  const i = res.fallen.findIndex((f) => f.id === link.me);
  // Placed by when I went out: the last out is second; never out, and nobody won, a tie for first.
  const placement = res.winner === link.me ? 1 : i >= 0 ? res.entrants.length - i : res.winner ? 2 : 1;
  recordMatch(placement);
}

/** A screen of the ROM's own the page shows (the Hall of Fame, a TM's party screen): it
 *  has the pad until it is over. */
let romUp = false;
/** The match's end standings are up (PLAY AGAIN): nothing puts the round's back over them. */
let endingShown = false;
/** The Hall of Fame: the ROM has the screen until it is over. */
async function parade(): Promise<void> {
  if (!rom) return;
  romUp = true;
  try { await rom.fame(() => battleEl.classList.add('on')); } catch (e) { console.warn('spike fame failed', e); }
  romUp = false;
  battleEl.classList.remove('on');
}

/** The last one standing (or MATCH OVER, with nobody), and how everybody else went out,
 *  the last out first. `over`: the match has ended, and the button is PLAY AGAIN. */
const botIds = () => new Set(link.room.actors.filter((a) => a.bot).map((a) => a.id));
function standings(done: boolean, res = link.room.results, bots = botIds()): void {
  const name = res.entrants.find(([id]) => id === res.winner)?.[1] ?? 'TRAINER';
  document.getElementById('win-title')!.textContent = !res.winner ? 'MATCH OVER' : res.winner === link.me ? 'YOU WIN!' : `${name} WINS`;
  const list = document.getElementById('win-list')!;
  list.replaceChildren();
  const row = (id: number, text: string) => {
    const li = document.createElement('li');
    li.textContent = text;
    if (id === link.me) li.className = 'me';
    list.append(li);
  };
  if (res.winner) row(res.winner, `${name}, last one standing`);
  else {
    // Trainers by name; the bots still wandering, as a count.
    let standing = 0;
    for (const [id, who] of res.entrants) {
      if (res.fallen.some((f) => f.id === id)) continue;
      if (bots.has(id)) standing++;
      else row(id, `${who}, still standing`);
    }
    // The bots go last: the trainers are who the standings are for.
    for (const f of [...res.fallen].reverse()) {
      if (!f.bot) row(f.id, `${f.name}, ${f.left ? 'left' : f.wild ? 'beaten by a wild POKéMON' : f.by ? `beaten by ${f.by}` : 'out in the fog'}`);
    }
    if (standing) row(0, `${standing} bot trainers still standing`);
    document.getElementById('win-ok')!.textContent = done && lobby ? 'PLAY AGAIN' : 'OK';
    outEl.classList.remove('on');
    winEl.classList.add('on');
    return;
  }
  // Trainers by name, last out first; the bots they and the fog beat, as a count.
  for (const f of [...res.fallen].reverse()) {
    if (!f.bot) row(f.id, `${f.name}, ${f.left ? 'left' : f.wild ? 'beaten by a wild POKéMON' : f.by ? `beaten by ${f.by}` : 'out in the fog'}`);
  }
  const out = res.fallen.filter((f) => f.bot).length;
  if (out) row(0, `${out} bot trainers beaten`);
  document.getElementById('win-ok')!.textContent = done && lobby ? 'PLAY AGAIN' : 'OK';
  outEl.classList.remove('on');
  winEl.classList.add('on');
}

// ---- a match, from the room's START to its end (lobby.ts) -----------------------------

let lobby: Lobby | null = null;
/** The room as the relay last said it is. */
let room: RoomInfo | null = null;
/** A match of mine is on (I am in it, or watching it). */
let matchOn = false;

// A reload within a minute comes back as the same trainer with the same team (Cam,
// 2026-10-20): the relay holds the trainer for AWAY_MS, the page keeps what lets it back
// in (the room, its id, its key) and the ROM's own (party, bag, Pokédex), every few
// seconds. A reload mid-battle is a forfeit: the relay does not hold a battling trainer.
const AGAIN = 'spikeB.again';
const AGAIN_ROM = 'spikeB.againRom';
const AGAIN_MS = 60_000;
interface Token { code: string; id: number; key: string; at: number }
function token(): Token | null {
  try {
    const t = JSON.parse(localStorage.getItem(AGAIN) ?? 'null') as Token | null;
    return t && Date.now() - t.at < AGAIN_MS ? t : null;
  } catch { return null; }
}
function forget(): void {
  try { localStorage.removeItem(AGAIN); localStorage.removeItem(AGAIN_ROM); } catch { /* private window */ }
}
/** The team a reload is bringing back, until the ROM has booted to take it. */
let comingBack: string | null = null;
let savedAt = 0;
/** The Safari opening (room.ts SAFARI): its welcome, the drop's question in its last
 *  half minute, and where the drop put me. */
let safariRound = -1;
let pickAsked = -1;
let wasSafari = false;
function safariFrame(ring: Ring): void {
  const me = link.room.actor(link.me);
  if (ring.safari && safariRound !== ring.round && me) {
    safariRound = ring.round;
    say(`Welcome to the SAFARI ZONE! Catch what you can: the drop is in ${Math.ceil(ring.left / 3600)} min.`);
  }
  if (ring.safari && me && pickAsked !== ring.round && ring.left < 30 * 60 && !battle && !swapping && !asking && !isOut) {
    pickAsked = ring.round;
    void pickDrop();
  }
  if (wasSafari && !ring.safari) {
    asking?.done('');
    const here = link.room.actor(link.me)?.m.spot.map;
    if (here && !here.startsWith(SAFARI)) say(`Dropped at ${ringMap?.placeOf(here) || 'somewhere in HOENN'}!`);
  }
  wasSafari = !!ring.safari;
}

/** Drop where? One row a place, the way the fly map names them; ANYWHERE leaves it to the deal. */
async function pickDrop(): Promise<void> {
  const byPlace = new Map<string, string>();
  for (const id of [...placed.keys()].sort()) {
    const p = placed.get(id)!;
    if (!p.m.outdoor || id.startsWith(SAFARI)) continue;
    const name = ringMap?.placeOf(id);
    if (name && !byPlace.has(name)) byPlace.set(name, id);
  }
  const rows = [...byPlace].sort(([a], [b]) => a.localeCompare(b)).map(([name, id]): [string, string] => [name, id]);
  const c = await ask('Drop where?', [['ANYWHERE', ''], ...rows]);
  if (c && link.room.ring().safari) { link.pick(c); say(`You will drop at ${ringMap?.placeOf(c) ?? c}.`); }
}

/** The gym leaders that fell, as the ticker says it (bosses.ts's line). */
let toldGyms = 0;
function gymFrame(): void {
  const g = link.room.gyms;
  if (toldGyms > g.length) toldGyms = 0;
  for (const [n, who] of g.slice(toldGyms)) if (who !== link.room.actor(link.me)?.name) tick(`${who} beat ${LEADERS[n].name}! The gym is closed.`);
  toldGyms = g.length;
}

/** Every few seconds of a match: still here, and the team as it is. */
function remember(): void {
  if (!link?.online || !link.key || !room || !matchOn || isOut || !link.room.actor(link.me)) return;
  const now = Date.now();
  if (now - savedAt < 5000) return;
  savedAt = now;
  try { localStorage.setItem(AGAIN, JSON.stringify({ code: room.code, id: link.me, key: link.key, at: now })); } catch { return; }
  if (rom && !battle && !asking && !swapping && !comingBack) {
    void rom.save().then((t) => { try { localStorage.setItem(AGAIN_ROM, t); } catch { /* full */ } });
  }
}
/** The relay said it is over; the standings wait for its last frames here. */
let endingAt = 0;
let looping = false;

/** A match starts for me (or I come into one under way): its link, and the page as a
 *  match begins it -- a fresh team, nobody out, the camera on my trainer. */
function startMatch(l: WorldLink): void {
  link = l;
  // A patch whose symbols predate the MAP's (gRegionMapEntries, gPlttBufferFaded) has none.
  ringMap = art && RingMap.SYMBOLS.every((n) => Number.isFinite(art!.sym(n))) ? new RingMap(l.room, art) : null;
  matchOn = true;
  endingAt = 0;
  endingShown = false;
  if (romUp && !battle) rom?.leave();
  lobby?.hide();
  isOut = waiting = shownWin = false;
  // Every match's rounds count from 0: what was told or recorded of the last one is not.
  seenRound = lastPhase = recordedRound = safariRound = pickAsked = hudRound = -1;
  wasSafari = false;
  ticks.length = 0;
  toldEvents = 0;
  toldGyms = l.room.gyms.length;
  wasInFog = false;
  toGive.length = 0;
  outEl.classList.remove('on');
  winEl.classList.remove('on');
  if (spectating) toggleSpectate();
  follow = link.me;
  savedAt = 0;
  const back = token();
  comingBack = null;
  if (back && l.online && back.id === l.me) {
    try { comingBack = localStorage.getItem(AGAIN_ROM); } catch { comingBack = null; }
  } else forget();
  if (rom) { rom.reseed(l.room.seed); void (comingBack ? takeBack(rom) : rom.fresh()); }
  if (!looping) {
    looping = true;
    resize();
    requestAnimationFrame((t) => { last = t; loop(t); });
  }
}

/** The team the reload left with, into the booted ROM. */
async function takeBack(r: RomBattles): Promise<void> {
  const t = comingBack;
  comingBack = null;
  if (!t || !(await r.load(t))) await r.fresh();
  else say('Welcome back!');
}

function matchOver(): void {
  forget();
  matchOn = false;
  endingAt = performance.now();
}
document.getElementById('menu')!.addEventListener('click', () => { void openMenu(); });
document.getElementById('find')!.addEventListener('click', () => itemfinder());

// Sound (the live match's MUTE, its own key): the ROM's, heard while its screen is the
// one shown -- a battle, the team screen, a menu, the parade. Its field runs hidden under
// ours between those, and its route music would come through in snatches.
const MUTE_KEY = 'hbr:muted';
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* private window: on */ }
const soundBtn = document.getElementById('sound')!;
let heard = -1;
function soundFrame(): void {
  const v = !muted && battleEl.classList.contains('on') ? 100 : 0;
  if (rom && v !== heard) { rom.emu.setVolume(v); heard = v; }
}
function paintSound(): void { soundBtn.textContent = `Sound: ${muted ? 'off' : 'on'}`; }
soundBtn.addEventListener('click', () => {
  muted = !muted;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* not kept */ }
  paintSound();
});
paintSound();

// ---- Hoenn's hidden items and the ITEMFINDER (br_levels.c, Cam 2026-10-18) -----------

/** Every map's hidden items (tools/br/spike-hidden.py): still buried in a match, and each
 *  trainer can dig each one up once, as each ROM's own flag lets them. */
const HIDDEN = new Map((hiddenJson as [string, number, number, number][]).map(([m, x, y, item]) => [`${m}:${x}:${y}`, { map: m, x, y, item }]));
/** What I dug up this round. */
const dug = new Set<string>();
let dugRound = -1;
function digReady(): boolean {
  const me = link.mine();
  if (link.room.results.round !== dugRound) { dug.clear(); dugRound = link.room.results.round; }
  return !!me && !!rom && !isOut && !spectating && !battle && !swapping && !romUp && !asking && !intro() && !me.battling && !me.m.action;
}
/** A pressed at a buried item's cell: it is mine. */
function dig(): void {
  const me = link.mine();
  if (!me || !digReady() || frame < calmUntil) return;
  const d = ({ 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] } as Record<number, number[]>)[me.m.facing];
  const k = `${me.m.spot.map}:${me.m.spot.x + d[0]}:${me.m.spot.y + d[1]}`;
  const h = HIDDEN.get(k);
  if (!h || dug.has(k)) return;
  dug.add(k);
  toGive.push({ key: 0, item: h.item, hidden: k });
  giveNext();
}
/** The ITEMFINDER: the nearest buried item on this map within its reach (x 7, y 5, the
 *  screen Emerald's searches), as which way and how far; or no response. */
function itemfinder(): void {
  const me = link.mine();
  if (!me || !digReady()) return;
  let best: { x: number; y: number } | null = null;
  for (const h of HIDDEN.values()) {
    if (h.map !== me.m.spot.map || dug.has(`${h.map}:${h.x}:${h.y}`)) continue;
    const dx = h.x - me.m.spot.x, dy = h.y - me.m.spot.y;
    if (Math.abs(dx) > 7 || Math.abs(dy) > 5) continue;
    if (!best || Math.abs(dx) + Math.abs(dy) < Math.abs(best.x) + Math.abs(best.y)) best = { x: dx, y: dy };
  }
  if (!best) { say("Nope! There's no response."); return; }
  const n = Math.abs(best.x) + Math.abs(best.y);
  if (n <= 1) { say('The ITEMFINDER is shaking! It is right here: face it and press A.'); return; }
  const way = (best.y < 0 ? '↑' : best.y > 0 ? '↓' : '') + (best.x < 0 ? '←' : best.x > 0 ? '→' : '');
  say(`The ITEMFINDER responds! Something is buried ${way}, ${n} steps away.`);
}

// ---- the HUD (the live match's corner and ticker: br_hud.c, ticker.ts) -----------------

const cornerEl = document.getElementById('corner')!;
const tickerEl = document.getElementById('ticker')!;
/** Lines waiting their turn, and when the one showing goes. */
const ticks: { text: string; alert: boolean }[] = [];
let tickUntil = 0;
/** Everybody's news, one line at a time (ticker.ts): outs, the ring, a gym, the win. */
function tick(text: string, alert = false): void {
  if (ticks.length < 6) ticks.push({ text, alert });
}
/** Outs that land together go out as one line (POK-324). */
let toldOuts = 0;
let outsSince = 0;
let hudRound = -1;
let toldWin = false;
let cornerText = '';
function hudFrame(): void {
  const res = link.room.results;
  if (res.round !== hudRound) { hudRound = res.round; toldOuts = res.fallen.length; toldWin = !!res.winner; outsSince = 0; }
  const left = res.entrants.length - res.fallen.length;
  if (res.fallen.length > toldOuts) {
    const now = performance.now();
    if (!outsSince) outsSince = now;
    // The endgame's count is everything: each out at once.
    if (now - outsSince >= OUT_BATCH_MS || left <= 3 || res.winner) {
      const batch = res.fallen.slice(toldOuts);
      const lone = batch.length === 1 && batch[0].by ? batch[0].by : undefined;
      const line = outs(0, batch.map((f) => f.name), left, lone);
      if (line) tick(line.text);
      toldOuts = res.fallen.length;
      outsSince = 0;
    }
  }
  if (res.winner && !toldWin) {
    toldWin = true;
    const line = won(0, res.entrants.find(([id]) => id === res.winner)?.[1] ?? 'TRAINER');
    if (line) tick(line.text);
  }
  const now = performance.now();
  if (now >= tickUntil) {
    const next = ticks.shift();
    if (next) {
      tickerEl.textContent = next.text;
      tickerEl.classList.toggle('alert', next.alert);
      tickerEl.classList.add('on');
      tickUntil = now + 3500;
    } else if (tickerEl.classList.contains('on')) tickerEl.classList.remove('on');
  }
  // The corner: how many are left, and the clock (or FOG! while it bites me).
  const ring = link.room.ring();
  const s = Math.ceil(ring.left / 60);
  const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const count = ring.safari ? 'SAFARI' : res.entrants.length ? `${left} LEFT` : `${link.room.actors.length} IN`;
  const fog = !isOut && inFogNow() && frame % 60 < 30;
  const text = `${count}\n${fog ? 'FOG!' : clock}`;
  if (text !== cornerText) {
    cornerText = text;
    cornerEl.textContent = text;
    cornerEl.classList.toggle('fog', fog);
  }
}

/** Once a frame: the ring's news, and the fog's bite while I stand in it. */
function fogFrame(): void {
  const ring = link.room.ring();
  if (ring.phase !== lastPhase) {
    // The ring phase is the level rung (br_levels.c): the host numbers phases from 1.
    const rung = rungForPhase(ring.phase + 1);
    const grew = lastPhase >= 0 && rung > rungForPhase(lastPhase + 1) ? ` All POKéMON are now Lv. ${rung}!` : '';
    if (lastPhase >= 0) {
      if (ring.phase === 0) tick('The fog lifts. A new round!');
      else if (ring.last) tick(`THE FOG COVERS ALL OF HOENN!${grew}`, true);
      else tick(`The fog closes in on ${ringMap?.place(ring) || 'Hoenn'}!${grew}`, true);
    }
    // An event dropped with the ring (DESIGN §Events): the ticker says what and where.
    const evs = link.room.events;
    if (toldEvents > evs.length) toldEvents = 0;
    for (const e of evs.slice(toldEvents)) tick(e.species ? `A legendary ${speciesName(e.species)} at ${ringMap?.placeOf(e.map) || 'HOENN'}!` : `A rare find at ${e.place ?? (ringMap?.placeOf(e.map) || 'HOENN')}!`, !!e.species);
    toldEvents = evs.length;
    lastPhase = ring.phase;
  }
  rom?.setPhase(ring.phase + 1);
  rom?.setSafari(!!ring.safari);
  safariFrame(ring);
  if (isOut || !rom) return;
  // The BAG screen is a menu: the fog bites on the field and in battle (BrRing_Tick).
  if (swapping) return;
  if (battle) {
    // A ring that closes on a trainer mid-battle reaches the battle at its next turn.
    if (inFogNow()) rom.fogNow();
    return;
  }
  const fog = inFogNow();
  if (fog && !wasInFog) { const way = safeWay(); say(`You are in the fog!${way ? ` Safe ${way}` : ''}`); fogTimer = FOG_TICK; }
  wasInFog = fog;
  if (!fog || --fogTimer > 0) return;
  fogTimer = FOG_TICK;
  void rom.bleed().then((alive) => { if (!alive) goOut('Your team fainted in the fog.'); });
}

/** The fog over everything outside the ring, the inside left clear. */
function drawFog(x0: number, y0: number, x1: number, y1: number, home: Placed): void {
  const ring = link.room.ring();
  if (ring.r === Infinity) return;
  ctx.fillStyle = 'rgba(176, 160, 196, 0.5)';
  // Inside, the fog is the fog at the door: all of it or none.
  if (!home.m.outdoor) {
    if (link.room.inFog({ map: home.m.id, x: 0, y: 0 }, ring)) ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    return;
  }
  ctx.beginPath();
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  if (ring.r >= 0) ctx.arc(ring.cx * TILE, ring.cy * TILE, Math.max(ring.r, 0.5) * TILE, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
}

function fogLine(): string {
  const ring = link.room.ring();
  const s = Math.ceil(ring.left / 60);
  const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const way = safeWay();
  const where = inFogNow() ? ` · YOU ARE IN THE FOG${way ? ` · Safe ${way}` : ''}` : '';
  if (ring.safari) return `SAFARI ZONE · the drop in ${clock}`;
  if (ring.r === Infinity) return `fog in ${clock}${where}`;
  if (ring.last) return `FOG EVERYWHERE · new round in ${clock}${where}`;
  return `fog phase ${ring.phase}, closes again in ${clock}${where}`;
}

// While the ROM has the screen, the pad is the ROM's.
const GBA_KEY: Record<string, GbaKey> = { up: 'up', down: 'down', left: 'left', right: 'right', a: 'a', b: 'b', start: 'start' };
// Enter is A on the field and START on the ROM's own screens (the swap's MOVE).
const romKey = (key: string): string | undefined => key === 'Enter' && (swapping || romUp) ? 'start' : KEYMAP[key];
addEventListener('keydown', (e) => {
  const k = romKey(e.key);
  if (k && asking) { if (!e.repeat) askKey(k); }
  else if ((battle || swapping || romUp) && rom && k) rom.press(GBA_KEY[k]);
});
addEventListener('keyup', (e) => { const k = romKey(e.key); if (rom && k) rom.release(GBA_KEY[k]); });
for (const el of document.querySelectorAll<HTMLElement>('.k')) {
  const k = el.dataset.k!;
  el.addEventListener('pointerdown', () => {
    if (asking) askKey(k);
    else if ((battle || swapping || romUp) && rom) rom.press(GBA_KEY[k]);
    else if (k === 'start') void openMenu();
  });
  el.addEventListener('pointerup', () => rom?.release(GBA_KEY[k]));
}

// ---- camera + drawing -----------------------------------------------------------------

const canvas = document.getElementById('world') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let spectating = false;
/** The trainer the camera follows, by id; 0 for a camera dragged free. */
let follow = 0;
let cam = { x: 0, y: 0 }; // world pixel at the screen centre
let zoom = 3; // device pixels per GBA pixel
// The device's pixels. The canvas itself is smaller: drawn at the GBA's own pixels (one
// canvas pixel per device pixel / floor(zoom)) and scaled up by CSS, nearest-neighbour.
// A phone's 2.6M-pixel screen is then ~150k pixels of drawing, the same picture.
let devW = 1, devH = 1;
const modeBtn = document.getElementById('mode')!;

function fitZoom(): number {
  // The game's own view: the GBA's 15 x 10 tiles fit the window, the way the game
  // scales its picture (portrait phones get 15 across, not 15 tall: Cam found that
  // "more zoomed in than normal").
  return Math.max(1, Math.floor(Math.min(devW / 15, devH / 10) / TILE));
}

function resize(): void {
  const dpr = devicePixelRatio || 1;
  devW = Math.round(innerWidth * dpr);
  devH = Math.round(innerHeight * dpr);
  if (!spectating) zoom = fitZoom();
}
addEventListener('resize', resize);

function toggleSpectate(): void {
  if ((isOut || waiting) && spectating) return; // out: watching is all there is
  spectating = !spectating;
  modeBtn.classList.toggle('on', spectating);
  modeBtn.textContent = spectating ? 'Back to my trainer (V)' : 'Spectate (V)';
  if (!spectating) { follow = link.me; zoom = fitZoom(); }
  held.clear();
}
modeBtn.addEventListener('click', toggleSpectate);
const watch = new Watch({
  trainers: () => (link ? actors() : []),
  me: () => link?.me ?? 0,
  spectating: () => spectating,
  follow: () => follow,
  setFollow: (id) => { follow = id; if (id && zoom < 1) zoom = fitZoom(); },
  zoom: () => zoom,
  link: () => link ?? null,
  rom: () => rom,
  idle: () => (isOut || waiting) && !battle && !swapping && !asking,
});

// Drag and pinch / wheel, spectating only. A tap on a trainer follows them.
const pointers = new Map<number, { x: number; y: number }>();
let pinch0: { d: number; zoom: number } | null = null;
let moved = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (!spectating) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  moved = 0;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom };
  }
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p || !spectating) return;
  const dpr = devicePixelRatio || 1;
  if (pointers.size === 1) {
    cam.x -= ((e.clientX - p.x) * dpr) / zoom;
    cam.y -= ((e.clientY - p.y) * dpr) / zoom;
    moved += Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y);
    follow = 0;
  }
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 2 && pinch0) {
    const [a, b] = [...pointers.values()];
    zoom = Math.min(8, Math.max(0.05, (pinch0.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch0.d));
  }
});
const endPointer = (e: PointerEvent) => {
  if (spectating && pointers.size === 1 && moved < 6) followAt(e.clientX, e.clientY);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch0 = null;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  if (!spectating) return;
  e.preventDefault();
  zoom = Math.min(8, Math.max(0.05, zoom * Math.exp(-e.deltaY * 0.0015)));
}, { passive: false });

function followAt(clientX: number, clientY: number): void {
  const dpr = devicePixelRatio || 1;
  const wx = cam.x + (clientX * dpr - devW / 2) / zoom;
  const wy = cam.y + (clientY * dpr - devH / 2) / zoom;
  let best: Actor | null = null;
  let bestD = 24 / Math.min(1, zoom);
  for (const a of actors()) {
    const p = pixelOf(a);
    const d = Math.hypot(p.x + 8 - wx, p.y - wy);
    if (d < bestD) { best = a; bestD = d; }
  }
  if (best) { follow = best.id; if (zoom < 1) zoom = fitZoom(); }
}

/** An actor's tile top-left in world pixels, mid-step included. */
function pixelOf(a: Actor): { x: number; y: number; lift: number } {
  const g = global(a.m.spot)!;
  return { x: g.gx * TILE + a.m.px, y: g.gy * TILE + a.m.py, lift: -a.m.lift };
}

/** The walk anim's frame. A step plays half the anim, one foot (SetStepAnimHandleAlternation
 *  starts it at command 0 or 2 by turns): the stride frame then standing, 8+8 of a walk's 16
 *  frames, and sAnim_RunSouth's 5+3 of a run's 8. Playing the whole anim each step was
 *  twice Emerald's cadence. */
function frameOf(a: Actor): number {
  const act = a.m.action;
  const run = a.m.run && act?.kind === 'step' && SHEETS[String(SKIN_GFX[a.skin])].frames >= 18;
  if (act?.kind === 'step') {
    const late = act.t / act.len >= (run ? 5 / 8 : 1 / 2) ? 1 : 0;
    return (run ? RUN : GO)[a.m.facing][(a.m.strides & 1) * 2 + late];
  }
  // A turn is a walk in place, one foot like a step: sAnim_GoFastSouth's 4+4. A bump into
  // a wall plays the whole of sAnim_GoSouth over its 32 frames.
  if (act?.kind === 'turn') return GO[a.m.facing][(a.m.strides & 1) * 2 + (act.t / act.len >= 1 / 2 ? 1 : 0)];
  if (act && act.kind !== 'hop' && act.kind !== 'warp') return GO[a.m.facing][Math.min(3, Math.floor((act.t / act.len) * 4))];
  return FACE[a.m.facing];
}


function mipFor(p: Placed, z: number): HTMLCanvasElement {
  if (!p.mips) {
    p.mips = [];
    let src: HTMLCanvasElement | null = null;
    for (const f of [4, 8, 16]) {
      const c = document.createElement('canvas');
      c.width = Math.ceil((p.m.w * TILE) / f);
      c.height = Math.ceil((p.m.h * TILE) / f);
      const x = c.getContext('2d')!;
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'high';
      if (src) x.drawImage(src, 0, 0, c.width, c.height);
      else { x.drawImage(p.ground!, 0, 0, c.width, c.height); x.drawImage(p.cover!, 0, 0, c.width, c.height); }
      p.mips.push(c);
      src = c;
    }
  }
  // the biggest copy that is not shrunk again on screen (shrinking is what aliases)
  return p.mips.find((_, i) => z * (4 << i) >= 0.9) ?? p.mips[2];
}

function tint(c: HTMLCanvasElement): string {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  const sum = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let j = 0; j < 3; j++) sum[j] += d[i + j];
  const n = d.length / 4;
  return `rgb(${sum.map((v) => Math.round(v / n)).join(',')})`;
}

const sprites = new Map<number, HTMLCanvasElement>();
function sheet(gfx: number): HTMLCanvasElement | null {
  let s = sprites.get(gfx);
  if (!s && art) { s = art.sprite(gfx, SHEETS[String(gfx)].frames); sprites.set(gfx, s); }
  return s ?? null;
}

let patchArt: { grass: HTMLCanvasElement; water: HTMLCanvasElement } | null = null;
// sAnim_TallGrass's frames, ten apiece, then br_patch.c's breath before the next rustle.
const RUSTLE = [1, 2, 3, 4, 0];
const BREATH = 25;
// br_patch.c's sDrift: a pixel or two either way and back, a step every eight frames.
const DRIFT = [0, 1, 2, 1, 0, -1, -2, -1];

/** The map's marked spots nobody has taken, as the ROM draws them (br_patch.c Draw):
 *  the grass's rustle, darkened; on water a ripple drifting; anywhere else a shadow. */
function drawPatches(p: Placed): void {
  if (!patchArt && art) patchArt = art.patchSheets();
  if (!patchArt) return;
  for (const q of link.room.patchesOn(p.m.id)) {
    if (link.room.isTaken(q.key)) continue;
    const x = (p.gx + q.x) * TILE, y = (p.gy + q.y) * TILE;
    // Each spot's sprite starts when it comes into view, so they rustle out of step.
    const t = (frame + q.key * 13) % (RUSTLE.length * 10 + BREATH);
    const f = t < RUSTLE.length * 10 ? RUSTLE[Math.floor(t / 10)] : 0;
    const drift = DRIFT[((frame + q.key * 7) >> 3) & 7];
    if (isWater(p.m, q.x, q.y)) ctx.drawImage(patchArt.water, f * TILE, 0, TILE, TILE, x + drift, y, TILE, TILE);
    else if (isTallGrass(p.m, q.x, q.y)) ctx.drawImage(patchArt.grass, f * TILE, 0, TILE, TILE, x, y, TILE, TILE);
    else {
      ctx.fillStyle = '#181818';
      ctx.beginPath();
      ctx.ellipse(x + 8 + drift, y + 12, 7, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

let ballArt: HTMLCanvasElement | null = null;
let bagArt: HTMLCanvasElement | null = null;
let nurseArt: HTMLCanvasElement | null = null;
const blobArt = new Map<number, HTMLCanvasElement | null>();
/** SURF's blob under a surfer, facing as they do (frame 2 flipped for east). */
function drawBlob(surferGfx: number, facing: number, dx: number, dy: number): void {
  if (!blobArt.has(surferGfx) && art) blobArt.set(surferGfx, art.surfBlob(surferGfx));
  const img = blobArt.get(surferGfx);
  if (!img) return;
  const f = FACE[facing];
  if (facing === DIR_EAST) {
    ctx.save();
    ctx.translate(dx + 32, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, f * 32, 0, 32, 32, 0, 0, 32, 32);
    ctx.restore();
  } else ctx.drawImage(img, f * 32, 0, 32, 32, dx, dy, 32, 32);
}
const propArt = new Map<number, HTMLCanvasElement>();
/** The trees CUT fells and the boulders STRENGTH moves, where nobody stands on them: a
 *  team that could CUT or push walks the cell (bots/world.ts canStand), and in Emerald
 *  the tree is down or the boulder moved by then. */
function drawProps(visible: Placed[], all: Actor[]): void {
  if (!art) return;
  for (const p of visible) {
    if (!p.props) {
      p.props = [];
      for (let i = 0; i < p.classes.length; i++) {
        const c = p.classes[i];
        if (c === CLASS_CUT || c === CLASS_BOULDER) p.props.push([i % p.m.w, Math.floor(i / p.m.w), c === CLASS_CUT ? OBJ_EVENT_GFX_CUTTABLE_TREE : OBJ_EVENT_GFX_PUSHABLE_BOULDER]);
      }
    }
    for (const [x, y, gfx] of p.props) {
      if (all.some((a) => a.m.spot.map === p.m.id && ((a.m.spot.x === x && a.m.spot.y === y) || (a.m.prev.map === p.m.id && a.m.prev.x === x && a.m.prev.y === y && a.m.action)))) continue;
      let img = propArt.get(gfx);
      if (!img) { img = art.sprite(gfx, 1); propArt.set(gfx, img); }
      ctx.drawImage(img, (p.gx + x) * TILE, (p.gy + y) * TILE + TILE - img.height);
    }
  }
}
/** Each CENTER's nurse behind her counter (two cells up from where you talk to her),
 *  facing out: the one person a match leaves in a CENTER (br_strip.c). */
function drawNurses(visible: Placed[]): void {
  if (!nurseArt && art) nurseArt = art.sprite(OBJ_EVENT_GFX_NURSE, 1);
  if (!nurseArt) return;
  for (const p of visible) {
    const c = p.m.centre;
    if (!c) continue;
    ctx.drawImage(nurseArt, (p.gx + c.counterX) * TILE + (TILE - nurseArt.width) / 2, (p.gy + c.counterY - 2) * TILE + TILE - nurseArt.height);
  }
}
/** The MARTs' clerks (marts.ts), each the way it faces: the first three frames are
 *  down, up and left; right is left turned over. */
const clerkArt = new Map<number, HTMLCanvasElement>();
function drawClerks(visible: Placed[]): void {
  if (!art) return;
  // Events' traders, facing down (br_event.c's GENTLEMAN).
  for (const e of link.room.events) {
    const p = e.trader && placed.get(e.map);
    if (!p || !visible.includes(p)) continue;
    let img = clerkArt.get(OBJ_EVENT_GFX_GENTLEMAN);
    if (!img) clerkArt.set(OBJ_EVENT_GFX_GENTLEMAN, (img = art.sprite(OBJ_EVENT_GFX_GENTLEMAN, 3)));
    const w = img.width / 3;
    ctx.drawImage(img, 0, 0, w, img.height, (p.gx + e.trader!.x) * TILE + (TILE - w) / 2, (p.gy + e.trader!.y) * TILE + TILE - img.height, w, img.height);
  }
  // People at home and floor traders (br_balls.c), facing down: a gift-giver's people.
  for (const h of link.room.homes) {
    const p = !h.gone && placed.get(h.map);
    const img = p && visible.includes(p) ? giftArt(h.n) : null;
    if (p && img) ctx.drawImage(img, (p.gx + h.x) * TILE + (TILE - img.width) / 2, (p.gy + h.y) * TILE + TILE - img.height);
  }
  for (const p of visible) {
    // The gym leaders nobody has beaten yet, facing down (a beaten one has left the gym).
    for (const l of LEADERS) {
      if (l.map !== p.m.id || link.room.bossDown(l.n)) continue;
      l.cells.forEach(([cx, cy], i) => {
        const gfx = l.gfx[i];
        let img = clerkArt.get(gfx);
        if (!img) clerkArt.set(gfx, (img = art!.sprite(gfx, 3)));
        const w = img.width / 3;
        ctx.drawImage(img, 0, 0, w, img.height, (p.gx + cx) * TILE + (TILE - w) / 2, (p.gy + cy) * TILE + TILE - img.height, w, img.height);
      });
    }
    for (const c of CLERKS) {
      if (c.map !== p.m.id) continue;
      const gfx = c.store ? OBJ_EVENT_GFX_WOMAN_3 : OBJ_EVENT_GFX_MART_EMPLOYEE;
      let img = clerkArt.get(gfx);
      if (!img) clerkArt.set(gfx, (img = art.sprite(gfx, 3)));
      const w = img.width / 3, f = c.facing === 1 ? 0 : c.facing === 2 ? 1 : 2;
      const x = (p.gx + c.x) * TILE + (TILE - w) / 2, y = (p.gy + c.y) * TILE + TILE - img.height;
      ctx.save();
      if (c.facing === 4) { ctx.translate(x + w, y); ctx.scale(-1, 1); } else ctx.translate(x, y);
      ctx.drawImage(img, f * w, 0, w, img.height, 0, 0, w, img.height);
      ctx.restore();
    }
  }
}

/** The item balls and bags nobody has taken, as the ROM draws them (br_loot.c: a
 *  fallen trainer's bag is BIRCH's BAG). */
function drawGround(x0: number, y0: number, x1: number, y1: number): void {
  if (!ballArt && art) ballArt = art.sprite(OBJ_EVENT_GFX_ITEM_BALL, 1);
  if (!bagArt && art) bagArt = art.sprite(OBJ_EVENT_GFX_BIRCHS_BAG, 1);
  const put = (img: HTMLCanvasElement | null, map: string, gx: number, gy: number) => {
    const p = placed.get(map);
    if (!img || !p) return;
    const x = (p.gx + gx) * TILE, y = (p.gy + gy) * TILE;
    if (x < x0 - TILE || x > x1 || y < y0 - TILE || y > y1) return;
    ctx.drawImage(img, x + (TILE - img.width) / 2, y + TILE - img.height);
  };
  for (const g of link.room.ground().values()) if (!link.room.picked.has(g.key)) put(g.gift ? giftArt(g.key) : tinted(g.item), g.map, g.x, g.y);
  for (const b of link.room.spills.values()) {
    if (link.room.picked.has(b.key)) continue;
    // An event's legendary stands as itself (br_legend.c's sLegends); a piece with one mon
    // or one item in it is a ball (br_loot.c), anything more a bag.
    const legend = b.legend && art ? legendArt(b.bag.mons![0].species) : b.person ? personArt(b.person.gfx) : null;
    const one = (b.bag.mons?.length ?? 0) + b.bag.items.length === 1 && !b.bag.money;
    put(legend ?? (one ? ballArt : bagArt), b.map, b.x, b.y);
  }
}

/** A ball in its colour (br_balls.h, Cam 2026-10-13: "red = items, blue = TMs, gold =
 *  rare"): the ROM's red ball with its reds moved. */
const tints = new Map<number, HTMLCanvasElement>();
function tinted(item: number): HTMLCanvasElement | null {
  const tier = GOLD.includes(item) ? 2 : isTm(item) ? 1 : 0;
  if (!tier || !ballArt) return ballArt;
  let img = tints.get(tier);
  if (!img) {
    img = document.createElement('canvas');
    img.width = ballArt.width;
    img.height = ballArt.height;
    const c = img.getContext('2d')!;
    c.drawImage(ballArt, 0, 0);
    const px = c.getImageData(0, 0, img.width, img.height);
    const d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      if (r < g + 40 || r < b + 40) continue; // only the ball's reds
      if (tier === 1) { d[i] = b; d[i + 1] = Math.min(255, g + r / 4); d[i + 2] = r; }
      else { d[i] = Math.min(255, r + 24); d[i + 1] = Math.round(r * 0.78); d[i + 2] = Math.round(b * 0.4); }
    }
    c.putImageData(px, 0, 0);
    tints.set(tier, img);
  }
  return img;
}

/** Who stands for a gift, by its key (br_loot.c's sGiftGfx): OLD_MAN, OLD_WOMAN,
 *  EXPERT_M, POKEFAN_F, facing down. */
const GIFT_GFX = [29, 30, 21, 18];
const giftArts = new Map<number, HTMLCanvasElement>();
function giftArt(key: number): HTMLCanvasElement | null {
  const gfx = GIFT_GFX[key % GIFT_GFX.length];
  if (!art) return null;
  let img = giftArts.get(gfx);
  if (!img) giftArts.set(gfx, (img = art.sprite(gfx, 1)));
  return img;
}

const personArts = new Map<number, HTMLCanvasElement>();
function personArt(gfx: number): HTMLCanvasElement | null {
  if (!art) return null;
  let img = personArts.get(gfx);
  if (!img) personArts.set(gfx, (img = art.sprite(gfx, 1)));
  return img;
}

const LEGEND_GFX: Record<number, number> = { 401: 200, 402: 201, 403: 202, 404: 197, 405: 198, 406: 41, 407: 187, 408: 188 };
const legendArts = new Map<number, HTMLCanvasElement>();
function legendArt(species: number): HTMLCanvasElement | null {
  const gfx = LEGEND_GFX[species];
  if (!gfx || !art) return null;
  let img = legendArts.get(gfx);
  if (!img) legendArts.set(gfx, (img = art.sprite(gfx, 1)));
  return img;
}

/** The "!" over a trainer who looked (trainer_see.c's FLDEFF_EXCLAMATION_MARK_ICON, as
 *  br_walkup.c starts it): a white bubble over their head, popping up, until the walk. */
function drawBang(x: number, y: number, t: number): void {
  const bx = Math.round(x + 3), by = Math.round(y - 24 - (t < 6 ? 6 - t : 0));
  ctx.fillStyle = '#303030';
  ctx.fillRect(bx + 1, by, 8, 14);
  ctx.fillRect(bx, by + 1, 10, 12);
  ctx.fillStyle = '#f8f8f8';
  ctx.fillRect(bx + 1, by + 1, 8, 12);
  ctx.fillStyle = '#303030';
  ctx.fillRect(bx + 4, by + 3, 2, 5);
  ctx.fillRect(bx + 4, by + 9, 2, 2);
}

/** The map at world pixel (x, y), or the nearest one to it: whose border fills the space
 *  past every map's edge. Picked by where the camera looks, the same whether it follows a
 *  trainer or is dragged, so the filler never changes with how you got there (Cam). */
function mapUnder(x: number, y: number): Placed | null {
  let best: Placed | null = null;
  let bestD = Infinity;
  for (const p of placed.values()) {
    const x0 = p.gx * TILE, y0 = p.gy * TILE;
    const dx = Math.max(x0 - x, 0, x - (x0 + p.m.w * TILE));
    const dy = Math.max(y0 - y, 0, y - (y0 + p.m.h * TILE));
    const d = dx * dx + dy * dy;
    if (d < bestD) { best = p; bestD = d; }
    if (d === 0) break;
  }
  return best;
}

function draw(): void {
  const all = actors();
  const followed = follow ? all.find((a) => a.id === follow) : undefined;
  if (followed) {
    const p = pixelOf(followed);
    cam.x = p.x + 8;
    cam.y = p.y + 8;
  }
  // Under one GBA pixel per CSS pixel (a spectator zoomed out), CSS pixels are plenty.
  const dpr = devicePixelRatio || 1;
  const k = zoom < dpr ? dpr : Math.floor(zoom);
  const W = Math.ceil(devW / k), H = Math.ceil(devH / k);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const z = zoom / k;
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0d1a14';
  ctx.fillRect(0, 0, W, H);
  // Past every map's edge the GBA repeats the map's 2x2 border block (Route 101's
  // trees): tile the block of the map under the camera, aligned to its even coordinates.
  const home = mapUnder(cam.x, cam.y) ?? placed.get('MAP_LITTLEROOT_TOWN')!;
  if (paint(home) && home.border && z < 0.5) {
    // Far out the 32 px block is noise: one flat colour, its average.
    home.borderTint ??= tint(home.border);
    ctx.fillStyle = home.borderTint;
    ctx.fillRect(0, 0, W, H);
  } else if (home.border) {
    const pat = ctx.createPattern(home.border, 'repeat')!;
    const bx = home.gx * TILE, by = home.gy * TILE;
    pat.setTransform(new DOMMatrix([z, 0, 0, z, Math.round(W / 2 - cam.x * z) + bx * z, Math.round(H / 2 - cam.y * z) + by * z]));
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, H);
  }
  // Whole-pixel camera at zoom >= 1, so tiles never shimmer.
  const ox = Math.round(W / 2 - cam.x * z);
  const oy = Math.round(H / 2 - cam.y * z);
  ctx.setTransform(z, 0, 0, z, ox, oy);
  // Far out, each map is drawn from a quarter-size copy averaged once (mip), because
  // nearest-neighbour shrinking turns trees into static and smoothing every frame is slow.
  const far = z < 0.5;
  const vx0 = -ox / z, vy0 = -oy / z, vx1 = vx0 + W / z, vy1 = vy0 + H / z;
  const visible: Placed[] = [];
  let painted = 0;
  for (const p of placed.values()) {
    const x = p.gx * TILE, y = p.gy * TILE;
    if (x > vx1 || y > vy1 || x + p.m.w * TILE < vx0 || y + p.m.h * TILE < vy0) continue;
    visible.push(p);
    if ((p.ground || painted++ < 2) && paint(p)) {
      if (far) ctx.drawImage(mipFor(p, z), x, y, p.m.w * TILE, p.m.h * TILE);
      else ctx.drawImage(p.ground!, x, y);
    }
  }
  if (!far) for (const p of visible) drawPatches(p);
  if (!far) drawGround(vx0, vy0, vx1, vy1);
  if (!far) drawProps(visible, all);
  const people = all
    .map((a) => ({ a, p: pixelOf(a) }))
    .filter(({ p }) => p.x > vx0 - 32 && p.x < vx1 + 32 && p.y > vy0 - 48 && p.y < vy1 + 32)
    .sort((u, v) => u.p.y - v.p.y);
  for (const { a, p } of people) {
    // On the water: sitting on the blob, bobbing (SURF's pose, FLDEFF_SURF_BLOB's bob).
    const surf = classAt(a.m.spot) === CLASS_WATER;
    const gfx = surf ? (a.skin === 1 ? OBJ_EVENT_GFX_MAY_SURFING : OBJ_EVENT_GFX_BRENDAN_SURFING) : SKIN_GFX[a.skin];
    const info = SHEETS[String(gfx)];
    const s = sheet(gfx);
    if (!s) continue;
    const fr = surf ? FACE[a.m.facing] : frameOf(a);
    const dx = p.x + TILE / 2 - info.w / 2;
    const dy = p.y + TILE - info.h - p.lift + (surf ? ((frame >> 4) & 1) - 2 : 0);
    if (surf) drawBlob(gfx, a.m.facing, dx, dy + 4);
    if (a.m.facing === DIR_EAST) {
      ctx.save();
      ctx.translate(dx + info.w, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(s, fr * info.w, 0, info.w, info.h, 0, 0, info.w, info.h);
      ctx.restore();
    } else ctx.drawImage(s, fr * info.w, 0, info.w, info.h, dx, dy, info.w, info.h);
    // Tall grass hides your feet: the ground's own grass tile over the sprite's bottom half.
    if (!a.m.action && classAt(a.m.spot) === 7) {
      const pl = placed.get(a.m.spot.map)!;
      if (pl.ground) ctx.drawImage(pl.ground, a.m.spot.x * TILE, a.m.spot.y * TILE + 8, TILE, 8, p.x, p.y + 8, TILE, 8);
    }
    if (spectating && a.id === follow) {
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 1 / Math.min(1, z);
      ctx.strokeRect(dx - 1, dy - 1, info.w + 2, info.h + 2);
    }
  }
  for (const p of visible) {
    if (p.cover && !far) ctx.drawImage(p.cover, p.gx * TILE, p.gy * TILE);
  }
  drawNurses(visible);
  drawClerks(visible);
  for (const { a, p } of people) if (a.meet?.walk && link.room.tick - a.meet.since < WALKUP_BANG) drawBang(p.x, p.y - p.lift, link.room.tick - a.meet.since);
  drawFog(vx0, vy0, vx1, vy1, home);
  // A door: the screen fades out and back in over the followed trainer's warp.
  const going = followed?.m.action?.kind === 'warp' ? followed.m.action : null;
  if (going) {
    ctx.fillStyle = `rgba(0, 0, 0, ${1 - Math.abs((going.t / going.len) * 2 - 1)})`;
    ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
  }
  // Zoomed far out, the sprites are specks: mark every trainer with a dot.
  if (z < 0.6) {
    // in canvas pixels, whole ones, so the squares stay sharp
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // mine last, on top
    for (const a of [...all.filter((o) => o.id !== link.me), ...all.filter((o) => o.id === link.me)]) {
      const p = pixelOf(a);
      const mine = a.id === link.me;
      ctx.fillStyle = mine ? '#ff3b3b' : a.battling ? '#ffd34d' : a.bot ? '#ffffff' : '#5ec8ff';
      const r = mine ? 5 : a.bot ? 3 : 4;
      ctx.fillRect(Math.round(ox + (p.x + 8) * z) - r, Math.round(oy + (p.y + 8) * z) - r, r * 2, r * 2);
    }
  }
}

// ---- loop: a fixed 60 Hz sim, drawn on rAF --------------------------------------------

const statsEl = document.getElementById('stats')!;
/** The numbers box is a dev's (?stats); a player sees it only while the ROM loads. */
const SHOW_STATS = new URLSearchParams(location.search).has('stats');
statsEl.classList.add('debug');
const gaps: number[] = [];
let last = performance.now();
let acc = 0;
let simMs = 0;
let drawMs = 0;

function loop(now: number): void {
  const dt = now - last;
  last = now;
  gaps.push(dt);
  if (gaps.length > 120) gaps.shift();
  acc += Math.min(dt, 100);
  const t0 = performance.now();
  let steps = 0;
  while (acc >= 1000 / 60 && steps < 4) {
    acc -= 1000 / 60;
    steps += 1;
    frame += 1;
    for (const e of link.frame(myBits())) startFor(e);
    roundFrame();
    fieldFrame();
    soundFrame();
    doorsFrame();
    fogFrame();
    foeFrame();
    remember();
    gymFrame();
    hudFrame();
    if (pressed.has('a')) dig();
    for (const k of pressed) watch.key(k);
    pressed.clear();
  }
  const t1 = performance.now();
  draw();
  watch.frame();
  if (foundUntil && performance.now() > foundUntil) { foundUntil = 0; foundEl.classList.remove('on'); }
  const t2 = performance.now();
  simMs = simMs * 0.9 + (t1 - t0) * 0.1;
  drawMs = drawMs * 0.9 + (t2 - t1) * 0.1;
  if (frame % 15 === 0) {
    statsEl.classList.toggle('debug', SHOW_STATS || !rom);
    const sorted = [...gaps].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const fps = 1000 / (gaps.reduce((s, g) => s + g, 0) / gaps.length);
    const here = link.mine()?.m.spot ?? { map: 'MAP_LITTLEROOT_TOWN', x: 0, y: 0 };
    statsEl.textContent =
      `${fps.toFixed(0)} fps · p95 gap ${p95.toFixed(1)} ms\n` +
      `sim ${simMs.toFixed(2)} ms · draw ${drawMs.toFixed(2)} ms · art from your ROM ${artMs.toFixed(0)} ms\n` +
      `${link.room.actors.length} trainers · ${here.map.replace('MAP_', '')} ${here.x},${here.y}\n${link.status()}` +
      `\nROM ${rom ? (battle ? 'fighting' : 'paused, waiting to fight') : 'booting'}` +
      (lastStart ? ` · battle up in ${lastStart.frames} frames (${lastStart.ms.toFixed(0)} ms)` : '') +
      `\n${fogLine()}` +
      (lastResult ? `\n${lastResult}` : '') +
      (spectating ? `\nzoom ${zoom.toFixed(2)} · drag, pinch, tap a trainer` : '');
  }
  requestAnimationFrame(loop);
}

// ---- boot -----------------------------------------------------------------------------

const DEFAULT_RELAY_URL = 'wss://hoenn-relay-production.up.railway.app';

async function boot(): Promise<void> {
  const hoenn = new WorldIndex(((await import('./data/world.json')).default as { maps: WorldMap[] }).maps);
  placed = layout(hoenn.maps);
  let files: Awaited<ReturnType<typeof loadRom>>;
  try {
    files = await loadRom(gbaCanvas, (t) => { statsEl.textContent = t; });
  } catch (e) {
    console.warn('spike ROM not loaded', e);
    return;
  }
  const t0 = performance.now();
  art = new RomArt(files.rom, files.sym);
  judge = makeJudge(files);
  paint(placed.get('MAP_LITTLEROOT_TOWN')!);
  artMs = performance.now() - t0;
  // One Hoenn for everybody on the page: the relay's (?world=<ws url> for another
  // relay), or, with none to reach (or ?solo), the page's own with the bots.
  const patches = await loadPatches();
  const q = new URLSearchParams(location.search);
  const url = q.get('world') ?? `${(import.meta.env.VITE_RELAY_URL as string | undefined) || DEFAULT_RELAY_URL}/world`;
  // The rest of Hoenn, a map a tick, so zooming out never waits.
  const rest = [...placed.values()];
  const next = () => { const p = rest.find((r) => !r.mips); if (p) { paint(p); mipFor(p, 0); setTimeout(next, 16); } };
  setTimeout(next, 500);
  const booted = (r: RomBattles) => { rom = r; if (link) r.reseed(link.room.seed); if (comingBack) void takeBack(r); giveNext(); };
  if (q.has('solo')) {
    // The debug path (Cam, 2026-10-29): straight into a world of the page's own, the bots
    // and nobody else. A quicker fog to try it: ?ring=<seconds a phase>.
    startMatch(soloLink(hoenn.maps, patches, hoenn.world, (crypto.getRandomValues(new Uint32Array(1))[0] || 1) >>> 0));
    const ringSecs = Number(q.get('ring'));
    if (ringSecs > 0) link.room.ringPhase = link.room.opening = Math.round(ringSecs * 60);
  } else {
    // The live game's way in: the menu, a room, START (lobby.ts).
    document.getElementById('intro')?.remove();
    const make = (seed: number) => makeRoom(hoenn.maps, patches, seed, hoenn.world);
    const sock = connectWorld(url, make, {
      onRoom: (r) => {
        room = r;
        if (matchOn && !r.playing) matchOver();
        // The standings stay up until PLAY AGAIN; then the room as it is by then.
        else if (!matchOn && !winEl.classList.contains('on')) lobby!.roomIs(r);
      },
      onNoRoom: (code) => { forget(); lobby!.menu(code ? `There is no room ${code}.` : 'Every place in the world is taken.'); },
      onMatch: (l) => startMatch(l),
      onClosed: () => { matchOn = false; lobby!.menu('Lost the relay. Reload to play again.'); },
    });
    lobby = new Lobby({
      join: (how) => sock.join(me().name, me().skin, how),
      start: () => sock.start(),
      leave: () => location.reload(),
    });
    // Reloaded within a minute of a match: straight back in (or, too late, in to watch).
    const back = token();
    if (back) { lobby.hide(); sock.join(me().name, me().skin, { code: back.code, again: { code: back.code, id: back.id, key: back.key } }); }
    else lobby.menu();
  }
  bootRom(files, link?.room.seed ?? 0).then(booted, (e) => console.warn('spike ROM not booted', e));
  (window as unknown as { __spike: unknown }).__spike = { get link() { return link; }, get lobby() { return lobby; }, get room() { return room; }, actors, placed, goOut, get zoom() { return zoom; }, set zoom(v: number) { zoom = v; }, cam, toggleSpectate, startFor, handoff, get rom() { return rom; }, get battle() { return battle; }, get lastStart() { return lastStart; }, get lastResult() { return lastResult; }, get isOut() { return isOut; }, get waiting() { return waiting; }, get swapping() { return swapping; }, get asking() { return !!asking; }, get spectating() { return spectating; } };
}

void boot();
