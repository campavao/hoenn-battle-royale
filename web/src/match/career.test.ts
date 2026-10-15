import ghostsSource from '../../../src/br/br_ghosts.c?raw';
import { describe, expect, it } from 'vitest';
import { lineAt, LINE_COUNT, LINES, nextLine, VOICE_COUNT, voiceOf } from '../bots/lines';
import {
  careerLine,
  cleanName,
  exportCareer,
  FILE_TAG,
  importCareer,
  loadCareer,
  NAME_MAX,
  nextLockedSkin,
  nextSkin,
  peekSkin,
  recordMatch,
  saveProfile,
  RETIRED_SKINS,
  SKIN_UNLOCK_WINS,
  SKINS,
  WARDROBE,
  skinNote,
  skinUnlocked,
} from './career';

/** A localStorage that lives for one test. */
function store() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('a name', () => {
  it('is uppercase, letters and digits, at most Emerald s seven', () => {
    expect(cleanName('brendan')).toBe('BRENDAN');
    expect(cleanName('  may  ')).toBe('MAY');
    expect(cleanName('a-very-long-name')).toHaveLength(NAME_MAX);
    expect(cleanName('!!!')).toBe('');
  });
});

describe('the profile', () => {
  it('is kept beside the record, so one read is the lot', () => {
    const s = store();
    recordMatch(1, s);
    saveProfile({ name: 'wally', skin: 4 }, s);
    const career = loadCareer(s);
    expect(career.name).toBe('WALLY');
    expect(career.skin).toBe(4);
    expect(career.wins).toBe(1); // the record survived the profile write
  });

  it('forgets a name that is not one, rather than keeping a blank', () => {
    const s = store();
    saveProfile({ name: 'MAY' }, s);
    saveProfile({ name: '???' }, s);
    expect(loadCareer(s).name).toBeUndefined();
  });

  it('cycles the skins and wraps', () => {
    expect(nextSkin(0)).toBe(1);
    expect(nextSkin(SKINS.length - 1)).toBe(0);
    expect(nextSkin(1)).toBe(4); // past the retired rivals
  });

  it('survives a store holding nonsense', () => {
    const s = store();
    s.setItem('hbr:career', '{"name":42,"skin":"blue","wins":-3}');
    const career = loadCareer(s);
    expect(career.name).toBeUndefined();
    expect(career.skin).toBeUndefined();
    expect(career.wins).toBe(0);
  });
});

describe('the wardrobe', () => {
  it('starts with the two base trainers unlocked and the rivals locked', () => {
    expect(skinUnlocked(0, 0)).toBe(true);
    expect(skinUnlocked(1, 0)).toBe(true);
    expect(skinUnlocked(2, 0)).toBe(false);
    expect(skinUnlocked(3, 0)).toBe(false);
  });

  it('never unlocks the retired rivals, however many wins (POK-336)', () => {
    expect(skinUnlocked(2, 1000)).toBe(false);
    expect(skinUnlocked(3, 1000)).toBe(false);
    expect(WARDROBE).not.toContain(2);
    expect(WARDROBE).not.toContain(3);
  });

  it('names the next locked skin and how many wins it takes, or nothing once full', () => {
    expect(nextLockedSkin(0)).toEqual({ skin: 4, wins: 1 });
    expect(nextLockedSkin(1)).toEqual({ skin: 5, wins: 2 });
    expect(nextLockedSkin(25)).toBeNull();
  });

  it('dresses a career that wore a rival in the base sprite it copies', () => {
    const s = store();
    s.setItem('hbr:career', JSON.stringify({ matches: 4, wins: 3, skin: 3 }));
    expect(loadCareer(s).skin).toBe(1);
    s.setItem('hbr:career', JSON.stringify({ matches: 4, wins: 3, skin: 2 }));
    expect(loadCareer(s).skin).toBeUndefined(); // BRENDAN, the default
  });

  it('cycles past a locked skin rather than landing on it', () => {
    // At 0 wins only BRENDAN(0)/MAY(1) are unlocked.
    expect(nextSkin(0, 0)).toBe(1);
    expect(nextSkin(1, 0)).toBe(0); // wraps past both locked rivals
  });

  it('refuses to save a skin the win count has not earned', () => {
    const s = store();
    saveProfile({ skin: 5 }, s); // 0 wins: BEAUTY is locked
    expect(loadCareer(s).skin).toBeUndefined();
    recordMatch(1, s);
    saveProfile({ skin: 5 }, s); // 1 win: HIKER, not BEAUTY yet
    expect(loadCareer(s).skin).toBeUndefined();
    recordMatch(1, s); // 2 wins: BEAUTY unlocks
    saveProfile({ skin: 5 }, s);
    expect(loadCareer(s).skin).toBe(5);
  });
});

