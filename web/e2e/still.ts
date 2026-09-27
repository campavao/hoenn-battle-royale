// The ROM's picture held to the map's still (POK-329). Past the LCD the core draws the
// field from the ROM's own ring of tiles, and tools/br/render-maps.py draws the same map
// from pret's data into web/public/field-maps/<MAP_ID>.png, which the composite under the
// picture shows. So wherever the band shows inside the map, it is that still -- less the
// sprites, the animated tiles (a flower's frames) and the GBA's 5-bit colour -- and a cell
// of the ring holding the wrong row or column of the map, the border block, the last
// map's rows or nothing at all, shows here as a 16x16 cell of the picture that is not
// the still.
//
// What counts is what the page shows: the band as the clip-path on #canvas leaves it
// (field.ts cuts it at the map's edge, and past the ring), read in the same frame, as a
// player would see it. The LCD itself is the GBA's and is not compared.
//
// One thing of BG0's is left out on purpose: the map-name popup slides in and out by
// scrolling all of BG0 (map_name_popup.c: BG0VOFS 40 from the moment a new area is
// entered, half a second before the window is even printed, then 40 to 0 and back), so
// while its task runs BG0's top rows -- the HUD's corner, then the popup -- are drawn in
// the sprite window's rows above the LCD, where the core draws every BG. That is
// POK-319's band, not the ring's, and a follow-up; the rows it reaches are not compared
// while the task runs.
//
// Everything in `installStill` runs in the page (Playwright serialises it), so it reaches
// for nothing outside itself. picture.spec.ts and scripts/seam-probe.mjs --check use it.

/** The ROM addresses the check reads (br-symbols.json). */
export interface StillSymbols {
  gSaveBlock1Ptr: number;
  gSaveBlock2Ptr: number;
  gTasks: number;
  gFieldCamera: number;
  gMain: number;
  CB2_Overworld: number;
}

export interface StillSetup {
  sym: StillSymbols;
  /** 'group:num' -> the still's URL, for every map the check may meet. */
  stills: Record<string, string>;
  /** Milliseconds between samples; 0 for every frame. */
  every: number;
  /** Per channel, 0..255: mGBA widens a 5-bit colour as (v << 3) | (v >> 2), the .pal
   *  files render-maps.py reads do not always. */
  tolerance: number;
  /** A cell is the still when this share of the pixels it compares match. */
  pass: number;
  /** A cell that compares fewer pixels than this (the map's edge, people) says nothing. */
  minPixels: number;
  /** Pictures of the first samples with a miss in a cell no kept picture has, for a
   *  person to look at (`missPngs()`). */
  keep?: number;
}

/** One 16x16 cell of one sample that was not the still. */
export interface CellMiss {
  frame: number;
  /** The cell's top-left, in LCD pixels (the LCD's top-left is 0,0). */
  x: number;
  y: number;
  share: number;
  compared: number;
  /** The same pixels against the still one metatile further down: the check's control. */
  control: number;
  cam: { map: string; x: number; y: number; subX: number; subY: number };
  /** The clip the page had on the picture, in GBA pixels. */
  clip: [number, number, number, number];
  /** Where the LCD's own pixels say the picture is, against where the camera said:
   *  dx, dy that fit the LCD to the still best (0, 0 when the read is the picture's). */
  fit?: [number, number, number];
  /** The camera read with the picture, one frame on. */
  next?: { x: number; y: number; subX: number; subY: number };
}

