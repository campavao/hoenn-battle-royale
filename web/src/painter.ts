// The drop painter (POK-314): Cam picks the spots, the exporter keeps them.
//
// Cam, deciding POK-307: "maybe we should have a follow up where I paint droppable
// lines for you and you can save those coordinates?" POK-307 gave every town a landing
// by rule -- a doorstep when the flood left nothing -- and eight of the sixteen towns the
// picker offers are on doorsteps today, so everybody piles out of the same few doors.
//
// And off as well as on. Cam, on the Route 117 Day Care yard: "even tho that section is
// technically walkable, it should not be possible since there is no way to normally get in
// there in the game." Walkable is the exporter's answer and reachable the flood's; where a
// player would ever be is nobody's but his. A VETO takes a cell out of every pool the drop,
// the ring and the bots draw from (match/landing.ts).
//
// Dev only: `npm run dev`, then /painter.html. Vite serves any page in the root in dev and
// builds only index.html, so this never ships. Pick a map, see its grid with what the drop
// already knows drawn over it, paint, copy the JSON into landing-hand.json. The file is
// hand-edited and committed; landing-reach.ts never writes it. match/hand.ts has the rules
// this and landing.test.ts share.
//
// The map itself is drawn under the grid, from web/public/field-maps/<MAP_ID>.png -- the
// page's own field renders (tools/br/render-maps.py, committed), one block to sixteen
// pixels. Cam: "I have to see the actual map sprites to know what I'm painting." Without
// the PNG the grid still draws, over the class colours.
import { HOENN } from './bots/hoenn';
import { decodeGrid, type WorldMap } from './bots/world';
import regionmapData from './data/regionmap.json';
import handData from './data/landing-hand.json';
import { LANDING_ALL, worldReady } from './match/landing';
import { cellKey, handJson, handProblems, rectCells, walksTo, type HandRow } from './match/hand';

await worldReady(); // the landing tables are fetched on demand, as the page's are

const CELL = 16; // one map block, so the render lines up under the grid
const DRAFT_KEY = 'hbr:painter-draft';
/** The drop picker's towns: MAPSEC_LITTLEROOT_TOWN (0) to MAPSEC_EVER_GRANDE_CITY (15), the
 *  sections GetMapsecType (region_map.c) calls MAPSECTYPE_CITY_CANFLY. The Battle Frontier
 *  is offered too, and the match does not go there. */
const LAST_TOWN = 15;

const maps = HOENN.maps.filter((m) => m.outdoor);
const sections = regionmapData.sections as Record<string, { name: string; num?: number }>;
const isTown = (m: WorldMap) => (sections[m.section]?.num ?? Infinity) <= LAST_TOWN;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = $<HTMLSelectElement>('map');
const canvas = $<HTMLCanvasElement>('grid');
const json = $<HTMLTextAreaElement>('json');
const status = $<HTMLElement>('status');
const problemList = $<HTMLUListElement>('problems');
const clearButton = $<HTMLButtonElement>('clear');
const ctx = canvas.getContext('2d')!;

// What the drop already knows, per cell, so a painted cell is chosen against it.
const ordinary = new Set(LANDING_ALL.filter((c) => !c.off && c.door === undefined).map(cellKey));
const doorstep = new Set(LANDING_ALL.filter((c) => c.door !== undefined).map(cellKey));
const off = new Set(LANDING_ALL.filter((c) => c.off && c.door === undefined).map(cellKey));
const withOrdinary = new Set(LANDING_ALL.filter((c) => !c.off && c.door === undefined).map((c) => c.map));
/** The cells the drop deals, before anybody's vetoes: what a pick has to walk off to. */
const seeds = LANDING_ALL.filter((c) => c.door !== undefined || !c.off);

/** The painting: every row of the file-to-be, by cell. */
let rows = readRows(handData as unknown[]);
const committed = handJson([...rows.values()]);
let mode: 'pick' | 'veto' = 'pick';

function readRows(list: readonly unknown[]): Map<string, HandRow> {
  const out = new Map<string, HandRow>();
  for (const r of list as HandRow[]) out.set(cellKey(r), r.veto ? { map: r.map, x: r.x, y: r.y, veto: 1 } : { map: r.map, x: r.x, y: r.y });
  return out;
}

