// The loading screen: Emerald's opening bike ride (intro.c, scene 2) over the page while the
// game gets ready, with what it is doing written on the grass under the bike (Cam 11-10).
// Until the player's ROM is in hand there is nothing to draw it from, so the screen is a
// plain dark one with the line; the ride fades in once the ROM's bytes are here.
//
// Drawn the way the GBA does it, a frame at a time at 60 a second:
//   BG3 the far trees (trees_map, first screen), still            priority 3
//   the small trees, 12 sprites drifting right at 1/8..1/32 px    priority 3
//   BG2 the near trees (trees_map, second screen), 1/4 px a frame priority 2
//   BG1 the grass (grass_map), 4 px a frame                       priority 1
//   the riders, left to right on top: Volbeat, the bicycle, the player, Torchic, Manectric
// and the palette's 9th and 10th colours trading places every 8 frames (CycleSceneryPalette),
// which is what makes the far hills shimmer. The 240-px screen is widened to the window by
// carrying on the 256-px backgrounds' wrap, at a whole-number scale so no pixel is smeared.

import type { IntroArt } from './introart';

const H = 160;
const FRAME_MS = 1000 / 60;

/** sSpriteMetadata_Trees: x, the tile the frame starts on, its width, and its speed (16.16). */
const TREES: [number, number, number, number][] = [
  [16, 0, 32, 0x2000], [40, 16, 16, 0x1000], [56, 24, 16, 0x800],
];
const TREE_Y = 88;

interface Sprite { tiles: Uint8Array; pal: Uint32Array; w: number; h: number }

/** A sprite frame (1D-mapped 4bpp, `tile` its first) as an RGBA canvas, colour 0 clear. */
function sprite(s: Sprite, tile: number, flip = false): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = s.w; c.height = s.h;
  const img = c.getContext('2d')!.createImageData(s.w, s.h);
  const px = new Uint32Array(img.data.buffer);
  const across = s.w / 8;
  for (let ty = 0; ty < s.h / 8; ty++) {
    for (let tx = 0; tx < across; tx++) {
      const at = (tile + ty * across + tx) * 32;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const b = s.tiles[at + y * 4 + (x >> 1)] ?? 0;
          const v = x & 1 ? b >> 4 : b & 15;
          if (!v) continue;
          const sx = tx * 8 + x;
          px[(ty * 8 + y) * s.w + (flip ? s.w - 1 - sx : sx)] = s.pal[v];
        }
      }
    }
  }
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

/** One 32x32-tile text background (2 KB of map) as a 256x256 RGBA canvas, colour 0 clear. */
function background(tiles: Uint8Array, map: Uint8Array, mapAt: number, pal: Uint32Array): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const img = c.getContext('2d')!.createImageData(256, 256);
  const px = new Uint32Array(img.data.buffer);
  for (let i = 0; i < 32 * 32; i++) {
    const e = map[mapAt + i * 2] | (map[mapAt + i * 2 + 1] << 8);
    const at = (e & 0x3ff) * 32, hf = e & 0x400, vf = e & 0x800;
    if (at + 32 > tiles.length) continue;
    const ox = (i & 31) * 8, oy = (i >> 5) * 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const b = tiles[at + y * 4 + (x >> 1)];
        const v = x & 1 ? b >> 4 : b & 15;
        if (!v) continue;
        px[(oy + (vf ? 7 - y : y)) * 256 + ox + (hf ? 7 - x : x)] = pal[v];
      }
    }
  }
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

/** The ride's pictures, cut once. */
interface Cut {
  backdrop: string;
  far: HTMLCanvasElement[]; near: HTMLCanvasElement[]; grass: HTMLCanvasElement;
  trees: HTMLCanvasElement[];
  player: HTMLCanvasElement[]; bike: HTMLCanvasElement[]; torchic: HTMLCanvasElement[];
  manectric: HTMLCanvasElement[]; volbeat: HTMLCanvasElement[];
}

function css(c: number): string {
  return `rgb(${c & 255},${(c >> 8) & 255},${(c >> 16) & 255})`;
}

