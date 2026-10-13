// A hidden host's room comes off the list after a while, and goes back on when the tab is
// looked at again (away.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AwayDoor } from './away';

const AWAY = 60_000;

function door(page: { waiting: boolean; listed: boolean }) {
  const sent: boolean[] = [];
  const d = new AwayDoor({
    awayMs: AWAY,
    waitingOnUs: () => page.waiting,
    listed: () => page.listed,
    setOpen: (open) => {
      sent.push(open);
      page.listed = open;
    },
  });
  return { d, sent };
}

describe('a host away from its room', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('takes the room off the list once hidden long enough, and puts it back on return', () => {
    const { d, sent } = door({ waiting: true, listed: true });
    d.hidden();
    vi.advanceTimersByTime(AWAY - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([false]);
    d.shown(true);
    expect(sent).toEqual([false, true]);
  });

  it('leaves the list alone for a quick look away', () => {
    const { d, sent } = door({ waiting: true, listed: true });
    d.hidden();
    vi.advanceTimersByTime(AWAY / 2);
    d.shown(true);
    vi.advanceTimersByTime(AWAY * 2);
    expect(sent).toEqual([]);
  });

  it('does nothing while a match is on, or to a room the host had closed', () => {
    const inMatch = door({ waiting: false, listed: true });
    inMatch.d.hidden();
    vi.advanceTimersByTime(AWAY);
    inMatch.d.shown(true);
    expect(inMatch.sent).toEqual([]);

    const closed = door({ waiting: true, listed: false });
    closed.d.hidden();
    vi.advanceTimersByTime(AWAY);
    closed.d.shown(true);
    // A door the host closed stays closed: only what this took off goes back on.
    expect(closed.sent).toEqual([]);
  });

  it('opens no door for a page that is no longer the host', () => {
    const { d, sent } = door({ waiting: true, listed: true });
    d.hidden();
    vi.advanceTimersByTime(AWAY);
    d.shown(false);
    expect(sent).toEqual([false]);
  });

  it('arms once however many times the tab is hidden', () => {
    const { d, sent } = door({ waiting: true, listed: true });
    d.hidden();
    vi.advanceTimersByTime(AWAY / 2);
    d.hidden();
    vi.advanceTimersByTime(AWAY / 2);
    expect(sent).toEqual([false]);
    d.hidden();
    vi.advanceTimersByTime(AWAY);
    expect(sent).toEqual([false]);
  });
});