// An unsaved painting survives a reload: kept in this browser until it is copied into the
// file and committed, which stays the only copy that counts. Storage can be missing or
// throw (a private window), and then the painter just starts from the file.
try {
  const draft = localStorage.getItem(DRAFT_KEY);
  const parsed: unknown = draft ? JSON.parse(draft) : null;
  if (Array.isArray(parsed) && handJson(parsed as HandRow[]) !== committed) rows = readRows(parsed);
} catch {
  // no storage: start from the file
}

function save(): void {
  const text = handJson([...rows.values()]);
  try {
    if (text === committed) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, text);
  } catch {
    // no storage: the textarea below is the copy
  }
}

const CLASS_COLOUR: Record<number, string> = {
  0: '#3a4a3a', // ground
  1: '#1a1d20', // wall
  2: '#1e3a5a', // water
  3: '#4a4a30', 4: '#4a4a30', 5: '#4a4a30', 6: '#4a4a30', // ledges
  7: '#2e5a2e', // tall grass
  8: '#5a4a2a', // door / warp
  9: '#4a3a20', // cut tree / rock
};

function mapLabel(m: WorldMap): string {
  const name = sections[m.section]?.name ?? m.section;
  const mine = [...rows.values()].filter((r) => r.map === m.id);
  const picks = mine.filter((r) => !r.veto).length;
  const bits = [`${m.id.replace(/^MAP_/, '')}  (${name})`];
  if (picks > 0) bits.push(`${picks} picked`);
  if (mine.length > picks) bits.push(`${mine.length - picks} vetoed`);
  // The towns the flood left with nothing but doors: the ones most worth painting.
  if (isTown(m) && !withOrdinary.has(m.id)) bits.push('doorsteps only');
  return bits.join(' · ');
}

const towns = document.createElement('optgroup');
towns.label = 'Towns the drop picker offers';
const rest = document.createElement('optgroup');
rest.label = 'Every other outdoor map';
for (const m of [...maps].sort((a, b) => (sections[a.section]?.num ?? 999) - (sections[b.section]?.num ?? 999) || a.id.localeCompare(b.id))) {
  const opt = document.createElement('option');
  opt.value = m.id;
  (isTown(m) ? towns : rest).appendChild(opt);
}
select.append(towns, rest);

function labelMaps(): void {
  for (const opt of select.options) opt.textContent = mapLabel(HOENN.byId.get(opt.value)!);
}

let current = HOENN.byId.get(select.options[0].value)!;
let classes: Uint8Array = decodeGrid(current.grid, current.w * current.h);
let picture: HTMLImageElement | null = null;
/** Cells of the current map a pick may go on: ones a trainer can walk off, to a cell the
 *  drop deals on this map (match/hand.ts's walksTo -- heights, trees and all). Emerald's
 *  collision bits call a tree top "passable", so the class grid alone lit up Dewford's
 *  top-right corner as if you could drop into a canopy; a cliff top is the same. */
let reachable: Uint8Array = new Uint8Array(0);
/** A drag in progress: the cell it started on and the one under the pointer now. */
let drag: { from: { x: number; y: number }; to: { x: number; y: number } } | null = null;

function vetoes(): Set<string> {
  return new Set([...rows.values()].filter((r) => r.veto).map(cellKey));
}

function flood(): void {
  const veto = vetoes();
  reachable = walksTo(HOENN.world, current, seeds.filter((c) => c.map === current.id && !veto.has(cellKey(c))));
}

