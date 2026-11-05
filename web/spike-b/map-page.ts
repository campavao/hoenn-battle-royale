// The map painter, /map/ (mappaint.ts says what for). Hoenn drawn from the ROM on this device, as
// the game draws it, so no art goes on the site. A finger, or a mouse: one finger or the left
// button is the tool, two fingers or the wheel and the other buttons move the view, and the same
// page keeps a keyboard's ways in on a computer. Nothing here reaches a match until the paint is
// handed over and released.
import type { WorldMap } from '../src/bots/world';
import { checkEmerald, isPrePatched } from '../src/rom/emerald';
import worldJson from './data/world.json';
import fillJson from './data/world-fill.json';
import { devRomParam } from './import';
import {
  ERASER, History, PaintWorld, fromFile, fromHash, keyOf, latticeAt, pickStamp, placeAt, revert, sameCell, setCell, stampCell, toFile, toHash, xOf, yOf,
  type Cell, type Edit, type PlaneSpot, type Stamp,
} from './mappaint';
import { loadRom } from './rom';
import { RomArt } from './romart';
import { isLooseSeam } from './shared/room';
import { CHUNK, ChunkCache, SEA_METATILE, WorldFill, mainlandPlane, type FillFile } from './worldfill';

const TILE = 16;
/** Cells a side of a far view's picture, drawn at FAR_PX a cell. */
const FAR_CELLS = 64;
const FAR_PX = 4;
const ZOOM_MIN = 0.5, ZOOM_MAX = 64;
/** A close view's cuts, on a phone and with a computer's memory. */
const CACHE = matchMedia('(pointer: fine)').matches ? 512 : 128;
const CUT_MS = 8;
/** How long a finger waits before it paints: a second one coming means the view. */
const TOUCH_WAIT = 90;
const DRAFT = 'hbr:map-paint', STAMPS = 'hbr:map-stamps', VIEW = 'hbr:map-view';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stored = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* a private window: this visit only */ } };
const say = (text: string, bad = false) => { const el = $('say'); el.textContent = text; el.classList.toggle('bad', bad); };
const nameOf = (id: string) => id.replace(/^MAP_/, '').replace(/_/g, ' ');

type Tool = 'move' | 'pick' | 'brush' | 'box';
type Maps = WorldMap & { group: number; num: number };

const maps = (worldJson as unknown as { maps: Maps[] }).maps;
const plane = mainlandPlane(maps, isLooseSeam);

/** The ROM, from a dev `?rom=` or the player's stored one, or asked for here. */
async function boot(): Promise<void> {
  const devRom = devRomParam();
  const bootSay = (t: string) => { $('boot-say').textContent = t; };
  const files = await loadRom($<HTMLCanvasElement>('emu'), bootSay, async (emu) => {
    if (devRom) {
      await emu.importRom(new Uint8Array(await (await fetch(`/@fs/${devRom}`)).arrayBuffer()));
      return;
    }
    bootSay('The map is drawn from your own POKEMON EMERALD (U) ROM. It stays on this device.');
    const pick = $('rom-pick');
    pick.style.display = 'inline-flex';
    const input = $<HTMLInputElement>('rom-input');
    const bytes = await new Promise<Uint8Array>((resolve) => {
      const take = async (f: File) => {
        const got = new Uint8Array(await f.arrayBuffer());
        if (import.meta.env.DEV && isPrePatched(got)) { resolve(got); return; }
        const r = await checkEmerald(got);
        if (r.ok) resolve(got);
        else bootSay(r.reason ?? 'That is not a POKEMON EMERALD (U) ROM, 16 MiB.');
      };
      input.addEventListener('change', () => { const f = input.files?.[0]; if (f) void take(f); });
      addEventListener('dragover', (e) => e.preventDefault());
      addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer?.files[0]; if (f && !art) void take(f); });
    });
    pick.style.display = 'none';
    bootSay('Waking the ROM…');
    await emu.importRom(bytes);
  }, devRom);
  $('build').textContent = files.version;
  art = new RomArt(files.rom, files.sym);
  $('boot').remove();
  await start();
}

let art: RomArt | null = null;

