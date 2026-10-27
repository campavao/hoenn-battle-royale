// Spike B (engine-path thread, 2026-10-27): the overworld as one world the page owns.
//
// Throwaway. It answers one question: if every trainer -- you, the bots, the people you
// watch -- stands in ONE world model the page simulates, and the ROM is only asked to
// fight, do the sync bugs go away, does it hold 60 fps on a phone, and does walking still
// feel like Emerald?
//
// One source of position: `actors`. The renderer only reads it. The camera is either
// glued to an actor or dragged freely over the whole of Hoenn.
//
// Reuses the shell's own data: world.json through bots/world.ts (the same walkability,
// ledges, heights and seams the bots already walk on) and the field-maps / field-sprites
// stills. Nothing here is shell code.

import { loadHoenn } from '../src/bots/hoenn';
import type { World, WorldMap, Spot } from '../src/bots/world';
import { DIR_EAST, DIR_SOUTH, newMover, stepFn, tick, type Keys, type Mover, type StepFn } from './sim';
import { bootRom, lastStart, type RomBattles } from './rom';
import type { GbaKey } from '../src/emu';
import type { PackedMon } from '../src/net/wire';
import spritesData from '../src/data/sprites.json';

const TILE = 16;
const SHEETS = spritesData as Record<string, { name: string; w: number; h: number; frames: number }>;

// ---- layout: every outdoor map at a place in one plane --------------------------------