/** A vetoed cell: a red wash and three diagonals, corner to corner and either side. */
function hatch(x: number, y: number): void {
  const px = x * CELL;
  const py = y * CELL;
  const half = CELL / 2;
  ctx.fillStyle = 'rgba(220,40,40,0.35)';
  ctx.fillRect(px, py, CELL, CELL);
  ctx.strokeStyle = '#ff5050';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px, py + CELL);
  ctx.lineTo(px + CELL, py);
  ctx.moveTo(px, py + half);
  ctx.lineTo(px + half, py);
  ctx.moveTo(px + half, py + CELL);
  ctx.lineTo(px + CELL, py + half);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function draw(): void {
  const m = current;
  canvas.width = m.w * CELL;
  canvas.height = m.h * CELL;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (picture && picture.complete && picture.naturalWidth > 0) ctx.drawImage(picture, 0, 0);
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      const i = y * m.w + x;
      const cls = classes[i];
      // The class as a tint over the tiles: walls, water and everywhere nobody can walk
      // off from darkened, so what can be picked reads at a glance.
      if (!picture || cls === 1 || cls === 2 || cls === 9 || !reachable[i]) {
        ctx.fillStyle = picture ? 'rgba(0,0,0,0.55)' : (CLASS_COLOUR[cls] ?? '#f0f');
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.strokeRect(x * CELL + 0.5, y * CELL + 0.5, CELL - 1, CELL - 1);
      const k = `${m.id}:${x},${y}`;
      const row = rows.get(k);
      const dot =
        row && !row.veto ? '#f28c28'
        : doorstep.has(k) ? '#2f6fd1'
        : ordinary.has(k) ? '#2b7a3b'
        : off.has(k) ? '#7a2b2b'
        : undefined;
      if (dot) {
        ctx.fillStyle = dot;
        ctx.fillRect(x * CELL + 5, y * CELL + 5, CELL - 10, CELL - 10);
      }
      // A veto hatches the cell over whatever it vetoed, so the dot it took out still shows.
      if (row?.veto) hatch(x, y);
    }
  }
  if (drag) {
    const x0 = Math.min(drag.from.x, drag.to.x);
    const y0 = Math.min(drag.from.y, drag.to.y);
    ctx.strokeStyle = mode === 'pick' ? '#f28c28' : '#ff5050';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 * CELL + 1, y0 * CELL + 1, (Math.abs(drag.to.x - drag.from.x) + 1) * CELL - 2, (Math.abs(drag.to.y - drag.from.y) + 1) * CELL - 2);
    ctx.lineWidth = 1;
  }
}

/** Everything after a change: the file, the list of what is wrong with it, the counts. */
function changed(message?: string): void {
  save();
  flood();
  draw();
  labelMaps();
  const all = [...rows.values()];
  json.value = handJson(all);
  const picks = all.filter((r) => !r.veto).length;
  const here = all.filter((r) => r.map === current.id);
  const herePicks = here.filter((r) => !r.veto).length;
  const summary = `${current.w}×${current.h} · here ${herePicks} picked, ${here.length - herePicks} vetoed · in all ${picks} picked, ${all.length - picks} vetoed`;
  status.textContent = message ? `${message} -- ${summary}` : summary;
  // The same check landing.test.ts runs, so a stale cell shows here before CI says so.
  problemList.replaceChildren(
    ...handProblems(all, HOENN.byId, HOENN.world, seeds).map((p) => {
      const li = document.createElement('li');
      li.textContent = p;
      return li;
    }),
  );
}

/** Why a cell cannot take the current mode's paint, or '' when it can. */
function refusal(x: number, y: number): string {
  if (mode === 'veto') return HOENN.world.standable(current.id, x, y, false, true) ? '' : 'a wall or water';
  if (!HOENN.world.standable(current.id, x, y)) return 'a wall, water or a tree to cut';
  return reachable[y * current.w + x] ? '' : 'nowhere to walk off to: a tree top, a cliff top or a pit';
}

function paint(x: number, y: number): string {
  const why = refusal(x, y);
  if (!why) rows.set(`${current.id}:${x},${y}`, mode === 'veto' ? { map: current.id, x, y, veto: 1 } : { map: current.id, x, y });
  return why;
}

/** A click: paint the cell in this mode, or take this mode's paint off it. */
function toggle(x: number, y: number): void {
  const k = `${current.id}:${x},${y}`;
  const row = rows.get(k);
  if (row && !!row.veto === (mode === 'veto')) {
    rows.delete(k);
    changed(`${x},${y} cleared`);
    return;
  }
  const why = paint(x, y);
  changed(why ? `${x},${y} is ${why}` : `${x},${y} ${mode === 'veto' ? 'vetoed' : 'picked'}`);
}