export interface StillReport {
  samples: number;
  /** Samples taken mid-step: the camera's sub-tile offset not 0. */
  moving: number;
  /** Cells that compared at least minPixels. */
  cells: number;
  /** ...and the ones the control (the still one metatile off) passed too. */
  controlPassed: number;
  /** The worst share any cell had, and where. */
  worst: number;
  worstAt: CellMiss | null;
  misses: CellMiss[];
  /** How many misses in all (misses keeps the first 100, and 200 more under half). */
  missed: number;
  /** The picture's size and the band it carries, as the last sample saw them. */
  picture: { width: number; height: number; left: number; top: number } | null;
  /** Frames the page's reads lost track of (a frame with no callback). */
  gaps: number;
  /** Pictures drawn from a frame whose logic ran past its VBlank (a lag frame): the scroll
   *  registers the VBlank wrote were the new camera's, the tilemap copies the logic had
   *  not asked for yet, so there is no state to hold that picture to. Not compared. */
  lagged: number;
  /** Pictures drawn with the map-name popup's task running (BG0 scrolled). */
  popup: number;
  /** The worst share of all the pixels one picture compared. */
  worstFrame: number;
  /** ...and the best share any picture had against the still one metatile further down:
   *  the check's control, which must stay well under what a picture needs to pass. */
  controlFrame: number;
  /** Every sample's camera and worst cell, in order: frame x,y,subX,subY worst%. */
  trace: string[];
}

/** A sprite's box on the picture, LCD pixels: x0, y0, x1, y1. */
type Box = [number, number, number, number];
type Cam = { map: string; x: number; y: number; subX: number; subY: number; frame: number; logic: number; field: boolean; popup: number; sprites: Box[] };
type Pic = { width: number; height: number; left: number; top: number; data: Uint8Array };
type StillEmu = {
  read(addr: number, width: 8 | 16 | 32): number;
  bytes(addr: number, len: number): Uint8Array;
  onFrame(fn: () => void): () => void;
  picture(): Pic | null;
};
type StillWindow = {
  __hbr: { emu: StillEmu };
  __still?: { start(): void; stop(): StillReport; report(): StillReport; worstPng(): string | null; missPngs(): string[] };
};

/** Sets up window.__still in the page: `start()` samples the core's picture against the
 *  still until `stop()`, which returns what it found; `worstPng()` is the picture with the
 *  worst cell in it, every compared pixel that was not the still in magenta and the part
 *  the page did not show darkened, as a data URL. */