function cut(art: IntroArt, female: boolean): Cut {
  // CycleSceneryPalette(0): colours 9 and 10 of BG palette 0 trade places.
  const swapped = art.treesPal.slice();
  [swapped[9], swapped[10]] = [art.treesPal[10], art.treesPal[9]];
  const rider = female ? art.may : art.brendan;
  return {
    backdrop: css(art.treesPal[0]),
    far: [background(art.trees, art.treesMap, 0, art.treesPal), background(art.trees, art.treesMap, 0, swapped)],
    near: [background(art.trees, art.treesMap, 0x800, art.treesPal), background(art.trees, art.treesMap, 0x800, swapped)],
    grass: background(art.grass, art.grassMap, 0, art.grassPal),
    trees: TREES.map(([, tile, w]) => sprite({ tiles: art.treesSmall, pal: art.treesSmallPal, w, h: 32 }, tile)),
    player: [0, 64, 128, 192].map((t) => sprite({ tiles: rider, pal: art.playerPal, w: 64, h: 64 }, t)),
    bike: [0, 32, 64, 96].map((t) => sprite({ tiles: art.bicycle, pal: art.playerPal, w: 64, h: 32 }, t)),
    torchic: [0, 16, 32, 16].map((t) => sprite({ tiles: art.torchic, pal: art.torchicPal, w: 32, h: 32 }, t)),
    manectric: [0, 64, 128, 192].map((t) => sprite({ tiles: art.manectric, pal: art.manectricPal, w: 64, h: 64 }, t)),
    volbeat: [0, 16].map((t) => sprite({ tiles: art.volbeat, pal: art.volbeatPal, w: 32, h: 32 }, t)),
  };
}

/** The scale: whole pixels, the ride about three fifths of the height, and never so narrow
 *  that the riders do not fit across (176 GBA px). */
export function sceneScale(vw: number, vh: number): number {
  return Math.max(1, Math.min(Math.floor((vh * 0.6) / H), Math.floor(vw / 176)));
}

/** sin of a 256-step angle, as the ROM's Sin(index, amplitude) table reads. */
const sin = (i: number, amp: number) => Math.sin((i / 256) * Math.PI * 2) * amp;

export class LoadingScreen {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly line: HTMLDivElement;
  private pics: Cut | null = null;
  private raf = 0;
  private start = 0;
  private scale = 1;
  private w = 240;
  private wobble = 0;
  private gone = false;

  /** The page's own #loading (index.html, so it is up from the first paint), or a new one,
   *  until `done` says there is something to do (asked every frame). */
  constructor(private readonly done: () => boolean = () => false, host: HTMLElement = document.body) {
    const had = document.getElementById('loading') as HTMLDivElement | null;
    this.root = had ?? document.createElement('div');
    this.root.id = 'loading';
    this.canvas = this.root.querySelector('canvas') ?? this.root.appendChild(document.createElement('canvas'));
    this.canvas.height = H;
    this.line = (this.root.querySelector('.loading-line') as HTMLDivElement | null) ?? this.root.appendChild(document.createElement('div'));
    this.line.className = 'loading-line';
    this.line.setAttribute('role', 'status');
    if (!had) host.append(this.root);
    document.body.classList.add('loading-up');
    addEventListener('resize', this.fit);
    this.fit();
    this.raf = requestAnimationFrame(this.draw);
  }

  get up(): boolean { return !this.gone && !this.root.hidden; }

  /** What the page is doing, on the grass under the bike. */
  say(text: string): void {
    this.line.textContent = text;
  }

  /** The ride, from the player's ROM; `female` rides May's bike, Brendan's otherwise. */
  ride(art: IntroArt | null, female: boolean): void {
    if (!art || this.gone || this.pics) return;
    this.pics = cut(art, female);
    this.root.classList.add('riding');
    this.root.style.setProperty('--sky', this.pics.backdrop);
    this.start = performance.now();
    this.fit();
  }

  /** Out of the way for something the player must answer (the ROM picker), and back. */
  hold(on: boolean): void {
    if (this.gone) return;
    this.root.hidden = on;
    document.body.classList.toggle('loading-up', !on);
  }

  /** Done: it fades and is gone for good. */
  hide(): void {
    if (this.gone) return;
    this.gone = true;
    document.body.classList.remove('loading-up');
    removeEventListener('resize', this.fit);
    this.root.classList.add('leaving');
    const end = () => { cancelAnimationFrame(this.raf); this.root.remove(); };
    this.root.addEventListener('transitionend', end, { once: true });
    setTimeout(end, 600);
  }

