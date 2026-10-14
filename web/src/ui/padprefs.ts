// Where a phone's stick and A/B sit, how see-through they are, and whether they are
// there at all (mockup v2: "you can drag them, fade them, or hide them and just tap the
// map to walk"). This browser's own, in localStorage; index.html reads them as
// --stick-dx/dy, --ab-dx/dy and --pad-alpha on #screen-playing, and body.pad-hidden.
//
// MOVE PAD in the sheet starts the editor: the two controls get a dashed outline and
// follow a drag instead of pressing keys, and a small Emerald window says DRAG, FADE
// - 60% + and DONE.
import { TEXT_BLUE, TEXT_DARK, TEXT_RED, textImage } from './emerald';

export interface PadPrefs {
  stick: { dx: number; dy: number };
  ab: { dx: number; dy: number };
  /** 0.2 .. 1 */
  alpha: number;
  hidden: boolean;
}

export const PAD_KEY = 'hbr-pad';
export const PAD_DEFAULT: PadPrefs = { stick: { dx: 0, dy: 0 }, ab: { dx: 0, dy: 0 }, alpha: 0.6, hidden: false };

const num = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

/** What was stored, each field checked; the default for anything missing or wrong. */
export function parsePadPrefs(raw: string | null): PadPrefs {
  let o: Partial<PadPrefs> = {};
  try {
    o = raw ? (JSON.parse(raw) as Partial<PadPrefs>) : {};
  } catch {
    o = {};
  }
  const off = (p: unknown) => {
    const q = (p ?? {}) as { dx?: unknown; dy?: unknown };
    return { dx: num(q.dx, -2000, 2000, 0), dy: num(q.dy, -2000, 2000, 0) };
  };
  return {
    stick: off(o.stick),
    ab: off(o.ab),
    alpha: num(o.alpha, 0.2, 1, PAD_DEFAULT.alpha),
    hidden: o.hidden === true,
  };
}

export function loadPadPrefs(): PadPrefs {
  try {
    return parsePadPrefs(localStorage.getItem(PAD_KEY));
  } catch {
    return parsePadPrefs(null);
  }
}

export function savePadPrefs(p: PadPrefs): void {
  try {
    localStorage.setItem(PAD_KEY, JSON.stringify(p));
  } catch {
    // A browser that keeps nothing keeps the pad where it is for this visit.
  }
}

/** The prefs on the page: the offsets and the fade as CSS variables, hidden as a class. */
export function applyPadPrefs(root: HTMLElement, body: HTMLElement, p: PadPrefs): void {
  root.style.setProperty('--stick-dx', `${p.stick.dx}px`);
  root.style.setProperty('--stick-dy', `${p.stick.dy}px`);
  root.style.setProperty('--ab-dx', `${p.ab.dx}px`);
  root.style.setProperty('--ab-dy', `${p.ab.dy}px`);
  root.style.setProperty('--pad-alpha', String(p.alpha));
  body.classList.toggle('pad-hidden', p.hidden);
}

/** A fade step: 20% at a time, 20% at least. */
export function fadeStep(alpha: number, dir: 1 | -1): number {
  return Math.round(Math.min(1, Math.max(0.2, alpha + dir * 0.2)) * 10) / 10;
}

export interface PadEditorDeps {
  root: HTMLElement;
  body: HTMLElement;
  stick: HTMLElement;
  ab: HTMLElement;
  bar: HTMLElement;
  /** CSS pixels per GBA pixel, for the bar's text. */
  scale(): number;
}

export class PadPrefsControl {
  prefs: PadPrefs = loadPadPrefs();
  private editing = false;
  private readonly offs: (() => void)[] = [];

  constructor(private readonly deps: PadEditorDeps) {
    this.apply();
  }

  get hidden(): boolean {
    return this.prefs.hidden;
  }

  toggleHidden(): void {
    this.prefs = { ...this.prefs, hidden: !this.prefs.hidden };
    this.commit();
  }

  /** The editor: drag either control, fade both, DONE. */
  edit(): void {
    if (this.editing) return;
    this.editing = true;
    this.deps.body.classList.add('pad-editing');
    this.drag(this.deps.stick, 'stick');
    this.drag(this.deps.ab, 'ab');
    this.drawBar();
    this.deps.bar.hidden = false;
  }

  done(): void {
    if (!this.editing) return;
    this.editing = false;
    this.deps.body.classList.remove('pad-editing');
    for (const off of this.offs.splice(0)) off();
    this.deps.bar.hidden = true;
  }

  private apply(): void {
    applyPadPrefs(this.deps.root, this.deps.body, this.prefs);
  }

  private commit(): void {
    savePadPrefs(this.prefs);
    this.apply();
  }

  /** A drag moves the control rather than pressing it: captured before wireDpad and
   *  wireButton see the pointer. */
  private drag(el: HTMLElement, which: 'stick' | 'ab'): void {
    let start: { x: number; y: number; dx: number; dy: number; id: number } | null = null;
    const down = (ev: PointerEvent) => {
      ev.stopImmediatePropagation();
      ev.preventDefault();
      const o = this.prefs[which];
      start = { x: ev.clientX, y: ev.clientY, dx: o.dx, dy: o.dy, id: ev.pointerId };
      el.setPointerCapture?.(ev.pointerId);
    };
    const move = (ev: PointerEvent) => {
      if (!start || ev.pointerId !== start.id) return;
      ev.stopImmediatePropagation();
      const box = this.deps.root.getBoundingClientRect();
      const lim = (v: number, span: number) => Math.round(Math.max(-span, Math.min(span, v)));
      this.prefs = {
        ...this.prefs,
        [which]: { dx: lim(start.dx + ev.clientX - start.x, box.width), dy: lim(start.dy + ev.clientY - start.y, box.height) },
      };
      this.apply();
    };
    const up = (ev: PointerEvent) => {
      if (!start || ev.pointerId !== start.id) return;
      ev.stopImmediatePropagation();
      start = null;
      this.commit();
    };
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move, true);
    el.addEventListener('pointerup', up, true);
    el.addEventListener('pointercancel', up, true);
    this.offs.push(() => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move, true);
      el.removeEventListener('pointerup', up, true);
      el.removeEventListener('pointercancel', up, true);
    });
  }

  private drawBar(): void {
    const { bar } = this.deps;
    const s = this.deps.scale();
    const doc = bar.ownerDocument;
    const button = (label: string, color: typeof TEXT_DARK, id: string, onPress: () => void) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.id = id;
      b.className = 'hud-btn';
      b.setAttribute('aria-label', label === '-' ? 'Fade more' : label === '+' ? 'Fade less' : label);
      b.appendChild(textImage(label, color, s));
      b.addEventListener('click', onPress);
      return b;
    };
    const row = doc.createElement('div');
    row.className = 'pad-edit-row';
    row.append(
      textImage('DRAG.  FADE', TEXT_DARK, s),
      button('-', TEXT_BLUE, 'pad-fade-more', () => this.fade(-1)),
      textImage(`${Math.round(this.prefs.alpha * 100)}%`, TEXT_DARK, s),
      button('+', TEXT_BLUE, 'pad-fade-less', () => this.fade(1)),
      button('DONE', TEXT_RED, 'pad-done', () => this.done()),
    );
    bar.replaceChildren(row);
  }

  private fade(dir: 1 | -1): void {
    this.prefs = { ...this.prefs, alpha: fadeStep(this.prefs.alpha, dir) };
    this.commit();
    this.drawBar();
  }
}
