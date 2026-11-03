import { describe, expect, it } from 'vitest';
import { eventMs, logMs, stateAt, type BattleEvent } from './shared/battlelog';
import { CANNED_LOG } from './fixtures/battlelog-canned';
import { BLINK_MS, CHAR_MS, advance, boxLines, envFor, fitScale, introLine, readsFor, revealed, sceneAt, sideOf, slotOf } from './battlescene';
import { barColour, barPixels, statusKind, trainerPicFor } from './battleview';

/** The ms at which event `i` of the canned log starts. */
const startOf = (i: number) => CANNED_LOG.slice(0, i).reduce((t, e) => t + eventMs(e), 0);
const SHARPEDO = 331, POOCHYENA = 286, TREECKO = 277;

describe('which side is near', () => {
  it('is side 0 unless the watcher follows side 1, and flips back', () => {
    expect([slotOf(0, 0), slotOf(1, 0)]).toEqual(['near', 'far']);
    expect([slotOf(0, 1), slotOf(1, 1)]).toEqual(['far', 'near']);
    expect([sideOf('near', 0), sideOf('far', 0), sideOf('near', 1), sideOf('far', 1)]).toEqual([0, 1, 1, 0]);
  });
  it('puts the followed trainer near the camera in the scene', () => {
    const t = startOf(5) + 10;
    const a = sceneAt(CANNED_LOG, t, 0), b = sceneAt(CANNED_LOG, t, 1);
    expect(a.near.mon?.species).toBe(SHARPEDO);
    expect(a.far.mon?.species).toBe(POOCHYENA);
    expect(b.near.mon?.species).toBe(POOCHYENA);
    expect(b.far.mon?.species).toBe(SHARPEDO);
    expect(b.near.side).toBe(1);
  });
  it('slides the trainers from their own side, whichever way the view is flipped', () => {
    const a = sceneAt(CANNED_LOG, 100, 0), b = sceneAt(CANNED_LOG, 100, 1);
    expect(a.near.trainerDx).toBeLessThan(0);
    expect(a.far.trainerDx).toBeGreaterThan(0);
    expect(b.near.name).toBe('LASS ROSE');
    expect(b.near.trainerDx).toBeLessThan(0);
  });
});

describe('the size', () => {
  it('is a whole number of device pixels a pixel, and fits', () => {
    expect(fitScale(1280, 720)).toBe(4);
    expect(fitScale(1920, 1080)).toBe(6);
    expect(fitScale(375, 667, 3)).toBeCloseTo(4 / 3, 5);
    expect(375 * 3 >= 240 * 4).toBe(true);
    expect(fitScale(100, 100)).toBe(1);
  });
  it('is bound by the tighter of the two sides', () => {
    expect(fitScale(2000, 330)).toBe(2);
    expect(fitScale(500, 2000)).toBe(2);
  });
  it('never makes the picture bigger than the window', () => {
    for (const [w, h, d] of [[375, 667, 3], [1280, 720, 1], [1920, 1080, 1], [820, 1180, 2], [360, 640, 2]] as const) {
      const s = fitScale(w, h, d);
      expect(240 * s).toBeLessThanOrEqual(w);
      expect(160 * s).toBeLessThanOrEqual(h);
    }
  });
});

describe('where a fight is', () => {
  it('is on the ground its map says', () => {
    expect(envFor('MAP_ROUTE117')).toBe('grass');
    expect(envFor('MAP_ROUTE105')).toBe('water');
    expect(envFor('MAP_ROUTE111')).toBe('sand');
    expect(envFor('MAP_GRANITE_CAVE_1F')).toBe('cave');
    expect(envFor('MAP_RUSTBORO_CITY_GYM')).toBe('gym');
    expect(envFor('MAP_LITTLEROOT_TOWN_BRENDANS_HOUSE_1F')).toBe('building');
    expect(envFor('MAP_ROUTE117_POKEMON_DAY_CARE')).toBe('building');
    expect(envFor('MAP_UNDERWATER_ROUTE124')).toBe('underwater');
    expect(envFor('MAP_LILYCOVE_CITY')).toBe('plain');
    expect(envFor('MAP_MT_PYRE_EXTERIOR')).toBe('mountain');
    expect(envFor('')).toBe('grass');
  });
});

describe('time', () => {
  it('runs on through the log and waits at its end', () => {
    expect(advance(100, 16, 5000)).toBe(116);
    expect(advance(4990, 16, 5000)).toBe(5000);
    expect(advance(5000, 500, 5000)).toBe(5000);
    expect(advance(10, -5, 5000)).toBe(10);
  });
  it('holds each event for its eventMs', () => {
    const s = sceneAt(CANNED_LOG, startOf(5) + 1, 0);
    expect(s.next).toBe(5);
    expect(s.elapsed).toBe(1);
    expect(s.p).toBeCloseTo(1 / eventMs(CANNED_LOG[5]), 5);
  });
});

