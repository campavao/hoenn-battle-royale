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
//
// That was every fight. Now a fight with a log (battlelog.ts) -- a simulated one of two bots, or a
// trainer's their page reads off its ROM -- is drawn by this page (battleview.ts) in the battle
// screen's place, with the strip over it, and the ROM's replay is only for a fight with none. Joined
// late it stands where the fight stands, with nothing to catch up on. The song is the ROM's battle
// song and its hit, send-out and faint sounds, on the parked field's sound engine (rom.ts fightSong).

import type { Actor } from './shared/room';
import { over } from './shared/over';
import type { WorldLink } from './net';
import type { MirrorFeed, RomBattles } from './rom';
import type { SpMsg } from './shared/wire';
import { logMs, type BattleEvent, type Side } from './shared/battlelog';
import { SE_BALL_OPEN, SE_EFFECTIVE, SE_FAINT } from './music';
import { recorder } from './recorder';

/** screens.ts's cycleWatch (not imported: it would bring the match's UI sheets along):
 *  round the list from `on`, or from an end when `on` is not in it. */
function cycleWatch(ids: readonly number[], on: number | null, dir: 1 | -1): number | null {
  if (ids.length === 0) return null;
  const at = on === null ? -1 : ids.indexOf(on);
  if (at < 0) return dir > 0 ? ids[0] : ids[ids.length - 1];
  return ids[(at + dir + ids.length) % ids.length];
}

/** What a watcher needs of a battleview.ts, new each fight. */
export interface LogView {
  play(log: readonly BattleEvent[], ms: number): void;
  add(events: readonly BattleEvent[]): void;
  /** Where the playhead is, and whether a fight's over or waits on more of its log. */
  snapshot(): { next: number; ended: boolean; waiting: boolean };
  redraw(): void;
  close(): void;
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
  /** A battle view on the page, its back to us on side `follow`; null until the ROM's art is in. */
  view(follow: Side): LogView | null;
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

/** One fight, off its BSTART: the battle id is only the two seats, so a rematch has the same
 *  one, and the seed (the message's first four bytes) tells them apart. */
export function fightKey(from: number, start: SpMsg): string {
  return `${from}:${start.battle}:${start.data.slice(0, 4).join()}`;
}

/** A BSTART from a trainer's page waits this long for that page's log of the fight (it reads the
 *  ROM's battle once it is up) before the ROM's replay of it starts. A bot's has no log coming. */
const LOG_GRACE_MS = 3000;
/** A log with no end, its fight over in the room (a late joiner past the kept log's cap, a socket's
 *  hiccup): the screen waits this long for the rest of it, then gives the field back. */
const LOG_LOST_MS = 5000;
/** A fight the room says is still on, and not a word of it for this long (a socket that has gone, its
 *  frames with it, so the room here stands still too; a menu's own clock is far shorter). */
const LOG_SILENT_MS = 180_000;

/** The sound of an event of a watched fight (constants/songs.h), as a fight sounds it. */
function soundOf(ev: BattleEvent | undefined): number {
  switch (ev?.e) {
    case 'hit': return SE_EFFECTIVE;
    case 'send': return SE_BALL_OPEN;
    case 'faint': return SE_FAINT;
    default: return 0;
  }
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
  private queue: { from: number; m: SpMsg; at: number }[] = [];
  private mirroring = false;
  /** The fight the trainer watched is in, as a log, and the view of it once there can be one. */
  private fight: { from: number; f: number; side: Side; events: BattleEvent[]; began: number; view: LogView | null; next: number; lostAt: number; heard: number } | null = null;
  private viewEl: HTMLElement;
  /** A battle of the trainer watched is on my screen now (the results wait for it). */
  get replaying(): boolean { return this.mirroring || !!this.fight; }
  /** The page is drawing it. */
  get viewing(): boolean { return !!this.fight?.view; }
  /** What it is drawing, for whoever asks (a spec). */
  get showing() { return this.fight?.view ? this.fight : null; }
  private publisher: RomBattles | null = null;
  /** Loot keys looked at already (pickedBy). */
  private seen = new Set<number>();
  /** Fights whose replay I have gone back into (rejoin), by fightKey. */
  private rejoined = new Set<string>();

  constructor(private host: WatchHost) {
    this.strip = document.getElementById('watch')!;
    this.who = document.getElementById('watch-who')!;
    this.label = document.getElementById('watch-label')!;
    this.eyesEl = document.getElementById('eyes')!;
    this.battleEl = document.getElementById('battle')!;
    this.viewEl = document.getElementById('battleview-dim')!;
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
    this.logFrame();
    this.mirror();
    this.eyesEl.hidden = this.eyes <= 0 || this.host.spectating();
    const on = this.host.spectating();
    this.strip.hidden = !on;
    let id = this.host.follow();
    // The trainer watched is out (off the map): on to the next one still in, rather than
    // a camera left on the cell they fell on until NEXT. Not under the replay of the fight
    // that put them out: the proxy fights at eight times the pace, so the room has it over
    // while the replay is turns from the end, and moving on would cut it off there.
    if (on && id && !this.replaying && !this.host.trainers().some((t) => t.id === id)) {
      id = nextAfter(this.others(), id) ?? 0;
      this.host.setFollow(id);
    }
    this.tellPicked(on ? id : 0);
    const a = on && id ? this.host.trainers().find((t) => t.id === id) : undefined;
    this.who.textContent = a ? `WATCHING ${a.name}` : on ? 'Drag to look around' : '';
    (document.getElementById('watch-stop') as HTMLButtonElement).hidden = !a;
    this.label.hidden = !a || this.viewing;
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
      if (this.wired) { this.wired.onSp = null; this.wired.onEyes = null; this.wired.onBattleLog = null; }
      this.endFight();
      this.wired = link;
      this.publisher = null;
      this.told = 0;
      this.eyes = 0;
      this.queue = [];
      this.rejoined.clear();
      // What was taken before this page came in is nobody's news.
      this.seen = new Set(link ? link.room.picked.keys() : []);
      if (link) {
        link.onEyes = (n) => { this.eyes = n; this.eyesEl.textContent = `👁 ${n}`; };
        link.onSp = (from, m) => {
          // A fight of somebody I have stopped watching, still on its way: not mine. Nor the ROM's
          // stream of one whose log I have.
          if (!this.told || this.fight) return;
          if (this.queue.length > 2000) return;
          this.queue.push({ from, m, at: performance.now() });
        };
        link.onBattleLog = (from, f, events, ago) => this.onLog(from, f, events, ago);
      }
    }
    // My own battles, published for whoever watches me.
    const rom = this.host.rom();
    if (rom && rom !== this.publisher) { this.publisher = rom; rom.publish(link ? (m) => link.sp(m) : null); }
    const t = this.target();
    if (link && t !== this.told) {
      this.told = t;
      this.queue = [];
      this.endFight();
      link.watch(t);
    }
  }

