// The drop painter (POK-314): Cam picks the spots, the exporter keeps them.
//
// Cam, deciding POK-307: "maybe we should have a follow up where I paint droppable
// lines for you and you can save those coordinates?" POK-307 gave every town a landing
// by rule -- a doorstep when the flood left nothing -- and seven of the sixteen towns the
// picker offers are on doorsteps today, so everybody piles out of the same few doors.
//
// Dev only: `npm run dev`, then /painter.html. Vite serves any page in the root in dev and
// builds only index.html, so this never ships. Pick a map, see its grid with what the drop
// already knows drawn over it, click cells, copy the JSON into landing-hand.json. The file
// is hand-edited and committed; landing-reach.ts never writes it.
//
// The map itself is drawn under the grid, from web/painter-maps/<MAP_ID>.png -- rendered
// by tools/br/render-maps.py from pret's tilesets, one block to sixteen pixels. Cam: "I
// have to see the actual map sprites to know what I'm painting." Gitignored; run the
// script once. Without the PNG the grid still draws, over black.
import { decodeGrid, type WorldMap } from './bots/world';
import worldData from './data/world.json';
import regionmapData from './data/regionmap.json';
import { DOORSTEPS, HAND, LANDING, LANDING_ALL } from './match/landing';
import type { LandingCell } from './match/director';

const CELL = 16; // one map block, so the render lines up under the grid
const maps = (worldData as { maps: WorldMap[] }).maps.filter((m) => m.outdoor);
const sections = regionmapData.sections as Record<string, { name: string }>;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = $<HTMLSelectElement>('map');
const canvas = $<HTMLCanvasElement>('grid');
const json = $<HTMLTextAreaElement>('json');
const status = $<HTMLElement>('status');
const ctx = canvas.getContext('2d')!;

// What the drop already knows, per map, so a painted cell is chosen against it.
const key = (c: { map: string; x: number; y: number }) => `${c.map}:${c.x},${c.y}`;
const ordinary = new Set(LANDING.map(key));
const doorstep = new Set(DOORSTEPS.map(key));
const off = new Set(LANDING_ALL.filter((c) => c.off).map(key));
const painted = new Map<string, LandingCell>(HAND.map((c) => [key(c), { map: c.map, x: c.x, y: c.y }]));

const CLASS_COLOUR: Record<number, string> = {
  0: '#3a4a3a', // ground
  1: '#1a1d20', // wall
  2: '#1e3a5a', // water
  3: '#4a4a30', 4: '#4a4a30', 5: '#4a4a30', 6: '#4a4a30', // ledges
  7: '#2e5a2e', // tall grass
  8: '#5a4a2a', // door / warp
  9: '#4a3a20', // cut tree / rock
};

for (const m of maps.slice().sort((a, b) => a.id.localeCompare(b.id))) {
  const opt = document.createElement('option');
  opt.value = m.id;
  const section = sections[m.section]?.name ?? m.section;
  opt.textContent = `${m.id.replace(/^MAP_/, '')}  (${section})`;
  select.appendChild(opt);
}

let current = maps[0];
let picture: HTMLImageElement | null = null;
/** Cells on the current map you can actually walk to from somewhere the drop already
 *  knows about. Emerald's collision bits call the top of a tree "passable" -- it is only
 *  ever drawn over -- so the class grid has pockets of standable cells inside solid tree
 *  clusters, and Dewford's top-right corner lit up as if you could drop into a canopy.
 *  A four-way flood over standable classes from every landing row on the map (off or
 *  not, doorsteps included) tells the pockets from the ground. */
let reachable = new Set<number>();

