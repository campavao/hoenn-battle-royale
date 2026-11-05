// A battle for WATCHING (Cam, 11-02): the page draws it, from a battle log and nothing else
// (shared/battlelog.ts), so a watcher can never drift out of step with the fight the way a
// replay on their own ROM could. It looks like Emerald's own battle, because it is cut from the
// player's ROM like the rest of spike B's art (romart.ts): the mons' pictures and where they
// stand, the ground and its platforms, the message box, the health boxes and the small font
// their words are set in, all at 240 x 160 and an integer scale, pixelated.
//
// The log says what happened and for how long (eventMs); battlescene.ts works out where
// everything stands at a moment of it; this draws that. Nothing is simulated here and no move has
// an animation: a hit is a blink, a faint a sinking, a send-out a mon growing out of white.
//
// Between turns of a live fight the screen waits; joined late (`play(log, ms)`) it is dropped in
// where the fight stands, with no catching up.

import { EmeraldCanvas, glyphIds, type TextColor } from '../src/ui/emerald';
import type { BattleEvent, LogMon, Side } from './shared/battlelog';
import { HB, type BattleEnv, type HealthboxArt, type RomArt, type RomFont } from './romart';
import { H, W, advance, boxUp, envFor, fitScale, namesShown, readsFor, revealed, sceneAt, slotOf, type Scene, type SideScene, type Slot } from './battlescene';
import { logMs } from './shared/battlelog';

/** What the view needs from the ROM's art: RomArt, or a stand-in in a test. */
export type BattleArt = Pick<RomArt, 'monPic' | 'monCoords' | 'trainerPic' | 'trainerSize' | 'battleGround' | 'battleTextbox' | 'healthbox' | 'font' | 'speciesName'>;

export interface ViewDeps {
  art: BattleArt;
  /** A 240 x 160 picture of the field the fight is on, to show through the ground's sky and stripes
   *  as in a match; none, and the ROM's ground is drawn whole. */
  behind?: (map: string) => CanvasImageSource | null;
}

export interface ViewOptions {
  /** The side the watcher follows: with its back to the camera. */
  follow?: Side;
  /** Draw the level (Lv5) in the health boxes. The ROM's own battle leaves it out in a match (battle_interface.c: BrMatch_InRound). */
  levels?: boolean;
  /** Time keeps running by itself; off, only `seek` moves it (a spec's, to stand where it chooses). */
  autoplay?: boolean;
}

/** The skin -> picture table (br_skin.c sSkinPics): TRAINER_PIC_*, for the front picture. */
export const SKIN_PICS = [71, 72, 71, 72, 0, 22, 29, 30, 7, 66, 9, 24, 51, 52, 53, 77];
const BRENDAN_MAY = 4;

/** Where the things on the screen are (battle_anim_mons.c sBattlerCoords for singles). */
const FAR_MON = { x: 176, y: 40 };
const NEAR_MON = { x: 72, y: 81 };
/** A trainer picture: the far one's middle is at x 176, the near one's at 80, each (8 - size) * 4
 *  lower than the base y (40 and 80). */
const FAR_TRAINER = { x: 176, y: 40 };
const NEAR_TRAINER = { x: 80, y: 80 };
/** A health box's first sprite's top left: (44, 30) and (158, 88) are the sprites' middles, which
 *  for a 64 x 32 sprite is 32 and 16 off. */
const FAR_BOX = { x: 12, y: 14 };
const NEAR_BOX = { x: 126, y: 73 };
const MSG_Y = 112;
/** The message box's window: x 16, y 120. A line is 16 px of the font's cell on a 16 px step. */
const MSG_X = 16;
const MSG_TEXT_Y = 121;
const MSG_STEP = 16;

/** The status icons' colours (battle_interface.c sStatusIconColors, 15-bit). */
const STATUS_COLOUR: Record<string, number> = {
  psn: 24 | (12 << 5) | (24 << 10),
  par: 23 | (23 << 5) | (3 << 10),
  slp: 20 | (20 << 5) | (17 << 10),
  frz: 17 | (22 << 5) | (28 << 10),
  brn: 28 | (14 << 5) | (10 << 10),
};