  /** More of a fight's log, or the start of one (`ago` said: net.ts onBattleLog). */
  private onLog(from: number, f: number, events: BattleEvent[], ago?: number): void {
    if (!this.told) return;
    if (ago === undefined) {
      if (this.fight?.from === from && this.fight.f === f) {
        this.fight.events.push(...events);
        this.fight.view?.add(events);
        this.fight.heard = performance.now();
      }
      return;
    }
    const s = events[0];
    if (s?.e !== 'start') return;
    // Not one of the trainer watched: on its way as I moved on.
    const side: Side | null = s.a.seat === this.told ? 0 : s.b.seat === this.told ? 1 : null;
    if (side === null) return;
    this.endFight();
    this.queue = [];
    this.fight = { from, f, side, events: [...events], began: performance.now() - ago, view: null, next: -1, lostAt: 0, heard: performance.now() };
    recorder.net('log-fight', from, f, Math.round(ago));
  }

  /** Once a frame: the fight's view on the screen when it can be, and off it when the fight is over. */
  private logFrame(): void {
    const fight = this.fight;
    if (!fight) return;
    const now = performance.now();
    // Not over anything of my own: it comes up where the fight stands by then.
    if (!fight.view && this.host.idle() && !this.mirroring) {
      // Shown first: the view sizes itself to the room it finds.
      this.viewEl.hidden = false;
      fight.view = this.host.view(fight.side);
      if (fight.view) fight.view.play(fight.events, now - fight.began);
      else this.viewEl.hidden = true;
    }
    if (!fight.view) {
      // Nothing of it on screen, and it has played out meanwhile.
      if (now - fight.began > logMs(fight.events)) this.endFight();
      return;
    }
    const rom = this.host.rom();
    rom?.fightSong(true);
    fight.view.redraw();
    const at = fight.view.snapshot();
    if (at.next !== fight.next) {
      // The sound of what has just begun; nothing for what was over before I came.
      const sound = fight.next >= 0 ? soundOf(fight.events[at.next]) : 0;
      if (sound) rom?.sound(sound);
      fight.next = at.next;
    }
    // Run out of log with no end to it: over, if the room says this fight is.
    if (at.waiting && this.fightIsOver(fight)) {
      fight.lostAt ||= now;
      if (now - fight.lostAt > LOG_LOST_MS) at.ended = true;
    } else fight.lostAt = 0;
    if (at.ended || (at.waiting && now - fight.heard > LOG_SILENT_MS)) this.endFight();
  }