describe('the message box', () => {
  it('breaks a line where the words do and keeps the strings own breaks', () => {
    expect(boxLines('What will\nSHARPEDO do?')).toEqual(['What will', 'SHARPEDO do?']);
    expect(boxLines('Short.')).toEqual(['Short.']);
    expect(boxLines('The wild POOCHYENA used a move with a long, long name so that it must be wrapped!').length).toBeGreaterThan(1);
  });
  it('scrolls its letters in, a line under a line', () => {
    expect(revealed('What will\nSHARPEDO do?', 0)).toEqual([]);
    expect(revealed('What will\nSHARPEDO do?', 4)).toEqual(['What']);
    expect(revealed('What will\nSHARPEDO do?', 11)).toEqual(['What will', 'S']);
    expect(revealed('What will\nSHARPEDO do?', 999)).toEqual(['What will', 'SHARPEDO do?']);
  });
  it('shows two lines at a time of a longer one', () => {
    expect(revealed('a\nb\nc', 99)).toEqual(['b', 'c']);
  });
  it('prints a line at a pace the event holds it for', () => {
    const s = sceneAt(CANNED_LOG, startOf(1) + CHAR_MS * 5, 0);
    expect(s.text).toBe('LASS ROSE sent out POOCHYENA!');
    expect(s.chars).toBe(5);
    for (const ev of CANNED_LOG) if (ev.e === 'text') expect(eventMs(ev)).toBeGreaterThan(CHAR_MS * ev.text.length);
  });
  it('says who would like to battle at the start, and keeps it until something else is said', () => {
    expect(sceneAt(CANNED_LOG, 50, 0).text).toBe(introLine('LASS ROSE'));
    expect(sceneAt(CANNED_LOG, 50, 1).text).toBe(introLine('BRENDAN'));
    expect(sceneAt(CANNED_LOG, startOf(1) - 1, 0).chars).toBeGreaterThan(5);
  });
});

describe('what is on the screen at a time', () => {
  it('has both trainers and no mons at the start, then each side hands over', () => {
    const s = sceneAt(CANNED_LOG, 1500, 0);
    expect(s.near.mon).toBeNull();
    expect(s.far.mon).toBeNull();
    expect(s.near.trainerDx).not.toBeNull();
    expect(s.far.trainerDx).not.toBeNull();
    // Once the far trainer sends out, theirs goes, and the near one stays until their own.
    const mid = sceneAt(CANNED_LOG, startOf(4) - 1, 0);
    expect(mid.far.mon?.species).toBe(POOCHYENA);
    expect(mid.far.trainerDx).toBeNull();
    expect(mid.near.trainerDx).toBe(0);
    expect(mid.near.mon).toBeNull();
  });
  it('has a mon growing out while its send plays, whole after', () => {
    const during = sceneAt(CANNED_LOG, startOf(2) + 100, 0);
    expect(during.far.mon?.species).toBe(POOCHYENA);
    expect(during.far.appear).toBeGreaterThan(0);
    expect(during.far.appear).toBeLessThan(1);
    expect(sceneAt(CANNED_LOG, startOf(2) + 1100, 0).far.appear).toBe(1);
  });
  it('has an HP bar that drains while the event holds and then stays', () => {
    const hp = startOf(7);
    expect(sceneAt(CANNED_LOG, hp, 0).far.hp).toBe(19);
    const mid = sceneAt(CANNED_LOG, hp + eventMs(CANNED_LOG[7]) / 2, 0).far.hp;
    expect(mid).toBeGreaterThan(8);
    expect(mid).toBeLessThan(19);
    expect(sceneAt(CANNED_LOG, hp + eventMs(CANNED_LOG[7]), 0).far.hp).toBe(8);
    // Slowing the clock never draws it past either end.
    for (let t = hp; t < hp + 1000; t += 37) expect(sceneAt(CANNED_LOG, t, 0).far.hp).toBeGreaterThanOrEqual(8);
  });
  it('blinks the one a hit lands on, and only for its while', () => {
    const hit = startOf(6);
    const seen = new Set<boolean>();
    for (let t = hit; t < hit + BLINK_MS; t += 20) seen.add(sceneAt(CANNED_LOG, t, 0).far.blink);
    expect(seen).toEqual(new Set([true, false]));
    expect(sceneAt(CANNED_LOG, hit + 10, 0).near.blink).toBe(false);
    expect(sceneAt(CANNED_LOG, startOf(7), 0).far.blink).toBe(false);
  });
  it('sinks a mon that faints, then it is gone', () => {
    const f = startOf(14);
    const mid = sceneAt(CANNED_LOG, f + 250, 0).far;
    expect(mid.leave).toBe('faint');
    expect(mid.vanish).toBeGreaterThan(0);
    expect(mid.hp).toBe(0);
    expect(sceneAt(CANNED_LOG, f + eventMs(CANNED_LOG[14]) + 5, 0).far.mon).toBeNull();
  });
  it('shows a status the moment it is given', () => {
    const at = startOf(19) + 1;
    expect(sceneAt(CANNED_LOG, at, 0).near.status).toBe(0x40);
    expect(sceneAt(CANNED_LOG, at - 5, 0).near.status).toBe(0);
  });
  it('ends when the log does, with the winner', () => {
    const end = sceneAt(CANNED_LOG, logMs(CANNED_LOG), 0);
    expect(end.ended).toBe(true);
    expect(end.waiting).toBe(false);
    expect(end.state.winner).toBe(1);
    expect(end.far.mon).toBeNull();
    expect(end.near.mon?.species).toBe(SHARPEDO);
  });
});

