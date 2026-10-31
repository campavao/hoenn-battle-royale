// The way into a match, as the live game has it (Cam, 2026-10-29: "our normal game
// structure is good, we should just be matching that"): the main menu's QUICK PLAY,
// HOST A ROOM and JOIN BY CODE, then the room -- its code, who is in it, the host's
// START, a quick room's count to its own start -- drawn with the live game's own screens
// (ui/screens.ts) on the same stage. Dropping straight into the world is the debug path
// now (?solo).
import { Stage, type DrawnScreen } from '../src/ui/stage';
import { loadStats, setStatsOff } from '../src/match/stats';
import { menuScreen, noticeScreen, roomScreen, sheetScreen, type RoomModel, type RowSpec, type SheetModel } from '../src/ui/screens';
import { CODE_ENTRY, NAME_ENTRY, PASS_ENTRY, entryScreen, newEntry } from '../src/ui/entry';
import { FEEDBACK_ROW, HOWTO_ROW, rewatchRow, emptyNote, isRoomCode, playRows, roomRows, type LobbyAction } from '../src/match/lobby';
import { howToScreen } from '../src/ui/howto';
import { howToRead, markHowToRead } from '../src/ui/howto-due';
import { SKINS, cleanName, exportCareer, importCareer, loadCareer, saveProfile, skinUnlocked } from '../src/match/career';
import { LINES } from '../src/bots/lines';
import { cardFields, lookScreen, statsScreen, trainerScreen } from '../src/ui/profile';
import { resultsScreen, type ResultsModel } from '../src/ui/results';
import type { TallyNames } from '../src/match/tally';
import { feedbackScreen, type FeedbackState } from '../src/ui/feedback';
import { cleanNote, sendFeedback } from '../src/net/feedback';
import { fillFor, type Listed, type Member, type Settings } from './shared/wire';
import { BOT_FILL, FOG_STEPS, SAFARI_STEPS, TEXT_SPEEDS, dealable, nextTextSpeed, textSpeedLabel, doorLabel, fillLabel, levelOf, nextDoor, nextFog, nextMax, nextSafari, safariLabel } from '../src/match/room';

/** The room as the relay last said it is (wire.ts's `room`). */
export interface RoomInfo { code: string; quick: boolean; you: number; key?: string; owner: number; members: Member[]; playing: boolean; startsIn?: number; set: Settings; pass?: string; ready?: boolean }

export interface LobbyHooks {
  /** Into a room: by code, a new one of my own, or quick play's. */
  join(how: { code?: string; host?: boolean; pass?: string }): void;
  start(): void;
  /** The host changed a setting for the room's next match. */
  set(set: Partial<Settings> & { pass?: string }): void;
  kick(id: number): void;
  /** Out of the room, back to the menu. */
  leave(): void;
  /** LOBBIES: ask the relay for its hosted rooms (answered through `listed`). */
  list(): void;
  /** The relay SEND FEEDBACK's note goes to (its own socket, net/feedback.ts). */
  relayUrl: string;
  /** QUICK PLAY with no relay: the bots and nobody else, in the page (the live game's
   *  offline QUICK PLAY). */
  solo(): void;
  /** Species and move names for MY STATS: the player's ROM's. */
  names: TallyNames;
}

/** BATTLE BACKDROP: OVER MAP (the default, nothing stored) or CLASSIC ('0'), as the live
 *  game keeps it (app.ts SEE_THROUGH_KEY). */
let shared: Stage | null = null;
/** The page's one Stage: the ROM import screen (import.ts) draws on it before the lobby
 *  takes it over, and two would both answer the same taps. */
export function pageStage(): Stage {
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  return (shared ??= new Stage($('stage'), $('ui') as HTMLCanvasElement, $('ui-hits'), $('stage-fade')));
}

export function seeThrough(): boolean {
  try { return localStorage.getItem('hbr-see-through') !== '0'; } catch { return true; }
}
function setSeeThrough(on: boolean): void {
  try { if (on) localStorage.removeItem('hbr-see-through'); else localStorage.setItem('hbr-see-through', '0'); } catch { /* the default holds */ }
}