  /** The room has the trainer watched out of this fight: not in one, in another with somebody else,
   *  or the match has ended with the room left standing. */
  private fightIsOver(fight: NonNullable<Watch['fight']>): boolean {
    const room = this.host.link()?.room;
    const a = room?.actor(this.told);
    if (!room || !a?.battling || over(room)) return true;
    const s = fight.events[0];
    return s.e === 'start' && a.foe !== (s.a.seat === this.told ? s.b.seat : s.a.seat);
  }

  private endFight(): void {
    const fight = this.fight;
    if (!fight) return;
    this.fight = null;
    fight.view?.close();
    if (fight.view) {
      this.viewEl.hidden = true;
      this.host.rom()?.fightSong(false);
    }
  }

  /** The watched trainer's battle, replayed on my hidden ROM once its BSTART is here. */
  private mirror(): void {
    if (this.mirroring || this.fight) return;
    // Anything before a BSTART is the tail of a fight there is no start of.
    while (this.queue.length && this.queue[0].m.t !== 'bstart') this.queue.shift();
    const rom = this.host.rom(), link = this.host.link();
    if (!this.queue.length || !rom || !link || !this.host.idle()) return;
    const head = this.queue[0];
    const { from } = head;
    const watched = this.told;
    const fighter = link.room.actor(from);
    // A trainer's page is reading this fight off its ROM too: its log, not my ROM, if it comes.
    if (fighter && !fighter.bot && performance.now() - head.at < LOG_GRACE_MS) return;
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
      stopped: () => this.told !== watched || this.host.link() !== link || !this.host.idle() || !!this.fight,
      turned: watched !== from,
      skins: [fighter?.skin ?? 0, foe?.skin ?? 0],
    };
    this.mirroring = true;
    void rom.mirror(feed, () => this.battleEl.classList.add('on')).finally(() => {
      this.mirroring = false;
      // Why a replay ended, for a recording of one that stopped mid-fight (Cam 11-01, 14:05).
      const why = this.told !== watched ? 1 : this.host.link() !== link ? 2 : !this.host.idle() ? 3 : feed.over() ? 4 : 5;
      recorder.net('mirror-end', why, from, this.queue.length);
      this.battleEl.classList.remove('on');
      // Whatever is left of that fight goes with it (its BSTART too, when the ROM never
      // took it).
      if (first && this.queue[0] === head) this.queue.shift();
      while (this.queue.length && this.queue[0].from === from && this.queue[0].m.t !== 'bstart') this.queue.shift();
      if (why === 5 && !this.fight) this.rejoin(link, watched, fightKey(from, head.m), fighter?.name ?? '');
    });
  }

  /** The replay ended itself and the fight goes on (mirror-end 5): nothing else brings it back,
   *  the TURNs still coming being the tail of a fight with no start here ("I want to watch this
   *  battle. It looks like I can't.", Cam, 11-02). The relay sends a new watch the whole fight,
   *  which the replay catches up on and drops me into where it stands. Once a fight: a replay
   *  the ROM ended for showing another fight (BR_SPECTATE_CHECK) would only end again. */
  private rejoin(link: WorldLink, watched: number, fight: string, name: string): void {
    if (this.rejoined.has(fight)) {
      this.host.tell(`${name}'s battle can't be shown.`);
      return;
    }
    this.rejoined.add(fight);
    link.watch(0);
    link.watch(watched);
  }
}