export async function installStill(s: StillSetup): Promise<void> {
  const w = window as unknown as StillWindow;
  const emu = w.__hbr.emu;
  const lcd = document.querySelector('#canvas') as HTMLCanvasElement;
  const stills: Record<string, { w: number; h: number; px: Uint8ClampedArray }> = {};
  for (const [ref, url] of Object.entries(s.stills)) {
    const img = await createImageBitmap(await (await fetch(url)).blob());
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    stills[ref] = { w: img.width, h: img.height, px: g.getImageData(0, 0, img.width, img.height).data };
  }
  const s16 = (v: number) => (v << 16) >> 16;
  // Every sprite the ROM put in OAM, where the core draws it: gMain.oamBuffer (at 0x38,
  // 128 entries of 8 bytes) is what the VBlank copies to OAM, so the picture of the next
  // frame is drawn from this frame's. A y of 216 (160 + the sprite window's 56) or more is
  // above the LCD, as the core reads it; semi-transparent sprites (the weather) and
  // hidden ones are not people.
  const SIZES = [[[8, 8], [16, 16], [32, 32], [64, 64]], [[16, 8], [32, 8], [32, 16], [64, 32]], [[8, 16], [8, 32], [16, 32], [32, 64]]];
  const sprites = (): Box[] => {
    const oam = emu.bytes(s.sym.gMain + 0x38, 128 * 8);
    const out: Box[] = [];
    for (let i = 0; i < 128; i++) {
      const a0 = oam[8 * i] | (oam[8 * i + 1] << 8);
      const a1 = oam[8 * i + 2] | (oam[8 * i + 3] << 8);
      const affine = (a0 >> 8) & 3;
      const mode = (a0 >> 10) & 3;
      if (affine === 2 || mode === 1 || mode === 2) continue;
      const shape = SIZES[(a0 >> 14) & 3];
      if (!shape) continue;
      let [w, h] = shape[(a1 >> 14) & 3];
      if (affine === 3) {
        w *= 2;
        h *= 2;
      }
      const y = a0 & 0xff;
      const x = a1 & 0x1ff;
      const top = y >= 216 ? y - 256 : y;
      const left = x >= 256 ? x - 512 : x;
      out.push([left - 1, top - 1, left + w + 1, top + h + 1]);
    }
    return out;
  };
  // How far the map-name popup has BG0 scrolled: its task (map_name_popup.c) is the one
  // at priority 90, and its tYOffset (data[2]) is the BG0VOFS it writes. `struct Task`
  // (include/task.h): func, isActive at 4, priority at 7, data at 8; 16 of 40 bytes.
  const popupUp = (): number => {
    const t = emu.bytes(s.sym.gTasks, 16 * 40);
    let y = 0;
    for (let i = 0; i < 16; i++) {
      if (!t[40 * i + 4] || t[40 * i + 7] !== 90) continue;
      y = Math.max(y, Math.min(40, Math.max(1, ((t[40 * i + 12] | (t[40 * i + 13] << 8)) << 16) >> 16)));
    }
    return y;
  };
  const read = (): Cam | null => {
    const p = emu.read(s.sym.gSaveBlock1Ptr, 32);
    if (!p) return null;
    return {
      map: `${emu.read(p + 4, 8)}:${emu.read(p + 5, 8)}`,
      x: s16(emu.read(p, 16)),
      y: s16(emu.read(p + 2, 16)),
      subX: emu.read(s.sym.gFieldCamera + 16, 32) | 0,
      subY: emu.read(s.sym.gFieldCamera + 20, 32) | 0,
      // gMain.vblankCounter1: one a frame.
      frame: emu.read(s.sym.gMain + 0x20, 32) >>> 0,
      // gSaveBlock2Ptr->playTimeVBlanks: one a frame of the game's logic, at the end of
      // its main loop (PlayTimeCounter_Update; BR starts the clock at boot). A frame the
      // logic has not finished by the VBlank has not moved it.
      logic: emu.read(emu.read(s.sym.gSaveBlock2Ptr, 32) + 0x12, 8),
      field: (emu.read(s.sym.gMain + 4, 32) & ~1) === (s.sym.CB2_Overworld & ~1),
      sprites: sprites(),
      popup: popupUp(),
    };
  };
  // field.ts's lcdOrigin: the map pixel at the LCD's top-left.
  const sub = (v: number) => (v > 0 ? v - 16 : v < 0 ? v + 16 : 0);
  const originOf = (c: Cam) => ({ left: c.x * 16 - 112 + sub(c.subX), top: c.y * 16 - 72 + sub(c.subY) });
  // The clip-path field.ts put on the picture this frame, in GBA pixels: top, right,
  // bottom, left. Its frame listener runs before this one (it attached first).
  const clipOf = (pic: Pic): [number, number, number, number] => {
    const m = /^inset\(([^)]*)\)$/.exec(lcd.style.clipPath.trim());
    if (!m) return [0, 0, 0, 0];
    const scale = lcd.getBoundingClientRect().width / pic.width;
    const v = m[1].trim().split(/\s+/).map((t) => Math.round(Number.parseFloat(t) / scale));
    const [t, r = t, b = t, l = r] = v;
    return [t, r, b, l];
  };

  const fresh = (): StillReport => ({ samples: 0, moving: 0, cells: 0, controlPassed: 0, worst: 1, worstAt: null, misses: [], missed: 0, picture: null, gaps: 0, lagged: 0, popup: 0, worstFrame: 1, controlFrame: 0, trace: [] });
  let report = fresh();
  type Kept = { pic: Pic; bad: Uint8Array; clip: [number, number, number, number] };
  let worstPic: Kept | null = null;
  let kept: Kept[] = [];
  let keptCells = new Set<string>();
  let prev: Cam | null = null;
  let prev2: Cam | null = null;
  let fits = 0;
  let last = -Infinity;
  let off: (() => void) | null = null;

  /** Compares one picture with the still, from the camera and the OAM it was drawn from.
   *  The sprites are left out, and this frame's too, a pixel round. */
  const sample = (pic: Pic, c: Cam, now: Cam) => {
    const still = stills[c.map];
    if (!still) return;
    const o = originOf(c);
    const clip = clipOf(pic);
    // The sprites, as a bitmap of the picture: 1 where one is.
    const mask = new Uint8Array(pic.width * pic.height);
    for (const [x0, y0, x1, y1] of [...c.sprites, ...now.sprites]) {
      const ya = Math.max(0, y0 + pic.top);
      const yb = Math.min(pic.height, y1 + pic.top);
      const xa = Math.max(0, x0 + pic.left);
      const xb = Math.min(pic.width, x1 + pic.left);
      for (let y = ya; y < yb; y++) mask.fill(1, y * pic.width + xa, Math.max(y * pic.width + xa, y * pic.width + xb));
    }
    const px = pic.data;
    const tol = s.tolerance;
    const same = (i: number, sx: number, sy: number) => {
      if (sx < 0 || sy < 0 || sx >= still.w || sy >= still.h) return false;
      const j = (sy * still.w + sx) * 4;
      return Math.abs(px[i] - still.px[j]) <= tol && Math.abs(px[i + 1] - still.px[j + 1]) <= tol && Math.abs(px[i + 2] - still.px[j + 2]) <= tol;
    };
    report.samples++;
    if (c.subX || c.subY) report.moving++;
    // The rows the popup's scroll puts BG0 in, above the LCD.
    const bg0From = -Math.max(c.popup, now.popup);
    if (bg0From) report.popup++;
    report.picture = { width: pic.width, height: pic.height, left: pic.left, top: pic.top };
    const bad = new Uint8Array(pic.width * pic.height);
    let worstHere = 1;
    let newMiss = false;
    let allCompared = 0;
    let allMatched = 0;
    let allControl = 0;
    // What the page shows of the picture, in its own pixels.
    const shown = { x0: clip[3], y0: clip[0], x1: pic.width - clip[1], y1: pic.height - clip[2] };
    for (let cy = 0; cy < pic.height; cy += 16) {
      for (let cx = 0; cx < pic.width; cx += 16) {
        let compared = 0;
        let matched = 0;
        let control = 0;
        for (let py = cy; py < Math.min(pic.height, cy + 16); py++) {
          if (py < shown.y0 || py >= shown.y1) continue;
          const r = py - pic.top;
          const my = o.top + r;
          if (my < 0 || my >= still.h) continue;
          for (let qx = cx; qx < Math.min(pic.width, cx + 16); qx++) {
            if (qx < shown.x0 || qx >= shown.x1) continue;
            const x = qx - pic.left;
            if (r >= 0 && r < 160 && x >= 0 && x < 240) continue; // the LCD
            if (r >= bg0From && r < 0) continue;
            const mx = o.left + x;
            if (mx < 0 || mx >= still.w) continue;
            if (mask[py * pic.width + qx]) continue;
            const i = (py * pic.width + qx) * 4;
            compared++;
            if (same(i, mx, my)) matched++;
            else bad[py * pic.width + qx] = 1;
            if (same(i, mx, my + 16)) control++;
          }
        }
        allCompared += compared;
        allMatched += matched;
        allControl += control;
        if (compared < s.minPixels) continue;
        report.cells++;
        const share = matched / compared;
        const ctl = control / compared;
        if (ctl >= s.pass) report.controlPassed++;
        const miss: CellMiss = { frame: c.frame, x: cx - pic.left, y: cy - pic.top, share, compared, control: ctl, cam: { map: c.map, x: c.x, y: c.y, subX: c.subX, subY: c.subY }, clip };
        if (share < report.worst) {
          report.worst = share;
          report.worstAt = miss;
        }
        worstHere = Math.min(worstHere, share);
        if (share < s.pass) {
          report.missed++;
          if (report.misses.length < 100 || (share < 0.5 && report.misses.length < 3000)) report.misses.push(miss);
          const key = `${miss.x},${miss.y}`;
          if (!keptCells.has(key)) {
            keptCells.add(key);
            newMiss = true;
          }
        }
      }
    }
    if (newMiss && worstHere < 0.5 && fits++ < 12) {
      // Which offset of the still fits the LCD best (every 4th pixel, sprites left out)?
      let best: [number, number, number] = [0, 0, -1];
      for (let dy = -16; dy <= 16; dy++) {
        for (let dx = -16; dx <= 16; dx++) {
          let n = 0;
          let ok = 0;
          for (let r = 8; r < 152; r += 4) {
            for (let x = 2; x < 240; x += 4) {
              if (mask[(pic.top + r) * pic.width + pic.left + x]) continue;
              n++;
              if (same(((pic.top + r) * pic.width + pic.left + x) * 4, o.left + x + dx, o.top + r + dy)) ok++;
            }
          }
          const share = n ? ok / n : 0;
          if (share > best[2]) best = [dx, dy, share];
        }
      }
      for (const m of report.misses) if (m.frame === c.frame) {
        m.fit = [best[0], best[1], Math.round(best[2] * 100)];
        m.next = { x: now.x, y: now.y, subX: now.subX, subY: now.subY };
      }
    }
    if (allCompared) {
      report.worstFrame = Math.min(report.worstFrame, allMatched / allCompared);
      report.controlFrame = Math.max(report.controlFrame, allControl / allCompared);
    }
    if (report.trace.length < 3000) report.trace.push(`${c.frame} ${c.x},${c.y},${c.subX},${c.subY} ${Math.round(worstHere * 100)}`);
    if (worstHere <= report.worst) worstPic = { pic: { ...pic, data: pic.data.slice() }, bad, clip };
    if (newMiss && kept.length < (s.keep ?? 0)) kept.push({ pic: { ...pic, data: pic.data.slice() }, bad, clip });
  };

  const png = ({ pic, bad, clip }: Kept): string => {
    const c = document.createElement('canvas');
    c.width = pic.width;
    c.height = pic.height;
    const rgba = new Uint8ClampedArray(pic.data);
    for (let i = 0; i < bad.length; i++) {
      const x = i % pic.width;
      const y = Math.floor(i / pic.width);
      rgba[4 * i + 3] = 255;
      if (bad[i]) {
        rgba[4 * i] = 255;
        rgba[4 * i + 1] = 0;
        rgba[4 * i + 2] = 255;
      } else if (y < clip[0] || x >= pic.width - clip[1] || y >= pic.height - clip[2] || x < clip[3]) {
        for (let k = 0; k < 3; k++) rgba[4 * i + k] >>= 2;
      }
    }
    c.getContext('2d')!.putImageData(new ImageData(rgba, pic.width, pic.height), 0, 0);
    return c.toDataURL('image/png');
  };

  w.__still = {
    start() {
      report = fresh();
      worstPic = null;
      kept = [];
      keptCells = new Set();
      fits = 0;
      prev = null;
      prev2 = null;
      last = -Infinity;
      off?.();
      off = emu.onFrame(() => {
        const now = read();
        // The picture of this frame was drawn from the state read on the frame before it
        // (field.ts): the scroll registers are written at the VBlank that ends a frame.
        const was = prev;
        const before = prev2;
        prev2 = prev;
        prev = now;
        if (!now || !was || !before || !now.field || !was.field) return;
        if (now.frame !== was.frame + 1 || was.frame !== before.frame + 1) {
          report.gaps++;
          return;
        }
        if (was.logic === before.logic) {
          report.lagged++;
          return;
        }
        const t = performance.now();
        if (t - last < s.every) return;
        last = t;
        const pic = emu.picture();
        if (pic) sample(pic, was, now);
      });
    },
    stop() {
      off?.();
      off = null;
      return report;
    },
    report() {
      return report;
    },
    worstPng() {
      return worstPic ? png(worstPic) : null;
    },
    missPngs() {
      return kept.map(png);
    },
  };
}