describe('joining late', () => {
  it('is dropped in where the fight stands, the same as playing up to it', () => {
    // The scene at a time depends on the log up to it alone, so a late joiner and one who
    // watched from the start are shown the same thing.
    for (const t of [0, 1500, 4000, 7100, 9500, 15000, 21000, logMs(CANNED_LOG)]) {
      const late = sceneAt(CANNED_LOG, t, 0);
      let watched = sceneAt(CANNED_LOG, 0, 0);
      for (let s = 0; s <= t; s += 250) watched = sceneAt(CANNED_LOG, s, 0);
      watched = sceneAt(CANNED_LOG, t, 0);
      expect(late).toEqual(watched);
      expect(late.state).toEqual(stateAt(CANNED_LOG, t).state);
    }
  });
  it('has the HP and the mons of the fight at that point, with no catching up', () => {
    const s = sceneAt(CANNED_LOG, startOf(11) + 5, 0);
    expect(s.near.hp).toBe(18);
    expect(s.far.hp).toBe(8);
    expect(s.far.mon?.species).toBe(POOCHYENA);
    expect(s.text).toBe('SHARPEDO used BITE!');
    expect(s.chars).toBe(0);
    const late = sceneAt(CANNED_LOG, startOf(19) + 10, 0);
    expect(late.far.mon?.species).toBe(TREECKO);
    expect(late.far.hp).toBe(19);
    expect(late.text).toBe('Foe TREECKO used LEER!');
  });
});

describe('a live log', () => {
  it('waits when it has run out, and goes on when more comes', () => {
    const turn: BattleEvent[] = CANNED_LOG.slice(0, 5);
    const end = logMs(turn);
    const waiting = sceneAt(turn, advance(end - 5, 1000, end), 0);
    expect(waiting.waiting).toBe(true);
    expect(waiting.ended).toBe(false);
    expect(waiting.next).toBe(turn.length);
    expect(waiting.near.mon?.species).toBe(SHARPEDO);
    const more = [...turn, ...CANNED_LOG.slice(5, 8)];
    const on = sceneAt(more, end + 100, 0);
    expect(on.waiting).toBe(false);
    expect(on.next).toBe(5);
    expect(on.text).toBe('SHARPEDO used BITE!');
  });
  it('draws an empty log as nothing', () => {
    const s = sceneAt([], 0, 0);
    expect(s.near.mon).toBeNull();
    expect(s.waiting).toBe(true);
    expect(s.state.a).toBeNull();
  });
  it('does not crash on events out of order', () => {
    const s = sceneAt([{ e: 'send', side: 0, slot: 3 }, { e: 'hp', side: 1, hp: 4 }, { e: 'faint', side: 0 }] as BattleEvent[], 5000, 0);
    expect(s.near.mon).toBeNull();
  });
});

describe('the health box', () => {
  it('fills as many pixels of 48 as the HP is of the max, and never none while there is any', () => {
    expect(barPixels(50, 50)).toBe(48);
    expect(barPixels(25, 50)).toBe(24);
    expect(barPixels(1, 500)).toBe(1);
    expect(barPixels(0, 50)).toBe(0);
    expect(barPixels(999, 50)).toBe(48);
  });
  it('turns yellow under half and red under a fifth', () => {
    expect([barColour(48), barColour(25), barColour(24), barColour(10), barColour(9), barColour(1)]).toEqual(['green', 'green', 'yellow', 'yellow', 'red', 'red']);
  });
  it('reads a status as the ROMs bits', () => {
    expect([0, 2, 0x08, 0x88, 0x10, 0x20, 0x40].map(statusKind)).toEqual([null, 'slp', 'psn', 'psn', 'brn', 'frz', 'par']);
  });
});