/** The career out to a file (app.ts saveCareerFile)... */
function saveCareerFile(): void {
  const url = URL.createObjectURL(new Blob([exportCareer()], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'hoenn-battle-royale-career.json';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** ...and back in: a file not one of ours changes nothing and says so. */
function loadCareerFile(then: (note: string) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    void file.text()
      .then((text) => then(importCareer(text) ? 'Career loaded.' : 'That is not a Hoenn Battle Royale career file.'))
      .catch(() => then('That file could not be read.'));
  });
  input.click();
}

/** Who I am, as the live game keeps it (career.ts): the name and sprite on the trainer card.
 *  No name saved is the live game's fallback too (app.ts careerName), never TRAINER (HBR-107). */
export function me(): { name: string; skin: number } {
  const c = loadCareer();
  let old = '';
  try { old = localStorage.getItem('hbr:name') ?? ''; } catch { /* a blocked store: no old name */ }
  return { name: c.name || cleanName(old) || 'CAM', skin: c.skin ?? 0 };
}

/** The main menu's backdrop (ui/menubg.ts), its own chunk; black until it lands. */
let menuBg: typeof import('../src/ui/menubg') | undefined;
const PAN_MS = 50;
const menuBgLoaded = import('../src/ui/menubg').then((m) => { menuBg = m; }, (err: unknown) => console.warn('the menu backdrop did not load', err));

export class Lobby {
  readonly stage: Stage;
  private room: RoomInfo | null = null;
  /** When the relay last said `startsIn` (performance.now()). */
  private heardAt = 0;
  private note = '';
  private ticker: ReturnType<typeof setInterval> | null = null;
  /** LOBBIES' rooms, as the relay last listed them. */
  private rooms: Listed[] = [];

  constructor(private readonly hooks: LobbyHooks) {
    this.stage = pageStage();
    void menuBgLoaded.then(() => { if (this.stage.current === this.main) this.stage.redraw(); });
  }

  /** The main menu (with a line under it: a code nobody has, say). */
  menu(note = ''): void {
    this.inSheet = false;
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

  /** The live game's results over a finished match: PLAY AGAIN is the room, MAIN MENU
   *  leaves it. */
  results(model: Omit<ResultsModel, 'again' | 'menu'>, menu: () => void): void {
    this.inSheet = false;
    const full: ResultsModel = { ...model, again: { label: 'PLAY AGAIN', id: 'results-again', onPress: () => this.backToRoom() }, menu };
    this.stage.show(resultsScreen(() => full));
  }

  /** The relay's list of hosted rooms (LOBBIES). */
  listed(rooms: Listed[]): void {
    this.rooms = rooms;
    if (this.stage.current === this.lobbies) this.stage.redraw();
  }

  /** Back to the room after a match: what the relay last said of it. */
  backToRoom(): void {
    if (this.room) { this.stage.show(this.roomShown); this.open(); }
    else this.menu();
  }

  /** The relay runs another world than this page (a deploy since it loaded): only a
   *  reload gets the page into a room again. */
  old(): void {
    this.inSheet = false;
    this.room = null;
    this.stage.show(noticeScreen(() => ({
      title: 'HOENN BATTLE ROYALE',
      lines: [{ text: 'A new version of the game is out. Reload the page to play.' }],
      buttons: [{ label: 'RELOAD', id: 'old-reload', onPress: () => location.reload() }],
    })));
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
    // A quick room's count goes down a second at a time; LOBBIES asks again every three.
    let n = 0;
    this.ticker ??= setInterval(() => {
      if (this.room?.startsIn !== undefined) this.stage.redraw();
      if (this.stage.current === this.lobbies && ++n % 3 === 0) this.hooks.list();
    }, 1000);
  }

  private press(a: LobbyAction): void {
    if (a.kind === 'quick') this.hooks.join({});
    else if (a.kind === 'solo') this.hooks.solo();
    else if (a.kind === 'host') this.hooks.join({ host: true });
    else if (a.kind === 'code') this.stage.push(this.codeEntry());
    else if (a.kind === 'name') this.stage.push(this.nameEntry());
    else if (a.kind === 'howto') this.stage.push(this.howTo);
    else if (a.kind === 'lobbies') { this.hooks.list(); this.stage.push(this.lobbies); }
    else if (a.kind === 'join') {
      if (a.pass) this.stage.push(this.passEntry('PASSCODE', 'Ask the host for it.', (pass) => this.hooks.join({ code: a.code, pass })));
      else this.hooks.join({ code: a.code });
    }
    else if (a.kind === 'feedback') { if (this.said !== 'sending') this.said = 'typing'; this.stage.push(this.feedback); }
    else if (a.kind === 'skin' || a.kind === 'look') { this.browsed = null; this.stage.push(this.look); }
    else if (a.kind === 'mystats') this.stage.push(this.myStats);
    else if (a.kind === 'rewatch') { this.rewatch = null; this.hooks.join({ code: a.code }); }
  }

  /** The room of a match a reload left too late to come back in as its trainer: the main
   *  menu's WATCH row goes back into it to look. */
  rewatch: string | null = null;

  /** The relay: there ('up'), gone ('down', QUICK PLAY is the bots alone), or not yet. */
  link: 'up' | 'down' | 'connecting' = 'connecting';
  linkIs(state: 'up' | 'down'): void {
    this.link = state;
    if (this.stage.current === this.main) this.stage.redraw();
  }

  /** The TRAINER CARD (the live game's, POK-335): name, sprite and record, and the two
   *  rows the world has a use for, MY LOOK and MY STATS. */
  private readonly trainer: DrawnScreen = trainerScreen(() => {
    const c = loadCareer();
    return {
      face: { name: me().name, skin: me().skin, wins: c.wins, played: c.matches, best: c.best },
      rows: [
        { label: 'MY LOOK', detail: 'sprite and lines', id: 'trainer-look', onPress: () => this.press({ kind: 'look' }) },
        { label: 'MY STATS', detail: 'every match so far', id: 'trainer-mystats', onPress: () => this.press({ kind: 'mystats' }) },
        // The live card's BATTLE BACKDROP, the same browser setting (hbr-see-through).
        { label: 'BATTLE BACKDROP', detail: seeThrough() ? 'OVER MAP' : 'CLASSIC', id: 'trainer-seethrough', onPress: () => { setSeeThrough(!seeThrough()); this.stage.redraw(); } },
        { label: 'MY CAREER', detail: 'save or load a file', id: 'trainer-career', onPress: () => this.stage.push(this.careerAsk) },
        // The live card's anonymous play count (match/stats.ts): solo matches, told to the relay.
        { label: 'SEND PLAY COUNT', detail: loadStats().off ? 'OFF' : 'ON', id: 'trainer-stats', onPress: () => { setStatsOff(!loadStats().off); this.stage.redraw(); } },
      ],
      note: this.trainerNote,
      onName: () => this.press({ kind: 'name' }),
      onSkin: () => this.press({ kind: 'skin' }),
      onBack: () => this.stage.pop(),
    };
  });

  /** What MY CAREER last did, under the card's rows. */
  private trainerNote = '';

  /** MY CAREER (the live card's, POK-243): the career lives in this browser; SAVE writes
   *  it to a file, LOAD takes one back. */
  private readonly careerAsk: DrawnScreen = noticeScreen(() => ({
    title: 'MY CAREER',
    lines: [{ text: 'Your career lives in this browser. Save it to a file to keep it, or load one to carry it here.' }],
    buttons: [
      { label: 'SAVE', id: 'career-save', onPress: () => { saveCareerFile(); this.trainerNote = 'Saved to a file.'; this.stage.pop(); } },
      { label: 'LOAD', id: 'career-load', onPress: () => { this.stage.pop(); loadCareerFile((said) => { this.trainerNote = said; this.stage.redraw(); }); } },
      { label: 'BACK', id: 'career-back', onPress: () => this.stage.pop() },
    ],
    onBack: () => this.stage.pop(),
  }));

  /** LOBBIES (the live game's, POK-320): the hosted rooms still waiting for START, one
   *  row each. HOST makes one of my own. */
  private readonly lobbies: DrawnScreen = menuScreen(() => ({
    title: 'LOBBIES',
    rows: roomRows(this.rooms.map((r) => ({ code: r.code, host: r.host, skin: String(r.skin), players: r.players, seats: r.seats, pass: r.pass, full: r.players >= r.seats })))
      .map((row, i): RowSpec => ({
        label: row.label,
        detail: row.detail?.replace('🔒', 'PASS') ?? '',
        disabled: row.disabled,
        id: `lobbies-${this.rooms[i].code}`,
        onPress: () => this.press(row.action),
      })),
    rowsId: 'lobby-rooms',
    note: this.rooms.length === 0 ? emptyNote(true) : '',
    noteId: 'lobby-rooms-note',
    buttons: [
      { label: 'HOST', id: 'lobbies-host', onPress: () => this.press({ kind: 'host' }) },
      { label: 'BACK', id: 'lobbies-back', onPress: () => this.stage.pop() },
    ],
    onBack: () => this.stage.pop(),
  }));

  /** SEND FEEDBACK (POK-428): a note to the relay, which files it. The draft stays if
   *  the screen is left, as the live game's does. */
  private draft = '';
  private said: FeedbackState = 'typing';
  /** Written mid-match (the MENU's FEEDBACK): BACK hides the stage and calls this. */
  private overMatch: (() => void) | null = null;

  /** SEND FEEDBACK over the match, from its MENU; `done` once it is closed. */
  /** The live match's sheet (ui/screens.ts sheetScreen) over the game, which runs on
   *  under it: the room's line, everybody in it, who I watch, LEAVE, the settings. Its
   *  FEEDBACK goes over it and BACK comes back to it; closed, `done`. */
  sheetOver(model: () => Omit<SheetModel, 'onClose' | 'onFeedback'>, done: () => void): void {
    this.sheetDone = done;
    this.inSheet = true;
    this.stage.show(sheetScreen(() => ({ ...model(), onClose: () => this.closeSheet(), onFeedback: () => this.stage.push(this.feedback) })));
  }

  /** The sheet is up (or a screen over it). */
  get sheetUp(): boolean {
    return this.inSheet && this.stage.active;
  }

  closeSheet(): void {
    if (!this.inSheet) return;
    this.inSheet = false;
    this.stage.hide();
    const done = this.sheetDone;
    this.sheetDone = null;
    done?.();
  }

  private inSheet = false;
  private sheetDone: (() => void) | null = null;

  feedbackOver(done: () => void): void {
    if (this.said !== 'sending') this.said = 'typing';
    this.overMatch = done;
    this.stage.show(this.feedback);
  }

  private readonly feedback: DrawnScreen = feedbackScreen(() => ({
    text: this.draft,
    state: this.said,
    onInput: (text) => { this.draft = text; if (this.said !== 'sending') this.said = 'typing'; },
    onSend: () => {
      const text = cleanNote(this.draft);
      if (!text || this.said === 'sending') return;
      this.said = 'sending';
      void sendFeedback(this.hooks.relayUrl, { type: 'feedback', text, v: 'spike B', where: this.overMatch || this.inSheet ? 'spikeb-match' : this.room ? 'spikeb-room' : 'spikeb-menu', name: me().name, ...(this.room ? { room: this.room.code } : {}) }).then((result) => {
        this.said = result;
        if (result === 'sent' && cleanNote(this.draft) === text) this.draft = '';
        this.stage.redraw();
      });
    },
    onBack: () => {
      const done = this.overMatch;
      this.overMatch = null;
      if (!done) { this.stage.pop(); return; }
      this.stage.hide();
      done();
    },
  }));

  /** The wardrobe strip being looked at: a locked one is looked at, not worn. */
  private browsed: number | null = null;
  private readonly look: DrawnScreen = lookScreen(() => {
    const c = loadCareer();
    return {
      wins: c.wins,
      worn: me().skin,
      browsing: this.browsed ?? me().skin,
      lines: LINES,
      picked: { intro: c.intro ?? 0, win: c.win ?? 0, lose: c.lose ?? 0 },
      onBrowse: (skin) => {
        if (skinUnlocked(skin, loadCareer().wins)) saveProfile({ skin });
        this.browsed = skin;
        this.stage.redraw();
      },
      onLine: (slot, index) => { saveProfile({ [slot]: index }); this.stage.redraw(); },
      onBack: () => { this.browsed = null; this.stage.pop(); },
    };
  });

  /** MY STATS (POK-416): every match so far, off the career. */
  private readonly myStats: DrawnScreen = statsScreen(() => ({ totals: loadCareer().totals, names: this.hooks.names, onBack: () => this.stage.pop() }));

  /** HOW TO PLAY's panels (ui/howto.ts), with the NEW on its tile until the last is read. */
  private readonly howTo: DrawnScreen = howToScreen(() => ({
    skin: me().skin,
    onDone: () => this.stage.pop(),
    onRead: () => markHowToRead(localStorage),
    redraw: () => { if (this.stage.current === this.howTo) this.stage.redraw(); },
  }));

  private panPending = false;
  private readonly main: DrawnScreen = menuScreen(() => ({
    title: 'HOENN BATTLE ROYALE',
    // The ways in the world has: no LOBBIES list or daily game here yet.
    rows: playRows(this.link)
      .filter((r) => r.action.kind === 'quick' || r.action.kind === 'solo' || r.action.kind === 'host' || r.action.kind === 'lobbies' || r.action.kind === 'code')
      // The match a reload left too late to come back into (HBR-20): WATCH it.
      .concat(this.rewatch ? [rewatchRow(this.rewatch)] : [], HOWTO_ROW, FEEDBACK_ROW)
      .map((r): RowSpec => ({ label: r.label, id: r.id, art: r.art, onPress: () => this.press(r.action), ...(r.id === HOWTO_ROW.id && !howToRead(localStorage) ? { badge: true } : {}) })),
    rowsId: 'lobby-rows',
    tiles: true,
    // The live menu's backdrop (HBR-30, ui/menubg.ts): a slow, soft pan over Hoenn, drawn
    // again every PAN_MS while the menu is up; still for somebody who asked for less motion.
    backdrop: (c, h) => {
      if (!menuBg) return;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return menuBg.paintPan(c, 0, h);
      menuBg.paintPan(c, performance.now(), h);
      if (this.panPending) return;
      this.panPending = true;
      setTimeout(() => {
        this.panPending = false;
        if (this.stage.current === this.main) this.stage.redraw();
      }, PAN_MS);
    },
    note: this.note,
    noteId: 'lobby-note',
    trainer: { name: me().name, skin: me().skin, onPress: () => this.stage.push(this.trainer) },
  }));

  /** Four letters: a locked room's passcode, typed to come in or set by its host. */
  private passEntry(title: string, note: string, done: (pass: string) => void): DrawnScreen {
    const state = newEntry(PASS_ENTRY);
    return entryScreen(() => ({
      title,
      state,
      note,
      onDone: (pass) => { this.stage.pop(); done(pass); },
      onBack: () => this.stage.pop(),
    }));
  }

  /** The seat whose card is open on the room screen (KICK on it, for the host). */
  private card: number | null = null;

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
    // The live room's: MAX seats, FILL's bots in the ones nobody has, and START only for
    // a match somebody could win (match/room.ts canStart, startNote).
    const max = r.quick ? Math.max(BOT_FILL, r.members.length) : r.set.max;
    const fill = fillFor({ bots: r.set.bots, max }, r.members.length);
    const startable = dealable(r.members.length, fill);
    const note = r.playing ? 'A match is on. You watch it, and are in the next.'
      : r.ready ? (isHost ? 'READY UP when everybody is: the next match counts down from it.' : 'Waiting for the host to READY UP.')
      : !isHost ? 'Waiting for the host to start.'
        : !startable ? 'Nobody to play against. Turn FILL on, or wait for somebody.' : '';
    return {
      status: r.quick ? 'QUICK PLAY' : `Room ${r.code}`,
      note,
      seats: r.members.map((m) => ({ seat: m.id, name: m.name, skin: m.skin, isMe: m.id === r.you, spectating: false, alive: true })),
      max,
      fill,
      isHost,
      started: r.playing,
      canStart: isHost && !r.playing && startable,
      startLabel: r.ready ? 'READY UP' : 'START',
      countdown: left === null ? null : Math.ceil(left),
      // The host's, in a room of their own (a quick room's are the relay's): the live
      // room's, in its order (app.ts hostOptions).
      options: isHost && !r.quick ? [
        { id: 'room-max', label: `MAX ${r.set.max}`, onPress: () => this.hooks.set({ max: nextMax(r.set.max) }) },
        { id: 'room-fill', label: fillLabel({ fillOn: r.set.bots, fill }), visual: { kind: 'toggle', on: r.set.bots }, onPress: () => this.hooks.set({ bots: !r.set.bots }) },
        {
          id: 'room-door',
          label: doorLabel(r.set.door, r.pass ?? null),
          onPress: () => {
            const next = nextDoor(r.set.door);
            if (next !== 'pass') this.hooks.set({ door: next });
            else this.stage.push(this.passEntry('PASSCODE', 'Guests type this to come in.', (pass) => this.hooks.set({ door: 'pass', pass })));
          },
        },
        { id: 'room-text', label: `TEXT ${textSpeedLabel(r.set.textSpeed)}`, visual: { kind: 'level', ...levelOf(TEXT_SPEEDS.map((t) => t.value), r.set.textSpeed) }, onPress: () => this.hooks.set({ textSpeed: nextTextSpeed(r.set.textSpeed) }) },
        { id: 'room-anim', label: r.set.animations ? 'ANIM ON' : 'ANIM OFF', visual: { kind: 'toggle', on: r.set.animations }, onPress: () => this.hooks.set({ animations: !r.set.animations }) },
        { id: 'room-fog', label: `FOG ${r.set.fogSecs}s`, visual: { kind: 'level', ...levelOf(FOG_STEPS, r.set.fogSecs), clock: true }, onPress: () => this.hooks.set({ fogSecs: nextFog(r.set.fogSecs) }) },
        { id: 'room-safari', label: safariLabel(r.set.safariSecs), visual: { kind: 'level', ...levelOf(SAFARI_STEPS, r.set.safariSecs, true), clock: true }, onPress: () => this.hooks.set({ safariSecs: nextSafari(r.set.safariSecs) }) },
      ] : null,
      card: (() => {
        const m = this.card === null ? undefined : r.members.find((x) => x.id === this.card);
        return m ? { seat: m.id, skin: m.skin, lines: [{ label: 'NAME', value: m.name }, ...(m.rec ? cardFields({ name: m.name, skin: m.skin, wins: m.rec.wins, played: m.rec.played, best: m.rec.best }) : [])], canKick: isHost && !r.playing && m.id !== r.you } : null;
      })(),
      onStart: () => this.hooks.start(),
      onLeave: () => this.hooks.leave(),
      onSeat: (seat) => { this.card = this.card === seat ? null : seat; this.stage.redraw(); },
      onKick: (seat) => { this.hooks.kick(seat); this.card = null; this.stage.redraw(); },
      onCloseCard: () => { this.card = null; this.stage.redraw(); },
    };
  });
}
