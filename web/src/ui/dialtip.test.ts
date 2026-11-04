import { describe, expect, it } from 'vitest';
import { DIAL_TIP_SHOWS, dialKnown, dialTipDue, dialTipShown, dialTipWords } from './dialtip';

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('the dial\'s word', () => {
  it('says so a few times and then stops', () => {
    const s = store();
    for (let i = 0; i < DIAL_TIP_SHOWS; i++) {
      expect(dialTipDue(s)).toBe(true);
      dialTipShown(s);
    }
    expect(dialTipDue(s)).toBe(false);
  });

  it('stops at once when the dial has been opened', () => {
    const s = store();
    dialKnown(s);
    expect(dialTipDue(s)).toBe(false);
  });

  it('keeps quiet with no storage, rather than saying so every match', () => {
    const none = { getItem: () => { throw new Error('private'); }, setItem: () => { throw new Error('private'); } };
    expect(dialTipDue(none)).toBe(false);
    expect(() => dialTipShown(none)).not.toThrow();
  });

  it('names what is driving', () => {
    expect(dialTipWords('touch', 'c')).toBe('Hold for key items');
    expect(dialTipWords('keys', 'c')).toBe('Hold C for key items');
    expect(dialTipWords('pad', 'c')).toContain('trigger');
  });
});