describe('the trainers pictures', () => {
  it('is the back picture for BRENDAN or MAY near the camera, a front one turned round for any other look', () => {
    expect(trainerPicFor(0, 'near')).toEqual({ pic: 0, back: true, flip: false });
    expect(trainerPicFor(1, 'near')).toEqual({ pic: 1, back: true, flip: false });
    expect(trainerPicFor(15, 'near')).toEqual({ pic: 77, back: false, flip: true });
    expect(trainerPicFor(15, 'far')).toEqual({ pic: 77, back: false, flip: false });
    expect(trainerPicFor(0, 'far')).toEqual({ pic: 71, back: false, flip: false });
    expect(trainerPicFor(99, 'far').pic).toBe(71);
  });
});

describe('a line of a log, for a watcher following side 1', () => {
  const trainers: [string, string] = ['MAY', 'BOB'];
  const names: [string[], string[]] = [['TREECKO', 'KADABRA'], ['GLOOM', 'ABRA']];
  const read = (t: string, n = names) => readsFor(t, trainers, n);

  it('their mon loses the Foe and the other side\'s gets it', () => {
    expect(read('Foe GLOOM used TOXIC!')).toBe('GLOOM used TOXIC!');
    expect(read('TREECKO used POUND!')).toBe('Foe TREECKO used POUND!');
    expect(read('Foe GLOOM fainted!')).toBe('GLOOM fainted!');
    expect(read('GLOOM is hurt by the fog!')).toBe('GLOOM is hurt by the fog!');
    expect(read('TREECKO is hurt by the fog!')).toBe('Foe TREECKO is hurt by the fog!');
    expect(read('Foe GLOOM drained TREECKO!')).toBe('GLOOM drained Foe TREECKO!');
    expect(read('A critical hit!')).toBe('A critical hit!');
  });

  it('a name in a longer name is no name', () => {
    expect(read('Foe ABRA used CONFUSION!')).toBe('ABRA used CONFUSION!');
    expect(readsFor('ABRA is fast. KADABRA is faster.', trainers, [['ABRA'], ['GLOOM']])).toBe('Foe ABRA is fast. KADABRA is faster.');
  });

  it('the same species on both sides: the log\'s "Foe" says whose it is', () => {
    const same: [string[], string[]] = [['GLOOM'], ['GLOOM']];
    expect(read('Foe GLOOM used TOXIC!', same)).toBe('GLOOM used TOXIC!');
    expect(read('GLOOM used POUND!', same)).toBe('Foe GLOOM used POUND!');
    expect(read('Foe GLOOM drained GLOOM!', same)).toBe('GLOOM drained Foe GLOOM!');
  });

  it('a name only they have stays bare, and a Foe with no name in the teams goes', () => {
    expect(read('Foe DITTO transformed into GLOOM!', [['DITTO'], ['GLOOM']])).toBe('DITTO transformed into GLOOM!');
    expect(read('DITTO transformed into GLOOM!', [['DITTO'], ['GLOOM']])).toBe('Foe DITTO transformed into GLOOM!');
    expect(read('Foe MYSTERY used TACKLE!')).toBe('MYSTERY used TACKLE!');
    expect(readsFor('A wild thing!', trainers, [[], []])).toBe('A wild thing!');
  });

  it('who sends out, and whose team, turned round', () => {
    expect(read('Go! TREECKO!')).toBe('MAY sent out TREECKO!');
    expect(read('BOB sent out GLOOM!')).toBe('Go! GLOOM!');
    expect(read('Your team\'s REFLECT raised DEFENSE!')).toBe("Foe's team's REFLECT raised DEFENSE!");
    expect(read("Foe's team's MIST wore off!")).toBe("Your team's MIST wore off!");
  });

  it('a name with a stop or a quote in it is taken as it stands', () => {
    expect(readsFor('MR. MIME used BARRIER!', trainers, [['MR. MIME'], ['GLOOM']])).toBe('Foe MR. MIME used BARRIER!');
    expect(readsFor("FARFETCH'D used CUT!", trainers, [["FARFETCH'D"], ['GLOOM']])).toBe("Foe FARFETCH'D used CUT!");
  });
});