function floodReachable(m: WorldMap): Set<number> {
  const grid = decodeGrid(m.grid, m.w * m.h);
  const standable = (i: number) => grid[i] !== 1 && grid[i] !== 2 && grid[i] !== 9;
  const seen = new Set<number>();
  const queue: number[] = [];
  for (const c of LANDING_ALL) {
    if (c.map !== m.id) continue;
    const i = c.y * m.w + c.x;
    if (!standable(i) || seen.has(i)) continue;
    seen.add(i);
    queue.push(i);
  }
  while (queue.length > 0) {
    const i = queue.pop()!;
    const x = i % m.w;
    const y = (i - x) / m.w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const j = ny * m.w + nx;
      if (seen.has(j) || !standable(j)) continue;
      seen.add(j);
      queue.push(j);
    }
  }
  return seen;
}

function draw(): void {
  const m = current;
  const grid = decodeGrid(m.grid, m.w * m.h);
  canvas.width = m.w * CELL;
  canvas.height = m.h * CELL;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (picture && picture.complete && picture.naturalWidth > 0) ctx.drawImage(picture, 0, 0);
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      const cls = grid[y * m.w + x];
      // The class as a tint over the tiles: walls, water and the pockets nobody can
      // walk to darkened so what can be stood on reads at a glance, everything else
      // left as the map draws it.
      if (!picture || cls === 1 || cls === 2 || cls === 9 || !reachable.has(y * m.w + x)) {
        ctx.fillStyle = picture ? 'rgba(0,0,0,0.55)' : (CLASS_COLOUR[cls] ?? '#f0f');
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.strokeRect(x * CELL + 0.5, y * CELL + 0.5, CELL - 1, CELL - 1);
      const k = `${m.id}:${x},${y}`;
      if (painted.has(k)) ctx.fillStyle = '#f28c28';
      else if (doorstep.has(k)) ctx.fillStyle = '#2f6fd1';
      else if (ordinary.has(k)) ctx.fillStyle = '#2b7a3b';
      else if (off.has(k)) ctx.fillStyle = '#7a2b2b';
      else continue;
      ctx.fillRect(x * CELL + 5, y * CELL + 5, CELL - 10, CELL - 10);
    }
  }
  const mine = [...painted.values()].filter((c) => c.map === m.id).length;
  status.textContent = `${m.w}×${m.h}, ${mine} painted here, ${painted.size} in all`;
  json.value = JSON.stringify([...painted.values()].sort((a, b) => a.map.localeCompare(b.map) || a.y - b.y || a.x - b.x), null, 1);
}

function show(m: WorldMap): void {
  current = m;
  reachable = floodReachable(m);
  picture = new Image();
  picture.onload = draw;
  picture.onerror = () => {
    picture = null;
    status.textContent = `no render for ${m.id}: run python tools/br/render-maps.py`;
  };
  picture.src = `/painter-maps/${m.id}.png`;
  draw();
}

select.addEventListener('change', () => show(maps.find((m) => m.id === select.value) ?? maps[0]));

canvas.addEventListener('click', (ev) => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((ev.clientX - rect.left) / CELL);
  const y = Math.floor((ev.clientY - rect.top) / CELL);
  if (x < 0 || y < 0 || x >= current.w || y >= current.h) return;
  const cls = decodeGrid(current.grid, current.w * current.h)[y * current.w + x];
  if (cls === 1 || cls === 2 || cls === 9) {
    status.textContent = `${x},${y} is not standable (class ${cls})`;
    return;
  }
  if (!reachable.has(y * current.w + x)) {
    status.textContent = `${x},${y} cannot be walked to from anywhere on this map (a tree top, or a sealed pocket)`;
    return;
  }
  const k = `${current.id}:${x},${y}`;
  if (painted.has(k)) painted.delete(k);
  else painted.set(k, { map: current.id, x, y });
  draw();
});

$<HTMLButtonElement>('clear').addEventListener('click', () => {
  for (const k of [...painted.keys()]) if (k.startsWith(`${current.id}:`)) painted.delete(k);
  draw();
});

$<HTMLButtonElement>('copy').addEventListener('click', () => {
  void navigator.clipboard.writeText(json.value).then(() => {
    status.textContent = 'copied';
  });
});

show(current);