/** The status a PackedMon's `status` is, read as the ROM's status1 bits (pokemon.h): sleep in the low
 *  three, poison 0x08 (toxic 0x80), burn 0x10, freeze 0x20, paralysis 0x40. */
export function statusKind(status: number): 'slp' | 'psn' | 'brn' | 'frz' | 'par' | null {
  if (status & 7) return 'slp';
  if (status & 0x88) return 'psn';
  if (status & 0x10) return 'brn';
  if (status & 0x20) return 'frz';
  if (status & 0x40) return 'par';
  return null;
}

/** The HP bar's filled pixels of 48 (CalcBarFilledPixels: a mon with any HP shows one). */
export function barPixels(hp: number, maxHp: number): number {
  if (hp <= 0 || maxHp <= 0) return 0;
  return Math.max(1, Math.floor((Math.min(hp, maxHp) * 48) / maxHp));
}

/** Which colour of the bar (GetHPBarLevel's thresholds, in pixels of 48). */
export function barColour(px: number): 'green' | 'yellow' | 'red' {
  return px > 24 ? 'green' : px > 9 ? 'yellow' : 'red';
}

/** The skin's picture: the near trainer has a back picture when Brendan or May wears it (the
 *  ROM's own), and a front picture turned to face the foe for any other look. */
export function trainerPicFor(skin: number, slot: Slot): { pic: number; back: boolean; flip: boolean } {
  const front = SKIN_PICS[skin] ?? SKIN_PICS[0];
  if (slot === 'near' && skin < BRENDAN_MAY) return { pic: skin % 2, back: true, flip: false };
  return { pic: front, back: false, flip: slot === 'near' };
}

export interface ViewSnapshot {
  /** The playhead, the event under it, and whether the screen is waiting for more of a live log. */
  ms: number;
  next: number;
  waiting: boolean;
  ended: boolean;
  /** Each slot's mon (species, the HP its bar shows, status) or null. */
  near: { species: number; hp: number; maxHp: number; status: number } | null;
  far: { species: number; hp: number; maxHp: number; status: number } | null;
  text: string;
  /** How many letters of it are on the screen (all of them: Infinity is `text.length`). */
  chars: number;
  scale: number;
  follow: Side;
}

export class BattleView {
  readonly canvas: HTMLCanvasElement;
  private ec: EmeraldCanvas;
  private ctx: CanvasRenderingContext2D;
  private root: HTMLElement;
  private log: BattleEvent[] = [];
  private t = 0;
  private following: Side;
  private auto: boolean;
  private levels: boolean;
  private raf = 0;
  private last = 0;
  private closed = false;
  private dirty = true;
  private scale = 1;
  private observer: ResizeObserver | null = null;
  private boxes = new Map<string, HTMLCanvasElement>();
  private label = '';
  private recent: number[] = [];
  private draws = 0;
  private drawMs = 0;
  private worstMs = 0;