interface Placed {
  m: WorldMap;
  gx: number; // tiles
  gy: number;
  ground?: HTMLImageElement;
  cover?: HTMLImageElement;
  border?: HTMLImageElement;
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

function img(src: string): HTMLImageElement {
  const i = new Image();
  i.src = src;
  return i;
}

// ---- actors: the one source of position ------------------------------------------------

// sAnim_GoSouth/North/West/East, and the running sheet's (frames 9..17 of BrendanNormal).
const GO = { 1: [3, 0, 4, 0], 2: [5, 1, 6, 1], 3: [7, 2, 8, 2], 4: [7, 2, 8, 2] } as Record<number, number[]>;
const RUN = { 1: [12, 9, 13, 9], 2: [14, 10, 15, 10], 3: [16, 11, 17, 11], 4: [16, 11, 17, 11] } as Record<number, number[]>;
const FACE = { 1: 0, 2: 1, 3: 2, 4: 2 } as Record<number, number>;

interface Actor {
  id: number;
  name: string;
  gfx: number;
  /** Position, facing and the action in flight: sim.ts's, the ROM's rules, for everyone. */
  m: Mover;
  bot?: { rng: number; wait: number; dir: number; left: number; walk: boolean };
  battling?: boolean;
  /** A step whose arrival hasn't been checked yet (grass). */
  arriving?: boolean;
}

// ---- input ----------------------------------------------------------------------------

const held = new Set<string>();
const pressed = new Set<string>();
const KEYMAP: Record<string, string> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', x: 'b', X: 'b', z: 'a', Z: 'a', Shift: 'b', Enter: 'a', ' ': 'a',
};
addEventListener('keydown', (e) => {
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
  const down = (e: PointerEvent) => { e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('down'); if (!held.has(k)) pressed.add(k); held.add(k); };
  const up = () => { el.classList.remove('down'); held.delete(k); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

// ---- the sim --------------------------------------------------------------------------

let world: World;
let placed: Map<string, Placed>;
const actors: Actor[] = [];
let player: Actor;
let frame = 0;
let baseStep: StepFn;

function global(s: Spot): { gx: number; gy: number } | null {
  const p = placed.get(s.map);
  return p ? { gx: p.gx + s.x, gy: p.gy + s.y } : null;
}

function classAt(s: Spot): number {
  const p = placed.get(s.map);
  if (!p || s.x < 0 || s.y < 0 || s.x >= p.m.w || s.y >= p.m.h) return 1;
  return p.classes[s.y * p.m.w + s.x];
}

/** Another trainer stands there, or is stepping onto it: an object event is solid. */
function occupied(self: Actor, s: Spot): boolean {
  const g = global(s);
  if (!g) return true;
  return actors.some((o) => {
    if (o === self) return false;
    const og = global(o.m.spot);
    return !!og && og.gx === g.gx && og.gy === g.gy;
  });
}

/** Doors lead indoors, which this spike does not draw, so they are walls here; so is a
 *  map the layout never placed. */
function stepFor(a: Actor): StepFn {
  return (from, dir) => {
    const r = baseStep(from, dir);
    if (!r || !placed.has(r.to.map) || occupied(a, r.to)) return null;
    return r;
  };
}

function rand(a: Actor): number {
  let x = a.bot!.rng;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  a.bot!.rng = x >>> 0;
  return a.bot!.rng / 4294967296;
}

const KEY_OF: Record<number, keyof Keys> = { 1: 'down', 2: 'up', 3: 'left', 4: 'right' };

/** A bot's thumb on the pad: wander a few tiles, stop, look around. Its keys go through
 *  the same sim.ts as yours, so it turns, runs and bumps by the ROM's rules. */
function botKeys(a: Actor): Keys {
  const b = a.bot!;
  if (a.m.action) return b.left > 0 ? { [KEY_OF[b.dir]]: true, b: b.walk } : {};
  if (b.wait > 0) { b.wait -= 1; return {}; }
  if (b.left <= 0) {
    b.dir = 1 + Math.floor(rand(a) * 4);
    b.left = 1 + Math.floor(rand(a) * 6);
    b.walk = rand(a) < 0.4;
  }
  if (!stepFor(a)(a.m.spot, b.dir)) { b.left = 0; b.wait = 10 + Math.floor(rand(a) * 30); return {}; }
  b.left -= 1;
  if (b.left === 0) b.wait = Math.floor(rand(a) * 90);
  return { [KEY_OF[b.dir]]: true, b: b.walk };
}

function playerKeys(): Keys {
  if (spectating) return {};
  return { up: held.has('up'), down: held.has('down'), left: held.has('left'), right: held.has('right'), b: held.has('b') };
}

function tickActor(a: Actor): void {
  if (a.battling) return;
  const before = a.m.strides;
  tick(a.m, a === player ? playerKeys() : botKeys(a), stepFor(a));
  if (a.m.strides !== before) a.arriving = true;
  if (a === player && !a.m.action) {
    if (a.arriving) {
      a.arriving = false;
      if (classAt(a.m.spot) === 7 && Math.random() < 0.12) startBattle('wild', null);
    }
    if (pressed.has('a')) talk();
  }
}

function facingSpot(a: Actor): Spot {
  const d = { 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] }[a.m.facing]!;
  return { map: a.m.spot.map, x: a.m.spot.x + d[0], y: a.m.spot.y + d[1] };
}

function talk(): void {
  const g = global(facingSpot(player));
  const other = actors.find((o) => {
    if (o === player || o.m.action) return false;
    const og = global(o.m.spot);
    return !!og && !!g && og.gx === g.gx && og.gy === g.gy;
  });
  if (other) startBattle('trainer', other);
}

// ---- the battle handoff: the real ROM fights, the page waits ---------------------------

const battleEl = document.getElementById('battle')!;
const battleNote = document.getElementById('battle-note')!;
const gbaCanvas = document.getElementById('gba') as HTMLCanvasElement;
let rom: RomBattles | null = null;
let battle: { foe: Actor | null; shownAt: number } | null = null;
const handoff: number[] = []; // ms from the trigger to the ROM's first battle frame, and back

// Emerald's internal species ids (not the dex's): what lives around Littleroot.
const WILD = [286, 288, 290, 289]; // POOCHYENA ZIGZAGOON WURMPLE (and a LINOONE)
function mon(species: number, level: number): PackedMon {
  return {
    species, level, hp: 1, maxHp: 1, status: 0, moves: [{ id: 33, pp: 35, ppUps: 0 }], heldItem: 0,
    otId: 0, personality: (species * 2654435761) >>> 0, exp: 0, nickname: '', ot: '',
  };
}

function startBattle(kind: 'wild' | 'trainer', foe: Actor | null): void {
  player.battling = true;
  if (foe) {
    foe.battling = true;
    foe.m.facing = foe.m.moveDir = ({ 1: 2, 2: 1, 3: 4, 4: 3 } as Record<number, number>)[player.m.facing];
  }
  held.clear();
  battle = { foe, shownAt: performance.now() };
  battleEl.classList.add('on');
  if (!rom) {
    battleNote.textContent = 'The ROM is still booting (or web/public/spike-rom is missing).';
    setTimeout(endBattle, 1500);
    return;
  }
  battleNote.textContent = '';
  const t0 = performance.now();
  const party = kind === 'wild' ? [mon(WILD[Math.floor(Math.random() * WILD.length)], 3)] : [mon(286, 5), mon(288, 5)];
  const firstFrame = rom.emu.onFrame(() => { handoff.push(performance.now() - t0); firstFrame(); });
  void rom.fight(kind === 'wild' ? 'WILD' : foe!.name.split(' ')[0].slice(0, 7), party).then(endBattle);
}

function endBattle(): void {
  battleEl.classList.remove('on');
  player.battling = false;
  if (battle?.foe) battle.foe.battling = false;
  battle = null;
  held.clear();
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
let follow: Actor;
let cam = { x: 0, y: 0 }; // world pixel at the screen centre
let zoom = 3; // device pixels per GBA pixel
const modeBtn = document.getElementById('mode')!;

function fitZoom(): number {
  // about fifteen tiles tall, the way the whole-window build shows a desktop
  const h = canvas.height;
  return Math.max(1, Math.floor(h / (TILE * 15)));
}

function resize(): void {
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  if (!spectating) zoom = fitZoom();
}
addEventListener('resize', resize);

function toggleSpectate(): void {
  spectating = !spectating;
  modeBtn.classList.toggle('on', spectating);
  modeBtn.textContent = spectating ? 'Back to my trainer (V)' : 'Spectate (V)';
  if (!spectating) { follow = player; zoom = fitZoom(); }
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
    follow = undefined as unknown as Actor;
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
  const wx = cam.x + (clientX * dpr - canvas.width / 2) / zoom;
  const wy = cam.y + (clientY * dpr - canvas.height / 2) / zoom;
  let best: Actor | null = null;
  let bestD = 24 / Math.min(1, zoom);
  for (const a of actors) {
    const p = pixelOf(a);
    const d = Math.hypot(p.x + 8 - wx, p.y - wy);
    if (d < bestD) { best = a; bestD = d; }
  }
  if (best) { follow = best; if (zoom < 1) zoom = fitZoom(); }
}

/** An actor's tile top-left in world pixels, mid-step included. */
function pixelOf(a: Actor): { x: number; y: number; lift: number } {
  const g = global(a.m.spot)!;
  return { x: g.gx * TILE + a.m.px, y: g.gy * TILE + a.m.py, lift: -a.m.lift };
}

/** The walk anim's frame: a stride's four frames over the action, feet alternating. */
function frameOf(a: Actor): number {
  const act = a.m.action;
  const tab = a.m.run && act?.kind === 'step' && SHEETS[String(a.gfx)].frames >= 18 ? RUN : GO;
  if (act && act.kind !== 'hop') {
    const q = Math.min(3, Math.floor((act.t / act.len) * 4));
    return tab[a.m.facing][(q + (a.m.strides & 1) * 2) % 4];
  }
  return FACE[a.m.facing];
}


const sprites = new Map<number, HTMLImageElement>();
function sheet(gfx: number): HTMLImageElement {
  let s = sprites.get(gfx);
  if (!s) { s = img(`/field-sprites/${gfx}.png`); sprites.set(gfx, s); }
  return s;
}

function draw(): void {
  if (follow) {
    const p = pixelOf(follow);
    cam.x = p.x + 8;
    cam.y = p.y + 8;
  }
  const W = canvas.width, H = canvas.height;
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0d1a14';
  ctx.fillRect(0, 0, W, H);
  // Past every map's edge the GBA repeats the map's 2x2 border block (Route 101's
  // trees): tile the followed map's, aligned to its even coordinates.
  const home = placed.get((follow ?? player).m.spot.map)!;
  home.border ??= img(`/field-maps/${home.m.id}.border.png`);
  if (home.border.complete && home.border.naturalWidth) {
    const pat = ctx.createPattern(home.border, 'repeat')!;
    const bx = home.gx * TILE, by = home.gy * TILE;
    pat.setTransform(new DOMMatrix([zoom, 0, 0, zoom, Math.round(W / 2 - cam.x * zoom) + bx * zoom, Math.round(H / 2 - cam.y * zoom) + by * zoom]));
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, H);
  }
  // Whole-pixel camera at zoom >= 1, so tiles never shimmer.
  const z = zoom;
  const ox = Math.round(W / 2 - cam.x * z);
  const oy = Math.round(H / 2 - cam.y * z);
  ctx.setTransform(z, 0, 0, z, ox, oy);
  const vx0 = -ox / z, vy0 = -oy / z, vx1 = vx0 + W / z, vy1 = vy0 + H / z;
  const visible: Placed[] = [];
  for (const p of placed.values()) {
    const x = p.gx * TILE, y = p.gy * TILE;
    if (x > vx1 || y > vy1 || x + p.m.w * TILE < vx0 || y + p.m.h * TILE < vy0) continue;
    visible.push(p);
    p.ground ??= img(`/field-maps/${p.m.id}.png`);
    if (p.ground.complete && p.ground.naturalWidth) ctx.drawImage(p.ground, x, y);
  }
  const people = actors
    .map((a) => ({ a, p: pixelOf(a) }))
    .filter(({ p }) => p.x > vx0 - 32 && p.x < vx1 + 32 && p.y > vy0 - 48 && p.y < vy1 + 32)
    .sort((u, v) => u.p.y - v.p.y);
  for (const { a, p } of people) {
    const info = SHEETS[String(a.gfx)];
    const s = sheet(a.gfx);
    if (!s.complete || !s.naturalWidth) continue;
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
      if (pl.ground?.complete) ctx.drawImage(pl.ground, a.m.spot.x * TILE, a.m.spot.y * TILE + 8, TILE, 8, p.x, p.y + 8, TILE, 8);
    }
    if (spectating && a === follow) {
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 1 / Math.min(1, z);
      ctx.strokeRect(dx - 1, dy - 1, info.w + 2, info.h + 2);
    }
  }
  for (const p of visible) {
    p.cover ??= img(`/field-maps/${p.m.id}.cover.png`);
    if (p.cover.complete && p.cover.naturalWidth) ctx.drawImage(p.cover, p.gx * TILE, p.gy * TILE);
  }
  // Zoomed far out, the sprites are specks: mark every trainer with a dot.
  if (z < 0.6) {
    for (const a of [...actors.slice(1), player]) {
      const p = pixelOf(a);
      ctx.fillStyle = a === player ? '#ff3b3b' : a.battling ? '#ffd34d' : '#ffffff';
      const r = (a === player ? 5 : 3) / z;
      ctx.fillRect(p.x + 8 - r, p.y + 8 - r, r * 2, r * 2);
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
    for (const a of actors) tickActor(a);
    pressed.clear();
  }
  const t1 = performance.now();
  draw();
  const t2 = performance.now();
  simMs = simMs * 0.9 + (t1 - t0) * 0.1;
  drawMs = drawMs * 0.9 + (t2 - t1) * 0.1;
  if (frame % 15 === 0) {
    const sorted = [...gaps].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const fps = 1000 / (gaps.reduce((s, g) => s + g, 0) / gaps.length);
    const here = player.m.spot;
    statsEl.textContent =
      `${fps.toFixed(0)} fps · p95 gap ${p95.toFixed(1)} ms\n` +
      `sim ${simMs.toFixed(2)} ms · draw ${drawMs.toFixed(2)} ms\n` +
      `${actors.length} trainers · ${here.map.replace('MAP_', '')} ${here.x},${here.y}` +
      `\nROM ${rom ? (battle ? 'fighting' : 'paused, waiting to fight') : 'booting'}` +
      (lastStart ? ` · battle up in ${lastStart.frames} frames (${lastStart.ms.toFixed(0)} ms)` : '') +
      (spectating ? `\nzoom ${zoom.toFixed(2)} · drag, pinch, tap a trainer` : '');
  }
  requestAnimationFrame(loop);
}

// ---- boot -----------------------------------------------------------------------------

const BOT_GFX = Object.entries(SHEETS)
  .filter(([k, v]) => k !== '0' && v.w === 16 && v.h === 32 && v.frames >= 9)
  .map(([k]) => Number(k));

async function boot(): Promise<void> {
  const hoenn = await loadHoenn();
  world = hoenn.world;
  placed = layout(hoenn.maps);
  baseStep = stepFn(world);
  player = { id: 0, name: 'YOU', gfx: 0, m: newMover({ map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 }, DIR_SOUTH) };
  actors.push(player);
  follow = player;
  // Bots all over Hoenn, so a spectator sees the whole map playing out.
  const seed = Number(new URLSearchParams(location.search).get('bots') ?? 64);
  let rng = 0x9e3779b9;
  const r = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
  const land = [...placed.values()].filter((p) => !p.m.id.includes('SAFARI') && !p.m.id.includes('FRONTIER') && !p.m.id.includes('PROTOTYPE'));
  let id = 1;
  for (let tries = 0; actors.length <= seed && tries < 50000; tries++) {
    const p = land[Math.floor(r() * land.length)];
    const x = Math.floor(r() * p.m.w), y = Math.floor(r() * p.m.h);
    const c = p.classes[y * p.m.w + x];
    if (c !== 0 && c !== 7) continue;
    if (actors.some((a) => a.m.spot.map === p.m.id && a.m.spot.x === x && a.m.spot.y === y)) continue;
    // near Littleroot, a handful close enough to walk up to
    const gfx = BOT_GFX[Math.floor(r() * BOT_GFX.length)];
    actors.push({
      id, name: `${SHEETS[String(gfx)].name.toUpperCase()} ${id}`, gfx, m: newMover({ map: p.m.id, x, y }, 1 + Math.floor(r() * 4)),
      bot: { rng: (id * 2654435761) >>> 0 || 1, wait: Math.floor(r() * 60), dir: 1, left: 0, walk: false },
    });
    id += 1;
  }
  // three bots right next to you in Littleroot, to walk up to and battle
  for (const [x, y] of [[7, 12], [13, 13], [11, 16]]) {
    const gfx = BOT_GFX[(id * 7) % BOT_GFX.length];
    actors.push({ id, name: `TRAINER ${id}`, gfx, m: newMover({ map: 'MAP_LITTLEROOT_TOWN', x, y }, DIR_SOUTH), bot: { rng: id * 97 + 1, wait: 30, dir: 1, left: 0, walk: false } });
    id += 1;
  }
  resize();
  requestAnimationFrame((t) => { last = t; loop(t); });
  bootRom(gbaCanvas).then((r) => { rom = r; }, (e) => console.warn('spike ROM not booted', e));
  (window as unknown as { __spike: unknown }).__spike = { actors, placed, get zoom() { return zoom; }, set zoom(v: number) { zoom = v; }, cam, toggleSpectate, startBattle, handoff, get rom() { return rom; }, get battle() { return battle; }, get lastStart() { return lastStart; } };
}

void boot();