  private readonly fit = (): void => {
    const vw = innerWidth, vh = innerHeight;
    this.scale = sceneScale(vw, vh);
    this.w = Math.ceil(vw / this.scale);
    this.canvas.width = this.w;
    this.canvas.style.width = `${this.w * this.scale}px`;
    this.canvas.style.height = `${H * this.scale}px`;
    this.root.style.setProperty('--px', `${this.scale}px`);
    this.root.style.setProperty('--top', `${Math.round((vh - H * this.scale) * 0.4)}px`);
  };

  private readonly draw = (now: number): void => {
    if (this.gone) return;
    if (!this.root.hidden && this.done()) { this.hide(); return; }
    this.raf = requestAnimationFrame(this.draw);
    if (!this.pics) return;
    const p = this.pics, f = Math.floor((now - this.start) / FRAME_MS);
    const g = this.canvas.getContext('2d')!;
    const w = this.w;
    g.imageSmoothingEnabled = false;
    g.fillStyle = p.backdrop;
    g.fillRect(0, 0, w, H);
    const shimmer = (f >> 3) & 1;
    // A background scrolled by `hofs` (REG_BGxHOFS), its 256-px wrap carried on across.
    const bg = (c: HTMLCanvasElement, hofs: number) => {
      const off = ((Math.floor(hofs) % 256) + 256) % 256;
      for (let x = -off; x < w; x += 256) g.drawImage(c, 0, 0, 256, H, x, 0, 256, H);
    };
    bg(p.far[shimmer], 8);
    // The small trees: the ROM's x positions repeat every 64 px, so a 64-px pattern across.
    const span = Math.ceil((w + 64) / 64) * 64;
    TREES.forEach(([x0, , tw, speed], i) => {
      const moved = Math.floor((speed * f) / 0x10000);
      for (let k = 0; k * 64 < span; k++) {
        const x = ((x0 + k * 64 + moved) % span) - 32;
        g.drawImage(p.trees[i], x - tw / 2, TREE_Y - 16);
      }
    });
    bg(p.near[shimmer], -f / 4);
    bg(p.grass, -f * 4);

    // The riders round the middle, the player a touch left of it so that Torchic, behind,
    // runs clear of Manectric's circle on a phone's narrow screen as on a wide one.
    const cx = Math.round(w / 2) - 8;
    // SpriteCB_PlayerOnBicycle: every 8 frames a 1-px wobble up or down, or back to level.
    if ((f & 7) === 0 && f !== this.lastWobble) {
      this.lastWobble = f;
      this.wobble = this.wobble ? 0 : [-1, 1, 0, 0][Math.floor(Math.random() * 4)];
    }
    const at = (c: HTMLCanvasElement, x: number, y: number) => g.drawImage(c, Math.round(x - c.width / 2), Math.round(y - c.height / 2));
    // Volbeat's loop over the rider.
    const v = (f % 180) / 180 * 256;
    at(p.volbeat[(f >> 1) & 1], cx + 4 + sin(v, 40), 56 + sin(v * 2, 8));
    at(p.bike[(f >> 3) & 3], cx, 108 + this.wobble);
    at(p.player[(f >> 2) & 3], cx, 100 + this.wobble);
    // Torchic running behind (sAnim_Torchic_Run: 3 frames a step).
    at(p.torchic[Math.floor(f / 3) & 3], cx + 72, 110);
    // Manectric's circle round the bike (SpriteCB_Manectric's sin/cos, 256 frames a lap).
    at(p.manectric[(f >> 2) & 3], cx - 8 + sin(0x80 + f, 64), 116 + sin(0x40 + f, 12));
    // The window past the picture: the sky's top row above it, the grass's bottom row below.
    if (!this.sampled) {
      this.sampled = true;
      const px = (y: number) => { const d = g.getImageData(0, y, 1, 1).data; return `rgb(${d[0]},${d[1]},${d[2]})`; };
      this.root.style.setProperty('--sky', px(0));
      this.root.style.setProperty('--grass', px(H - 1));
    }
  };
  private lastWobble = -1;
  private sampled = false;
}
