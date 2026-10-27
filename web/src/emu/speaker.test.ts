import { describe, expect, it } from 'vitest';
import { CutDetector, RING_FRAMES, RING_HEADER_U32, RING_LEAD, RING_READ, RING_WRITE, RingReader } from './speaker';

/** A ring over shared memory, as the core leaves it, with a lead of `lead` frames. */
function ring(lead: number) {
  const memory = new SharedArrayBuffer(RING_HEADER_U32 * 4 + RING_FRAMES * 4);
  const header = new Uint32Array(memory, 0, RING_HEADER_U32);
  const samples = new Int16Array(memory, RING_HEADER_U32 * 4, RING_FRAMES * 2);
  header[RING_LEAD] = lead;
  /** The core writes `n` frames, each left = right = `value`. */
  const write = (n: number, value = 16384) => {
    let w = header[RING_WRITE];
    for (let i = 0; i < n; i++, w = (w + 1) >>> 0) {
      samples[(w % RING_FRAMES) * 2] = value;
      samples[(w % RING_FRAMES) * 2 + 1] = value;
    }
    header[RING_WRITE] = w;
  };
  return { header, reader: new RingReader(header, samples), write };
}

const quantum = () => [new Float32Array(128), new Float32Array(128)] as const;

describe('the speaker reading the core\'s sound ring (HBR-59)', () => {
  it('waits for a lead of sound, then plays it', () => {
    const { reader, write } = ring(256);
    const [l, r] = quantum();
    write(200);
    expect(reader.play(l, r, false)).toEqual({ frames: 0, under: false, skipped: 0 });
    expect(l.every((v) => v === 0)).toBe(true);
    write(100);
    expect(reader.play(l, r, false)).toEqual({ frames: 128, under: false, skipped: 0 });
    expect(l[0]).toBe(0.5);
    expect(r[127]).toBe(0.5);
  });

  it('runs dry: a gap, the rest silence, then a lead again before it plays', () => {
    const { reader, write } = ring(128);
    const [l, r] = quantum();
    write(200);
    reader.play(l, r, false);
    expect(reader.play(l, r, false)).toEqual({ frames: 72, under: true, skipped: 0 });
    expect(l[71]).toBe(0.5);
    expect(l[72]).toBe(0);
    write(100);
    expect(reader.play(l, r, false).frames).toBe(0);
  });

  it('rides out a burst of the core\'s catch-up without skipping', () => {
    const { reader, write } = ring(256);
    const [l, r] = quantum();
    write(256 + 4 * 128);
    expect(reader.play(l, r, false).skipped).toBe(0);
  });

  it('skips to the newest lead when the ring filled while nobody played it', () => {
    const { header, reader, write } = ring(256);
    const [l, r] = quantum();
    write(1000, 1000);
    write(256, 16384);
    expect(reader.play(l, r, false)).toEqual({ frames: 128, under: false, skipped: 1000 });
    expect(l[0]).toBe(0.5);
    expect(header[RING_READ]).toBe(1000 + 128);
  });

  it('plays nothing and counts nothing paused, and waits for a lead after', () => {
    const { header, reader, write } = ring(256);
    const [l, r] = quantum();
    write(300);
    reader.play(l, r, false);
    expect(reader.play(l, r, true)).toEqual({ frames: 0, under: false, skipped: 0 });
    expect(header[RING_READ]).toBe(128);
    expect(reader.play(l, r, false).frames).toBe(0);
    write(100);
    expect(reader.play(l, r, false).frames).toBe(128);
  });

  it('counts through the u32 wrap', () => {
    const { header, reader, write } = ring(256);
    const [l, r] = quantum();
    header[RING_WRITE] = 0xffffff00;
    header[RING_READ] = 0xffffff00;
    write(400);
    expect(reader.play(l, r, false).frames).toBe(128);
    expect(header[RING_READ]).toBe(0xffffff80);
  });
});

describe('a cut across quanta', () => {
  it('is sound that stops dead, even when the silence starts in the next quantum', () => {
    const cuts = new CutDetector();
    const [l, r] = quantum();
    l.fill(0.25);
    r.fill(0.25);
    expect(cuts.feed(l, r)).toBe(false);
    l.fill(0);
    r.fill(0);
    expect(cuts.feed(l, r)).toBe(true);
    expect(cuts.feed(l, r)).toBe(false);
  });

  it('is not quiet music fading out', () => {
    const cuts = new CutDetector();
    const [l, r] = quantum();
    l.fill(1 / 4096);
    r.fill(1 / 4096);
    cuts.feed(l, r);
    l.fill(0);
    r.fill(0);
    expect(cuts.feed(l, r)).toBe(false);
  });
});
