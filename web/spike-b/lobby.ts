// The way into a match, as the live game has it (Cam, 2026-10-29: "our normal game
// structure is good, we should just be matching that"): the main menu's QUICK PLAY,
// HOST A ROOM and JOIN BY CODE, then the room -- its code, who is in it, the host's
// START, a quick room's count to its own start -- drawn with the live game's own screens
// (ui/screens.ts) on the same stage. Dropping straight into the world is the debug path
// now (?solo).
import { Stage, type DrawnScreen } from '../src/ui/stage';
import { menuScreen, roomScreen, type RoomModel, type RowSpec } from '../src/ui/screens';
import { CODE_ENTRY, NAME_ENTRY, entryScreen, newEntry } from '../src/ui/entry';
import { HOWTO_ROW, countdown, isRoomCode, playRows, type LobbyAction } from '../src/match/lobby';
import { howToScreen } from '../src/ui/howto';
import { howToRead, markHowToRead } from '../src/ui/howto-due';
import { cleanName, loadCareer, saveProfile } from '../src/match/career';
import type { Member } from './shared/wire';

/** The room as the relay last said it is (wire.ts's `room`). */
export interface RoomInfo { code: string; quick: boolean; you: number; owner: number; members: Member[]; playing: boolean; startsIn?: number }

export interface LobbyHooks {
  /** Into a room: by code, a new one of my own, or quick play's. */
  join(how: { code?: string; host?: boolean }): void;
  start(): void;
  /** Out of the room, back to the menu. */
  leave(): void;
}

/** Who I am, as the live game keeps it (career.ts): the name and sprite on the trainer card. */
export function me(): { name: string; skin: number } {
  const c = loadCareer();
  return { name: c.name ?? '', skin: c.skin ?? 0 };
}

export class Lobby {
  readonly stage: Stage;
  private room: RoomInfo | null = null;
  /** When the relay last said `startsIn` (performance.now()). */
  private heardAt = 0;
  private note = '';
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly hooks: LobbyHooks) {
    const $ = (id: string) => document.getElementById(id) as HTMLElement;
    this.stage = new Stage($('stage'), $('ui') as HTMLCanvasElement, $('ui-hits'), $('stage-fade'));
  }

  /** The main menu (with a line under it: a code nobody has, say). */
  menu(note = ''): void {
    this.note = note;
    this.room = null;
    this.stage.show(this.main);
    this.open();
  }

  /** The room, as the relay says it is now. */
  roomIs(r: RoomInfo): void {
    const was = this.room;
    this.room = r;
    this.heardAt = performance.now();
    if (!was || this.stage.current !== this.roomShown) this.stage.show(this.roomShown);
    else this.stage.redraw();
    this.open();
  }

  /** Back to the room after a match: what the relay last said of it. */
  backToRoom(): void {
    if (this.room) { this.stage.show(this.roomShown); this.open(); }
    else this.menu();
  }

  hide(): void {
    this.stage.hide();
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  /** The stage has the screen (and the keys). */
  get shown(): boolean {
    return this.stage.active;
  }

  private open(): void {
    // A quick room's count goes down a second at a time.
    this.ticker ??= setInterval(() => { if (this.room?.startsIn !== undefined) this.stage.redraw(); }, 1000);
  }

  private press(a: LobbyAction): void {
    if (a.kind === 'quick') this.hooks.join({});
    else if (a.kind === 'host') this.hooks.join({ host: true });
    else if (a.kind === 'code') this.stage.push(this.codeEntry());
    else if (a.kind === 'name') this.stage.push(this.nameEntry());
    else if (a.kind === 'howto') this.stage.push(this.howTo);
  }

  /** HOW TO PLAY's panels (ui/howto.ts), with the NEW on its tile until the last is read. */
  private readonly howTo: DrawnScreen = howToScreen(() => ({
    skin: me().skin,
    onDone: () => this.stage.pop(),
    onRead: () => markHowToRead(localStorage),
    redraw: () => { if (this.stage.current === this.howTo) this.stage.redraw(); },
  }));

  private readonly main: DrawnScreen = menuScreen(() => ({
    title: 'HOENN BATTLE ROYALE',
    // The ways in the world has: no LOBBIES list or daily game here yet.
    rows: playRows('up')
      .filter((r) => r.action.kind === 'quick' || r.action.kind === 'host' || r.action.kind === 'code')
      .concat(HOWTO_ROW)
      .map((r): RowSpec => ({ label: r.label, id: r.id, art: r.art, onPress: () => this.press(r.action), ...(r.id === HOWTO_ROW.id && !howToRead(localStorage) ? { badge: true } : {}) })),
    rowsId: 'lobby-rows',
    tiles: true,
    note: this.note,
    noteId: 'lobby-note',
    trainer: { name: me().name || 'TRAINER', skin: me().skin, onPress: () => this.press({ kind: 'name' }) },
  }));

  private codeEntry(): DrawnScreen {
    const state = newEntry(CODE_ENTRY);
    let wrong = '';
    return entryScreen(() => ({
      title: 'ROOM CODE',
      state,
      note: wrong,
      noteIsError: wrong !== '',
      onDone: (code) => {
        if (!isRoomCode(code)) { wrong = `${code} is not a room code.`; return; }
        this.stage.pop();
        this.hooks.join({ code });
      },
      onBack: () => this.stage.pop(),
    }));
  }

  private nameEntry(): DrawnScreen {
    const state = newEntry(NAME_ENTRY, me().name);
    return entryScreen(() => ({
      title: 'YOUR NAME',
      state,
      note: 'Seven letters, as Emerald keeps it.',
      onDone: (text) => {
        const typed = cleanName(text);
        if (typed) saveProfile({ name: typed });
        this.stage.pop();
      },
      onBack: () => this.stage.pop(),
    }));
  }

  private readonly roomShown: DrawnScreen = roomScreen((): RoomModel => {
    const r = this.room!;
    const isHost = r.owner === r.you;
    const left = r.startsIn !== undefined ? Math.max(0, (r.startsIn - (performance.now() - this.heardAt)) / 1000) : null;
    const note = r.playing ? 'A match is on. You watch it, and are in the next.'
      : isHost ? (left !== null ? `Starts in ${countdown(left)}, or press START.` : 'Press START when everybody is in.')
        : left !== null ? `Starts in ${countdown(left)}.` : 'Waiting for the host to start.';
    return {
      status: r.quick ? 'QUICK PLAY' : `Room ${r.code}`,
      note,
      seats: r.members.map((m) => ({ seat: m.id, name: m.name, skin: m.skin, isMe: m.id === r.you, spectating: false, alive: true })),
      max: Math.max(8, r.members.length),
      fill: 0,
      isHost,
      started: r.playing,
      canStart: isHost && !r.playing,
      startLabel: 'START',
      countdown: left === null ? null : Math.ceil(left),
      options: null,
      card: null,
      onStart: () => this.hooks.start(),
      onLeave: () => this.hooks.leave(),
      onSeat: () => undefined,
      onKick: () => undefined,
      onCloseCard: () => undefined,
    };
  });
}
