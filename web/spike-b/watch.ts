// Spike B's WATCH: the match's spectate strip (web/src/ui/screens.ts) for this world.
//
// While spectating, a strip says who the camera is on -- WATCHING <NAME> -- with PREV and
// NEXT round the trainers still in (cycleWatch) and STOP for a free camera; left and right
// step it too (watchStepKey: the D-pad's PREV and NEXT once there is somebody to step
// from). The trainer watched carries their name over their head.
//
// Whoever is watched is told so: the relay counts the watchers and their HUD shows the
// eye and the count (br_hud.c, POK-233). And a trainer out of the match follows the one
// they watch into their battles: the fighter's ROM publishes the fight (a BSTART, then
// its TURNs), the relay hands it on, and this page's hidden ROM replays it as the match's
// spectator does (rom.ts mirror), the trainer watched near the camera, back to us (Cam,
// 2026-10-26). Joined late, the relay sends the fight from its start and the replay
// catches up at 8x, silent, as in the match.

import type { Actor } from './shared/room';
import type { WorldLink } from './net';
import type { MirrorFeed, RomBattles } from './rom';
import type { SpMsg } from './shared/wire';

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
  /** The match's link now (a new one each match). */
  link(): WorldLink | null;
  rom(): RomBattles | null;
  /** Free to watch a battle on the hidden ROM: out of the match (or benched), nothing of
   *  my own on it. */
  idle(): boolean;
  /** What a piece of loot was, as a watcher is told it ("POTION", "MAY's bag"); null for
   *  one not worth a line (a legendary's or a gate's, which are fights). */
  describe(key: number): string | null;
  /** A line on the ticker. */
  tell(text: string): void;
}

/** The loot `picked` (room.ts: key, and who took it) gained since the last look that
 *  `who` took. Every key is looked at once: `seen` keeps them, so what was taken before
 *  the watch began is never told. */
export function pickedBy(picked: ReadonlyMap<number, number>, seen: Set<number>, who: number): number[] {
  const out: number[] = [];
  for (const [key, by] of picked) {
    if (seen.has(key)) continue;
    seen.add(key);
    if (who && by === who) out.push(key);
  }
  return out;
}

/** Who the camera goes to when the trainer it is on is out: the next one still in, in
 *  the strip's order (Kanto: "the first living trainer is picked for you"). */
export function nextAfter(ids: readonly number[], gone: number): number | null {
  return ids.find((id) => id > gone) ?? ids[0] ?? null;
}

/** A trainer's sprite is 32 pixels tall on a 16-pixel cell, and the camera sits on the
 *  cell's middle: the head is 24 pixels above it. Two more for air. */
const HEAD_ABOVE = 26;

export class Watch {
  private strip: HTMLElement;
  private who: HTMLElement;
  private label: HTMLElement;
  private eyesEl: HTMLElement;
  private battleEl: HTMLElement;
  /** The link the relay's callbacks are on, and who it was last told I watch. */
  private wired: WorldLink | null = null;
  private told = 0;
  /** How many watch me, as the relay last said. */
  eyes = 0;
  /** What has come of the watched trainer's battles, not yet replayed. */
  private queue: { from: number; m: SpMsg }[] = [];
  private mirroring = false;
  /** A battle of the trainer watched is on my screen now (the results wait for it). */
  get replaying(): boolean { return this.mirroring; }
  private publisher: RomBattles | null = null;
  /** Loot keys looked at already (pickedBy). */
  private seen = new Set<number>();