async function start(): Promise<void> {
  const romArt = art!;
  const fill = new WorldFill(fillJson as unknown as FillFile);
  const spots: PlaneSpot[] = [...plane.values()].map((p) => ({ id: p.m.id, gx: p.gx, gy: p.gy, w: p.m.w, h: p.m.h }));
  const homes = new Map([...plane.values()].map((p) => [p.m.id, p.m as Maps]));
  const home = homes.get('MAP_LITTLEROOT_TOWN')!;
  const world = new PaintWorld(fill, spots, (m, x, y) => {
    const h = homes.get(m.id)!;
    return romArt.blockAt(h.group, h.num, x, y);
  });

  const paint = new Map<number, Cell>();
  // What a release already has in it is no paint any more.
  const draft = stored(DRAFT);
  if (draft) {
    try {
      for (const [k, c] of fromFile(JSON.parse(draft)) ?? []) {
        if (!world.locked(xOf(k), yOf(k)) && !sameCell(c, world.base(xOf(k), yOf(k)))) paint.set(k, c);
      }
    } catch { /* not ours: start clean */ }
  }
  const history = new History();
  const canvas = $<HTMLCanvasElement>('world');
  const ctx = canvas.getContext('2d')!;

  let tool: Tool = 'move';
  let snap = true;
  let showMaps = true, showMine = false, showGrid = true;
  let dirty = true;

  // ---- the view ------------------------------------------------------------------------
  const view = { x: fill.x0 + fill.w / 2, y: fill.y0 + fill.h / 2, z: 1 };
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    view.x = fill.x0 + fill.w / 2;
    view.y = fill.y0 + fill.h / 2;
    view.z = Math.max(ZOOM_MIN, Math.min(r.width / fill.w, r.height / fill.h));
  };
  let hadView = false;
  try {
    const v = JSON.parse(stored(VIEW) ?? 'null') as typeof view | null;
    if (v && Number.isFinite(v.x + v.y + v.z)) { Object.assign(view, v); hadView = true; }
  } catch { /* the whole map, then */ }
  const clampView = () => {
    view.z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.z));
    view.x = Math.max(fill.x0, Math.min(fill.x0 + fill.w, view.x));
    view.y = Math.max(fill.y0, Math.min(fill.y0 + fill.h, view.y));
  };
  const dpr = () => Math.min(2, devicePixelRatio || 1);
  const rectOf = () => canvas.getBoundingClientRect();
  /** A world position (in cells, not whole ones) from a place on the page. */
  const toWorld = (px: number, py: number) => {
    const r = rectOf();
    return { x: view.x + (px - r.left - r.width / 2) / view.z, y: view.y + (py - r.top - r.height / 2) / view.z };
  };
  const toCell = (px: number, py: number) => {
    const w = toWorld(px, py);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  };
  const changedView = () => {
    clampView();
    dirty = true;
    store(VIEW, JSON.stringify(view));
  };
  const zoomAt = (px: number, py: number, z: number) => {
    const before = toWorld(px, py);
    view.z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    const after = toWorld(px, py);
    view.x += before.x - after.x;
    view.y += before.y - after.y;
    changedView();
  };
  const resize = () => {
    const r = rectOf();
    const w = Math.max(1, Math.round(r.width * dpr())), h = Math.max(1, Math.round(r.height * dpr()));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      dirty = true;
    }
  };
  new ResizeObserver(resize).observe($('stage'));

  // ---- the pictures --------------------------------------------------------------------
  const artOf = (c: Cell) => {
    const h = (c.ref && homes.get(c.ref)) || home;
    return { group: h.group, num: h.num, id: c.id };
  };
  const close = new ChunkCache<HTMLCanvasElement>(CACHE);
  const far = new Map<number, HTMLCanvasElement>();
  /** A chunk whose paint changed: its old picture stands until the new one is cut, so nothing blinks. */
  const staleClose = new Set<number>(), staleFar = new Set<number>();
  const chunkKey = (cx: number, cy: number) => (cy + 4096) * 8192 + cx + 4096;
  const touched = (x: number, y: number) => {
    staleClose.add(chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK)));
    staleFar.add(chunkKey(Math.floor(x / FAR_CELLS), Math.floor(y / FAR_CELLS)));
    dirty = true;
  };
  const cutClose = (cx: number, cy: number) => {
    const cv = romArt.cells(CHUNK, CHUNK, (x, y) => artOf(world.shown(cx * CHUNK + x, cy * CHUNK + y, paint)));
    close.set(chunkKey(cx, cy), cv);
    staleClose.delete(chunkKey(cx, cy));
    return cv;
  };
  // Every metatile at FAR_PX, a slot apiece: 4,096 cells in a far picture is 4,096 of these.
  const THUMB_ROW = 64;
  const thumbPages: CanvasRenderingContext2D[] = [];
  const thumbs = new Map<string, number>();
  const thumb = (c: Cell) => {
    const key = `${c.ref ?? ''}:${c.id}`;
    let n = thumbs.get(key);
    if (n === undefined) {
      n = thumbs.size;
      thumbs.set(key, n);
      const page = Math.floor(n / (THUMB_ROW * THUMB_ROW));
      if (!thumbPages[page]) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = THUMB_ROW * FAR_PX;
        thumbPages[page] = cv.getContext('2d')!;
        thumbPages[page].imageSmoothingEnabled = true;
        thumbPages[page].imageSmoothingQuality = 'high';
      }
      const at = n % (THUMB_ROW * THUMB_ROW);
      thumbPages[page].drawImage(romArt.cells(1, 1, () => artOf(c)), 0, 0, TILE, TILE, (at % THUMB_ROW) * FAR_PX, Math.floor(at / THUMB_ROW) * FAR_PX, FAR_PX, FAR_PX);
    }
    return n;
  };
  const cutFar = (cx: number, cy: number) => {
    const cv = far.get(chunkKey(cx, cy)) ?? document.createElement('canvas');
    cv.width = cv.height = FAR_CELLS * FAR_PX;
    const c2 = cv.getContext('2d')!;
    for (let y = 0; y < FAR_CELLS; y++) {
      for (let x = 0; x < FAR_CELLS; x++) {
        const n = thumb(world.shown(cx * FAR_CELLS + x, cy * FAR_CELLS + y, paint));
        const page = Math.floor(n / (THUMB_ROW * THUMB_ROW)), at = n % (THUMB_ROW * THUMB_ROW);
        c2.drawImage(thumbPages[page].canvas, (at % THUMB_ROW) * FAR_PX, Math.floor(at / THUMB_ROW) * FAR_PX, FAR_PX, FAR_PX, x * FAR_PX, y * FAR_PX, FAR_PX, FAR_PX);
      }
    }
    far.set(chunkKey(cx, cy), cv);
    staleFar.delete(chunkKey(cx, cy));
    return cv;
  };
  const stampPics = new Map<Stamp, HTMLCanvasElement>();
  const stampPic = (s: Stamp) => {
    let p = stampPics.get(s);
    if (!p) {
      p = romArt.cells(s.w, s.h, (x, y) => {
        const c = s.cells[y * s.w + x];
        return c ? artOf(c) : null;
      });
      stampPics.set(s, p);
    }
    return p;
  };

  // ---- drawing -------------------------------------------------------------------------
  /** A rectangle of cells on the canvas, on whole pixels, so neighbours never leave a seam. */
  const span = (a: number, b: number, from: number, s: number, mid: number) => {
    const p0 = Math.round((a - from) * s + mid), p1 = Math.round((b - from) * s + mid);
    return [p0, p1 - p0];
  };
  function render(): void {
    const s = view.z * dpr();
    const W = canvas.width, H = canvas.height;
    const vx0 = view.x - W / 2 / s, vy0 = view.y - H / 2 / s, vx1 = view.x + W / 2 / s, vy1 = view.y + H / 2 / s;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b1116';
    ctx.fillRect(0, 0, W, H);
    const fx0 = Math.max(vx0, fill.x0), fy0 = Math.max(vy0, fill.y0), fx1 = Math.min(vx1, fill.x0 + fill.w), fy1 = Math.min(vy1, fill.y0 + fill.h);
    const t0 = performance.now();
    let waiting = false, cut = 0;
    const budget = () => cut === 0 || performance.now() - t0 < CUT_MS;

    const drawFar = (cx: number, cy: number) => {
      const k = chunkKey(cx, cy);
      let pic = far.get(k);
      if (!pic || staleFar.has(k)) {
        if (budget()) { pic = cutFar(cx, cy); cut++; }
        else waiting = true;
      }
      if (!pic) return;
      const [dx, dw] = span(cx * FAR_CELLS, (cx + 1) * FAR_CELLS, view.x, s, W / 2);
      const [dy, dh] = span(cy * FAR_CELLS, (cy + 1) * FAR_CELLS, view.y, s, H / 2);
      // Several of its pixels to one of the screen's: anything less than high is a moire on the long grass.
      ctx.imageSmoothingEnabled = s < FAR_PX;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(pic, dx, dy, dw, dh);
    };
    const c0x = Math.floor(fx0 / CHUNK), c1x = Math.floor((fx1 - 1e-6) / CHUNK), c0y = Math.floor(fy0 / CHUNK), c1y = Math.floor((fy1 - 1e-6) / CHUNK);
    const useClose = s >= FAR_PX && (c1x - c0x + 1) * (c1y - c0y + 1) <= CACHE * 0.75;
    if (useClose) {
      for (let cy = c0y; cy <= c1y; cy++) {
        for (let cx = c0x; cx <= c1x; cx++) {
          const k = chunkKey(cx, cy);
          let pic = close.get(k);
          if (!pic || staleClose.has(k)) {
            if (budget()) { pic = cutClose(cx, cy); cut++; }
            else waiting = true;
          }
          const [dx, dw] = span(cx * CHUNK, (cx + 1) * CHUNK, view.x, s, W / 2);
          const [dy, dh] = span(cy * CHUNK, (cy + 1) * CHUNK, view.y, s, H / 2);
          if (pic) {
            ctx.imageSmoothingEnabled = s < TILE;
            ctx.drawImage(pic, dx, dy, dw, dh);
          } else {
            // Not cut yet: the far picture under it if there is one.
            const fk = chunkKey(Math.floor(cx * CHUNK / FAR_CELLS), Math.floor(cy * CHUNK / FAR_CELLS));
            const under = far.get(fk);
            if (under) {
              const ox = (cx * CHUNK - Math.floor(cx * CHUNK / FAR_CELLS) * FAR_CELLS) * FAR_PX, oy = (cy * CHUNK - Math.floor(cy * CHUNK / FAR_CELLS) * FAR_CELLS) * FAR_PX;
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(under, ox, oy, CHUNK * FAR_PX, CHUNK * FAR_PX, dx, dy, dw, dh);
            }
          }
        }
      }
    } else {
      for (let cy = Math.floor(fy0 / FAR_CELLS); cy <= Math.floor((fy1 - 1e-6) / FAR_CELLS); cy++) {
        for (let cx = Math.floor(fx0 / FAR_CELLS); cx <= Math.floor((fx1 - 1e-6) / FAR_CELLS); cx++) drawFar(cx, cy);
      }
    }

    const px = (x: number) => (x - view.x) * s + W / 2, py = (y: number) => (y - view.y) * s + H / 2;
    if (showMine && paint.size) {
      ctx.fillStyle = 'rgba(255, 214, 64, .45)';
      for (const k of paint.keys()) {
        const x = xOf(k), y = yOf(k);
        if (x + 1 >= vx0 && x <= vx1 && y + 1 >= vy0 && y <= vy1) ctx.fillRect(px(x), py(y), Math.ceil(s), Math.ceil(s));
      }
    }
    if (showMaps) {
      ctx.lineWidth = Math.max(1, dpr());
      ctx.strokeStyle = 'rgba(255, 255, 255, .55)';
      ctx.fillStyle = 'rgba(8, 14, 20, .22)';
      for (const m of spots) {
        if (m.gx > vx1 || m.gx + m.w < vx0 || m.gy > vy1 || m.gy + m.h < vy0) continue;
        ctx.fillRect(px(m.gx), py(m.gy), m.w * s, m.h * s);
        ctx.strokeRect(px(m.gx), py(m.gy), m.w * s, m.h * s);
      }
      if (view.z >= 1.5) {
        ctx.font = `600 ${Math.round(11 * dpr())}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const m of spots) {
          if (m.w * view.z < 44 || m.gx > vx1 || m.gx + m.w < vx0 || m.gy > vy1 || m.gy + m.h < vy0) continue;
          const name = nameOf(m.id).replace(/^ROUTE/, 'R').replace(/ (CITY|TOWN)$/, '');
          const x = px(m.gx + m.w / 2), y = py(m.gy + m.h / 2);
          ctx.lineWidth = 3 * dpr();
          ctx.strokeStyle = 'rgba(0, 0, 0, .75)';
          ctx.strokeText(name, x, y);
          ctx.fillStyle = '#fff';
          ctx.fillText(name, x, y);
        }
      }
    }
    if (showGrid && view.z >= 14) {
      ctx.strokeStyle = 'rgba(255, 255, 255, .13)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.ceil(vx0); x <= vx1; x++) { const p = Math.round(px(x)) + 0.5; ctx.moveTo(p, 0); ctx.lineTo(p, H); }
      for (let y = Math.ceil(vy0); y <= vy1; y++) { const p = Math.round(py(y)) + 0.5; ctx.moveTo(0, p); ctx.lineTo(W, p); }
      ctx.stroke();
    }
    drawMark(px, py, s);
    if (waiting) dirty = true;
  }

  /** The block a tool is about to lay, over the world: nothing on a locked cell, as it will be. */
  function drawGhost(px: (x: number) => number, py: (y: number) => number, s: number, ax: number, ay: number, x0: number, y0: number, w: number, h: number): void {
    const eraser = current === ERASER;
    const pic = eraser ? null : stampPic(current);
    ctx.imageSmoothingEnabled = s < TILE;
    ctx.globalAlpha = 0.8;
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (world.locked(x, y)) continue;
        const dx = px(x), dy = py(y), size = Math.ceil(s);
        if (!pic) {
          ctx.fillStyle = 'rgba(255, 90, 80, .45)';
          ctx.fillRect(dx, dy, size, size);
          continue;
        }
        const sx = ((x - ax) % current.w + current.w) % current.w, sy = ((y - ay) % current.h + current.h) % current.h;
        ctx.drawImage(pic, sx * TILE, sy * TILE, TILE, TILE, dx, dy, size, size);
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(1, dpr());
    ctx.strokeStyle = '#ffd640';
    ctx.strokeRect(px(x0), py(y0), w * s, h * s);
  }

  function drawMark(px: (x: number) => number, py: (y: number) => number, s: number): void {
    if (g?.kind === 'pick') {
      const x0 = Math.min(g.ax, g.bx), y0 = Math.min(g.ay, g.by);
      ctx.lineWidth = 2 * dpr();
      ctx.strokeStyle = '#4fb3ff';
      ctx.strokeRect(px(x0), py(y0), (Math.abs(g.ax - g.bx) + 1) * s, (Math.abs(g.ay - g.by) + 1) * s);
    } else if (g?.kind === 'box') {
      const x0 = Math.min(g.ax, g.bx), y0 = Math.min(g.ay, g.by);
      const w = Math.abs(g.ax - g.bx) + 1, h = Math.abs(g.ay - g.by) + 1;
      const a = boxAnchor(x0, y0);
      drawGhost(px, py, s, a.x, a.y, x0, y0, w, h);
    } else if ((tool === 'brush' || tool === 'box') && hover && !g) {
      if (tool === 'box') {
        ctx.lineWidth = Math.max(1, dpr());
        ctx.strokeStyle = '#ffd640';
        ctx.strokeRect(px(hover.x), py(hover.y), s, s);
      } else {
        const at = placeAt(current, hover.x, hover.y, snap);
        drawGhost(px, py, s, at.x, at.y, at.x, at.y, current.w, current.h);
      }
    } else if (tool === 'pick' && hover && !g) {
      ctx.lineWidth = Math.max(1, dpr());
      ctx.strokeStyle = '#4fb3ff';
      ctx.strokeRect(px(hover.x), py(hover.y), s, s);
    }
  }

  // ---- painting ------------------------------------------------------------------------
  const saved = () => JSON.stringify(toFile(paint));
  let linkFor = '';
  const afterEdit = () => {
    store(DRAFT, saved());
    refresh();
    void linkNow();
  };
  const refresh = () => {
    $<HTMLButtonElement>('undo').disabled = !history.canUndo;
    $<HTMLButtonElement>('redo').disabled = !history.canRedo;
    for (const id of ['copy', 'share', 'save', 'clear']) $<HTMLButtonElement>(id).disabled = paint.size === 0;
    tell();
  };
  let lastCell: { x: number; y: number } | null = null;
  const tell = (c = lastCell) => {
    lastCell = c;
    const n = `${paint.size} painted.`;
    if (!c) { say(n); return; }
    const m = world.mapAt(c.x, c.y);
    const where = m ? `${nameOf(m.id)}, real map, locked` : world.locked(c.x, c.y) ? 'off the map' : paint.has(keyOf(c.x, c.y)) ? 'painted' : 'free to paint';
    const shown = world.shown(c.x, c.y, paint);
    say(`${c.x}, ${c.y}: ${where}, tile ${shown.id.toString(16)}. ${n}`);
  };
  const layCell = (edit: Edit, x: number, y: number, c: Cell | null) => {
    if (setCell(world, paint, edit, x, y, c)) touched(x, y);
  };
  const layStamp = (edit: Edit, ax: number, ay: number) => {
    for (let y = 0; y < current.h; y++) for (let x = 0; x < current.w; x++) layCell(edit, ax + x, ay + y, current.cells[y * current.w + x]);
  };
  const boxAnchor = (x0: number, y0: number) => (snap ? { x: current.sx, y: current.sy } : { x: x0, y: y0 });
  const redrawEdit = (e: Edit) => { for (const k of e.keys()) touched(xOf(k), yOf(k)); };
  const undo = () => { const e = history.undo(paint); if (e) { redrawEdit(e); afterEdit(); } };
  const redo = () => { const e = history.redo(paint); if (e) { redrawEdit(e); afterEdit(); } };

  // ---- the stamps ----------------------------------------------------------------------
  const FOREST: Cell[] = [0xc6, 0xc7, 0xc7, 0xc6].map((id) => ({ ref: null, id }));
  const seeds: Stamp[] = [
    { w: 1, h: 1, cells: [{ ref: null, id: 1 }], sx: 0, sy: 0 },
    { w: 2, h: 2, cells: FOREST, sx: 0, sy: 0 },
    { w: 1, h: 1, cells: [{ ref: null, id: SEA_METATILE }], sx: 0, sy: 0 },
  ];
  let recent: Stamp[] = seeds;
  try {
    const had = JSON.parse(stored(STAMPS) ?? 'null') as Stamp[] | null;
    if (Array.isArray(had) && had.length) recent = had.filter((s) => s.w > 0 && s.h > 0 && s.cells?.length === s.w * s.h && s.cells.every((c) => !c || !c.ref || homes.has(c.ref)));
  } catch { /* the seeds, then */ }
  let current: Stamp = recent[0] ?? ERASER;
  const sameStamp = (a: Stamp, b: Stamp) => a.w === b.w && a.h === b.h && a.cells.every((c, i) => sameCell(c, b.cells[i]));
  function drawStamps(): void {
    const box = $('stamps');
    box.replaceChildren();
    const eraser = document.createElement('button');
    eraser.textContent = 'ERASE';
    eraser.id = 'eraser';
    eraser.style.fontSize = '11px';
    eraser.title = 'Back to what was there (E)';
    eraser.setAttribute('aria-pressed', String(current === ERASER));
    eraser.onclick = () => chooseStamp(ERASER);
    box.append(eraser);
    recent.forEach((s, i) => {
      const b = document.createElement('button');
      b.dataset.stamp = String(i);
      b.title = `${s.w} x ${s.h}`;
      b.setAttribute('aria-pressed', String(s === current));
      const pic = stampPic(s);
      const cv = document.createElement('canvas');
      cv.width = pic.width;
      cv.height = pic.height;
      cv.getContext('2d')!.drawImage(pic, 0, 0);
      b.append(cv);
      b.onclick = () => chooseStamp(s);
      box.append(b);
    });
  }
  function chooseStamp(s: Stamp): void {
    current = s;
    if (tool === 'move' || tool === 'pick') setTool('brush');
    drawStamps();
    dirty = true;
  }
  function addStamp(s: Stamp): void {
    const had = recent.find((o) => sameStamp(o, s));
    if (had) { had.sx = s.sx; had.sy = s.sy; }
    const keep = had ?? s;
    recent = [keep, ...recent.filter((o) => o !== keep)].slice(0, 24);
    store(STAMPS, JSON.stringify(recent));
    chooseStamp(keep);
  }

  function setTool(t: Tool): void {
    tool = t;
    for (const n of ['move', 'pick', 'brush', 'box'] as Tool[]) $(`t-${n}`).setAttribute('aria-pressed', String(n === t));
    canvas.style.cursor = t === 'move' ? 'grab' : 'crosshair';
    dirty = true;
  }

  // ---- fingers and the mouse -----------------------------------------------------------
  type Gesture =
    | { kind: 'pan'; id: number; px: number; py: number; vx: number; vy: number }
    | { kind: 'pinch'; dist: number; mx: number; my: number; z: number; wx: number; wy: number }
    | { kind: 'wait'; id: number; px: number; py: number; timer: number }
    | { kind: 'brush'; id: number; edit: Edit; first: { x: number; y: number }; last: { x: number; y: number }; done: Set<number> }
    | { kind: 'pick'; id: number; ax: number; ay: number; bx: number; by: number }
    | { kind: 'box'; id: number; ax: number; ay: number; bx: number; by: number }
    | { kind: 'done' };
  let g: Gesture | null = null;
  let hover: { x: number; y: number } | null = null;
  let spaceDown = false;
  const fingers = new Map<number, { x: number; y: number }>();

  const beginBrush = (id: number, px: number, py: number) => {
    const c = toCell(px, py);
    const first = placeAt(current, c.x, c.y, snap);
    const b: Gesture & { kind: 'brush' } = { kind: 'brush', id, edit: new Map(), first, last: c, done: new Set() };
    g = b;
    strokeTo(b, c.x, c.y);
    tell(c);
    return b;
  };
  const strokeTo = (b: Gesture & { kind: 'brush' }, x: number, y: number) => {
    // Every cell between two reports of a quick drag.
    let cx = b.last.x, cy = b.last.y;
    const n = Math.max(Math.abs(x - cx), Math.abs(y - cy), 1);
    const x0 = cx, y0 = cy;
    for (let i = 0; i <= n; i++) {
      cx = Math.round(x0 + (x - x0) * i / n);
      cy = Math.round(y0 + (y - y0) * i / n);
      // A stroke's first stamp is round the finger, so `first` is what its lattice starts from.
      const at = latticeAt(current, b.first, cx, cy);
      const k = keyOf(at.x, at.y);
      if (b.done.has(k)) continue;
      b.done.add(k);
      layStamp(b.edit, at.x, at.y);
    }
    b.last = { x, y };
  };
  /** A second finger: whatever the first had started is off. */
  const cancelTool = () => {
    if (g?.kind === 'wait') clearTimeout(g.timer);
    if (g?.kind === 'brush') {
      revert(paint, g.edit);
      redrawEdit(g.edit);
    }
    g = null;
    dirty = true;
  };
  const startPinch = () => {
    const [a, b] = [...fingers.values()];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const w = toWorld(mx, my);
    g = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx, my, z: view.z, wx: w.x, wy: w.y };
  };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = toCell(e.clientX, e.clientY);
    tell(c);
    if (fingers.size >= 2) {
      cancelTool();
      startPinch();
      return;
    }
    if (e.button === 1 || e.button === 2 || spaceDown || tool === 'move') {
      g = { kind: 'pan', id: e.pointerId, px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (tool === 'pick' || e.altKey) {
      g = { kind: 'pick', id: e.pointerId, ax: c.x, ay: c.y, bx: c.x, by: c.y };
      dirty = true;
      return;
    }
    if (tool === 'box') {
      g = { kind: 'box', id: e.pointerId, ax: c.x, ay: c.y, bx: c.x, by: c.y };
      dirty = true;
      return;
    }
    if (e.pointerType === 'mouse') { beginBrush(e.pointerId, e.clientX, e.clientY); return; }
    const id = e.pointerId, px = e.clientX, py = e.clientY;
    g = { kind: 'wait', id, px, py, timer: window.setTimeout(() => { if (g?.kind === 'wait' && g.id === id) beginBrush(id, g.px, g.py); }, TOUCH_WAIT) };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (fingers.has(e.pointerId)) fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = toCell(e.clientX, e.clientY);
    if (e.pointerType === 'mouse' && (!hover || hover.x !== c.x || hover.y !== c.y)) {
      hover = c;
      dirty = true;
      if (!g) tell(c);
    }
    if (!g) return;
    if (g.kind === 'pinch') {
      if (fingers.size < 2) return;
      const [a, b] = [...fingers.values()];
      view.z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, g.z * Math.hypot(a.x - b.x, a.y - b.y) / g.dist));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, r = rectOf();
      view.x = g.wx - (mx - r.left - r.width / 2) / view.z;
      view.y = g.wy - (my - r.top - r.height / 2) / view.z;
      changedView();
    } else if (g.kind === 'pan' && g.id === e.pointerId) {
      view.x = g.vx - (e.clientX - g.px) / view.z;
      view.y = g.vy - (e.clientY - g.py) / view.z;
      changedView();
    } else if (g.kind === 'wait' && g.id === e.pointerId) {
      if (Math.hypot(e.clientX - g.px, e.clientY - g.py) > 6) {
        clearTimeout(g.timer);
        strokeTo(beginBrush(g.id, g.px, g.py), c.x, c.y);
      }
    } else if (g.kind === 'brush' && g.id === e.pointerId) {
      strokeTo(g, c.x, c.y);
      tell(c);
    } else if ((g.kind === 'pick' || g.kind === 'box') && g.id === e.pointerId) {
      if (g.kind === 'pick') {
        // A block no bigger than a stamp, however far the drag.
        g.bx = g.ax + Math.max(-31, Math.min(31, c.x - g.ax));
        g.by = g.ay + Math.max(-31, Math.min(31, c.y - g.ay));
      } else {
        g.bx = c.x;
        g.by = c.y;
      }
      say(`${Math.abs(g.ax - g.bx) + 1} x ${Math.abs(g.ay - g.by) + 1}`);
      dirty = true;
    }
  });
  const pointerEnd = (e: PointerEvent) => {
    fingers.delete(e.pointerId);
    canvas.style.cursor = tool === 'move' ? 'grab' : 'crosshair';
    if (!g) return;
    if (g.kind === 'pinch') {
      if (fingers.size === 0) g = null;
      else g = { kind: 'done' };
      return;
    }
    if (g.kind === 'done') {
      if (fingers.size === 0) g = null;
      return;
    }
    if (g.id !== e.pointerId) return;
    if (e.type === 'pointercancel') { cancelTool(); return; }
    const done = g;
    g = null;
    if (done.kind === 'wait') {
      clearTimeout(done.timer);
      beginBrush(done.id, done.px, done.py);
      finishBrush();
    } else if (done.kind === 'brush') {
      g = done;
      finishBrush();
    } else if (done.kind === 'pick') {
      addStamp(pickStamp(world, paint, done.ax, done.ay, done.bx, done.by));
      tell({ x: done.bx, y: done.by });
    } else if (done.kind === 'box') {
      const edit: Edit = new Map();
      const x0 = Math.min(done.ax, done.bx), y0 = Math.min(done.ay, done.by), x1 = Math.max(done.ax, done.bx), y1 = Math.max(done.ay, done.by);
      const a = boxAnchor(x0, y0);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) layCell(edit, x, y, stampCell(current, a.x, a.y, x, y));
      history.push(edit);
      afterEdit();
    }
    dirty = true;
  };
  const finishBrush = () => {
    if (g?.kind !== 'brush') return;
    history.push(g.edit);
    g = null;
    afterEdit();
  };
  canvas.addEventListener('pointerup', pointerEnd);
  canvas.addEventListener('pointercancel', pointerEnd);
  canvas.addEventListener('pointerleave', () => { hover = null; dirty = true; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    // A trackpad's two fingers move the view, its pinch comes as ctrl-wheel, and a mouse's wheel zooms.
    const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || mouseWheel) {
      zoomAt(e.clientX, e.clientY, view.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    } else {
      view.x += e.deltaX / view.z;
      view.y += e.deltaY / view.z;
      changedView();
    }
  }, { passive: false });

  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).matches?.('select, textarea, input')) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && key === 'y') { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey) return;
    const pan = 64 / view.z;
    if (e.key === ' ') { spaceDown = true; canvas.style.cursor = 'grab'; e.preventDefault(); }
    else if (key === 'm') setTool('move');
    else if (key === 'p' || key === 'i') setTool('pick');
    else if (key === 'b') setTool('brush');
    else if (key === 'x') setTool('box');
    else if (key === 'e') chooseStamp(ERASER);
    else if (key === 's') toggleSnap();
    else if (key === 'l') toggleMaps();
    else if (key === 't') toggleMine();
    else if (key === 'g') toggleGrid();
    else if (key === '+' || key === '=') centreZoom(1.5);
    else if (key === '-') centreZoom(1 / 1.5);
    else if (key === 'arrowleft') { view.x -= pan; changedView(); }
    else if (key === 'arrowright') { view.x += pan; changedView(); }
    else if (key === 'arrowup') { view.y -= pan; changedView(); }
    else if (key === 'arrowdown') { view.y += pan; changedView(); }
    else return;
    e.preventDefault();
  });
  addEventListener('keyup', (e) => { if (e.key === ' ') { spaceDown = false; canvas.style.cursor = tool === 'move' ? 'grab' : 'crosshair'; } });
  const centreZoom = (f: number) => {
    const r = rectOf();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, view.z * f);
  };

  // ---- the buttons ---------------------------------------------------------------------
  const pressed = (id: string, on: boolean) => $(id).setAttribute('aria-pressed', String(on));
  const toggleSnap = () => { snap = !snap; pressed('t-snap', snap); dirty = true; };
  const toggleMaps = () => { showMaps = !showMaps; pressed('o-maps', showMaps); dirty = true; };
  const toggleMine = () => { showMine = !showMine; pressed('o-mine', showMine); dirty = true; };
  const toggleGrid = () => { showGrid = !showGrid; pressed('o-grid', showGrid); dirty = true; };
  for (const n of ['move', 'pick', 'brush', 'box'] as Tool[]) $(`t-${n}`).onclick = () => setTool(n);
  $('t-snap').onclick = toggleSnap;
  $('o-maps').onclick = toggleMaps;
  $('o-mine').onclick = toggleMine;
  $('o-grid').onclick = toggleGrid;
  $('undo').onclick = undo;
  $('redo').onclick = redo;
  $('menu').onclick = () => { pressed('menu', $('more').classList.toggle('open')); };
  const go = $<HTMLSelectElement>('go');
  go.add(new Option('Go to a map…', ''));
  go.add(new Option('All of Hoenn', 'all'));
  [...spots].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })).forEach((m) => go.add(new Option(nameOf(m.id), m.id)));
  go.onchange = () => {
    const m = spots.find((o) => o.id === go.value);
    if (m) {
      const r = rectOf();
      view.x = m.gx + m.w / 2;
      view.y = m.gy + m.h / 2;
      view.z = Math.min(r.width / (m.w + 40), r.height / (m.h + 40));
      changedView();
    } else if (go.value === 'all') {
      fit();
      changedView();
    }
    go.value = '';
  };
  const linkOf = async () => `${location.origin}/map/#${await toHash(toFile(paint))}`;
  async function linkNow(): Promise<void> {
    const want = saved();
    if (want === linkFor) return;
    linkFor = want;
    const url = paint.size ? await linkOf() : '';
    if (linkFor === want) $<HTMLTextAreaElement>('link').value = url;
  }
  $('copy').onclick = async () => {
    const url = await linkOf();
    const box = $<HTMLTextAreaElement>('link');
    box.value = url;
    try {
      await navigator.clipboard.writeText(url);
      say(`Link copied: ${paint.size} cells, ${url.length} letters.`);
    } catch {
      box.focus();
      box.select();
      say('Your browser would not copy it: the link is selected in the box.', true);
    }
  };
  if (!navigator.share) $('share').style.display = 'none';
  $('share').onclick = async () => {
    try {
      await navigator.share({ title: 'Map paint', url: await linkOf() });
    } catch { /* they backed out */ }
  };
  $('save').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([saved()], { type: 'application/json' }));
    a.download = 'hoenn-map-paint.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('clear').onclick = () => {
    const edit: Edit = new Map(paint);
    for (const k of edit.keys()) touched(xOf(k), yOf(k));
    paint.clear();
    history.push(edit);
    afterEdit();
    say('All cleared. Undo brings it back.');
  };

  /** Paint from somewhere else: taken as it is if there's none here, asked about if there is. */
  async function bring(got: Map<number, Cell>): Promise<void> {
    const usable = [...got].filter(([k, c]) => !world.locked(xOf(k), yOf(k)) && !sameCell(c, world.base(xOf(k), yOf(k))));
    const take = (replace: boolean) => {
      const edit: Edit = new Map();
      if (replace) for (const k of [...paint.keys()]) layCell(edit, xOf(k), yOf(k), null);
      for (const [k, c] of usable) layCell(edit, xOf(k), yOf(k), c);
      history.push(edit);
      afterEdit();
      say(`${usable.length} cells brought in. ${paint.size} painted.`);
    };
    if (!paint.size) { take(false); return; }
    $('ask-say').textContent = `This has ${usable.length} painted cells, and there are ${paint.size} here.`;
    $('ask').classList.add('open');
    await new Promise<void>((resolve) => {
      const close = () => { $('ask').classList.remove('open'); resolve(); };
      $('ask-add').onclick = () => { take(false); close(); };
      $('ask-replace').onclick = () => { take(true); close(); };
      $('ask-no').onclick = close;
    });
  }
  const openFile = async (f: File) => {
    let got: Map<number, Cell> | null = null;
    try { got = fromFile(JSON.parse(await f.text())); } catch { /* said below */ }
    if (got) await bring(got);
    else say(`${f.name} is not a paint file.`, true);
  };
  $<HTMLInputElement>('open').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) void openFile(f).finally(() => { input.value = ''; });
  });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (f) void openFile(f);
  });
  const takeHash = async () => {
    if (location.hash.length < 3) return;
    const got = await fromHash(location.hash);
    history_clean();
    if (got) await bring(got);
    else say('That link has no paint in it.', true);
  };
  const history_clean = () => { window.history.replaceState(null, '', location.pathname + location.search); };
  addEventListener('hashchange', () => { void takeHash(); });

  // ---- off it goes ---------------------------------------------------------------------
  resize();
  if (!hadView) fit();
  clampView();
  setTool('move');
  pressed('t-snap', snap);
  pressed('o-maps', showMaps);
  pressed('o-mine', showMine);
  pressed('o-grid', showGrid);
  drawStamps();
  refresh();
  void linkNow();
  await takeHash();
  const loop = () => {
    if (dirty) {
      dirty = false;
      render();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // For the specs.
  (window as unknown as { __mappage: unknown }).__mappage = {
    get tool() { return tool; },
    get view() { return { ...view }; },
    get stamp() { return current; },
    get count() { return paint.size; },
    get settled() { return !dirty; },
    file: () => toFile(paint),
    locked: (x: number, y: number) => world.locked(x, y),
    shown: (x: number, y: number) => world.shown(x, y, paint),
    base: (x: number, y: number) => world.base(x, y),
    mapAt: (x: number, y: number) => world.mapAt(x, y)?.id ?? null,
    /** Where world cell (x, y)'s middle is on the page. */
    at: (x: number, y: number) => {
      const r = rectOf();
      return { x: r.left + r.width / 2 + (x + 0.5 - view.x) * view.z, y: r.top + r.height / 2 + (y + 0.5 - view.y) * view.z };
    },
    look: (x: number, y: number, z: number) => { view.x = x; view.y = y; view.z = z; changedView(); },
    hash: async () => toHash(toFile(paint)),
  };
}

void boot().catch((e) => { console.error('[map]', e); const el = document.getElementById('boot-say'); if (el) el.textContent = String(e); });