describe('the chosen voice', () => {
  it('is kept beside the record, and wraps like a skin', () => {
    const s = store();
    saveProfile({ voice: 1 }, s);
    expect(loadCareer(s).voice).toBe(1);
    saveProfile({ voice: VOICE_COUNT }, s); // wraps back to 0, which reads as unset
    expect(loadCareer(s).voice).toBeUndefined();
  });

  it('drops an out-of-range voice from a store holding nonsense', () => {
    const s = store();
    s.setItem('hbr:career', JSON.stringify({ voice: VOICE_COUNT + 5 }));
    expect(loadCareer(s).voice).toBeUndefined();
  });
});

describe('the career line', () => {
  it('reads as a record', () => {
    const s = store();
    recordMatch(1, s);
    expect(careerLine(loadCareer(s))).toContain('1 won');
  });
});

describe('the career as a file', () => {
  it('goes out and comes back', () => {
    const mine = store();
    saveProfile({ name: 'CAM', voice: 2 }, mine);
    recordMatch(1, mine);
    recordMatch(4, mine);
    const text = exportCareer(mine);
    expect(JSON.parse(text).tag).toBe(FILE_TAG);

    const theirs = store();
    const back = importCareer(text, theirs);
    // An old file's single `voice` is read back as the three lines it used to resolve
    // to (POK-283), so somebody who moves machines keeps saying what they said.
    expect(back).toMatchObject({ matches: 2, wins: 1, best: 1, name: 'CAM', voice: 2 });
    expect(lineAt(back!.intro!)).toBe(voiceOf(2).intro);
    expect(lineAt(back!.win!)).toBe(voiceOf(2).win);
    expect(lineAt(back!.lose!)).toBe(voiceOf(2).lose);
    expect(loadCareer(theirs)).toEqual(back);
  });

  it('refuses anything that is not one of ours', () => {
    const disk = store();
    expect(importCareer('{not json', disk)).toBeNull();
    expect(importCareer('null', disk)).toBeNull();
    expect(importCareer(JSON.stringify({ career: { wins: 9 } }), disk)).toBeNull();
    expect(importCareer(JSON.stringify({ tag: FILE_TAG }), disk)).toBeNull();
    // ...and nothing was written by any of that.
    expect(loadCareer(disk)).toEqual({ matches: 0, wins: 0 });
  });

  it('puts a hand-edited file through the same door a stored record goes through', () => {
    const disk = store();
    const back = importCareer(
      JSON.stringify({
        tag: FILE_TAG,
        career: { matches: -5, wins: 3, name: 'a very long name', voice: VOICE_COUNT + 9 },
      }),
      disk,
    );
    expect(back?.matches).toBe(0); // a negative count is not a count
    expect(back?.name).toBe('A VERY L'.slice(0, NAME_MAX));
    expect(back?.voice).toBeUndefined();
  });

  it('will not wear a skin the file has not earned', () => {
    const disk = store();
    const locked = SKIN_UNLOCK_WINS.findIndex((w) => w > 0);
    const back = importCareer(
      JSON.stringify({ tag: FILE_TAG, career: { matches: 1, wins: 0, skin: locked } }),
      disk,
    );
    expect(skinUnlocked(locked, 0)).toBe(false);
    expect(back?.skin).toBeUndefined();
    expect(SKINS[locked]).toBeDefined();
  });
});