  constructor(private host: WatchHost) {
    this.strip = document.getElementById('watch')!;
    this.who = document.getElementById('watch-who')!;
    this.label = document.getElementById('watch-label')!;
    this.eyesEl = document.getElementById('eyes')!;
    this.battleEl = document.getElementById('battle')!;
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

  /** Once a frame: the relay told who I watch, a battle of theirs replayed, the strip and
   *  the name over the head the camera is on. */
  frame(): void {
    this.wire();
    this.mirror();
    this.eyesEl.hidden = this.eyes <= 0 || this.host.spectating();
    const on = this.host.spectating();
    this.strip.hidden = !on;
    let id = this.host.follow();
    // The trainer watched is out (off the map): on to the next one still in, rather than
    // a camera left on the cell they fell on until NEXT.
    if (on && id && !this.host.trainers().some((t) => t.id === id)) {
      id = nextAfter(this.others(), id) ?? 0;
      this.host.setFollow(id);
    }
    this.tellPicked(on ? id : 0);
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

  /** What the trainer watched just took off the ground or out of a bag (POK-268): drawn
   *  by the watcher's own page off the room's `picked`, which every page has. */
  private tellPicked(who: number): void {
    const link = this.host.link();
    if (!link) return;
    const a = who ? this.host.trainers().find((t) => t.id === who) : undefined;
    for (const key of pickedBy(link.room.picked, this.seen, a ? who : 0)) {
      const what = this.host.describe(key);
      if (what && a) this.host.tell(`${a.name} took ${what}!`);
    }
  }

  /** Who I watch now, for the relay: somebody followed while spectating, or nobody. */
  private target(): number {
    return this.host.spectating() ? this.host.follow() : 0;
  }

  private wire(): void {
    const link = this.host.link();
    if (link !== this.wired) {
      // A new match: nobody watched yet, nobody watching me, nothing of the last one's.
      if (this.wired) { this.wired.onSp = null; this.wired.onEyes = null; }
      this.wired = link;
      this.publisher = null;
      this.told = 0;
      this.eyes = 0;
      this.queue = [];
      // What was taken before this page came in is nobody's news.
      this.seen = new Set(link ? link.room.picked.keys() : []);
      if (link) {
        link.onEyes = (n) => { this.eyes = n; this.eyesEl.textContent = `👁 ${n}`; };
        link.onSp = (from, m) => {
          // A fight of somebody I have stopped watching, still on its way: not mine.
          if (!this.told) return;
          if (this.queue.length > 2000) return;
          this.queue.push({ from, m });
        };
      }
    }
    // My own battles, published for whoever watches me.
    const rom = this.host.rom();
    if (rom && rom !== this.publisher) { this.publisher = rom; rom.publish(link ? (m) => link.sp(m) : null); }
    const t = this.target();
    if (link && t !== this.told) {
      this.told = t;
      this.queue = [];
      link.watch(t);
    }
  }

  /** The watched trainer's battle, replayed on my hidden ROM once its BSTART is here. */
  private mirror(): void {
    if (this.mirroring) return;
    // Anything before a BSTART is the tail of a fight there is no start of.
    while (this.queue.length && this.queue[0].m.t !== 'bstart') this.queue.shift();
    const rom = this.host.rom(), link = this.host.link();
    if (!this.queue.length || !rom || !link || !this.host.idle()) return;
    const head = this.queue[0];
    const { from } = head;
    const watched = this.told;
    const fighter = link.room.actor(from);
    const foe = fighter?.foe ? link.room.actor(fighter.foe) : undefined;
    // Their ROM's own BSTART first, then its TURNs: up to the next fight's BSTART.
    let first = true;
    const own = () => this.queue.length > 0 && this.queue[0].from === from && (first || this.queue[0].m.t !== 'bstart');
    const feed: MirrorFeed = {
      peek: () => (own() ? this.queue[0].m : null),
      shift: () => { this.queue.shift(); first = false; },
      over: () => {
        const a = link.room.actor(from);
        return !a?.battling || (this.queue.length > 0 && !own());
      },
      stopped: () => this.told !== watched || this.host.link() !== link || !this.host.idle(),
      turned: watched !== from,
      skins: [fighter?.skin ?? 0, foe?.skin ?? 0],
    };
    this.mirroring = true;
    void rom.mirror(feed, () => this.battleEl.classList.add('on')).finally(() => {
      this.mirroring = false;
      this.battleEl.classList.remove('on');
      // Whatever is left of that fight goes with it (its BSTART too, when the ROM never
      // took it).
      if (first && this.queue[0] === head) this.queue.shift();
      while (this.queue.length && this.queue[0].from === from && this.queue[0].m.t !== 'bstart') this.queue.shift();
    });
  }
}
