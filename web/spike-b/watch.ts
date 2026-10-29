// Spike B's WATCH: the match's spectate strip (web/src/ui/screens.ts) for this world.
//
// While spectating, a strip says who the camera is on -- WATCHING <NAME> -- with PREV and
// NEXT round the trainers still in (cycleWatch) and STOP for a free camera; left and right
// step it too (watchStepKey: the D-pad's PREV and NEXT once there is somebody to step
// from). The trainer watched carries their name over their head.

import type { Actor } from './shared/room';

/** screens.ts's cycleWatch (not imported: it would bring the match's UI sheets along):
 *  round the list from `on`, or from an end when `on` is not in it. */
function cycleWatch(ids: readonly number[], on: number | null, dir: 1 | -1): number | null {
  if (ids.length === 0) return null;
  const at = on === null ? -1 : ids.indexOf(on);
  if (at < 0) return dir > 0 ? ids[0] : ids[ids.length - 1];
  return ids[(at + dir + ids.length) % ids.length];
}

export interface WatchHost {
  /** Everybody on the map now. */
  trainers(): readonly Actor[];
  me(): number;
  spectating(): boolean;
  /** Who the camera is on, 0 for nobody. */
  follow(): number;
  setFollow(id: number): void;
  /** Device pixels per GBA pixel. */
  zoom(): number;
}

/** A trainer's sprite is 32 pixels tall on a 16-pixel cell, and the camera sits on the
 *  cell's middle: the head is 24 pixels above it. Two more for air. */
const HEAD_ABOVE = 26;

export class Watch {
  private strip: HTMLElement;
  private who: HTMLElement;
  private label: HTMLElement;

  constructor(private host: WatchHost) {
    this.strip = document.getElementById('watch')!;
    this.who = document.getElementById('watch-who')!;
    this.label = document.getElementById('watch-label')!;
    document.getElementById('watch-prev')!.addEventListener('click', () => this.step(-1));
    document.getElementById('watch-next')!.addEventListener('click', () => this.step(1));
    document.getElementById('watch-stop')!.addEventListener('click', () => this.host.setFollow(0));
  }

  /** Who can be watched, in a steady order: everybody on the map but me. */
  private others(): number[] {
    const me = this.host.me();
    return this.host.trainers().filter((a) => a.id !== me).map((a) => a.id).sort((a, b) => a - b);
  }

  step(dir: 1 | -1): void {
    const next = cycleWatch(this.others(), this.host.follow() || null, dir);
    if (next !== null) this.host.setFollow(next);
  }

  /** A key while spectating: left and right step once somebody is watched. True when
   *  it was taken. */
  key(k: string): boolean {
    if (!this.host.spectating() || !this.host.follow()) return false;
    if (k === 'left') this.step(-1);
    else if (k === 'right') this.step(1);
    else return false;
    return true;
  }

  /** Once a frame: the strip, and the name over the head the camera is on. */
  frame(): void {
    const on = this.host.spectating();
    this.strip.hidden = !on;
    const id = this.host.follow();
    const a = on && id ? this.host.trainers().find((t) => t.id === id) : undefined;
    this.who.textContent = a ? `WATCHING ${a.name}` : on ? 'Drag to look around' : '';
    (document.getElementById('watch-stop') as HTMLButtonElement).hidden = !a;
    this.label.hidden = !a;
    if (!a) return;
    if (this.label.textContent !== a.name) this.label.textContent = a.name;
    // The camera is glued to the watched trainer, so their head is straight up from the
    // middle of the screen.
    const up = (HEAD_ABOVE * this.host.zoom()) / (devicePixelRatio || 1);
    this.label.style.transform = `translate(-50%, calc(-100% - ${up.toFixed(1)}px))`;
  }
}