// POK-282. Cam: "I should be able to pick kind of like any sprites -- the way Kanto
// Battle Royale has it, the amount of wins you get means you get more sprites. But in
// Kanto you're able to preview all the different skins even if you don't have all the
// wins yet."
describe('the wardrobe (POK-282)', () => {
  /** sSkinGraphics in src/br/br_ghosts.c, which is where the sprite really comes from.
   *  Read rather than mirrored: the two lists drifting apart is the whole failure mode,
   *  and it shows up as everybody wearing BRENDAN rather than as an error. */
  const romSkins = (): string[] => {
    const block = /static const u8 sSkinGraphics\[\] =\s*\{([^}]*)\}/.exec(ghostsSource);
    if (!block) throw new Error('sSkinGraphics not found in br_ghosts.c');
    return [...block[1].matchAll(/OBJ_EVENT_GFX_[A-Z0-9_]+/g)].map((m) => m[0]);
  };

  it('has exactly as many sprites as the ROM does', () => {
    expect(SKINS.length).toBe(romSkins().length);
  });

  it('prices every one of them', () => {
    expect(SKIN_UNLOCK_WINS.length).toBe(SKINS.length);
  });

  it('keeps sprites in pairs, a man then a woman', () => {
    // A skin index IS the gender on the wire -- br_netlink.c reads the peer's as
    // `skin & 1` -- so the list stays even, appended in pairs.
    expect(SKINS.length % 2).toBe(0);
  });

  it('staggers each pair, the man a rung before the woman (POK-338)', () => {
    const prices = WARDROBE.map((i) => SKIN_UNLOCK_WINS[i]);
    expect(prices).toEqual([0, 0, 1, 2, 4, 5, 9, 10, 13, 15, 18, 20, 23, 25]);
  });

  it('never gets cheaper further down the wardrobe', () => {
    for (let i = 1; i < WARDROBE.length; i++) {
      expect(SKIN_UNLOCK_WINS[WARDROBE[i]]).toBeGreaterThanOrEqual(SKIN_UNLOCK_WINS[WARDROBE[i - 1]]);
    }
  });

  it('keeps the first four where they were, because a career file stores the index', () => {
    // The NAMES and their positions are what a saved career depends on, the retired
    // rivals' included: they keep their index and are only out of the wardrobe.
    expect(SKINS.slice(0, 4)).toEqual(['BRENDAN', 'MAY', 'RIVAL BRENDAN', 'RIVAL MAY']);
    expect([...RETIRED_SKINS]).toEqual([2, 3]);
    expect(SKIN_UNLOCK_WINS.slice(0, 2)).toEqual([0, 0]);
  });

  it('gives a new trainer two to choose from and the rest to look at', () => {
    expect(skinUnlocked(0, 0)).toBe(true);
    expect(skinUnlocked(1, 0)).toBe(true);
    expect(skinUnlocked(2, 0)).toBe(false);
    expect(skinUnlocked(SKINS.length - 1, 0)).toBe(false);
  });

  it('browses every sprite, locked or not, and comes back round', () => {
    const seen = new Set<number>();
    let at = 0;
    for (let i = 0; i < WARDROBE.length; i++) {
      at = peekSkin(at);
      seen.add(at);
    }
    expect(seen.size).toBe(WARDROBE.length);
    expect(at).toBe(0);
  });

  it('says what a locked one costs, and says nothing about one you own', () => {
    expect(skinNote(0, 0)).toBe('your sprite');
    expect(skinNote(4, 0)).toBe('LOCKED -- 1 win');
    expect(skinNote(5, 0)).toBe('LOCKED -- 2 wins');
    expect(skinNote(4, 1)).toBe('your sprite');
  });

  it('still refuses to WEAR one that has not been earned', () => {
    // Browsing is not wearing: saveProfile is the backstop and stays shut.
    const s = store();
    saveProfile({ skin: SKINS.length - 1 }, s);
    expect(loadCareer(s).skin).toBeUndefined();
  });
});



// POK-283. Cam: "it should have three voices: your intro text, your win text -- what you
// say when you win -- and your lose text. And these should be a big list of essentially
// any NPC text in the game, so that you can use them however you want."
describe('MY VOICE (POK-283)', () => {
  it("is a big list, and it is the game's own words", () => {
    expect(LINE_COUNT).toBeGreaterThan(100);
    // Everything the ticker draws has to fit beside a name and a colon on a 40-wide line.
    for (const line of LINES) expect(line.length).toBeLessThanOrEqual(30);
  });

  it('has no line twice, which would read as a bug while cycling', () => {
    expect(new Set(LINES).size).toBe(LINES.length);
  });

  it('cycles one row without moving the other two', () => {
    const s = store();
    saveProfile({ intro: 4, win: 9, lose: 2 }, s);
    saveProfile({ win: nextLine(9) }, s);
    const after = loadCareer(s);
    expect(after.intro).toBe(4);
    expect(after.win).toBe(10);
    expect(after.lose).toBe(2);
  });

  it('wraps rather than running off the end', () => {
    const s = store();
    saveProfile({ intro: LINE_COUNT - 1 }, s);
    saveProfile({ intro: nextLine(LINE_COUNT - 1) }, s);
    // Stored as absent rather than as 0 -- `sane` keeps only a positive index, the same
    // convention `skin` and `voice` use -- and absent IS the first line.
    expect(loadCareer(s).intro ?? 0).toBe(0);
  });

  it('turns an old single-voice career into the three lines it was saying', () => {
    const s = store();
    s.setItem('hbr:career', JSON.stringify({ matches: 1, wins: 0, voice: 3 }));
    const career = loadCareer(s);
    expect(lineAt(career.intro ?? 0)).toBe(voiceOf(3).intro);
    expect(lineAt(career.win ?? 0)).toBe(voiceOf(3).win);
    expect(lineAt(career.lose ?? 0)).toBe(voiceOf(3).lose);
  });
});
