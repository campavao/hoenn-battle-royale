import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRomPicture, onRomPictures, romPicture, romPicturesChanged, useRomPictures, type Cutter } from './pictures';

/** A stand-in canvas of a size: the module reads only width and height. */
const canvas = (w: number, h: number) => ({ width: w, height: h }) as HTMLCanvasElement;

afterEach(() => useRomPictures(null));

describe("the game's pictures, cut from the player's ROM", () => {
  it('knows which paths are the ROM pictures the site used to ship', () => {
    for (const p of ['/ui/font-normal.png', '/field-maps/MAP_LITTLEROOT_TOWN.cover.png', '/field-maps/fill/3_4.png', '/field-sprites/fog.png', '/mon-pics/25s.png', '/trainer-pics/71.png']) {
      expect(isRomPicture(p), p).toBe(true);
    }
    for (const p of ['/assets/howto-sheet-1a2b.png', '/og.png', '/icon.svg', '/patch/br-version.json']) expect(isRomPicture(p), p).toBe(false);
  });

  it('has nothing before the ROM, and tells whoever waited when it comes', () => {
    expect(romPicture('/ui/frame-1.png')).toBeUndefined();
    const told = vi.fn();
    const stop = onRomPictures(told);
    useRomPictures((p) => (p === '/ui/frame-1.png' ? canvas(24, 24) : null));
    expect(told).toHaveBeenCalledTimes(1);
    expect(romPicture('/ui/frame-1.png')?.width).toBe(24);
    expect(romPicture('/ui/nothing.png'), 'the ROM has none').toBeNull();
    stop();
  });

  it('cuts each picture once, and asks again for one whose data was still loading', () => {
    let ready = false;
    const cut = vi.fn<Cutter>((p) => (p.includes('fill') && !ready ? undefined : canvas(16, 16)));
    useRomPictures(cut);
    romPicture('/field-sprites/0.png');
    romPicture('/field-sprites/0.png');
    expect(cut).toHaveBeenCalledTimes(1);
    expect(romPicture('/field-maps/fill/1_1.png')).toBeUndefined();
    ready = true;
    romPicturesChanged();
    expect(romPicture('/field-maps/fill/1_1.png')?.width).toBe(16);
  });

  it('keeps only the most recently drawn of the big pictures (a phone tab has a canvas budget)', () => {
    const cut = vi.fn<Cutter>(() => canvas(1280, 1280));
    useRomPictures(cut);
    for (let i = 0; i < 6; i++) romPicture(`/field-maps/MAP_${i}.png`);
    expect(cut).toHaveBeenCalledTimes(6);
    romPicture('/field-maps/MAP_5.png');
    expect(cut, 'the last one is kept').toHaveBeenCalledTimes(6);
    romPicture('/field-maps/MAP_0.png');
    expect(cut, 'the first one went').toHaveBeenCalledTimes(7);
  });

  it('a cut that throws is a picture the ROM does not have, not a broken page', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    useRomPictures(() => { throw new Error('bad table'); });
    expect(romPicture('/ui/types.png')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
