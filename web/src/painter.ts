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
import { decodeGrid, type WorldMap } from './bots/world';
import worldData from './data/world.json';
import regionmapData from './data/regionmap.json';
import { DOORSTEPS, HAND, LANDING, LANDING_ALL } from './match/landing';
import type { LandingCell } from './match/director';

const CELL = 10;
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

function draw(): void {
  const m = current;
  const grid = decodeGrid(m.grid, m.w * m.h);
  canvas.width = m.w * CELL;
  canvas.height = m.h * CELL;
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      ctx.fillStyle = CLASS_COLOUR[grid[y * m.w + x]] ?? '#f0f';
      ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);
      const k = `${m.id}:${x},${y}`;
      if (painted.has(k)) ctx.fillStyle = '#f28c28';
      else if (doorstep.has(k)) ctx.fillStyle = '#2f6fd1';
      else if (ordinary.has(k)) ctx.fillStyle = '#2b7a3b';
      else if (off.has(k)) ctx.fillStyle = '#7a2b2b';
      else continue;
      ctx.fillRect(x * CELL + 3, y * CELL + 3, CELL - 7, CELL - 7);
    }
  }
  const mine = [...painted.values()].filter((c) => c.map === m.id).length;
  status.textContent = `${m.w}×${m.h}, ${mine} painted here, ${painted.size} in all`;
  json.value = JSON.stringify([...painted.values()].sort((a, b) => a.map.localeCompare(b.map) || a.y - b.y || a.x - b.x), null, 1);
}

select.addEventListener('change', () => {
  current = maps.find((m) => m.id === select.value) ?? maps[0];
  draw();
});

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

draw();