/** A drag: every cell of the rectangle that can take this mode's paint gets it; with shift,
 *  every cell of it loses this mode's paint instead. */
function fill(from: { x: number; y: number }, to: { x: number; y: number }, erase: boolean): void {
  let done = 0;
  let skipped = 0;
  for (const { x, y } of rectCells(from, to)) {
    const k = `${current.id}:${x},${y}`;
    if (erase) {
      const row = rows.get(k);
      if (row && !!row.veto === (mode === 'veto')) {
        rows.delete(k);
        done++;
      }
    } else if (paint(x, y)) skipped++;
    else done++;
  }
  changed(erase ? `${done} cleared` : `${done} ${mode === 'veto' ? 'vetoed' : 'picked'}${skipped ? `, ${skipped} skipped` : ''}`);
}

function show(m: WorldMap): void {
  current = m;
  classes = decodeGrid(m.grid, m.w * m.h);
  select.value = m.id;
  picture = new Image();
  picture.onload = draw;
  picture.onerror = () => {
    picture = null;
    draw();
    status.textContent = `no render for ${m.id}: run python tools/br/render-maps.py`;
  };
  picture.src = `/field-maps/${m.id}.png`;
  changed();
}

function setMode(next: 'pick' | 'veto'): void {
  mode = next;
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name=mode]')) input.checked = input.value === mode;
  clearButton.textContent = mode === 'veto' ? 'Clear this map’s vetoes' : 'Clear this map’s picks';
}

function cellAt(ev: MouseEvent): { x: number; y: number } {
  // From the canvas's own pixels: inside its border, scaled if the page is zoomed.
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((ev.clientX - rect.left - canvas.clientLeft) * (canvas.width / canvas.clientWidth)) / CELL);
  const y = Math.floor(((ev.clientY - rect.top - canvas.clientTop) * (canvas.height / canvas.clientHeight)) / CELL);
  return { x: Math.max(0, Math.min(current.w - 1, x)), y: Math.max(0, Math.min(current.h - 1, y)) };
}

select.addEventListener('change', () => show(HOENN.byId.get(select.value) ?? maps[0]));

for (const input of document.querySelectorAll<HTMLInputElement>('input[name=mode]')) {
  input.addEventListener('change', () => setMode(input.value === 'veto' ? 'veto' : 'pick'));
}

document.addEventListener('keydown', (ev) => {
  if (ev.target instanceof HTMLTextAreaElement || ev.target instanceof HTMLSelectElement) return;
  if (ev.key === 'p' || ev.key === 'P') setMode('pick');
  else if (ev.key === 'v' || ev.key === 'V') setMode('veto');
  else if (ev.key === 'Escape' && drag) {
    drag = null;
    draw();
  }
});

canvas.addEventListener('mousedown', (ev) => {
  if (ev.button !== 0) return;
  const at = cellAt(ev);
  drag = { from: at, to: at };
  ev.preventDefault();
});

canvas.addEventListener('mousemove', (ev) => {
  if (!drag) return;
  const at = cellAt(ev);
  if (at.x === drag.to.x && at.y === drag.to.y) return;
  drag.to = at;
  draw();
});

window.addEventListener('mouseup', (ev) => {
  if (!drag) return;
  const { from, to } = drag;
  drag = null;
  if (from.x === to.x && from.y === to.y) toggle(from.x, from.y);
  else fill(from, to, ev.shiftKey);
});

clearButton.addEventListener('click', () => {
  for (const [k, row] of [...rows]) if (row.map === current.id && !!row.veto === (mode === 'veto')) rows.delete(k);
  changed('cleared');
});

$<HTMLButtonElement>('reset').addEventListener('click', () => {
  if (!confirm('Drop this browser’s unsaved painting and go back to landing-hand.json?')) return;
  rows = readRows(handData as unknown[]);
  changed('back to the file');
});

$<HTMLButtonElement>('copy').addEventListener('click', () => {
  void navigator.clipboard.writeText(json.value).then(() => {
    status.textContent = 'copied: paste it over web/src/data/landing-hand.json';
  });
});

setMode('pick');
show(current);
if (handJson([...rows.values()]) !== committed) status.textContent = `restored this browser's unsaved painting -- ${status.textContent}`;