  constructor(private host: HTMLElement, private deps: ViewDeps, opts: ViewOptions = {}) {
    this.following = opts.follow ?? 0;
    this.auto = opts.autoplay ?? true;
    this.levels = opts.levels ?? true;
    this.root = document.createElement('div');
    this.root.className = 'battleview';
    this.root.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;';
    this.canvas = document.createElement('canvas');
    this.canvas.style.imageRendering = 'pixelated';
    this.canvas.setAttribute('role', 'img');
    this.root.appendChild(this.canvas);
    host.appendChild(this.root);
    this.ec = new EmeraldCanvas(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.ec.onLoad = () => { this.dirty = true; };
    this.ec.resize(W, H, 1);
    this.fit();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.fit());
      this.observer.observe(host);
    }
    this.raf = requestAnimationFrame(this.frame);
  }

  /** A whole log, from `ms` in: the fight as it stands there, dropped in with no catching up,
   *  and on from there by itself. */
  play(log: readonly BattleEvent[], ms = 0): void {
    this.log = [...log];
    this.t = Math.max(0, Math.min(ms, logMs(this.log)));
    this.last = 0;
    this.dirty = true;
  }

  /** More of a live fight, a turn at a time. The screen runs on into it, and waits at its end for
   *  the next. */
  add(events: readonly BattleEvent[]): void {
    this.log.push(...events);
    this.dirty = true;
  }

  /** The playhead put at `ms` and held there (a spec's, to look at one moment). */
  seek(ms: number): void {
    this.auto = false;
    this.t = Math.max(0, Math.min(ms, logMs(this.log)));
    this.dirty = true;
  }

  resume(): void {
    this.auto = true;
    this.last = 0;
  }

  /** Follow a side: the one with its back to the camera (the view flips). */
  follow(side: Side): void {
    if (side === this.following) return;
    this.following = side;
    this.dirty = true;
  }

  close(): void {
    this.closed = true;
    cancelAnimationFrame(this.raf);
    this.observer?.disconnect();
    this.root.remove();
  }

  /** Draw again next frame, nothing having changed here: what shows through the ground has. */
  redraw(): void {
    this.dirty = true;
  }

  scene(): Scene {
    const s = sceneAt(this.log, this.t, this.following);
    s.text = this.worded(s.text);
    return s;
  }

  /** The log's line as it reads from the side followed (readsFor), the last one remembered: this
   *  is asked every draw, and the line changes every second or so. */
  private wordedFrom = '';
  private wordedTo = '';
  private worded(text: string): string {
    const start = this.log[0];
    if (this.following === 0 || start?.e !== 'start' || !text) return text;
    if (text === this.wordedFrom) return this.wordedTo;
    const names = (team: readonly LogMon[]) => team.map((m) => m.nickname || this.deps.art.speciesName(m.species));
    this.wordedFrom = text;
    this.wordedTo = readsFor(text, [start.a.name, start.b.name], [names(start.a.team), names(start.b.team)]);
    return this.wordedTo;
  }

  snapshot(): ViewSnapshot {
    const s = this.scene();
    const side = (v: SideScene) => (v.mon ? { species: v.mon.species, hp: v.hp, maxHp: v.mon.maxHp, status: v.status } : null);
    return { ms: this.t, next: s.next, waiting: s.waiting, ended: s.ended, near: side(s.near), far: side(s.far), text: s.text, chars: Math.min(s.chars, s.text.length), scale: this.scale, follow: this.following };
  }

  /** How the drawing is doing: draws made, the ms one took on average, at the 95th percentile of the last 300, and the worst. */
  stats(): { draws: number; meanMs: number; p95Ms: number; worstMs: number } {
    const sorted = [...this.recent].sort((a, b) => a - b);
    return { draws: this.draws, meanMs: this.draws ? this.drawMs / this.draws : 0, p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0, worstMs: this.worstMs };
  }

  // ---- the loop -------------------------------------------------------------------------

  private frame = (now: number): void => {
    if (this.closed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.auto) {
      const dt = this.last ? now - this.last : 0;
      this.last = now;
      const total = logMs(this.log);
      const next = advance(this.t, dt, total);
      // Time standing still (the end of a log, a live fight between turns) draws nothing new.
      if (next !== this.t) { this.t = next; this.dirty = true; }
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.draw(performance.now());
  };

  private fit(): void {
    const r = this.host.getBoundingClientRect();
    const w = r.width || window.innerWidth, h = r.height || window.innerHeight;
    const s = fitScale(w, h, window.devicePixelRatio || 1);
    if (s === this.scale && this.canvas.width === W) return;
    this.scale = s;
    this.ec.resize(W, H, s);
    this.dirty = true;
  }

  // ---- drawing --------------------------------------------------------------------------

  private draw(started: number): void {
    const sc = this.scene();
    const ctx = this.ctx;
    const { art } = this.deps;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    // What a person using a screen reader, or a spec, can read of it, written only when it changes
    // (an attribute written every frame is a style recalculation every frame).
    const label = `${sc.near.name || 'Trainer'} against ${sc.far.wild ? 'a wild POKéMON' : sc.far.name || 'trainer'}: ${sc.text.replace(/\n/g, ' ')}`;
    if (label !== this.label) {
      this.label = label;
      this.canvas.setAttribute('aria-label', label);
    }
    const near = sc.near.mon ? `${sc.near.mon.species}:${sc.near.hp}` : '', far = sc.far.mon ? `${sc.far.mon.species}:${sc.far.hp}` : '';
    if (near !== this.canvas.dataset.near) this.canvas.dataset.near = near;
    if (far !== this.canvas.dataset.far) this.canvas.dataset.far = far;
    if (sc.state.a || sc.ev?.e === 'start') {
      this.drawGround(sc);
      this.drawSide(art, sc.far, 'far');
      this.drawSide(art, sc.near, 'near');
      if (boxUp(sc.far)) this.drawBox(art, sc.far, 'far');
      if (boxUp(sc.near)) this.drawBox(art, sc.near, 'near');
      this.drawMessage(art, sc);
      this.drawNames(sc);
    }
    const ms = performance.now() - started;
    this.draws++;
    this.drawMs += ms;
    this.worstMs = Math.max(this.worstMs, ms);
    this.recent.push(ms);
    if (this.recent.length > 300) this.recent.shift();
  }

  private drawGround(sc: Scene): void {
    const { art, behind } = this.deps;
    const env: BattleEnv = envFor(sc.map);
    const back = behind?.(sc.map) ?? null;
    const ground = art.battleGround(env, !!back);
    if (back) this.ctx.drawImage(back, 0, 0, W, H);
    if (ground) {
      this.ctx.drawImage(ground, 0, 0);
      return;
    }
    // No ground in this ROM's patch: the sky and a lawn, enough to stand things on.
    this.ctx.fillStyle = '#8cc8e8';
    this.ctx.fillRect(0, 0, W, 72);
    this.ctx.fillStyle = '#58a850';
    this.ctx.fillRect(0, 72, W, MSG_Y - 72);
    this.ctx.fillStyle = '#78c070';
    this.ctx.beginPath();
    this.ctx.ellipse(FAR_MON.x, FAR_MON.y + 28, 48, 10, 0, 0, Math.PI * 2);
    this.ctx.ellipse(NEAR_MON.x, NEAR_MON.y + 32, 64, 12, 0, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private drawSide(art: BattleArt, v: SideScene, slot: Slot): void {
    const ctx = this.ctx;
    // The trainer's picture, until their first mon is out.
    if (v.trainerDx !== null) {
      const { pic, back, flip } = trainerPicFor(v.skin, slot);
      const cv = art.trainerPic(pic, back);
      const base = slot === 'near' ? NEAR_TRAINER : FAR_TRAINER;
      const cx = base.x + v.trainerDx, cy = (8 - art.trainerSize(pic, back)) * 4 + base.y;
      if (cv) {
        if (flip) {
          ctx.save();
          ctx.translate(cx + 32, cy - 32);
          ctx.scale(-1, 1);
          ctx.drawImage(cv, 0, 0);
          ctx.restore();
        } else ctx.drawImage(cv, cx - 32, cy - 32);
      } else this.standIn(cx - 16, cy - 24, 32, 48, '#a090c0');
    }
    if (!v.mon || v.blink) return;
    const mon = v.mon;
    const pic = art.monPic(mon.species, slot === 'near', !!mon.shiny);
    const c = art.monCoords(mon.species, slot === 'near');
    const base = slot === 'near' ? NEAR_MON : FAR_MON;
    const cx = base.x + v.monDx, cy = base.y + (c ? c.y - (slot === 'far' ? c.lift : 0) : 0);
    const x = cx - 32, y = cy - 32;
    if (!pic) {
      this.standIn(cx - 24, cy - 24, 48, 48, '#c0c0c0');
      return;
    }
    if (v.leave === 'faint') {
      // Sinks into the ground: the rest of the picture is cut where it stood.
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, 64, 64);
      ctx.clip();
      ctx.drawImage(pic, x, y + Math.round(v.vanish * 64));
      ctx.restore();
      return;
    }
    // Out of its ball: grows from the foot of its place, white first.
    const grow = v.leave === 'back' ? 1 - v.vanish : v.appear;
    if (grow <= 0) return;
    const size = Math.max(1, Math.round(64 * grow));
    const left = cx - size / 2, top = cy + 32 - size;
    if (v.leave === 'back' || v.appear < 0.5) {
      ctx.drawImage(this.silhouette(pic), left, top, size, size);
    } else if (grow < 1) ctx.drawImage(pic, left, top, size, size);
    else ctx.drawImage(pic, x, y);
  }

  private white = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
  private silhouette(pic: HTMLCanvasElement): HTMLCanvasElement {
    let w = this.white.get(pic);
    if (w) return w;
    w = document.createElement('canvas');
    w.width = pic.width;
    w.height = pic.height;
    const c = w.getContext('2d')!;
    c.drawImage(pic, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = '#fff';
    c.fillRect(0, 0, w.width, w.height);
    this.white.set(pic, w);
    return w;
  }

  private standIn(x: number, y: number, w: number, h: number, colour: string): void {
    this.ctx.fillStyle = colour;
    this.ctx.fillRect(x, y, w, h);
  }

  // ---- the health boxes -----------------------------------------------------------------

  private drawBox(art: BattleArt, v: SideScene, slot: Slot): void {
    const mon = v.mon!;
    const near = slot === 'near';
    const at = near ? NEAR_BOX : FAR_BOX;
    const hb = art.healthbox(near);
    const font = art.font('small');
    if (!hb || !font) {
      this.standInBox(art, v, at);
      return;
    }
    const px = barPixels(v.hp, mon.maxHp);
    const name = mon.nickname || art.speciesName(mon.species);
    const key = [slot, mon.species, name, mon.level, mon.gender ?? 2, px, near ? v.hp : 0, mon.maxHp, statusKind(v.status), this.levels].join('|');
    let cv = this.boxes.get(key);
    if (!cv) {
      if (this.boxes.size > 64) this.boxes.clear();
      cv = this.composeBox(hb, font, v, slot, name, px);
      this.boxes.set(key, cv);
    }
    this.ctx.drawImage(cv, at.x, at.y);
  }

  /** One health box as the ROM puts it together (battle_interface.c): the frame, the words in
   *  windows whose lower part shows, the bar's tiles, the status icon. `x, y` are in the box's
   *  own pixels (its first sprite's corner). */
  private composeBox(hb: HealthboxArt, font: RomFont, v: SideScene, slot: Slot, name: string, px: number): HTMLCanvasElement {
    const near = slot === 'near';
    const mon = v.mon!;
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = near ? 64 : 32;
    const c = cv.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    c.drawImage(hb.box, 0, 0);
    const FG = hb.ink.fg, SH = hb.ink.shadow;
    const gender = mon.gender === 0 ? '♂' : mon.gender === 1 ? '♀' : '';
    // The name window starts at tile 2 (near) or 1 (far) and is 56 wide, the level's right of it.
    const nameX = near ? 16 : 8, levelX = near ? 72 : 64;
    font.draw(c, glyphIds(name), nameX, 3, FG, SH, [nameX, 5, nameX + 56, 16]);
    if (gender) {
      const w = font.width(glyphIds(name));
      font.draw(c, glyphIds(gender), nameX + w, 3, gender === '♂' ? hb.ink.male : hb.ink.female, SH, [nameX, 5, nameX + 56, 16]);
    }
    const digits = String(mon.level);
    if (this.levels) font.draw(c, [0x105, ...glyphIds(digits)], levelX + 5 * (3 - digits.length), 3, FG, SH, [levelX, 5, levelX + 24, 16]);
    // The label and the bar: six tiles of eight pixels, green, yellow or red by how much is left.
    const barX = near ? 32 : 24, barY = 16;
    const kind = statusKind(v.status);
    if (near || !kind) {
      c.drawImage(hb.tile(HB.H), barX, barY);
      c.drawImage(hb.tile(HB.H + 1), barX + 8, barY);
    } else {
      c.drawImage(hb.tile(0), barX, barY);
      c.drawImage(hb.tile(65), barX + 8, barY);
    }
    const base = { green: HB.HP_GREEN, yellow: HB.HP_YELLOW, red: HB.HP_RED }[barColour(px)];
    for (let i = 0; i < 6; i++) c.drawImage(hb.tile(base + Math.max(0, Math.min(8, px - 8 * i))), barX + 16 + 8 * i, barY);
    if (near) {
      // "cur/" ends in the first window and runs on into the second's, then the full HP.
      font.draw(c, glyphIds(`${String(v.hp).padStart(3, ' ')}/`), 62, 21, FG, SH, [56, 24, 80, 32]);
      font.draw(c, glyphIds(String(mon.maxHp).padStart(3, ' ')), 82, 21, FG, SH, [80, 24, 96, 32]);
    }
    if (kind) {
      const first = HB.STATUS[kind][near ? 0 : 1];
      const slotId = 12 + (near ? 0 : 1);
      const iconX = near ? 16 : 8, iconY = near ? 24 : 16;
      for (let i = 0; i < 3; i++) c.drawImage(hb.tile(first + i, { slot: slotId, colour: STATUS_COLOUR[kind] }), iconX + 8 * i, iconY);
    }
    return cv;
  }

  /** A box drawn by the page when the ROM's patch does not say where its art is. */
  private standInBox(art: BattleArt, v: SideScene, at: { x: number; y: number }): void {
    const mon = v.mon!;
    const ec = this.ec;
    ec.drawFrame({ x: at.x, y: at.y, w: 104, h: 32 });
    ec.drawText(`${mon.nickname || art.speciesName(mon.species) || '???'}  Lv${mon.level}`, at.x + 10, at.y + 6);
    const px = barPixels(v.hp, mon.maxHp);
    ec.fillRect({ x: at.x + 28, y: at.y + 22, w: 48, h: 4 }, '#183018');
    ec.fillRect({ x: at.x + 28, y: at.y + 22, w: px, h: 4 }, { green: '#58d080', yellow: '#e0c020', red: '#d04028' }[barColour(px)]);
  }

  // ---- the message box ------------------------------------------------------------------

  private drawMessage(art: BattleArt, sc: Scene): void {
    const tb = art.battleTextbox();
    let colour: TextColor;
    if (tb) {
      colour = this.ink(tb.fg, tb.shadow);
      this.ctx.drawImage(tb.box, 0, MSG_Y);
    } else {
      colour = this.ink('rgb(49,49,49)', 'rgb(213,213,205)');
      this.ec.drawFrame({ x: 0, y: MSG_Y, w: W, h: H - MSG_Y });
    }
    if (!sc.text) return;
    revealed(sc.text, sc.chars).forEach((line, i) => this.ec.drawText(line, MSG_X, MSG_TEXT_Y + i * MSG_STEP, colour));
  }

  /** A text colour that is the same object each time it is asked for: the canvas keeps its tinted font by it. */
  private inks = new Map<string, TextColor>();
  private ink(fg: string, shadow: string): TextColor {
    const key = `|`;
    let c = this.inks.get(key);
    if (!c) this.inks.set(key, (c = { fg, shadow }));
    return c;
  }

  /** The trainers' names, while their pictures are on the screen. */
  private drawNames(sc: Scene): void {
    const white = this.ink('rgb(255,255,255)', 'rgb(49,49,49)');
    const shown = namesShown(sc);
    if (shown.far) this.ec.drawTextCentred(sc.far.name, FAR_TRAINER.x + sc.far.trainerDx!, 2, white);
    if (shown.near) this.ec.drawTextCentred(sc.near.name, NEAR_TRAINER.x + sc.near.trainerDx!, 34, white);
  }

  /** Which slot a side is in now, for whoever asks (a spec). */
  slot(side: Side): Slot {
    return slotOf(side, this.following);
  }
}
