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
import { DIR_EAST } from './sim';
import { KEY_A, KEY_B, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_UP, makeRoom, type Actor, type Bag, type RoomEvent } from './shared/room';
import { SKIN_GFX } from './shared/bots';
import { onlineLink, soloLink, type WorldLink } from './net';
import { bootRom, loadRom, lastStart, type Fought, type RomBattles } from './rom';
import { groundCount } from './shared/items';
import { RomArt } from './romart';
import type { GbaKey } from '../src/emu';
import type { PackedMon } from '../src/net/wire';
import spritesData from '../src/data/sprites.json';

const TILE = 16;
// include/constants/event_objects.h.
const OBJ_EVENT_GFX_ITEM_BALL = 59;
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
  classes: Uint8Array;
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
  return placed;
}

let art: RomArt | null = null;
/** A map's pictures, cut from the ROM the first time it is seen (~20 ms a map); the rest
 *  are cut in the background after boot so a zoom-out never waits on them. */
function paint(p: Placed): boolean {
  if (p.ground) return true;
  if (!art) return false;
  const a = art.map(p.m.group, p.m.num);
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
addEventListener('keydown', (e) => {
  if (intro()) return;
  if (e.key === 'v' || e.key === 'V') { toggleSpectate(); return; }
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
  if (spectating || battle || intro()) return 0;
  const bits = (held.has('up') ? KEY_UP : 0) | (held.has('down') ? KEY_DOWN : 0) | (held.has('left') ? KEY_LEFT : 0) |
    (held.has('right') ? KEY_RIGHT : 0) | (held.has('b') ? KEY_B : 0) | (held.has('a') && frame >= calmUntil ? KEY_A : 0);
  return bits;
}

// ---- marked spots: the live game's visible encounters ------------------------------------

// The room deals them from its seed the way every ROM deals them (bots/patches.ts,
// br_patch.c's Pick), and the ROM rolls the national stand-ins off the same seed.

// ---- the battle handoff: the real ROM fights, the page waits ---------------------------

const battleEl = document.getElementById('battle')!;
document.getElementById('intro-go')!.addEventListener('click', () => document.getElementById('intro')!.remove());
const battleNote = document.getElementById('battle-note')!;
const gbaCanvas = document.getElementById('gba') as HTMLCanvasElement;
let rom: RomBattles | null = null;
let artMs = 0;
let battle: { foe: Actor | null; shownAt: number } | null = null;
let calmUntil = 0;
const handoff: number[] = []; // ms from the trigger to the ROM's first battle frame, and back

function mon(species: number, level: number): PackedMon {
  const hp = level * 3 + 10;
  return {
    species, level, hp, maxHp: hp, status: 0, moves: [{ id: 33, pp: 35, ppUps: 0 }], heldItem: 0,
    otId: 0, personality: (species * 2654435761) >>> 0, exp: 0, nickname: '', ot: '',
  };
}

/** A battle the ROM fights, the page showing it from its first frame and taking the
 *  screen back when it is over. */
function handOff(foe: Actor | null, run: (r: RomBattles, onStart: () => void) => Promise<Fought>): void {
  held.clear();
  battle = { foe, shownAt: performance.now() };
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
const toGive: ({ key: number; item: number } | { key: number; bag: Bag; name: string })[] = [];
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
    takeBag(next.key, next.bag, next.name).catch((e) => console.warn('spike bag failed', e)).finally(() => { giving = false; giveNext(); });
    return;
  }
  const { key, item } = next;
  rom.give(item, groundCount(item)).then((got) => {
    // What the ROM made of it (br_items.c's Apply), not what was on the ground.
    if (!got) {
      say(`No room in the bag for ${name(item)}.`);
      link.drop(key); // it stays where it lay
    } else if (got.items.length) say(`Found ${got.items.map((g) => `${g.n > 1 ? `${g.n} ` : ''}${name(g.id)}`).join(', ')}!`);
    else if (got.money) say(`Sold ${name(item)} for ¥${got.money}.`);
    else say(`${name(item)}! Your team got stronger.`);
  }, (e) => console.warn('spike give failed', e)).finally(() => { giving = false; giveNext(); });
}

/** A fallen trainer's bag, row by row into mine the ROM's way, and its money. What did
 *  not fit goes back down as the bag, for somebody else (POK-294: nothing leaves). */
async function takeBag(key: number, bag: Bag, who: string): Promise<void> {
  const r = rom!;
  const rest: Bag = { items: [], money: 0 };
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
  await r.addMoney(bag.money);
  const money = bag.money ? ` and ¥${bag.money}` : '';
  say(`Took ${who}'s bag: ${took} item${took === 1 ? '' : 's'}${money}.${rest.items.length ? ' Some would not fit.' : ''}`);
  if (rest.items.length) link.drop(key, rest);
}

/** What the room started for me: A at a bot, or a marked spot I landed on (the room took
 *  it as the battle started, as BrPatch_Take does), or A at an item ball. */
function startFor(e: RoomEvent): void {
  if (e.type === 'item' || e.type === 'bag') {
    toGive.push(e.type === 'item' ? { key: e.key, item: e.item } : { key: e.key, bag: e.bag, name: e.name });
    giveNext();
    return;
  }
  if (e.type === 'fight') {
    const foe = link.room.actor(e.foe);
    if (!foe) { link.end(); return; }
    // POOCHYENA and ZIGZAGOON (Emerald's internal species ids, not the dex's).
    const party = [mon(286, 5), mon(288, 5)];
    const fog = inFogNow();
    handOff(foe, (r, onStart) => r.fight(foe.name, party, foe.skin, onStart, fog));
  } else {
    const m = placed.get(e.map)!.m;
    const fog = inFogNow();
    handOff(null, (r, onStart) => r.wild(m.group, m.num, art!.behavior(m.group, m.num, e.x, e.y), onStart, fog));
  }
}

const OUTCOME = ['', 'won', 'lost', 'drew', 'ran', 'teleported', 'it fled', 'caught it', 'out of balls', 'forfeited'];
let lastResult = '';

function endBattle(r: Fought | null): void {
  battleEl.classList.remove('on');
  link.end();
  const wild = battle && !battle.foe;
  battle = null;
  held.clear();
  pressed.clear();
  // A held A from the battle's last text must not walk straight into another one.
  calmUntil = frame + 30;
  if (r && !r.ok) lastResult = 'last battle: the ROM did not start it';
  else if (r) lastResult = `last battle: ${wild ? `wild #${r.species} Lv${r.level}, ` : ''}${OUTCOME[r.outcome] ?? r.outcome}`;
  // A whiteout is the end of a trainer's match (Kanto's rules, DESIGN.md §10).
  if (r?.ok && (r.outcome === 2 || r.outcome === 3)) goOut(r.outcome === 2 ? 'Your team lost the battle.' : 'Your team went down with theirs.');
}

// ---- the fog (room.ts's ring) ----------------------------------------------------------

const outEl = document.getElementById('out')!;
let isOut = false;
let fogTimer = 0;
let lastPhase = -1;
let wasInFog = false;
/** br_ring.h: BR_FOG_TICK_FRAMES, a bite every four seconds. */
const FOG_TICK = 240;

function inFogNow(): boolean {
  const me = link.room.actor(link.me);
  return !!me && link.room.inFog(me.m.spot);
}

/** Out of the match: off the map, watching, and a way back in. */
function goOut(why: string): void {
  if (isOut) return;
  isOut = true;
  // Nothing more goes into a trainer who is out: what was on its way stays on the ground.
  for (const g of toGive.splice(0)) link.drop(g.key);
  // What I carried lies where I fell (POK-232), once what was already going in is in.
  if (rom) rom.spill().then((bag) => link.out(bag), () => link.out());
  else link.out();
  document.getElementById('out-why')!.textContent = why;
  outEl.classList.add('on');
  if (!spectating) toggleSpectate();
}
document.getElementById('rejoin')!.addEventListener('click', () => location.reload());

/** Once a frame: the ring's news, and the fog's bite while I stand in it. */
function fogFrame(): void {
  const ring = link.room.ring();
  if (ring.phase !== lastPhase) {
    if (lastPhase >= 0) {
      if (ring.phase === 0) say('The fog lifts. A new round!');
      else if (ring.last) say('THE FOG COVERS ALL OF HOENN!');
      else say(ring.phase === 1 ? 'The fog is rolling in!' : 'The fog is closing in!');
    }
    lastPhase = ring.phase;
  }
  if (isOut || !rom) return;
  if (battle) {
    // A ring that closes on a trainer mid-battle reaches the battle at its next turn.
    if (inFogNow()) rom.fogNow();
    return;
  }
  const fog = inFogNow();
  if (fog && !wasInFog) { say('You are in the fog!'); fogTimer = FOG_TICK; }
  wasInFog = fog;
  if (!fog || --fogTimer > 0) return;
  fogTimer = FOG_TICK;
  void rom.bleed().then((alive) => { if (!alive) goOut('Your team fainted in the fog.'); });
}

/** The fog over everything outside the ring, the inside left clear. */
function drawFog(x0: number, y0: number, x1: number, y1: number): void {
  const ring = link.room.ring();
  if (ring.r === Infinity) return;
  ctx.fillStyle = 'rgba(176, 160, 196, 0.5)';
  ctx.beginPath();
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  if (ring.r >= 0) ctx.arc(ring.cx * TILE, ring.cy * TILE, Math.max(ring.r, 0.5) * TILE, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
}

function fogLine(): string {
  const ring = link.room.ring();
  const s = Math.ceil(ring.left / 60);
  const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const where = inFogNow() ? ' · YOU ARE IN THE FOG' : '';
  if (ring.r === Infinity) return `fog in ${clock}${where}`;
  if (ring.last) return `FOG EVERYWHERE · new round in ${clock}${where}`;
  return `fog phase ${ring.phase}, closes again in ${clock}${where}`;
}

// While the ROM has the screen, the pad is the ROM's.
const GBA_KEY: Record<string, GbaKey> = { up: 'up', down: 'down', left: 'left', right: 'right', a: 'a', b: 'b' };
addEventListener('keydown', (e) => { const k = KEYMAP[e.key]; if (battle && rom && k) rom.press(GBA_KEY[k]); });
addEventListener('keyup', (e) => { const k = KEYMAP[e.key]; if (rom && k) rom.release(GBA_KEY[k]); });
for (const el of document.querySelectorAll<HTMLElement>('.k')) {
  const k = el.dataset.k!;
  el.addEventListener('pointerdown', () => { if (battle && rom) rom.press(GBA_KEY[k]); });
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
  if (isOut && spectating) return; // out: watching is all there is
  spectating = !spectating;
  modeBtn.classList.toggle('on', spectating);
  modeBtn.textContent = spectating ? 'Back to my trainer (V)' : 'Spectate (V)';
  if (!spectating) { follow = link.me; zoom = fitZoom(); }
  held.clear();
}
modeBtn.addEventListener('click', toggleSpectate);

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

/** The walk anim's frame: a stride's four frames over the action, feet alternating. */
function frameOf(a: Actor): number {
  const act = a.m.action;
  const tab = a.m.run && act?.kind === 'step' && SHEETS[String(SKIN_GFX[a.skin])].frames >= 18 ? RUN : GO;
  if (act && act.kind !== 'hop') {
    const q = Math.min(3, Math.floor((act.t / act.len) * 4));
    return tab[a.m.facing][(q + (a.m.strides & 1) * 2) % 4];
  }
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
  for (const g of link.room.ground().values()) if (!link.room.picked.has(g.key)) put(ballArt, g.map, g.x, g.y);
  for (const b of link.room.spills.values()) if (!link.room.picked.has(b.key)) put(bagArt, b.map, b.x, b.y);
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
  const people = all
    .map((a) => ({ a, p: pixelOf(a) }))
    .filter(({ p }) => p.x > vx0 - 32 && p.x < vx1 + 32 && p.y > vy0 - 48 && p.y < vy1 + 32)
    .sort((u, v) => u.p.y - v.p.y);
  for (const { a, p } of people) {
    const gfx = SKIN_GFX[a.skin];
    const info = SHEETS[String(gfx)];
    const s = sheet(gfx);
    if (!s) continue;
    const fr = frameOf(a);
    const dx = p.x + TILE / 2 - info.w / 2;
    const dy = p.y + TILE - info.h - p.lift;
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
  drawFog(vx0, vy0, vx1, vy1);
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
    fogFrame();
    pressed.clear();
  }
  const t1 = performance.now();
  draw();
  if (foundUntil && performance.now() > foundUntil) { foundUntil = 0; foundEl.classList.remove('on'); }
  const t2 = performance.now();
  simMs = simMs * 0.9 + (t1 - t0) * 0.1;
  drawMs = drawMs * 0.9 + (t2 - t1) * 0.1;
  if (frame % 15 === 0) {
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
  paint(placed.get('MAP_LITTLEROOT_TOWN')!);
  artMs = performance.now() - t0;
  // One Hoenn for everybody on the page: the relay's (?world=<ws url> for another
  // relay), or, with none to reach (or ?solo), the page's own with the bots.
  const patches = await loadPatches();
  const q = new URLSearchParams(location.search);
  const url = q.get('world') ?? `${(import.meta.env.VITE_RELAY_URL as string | undefined) || DEFAULT_RELAY_URL}/world`;
  statsEl.textContent = 'joining the shared world...';
  const online = q.has('solo') ? null : await onlineLink(url, 'TRAINER', Math.random() < 0.5 ? 0 : 1, (seed) => makeRoom(hoenn.maps, patches, seed, hoenn.world));
  link = online ?? soloLink(hoenn.maps, patches, hoenn.world, (crypto.getRandomValues(new Uint32Array(1))[0] || 1) >>> 0);
  // A quicker fog to try it alone: ?ring=<seconds a phase> (solo only: the relay's ring is
  // everybody's).
  const ringSecs = Number(q.get('ring'));
  if (!link.online && ringSecs > 0) link.room.ringPhase = Math.round(ringSecs * 60);
  follow = link.me;
  resize();
  requestAnimationFrame((t) => { last = t; loop(t); });
  // The rest of Hoenn, a map a tick, so zooming out never waits.
  const rest = [...placed.values()];
  const next = () => { const p = rest.find((r) => !r.mips); if (p) { paint(p); mipFor(p, 0); setTimeout(next, 16); } };
  setTimeout(next, 500);
  bootRom(files, link.room.seed).then((r) => { rom = r; giveNext(); }, (e) => console.warn('spike ROM not booted', e));
  (window as unknown as { __spike: unknown }).__spike = { link, actors, placed, goOut, get zoom() { return zoom; }, set zoom(v: number) { zoom = v; }, cam, toggleSpectate, startFor, handoff, get rom() { return rom; }, get battle() { return battle; }, get lastStart() { return lastStart; } };
}

void boot();
