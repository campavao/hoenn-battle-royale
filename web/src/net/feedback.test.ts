import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEEDBACK_MAX, cleanNote, sendFeedback, type FeedbackMsg } from './feedback';
import type { WebSocketLike } from './relay';

class Socket implements WebSocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: unknown[] = [];
  closed = false;
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.closed = true;
  }
  say(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const NOTE: FeedbackMsg = { type: 'feedback', text: 'the ferry softlocked', v: 'patch 0.3.15', where: 'menu', name: 'MAY' };

function opened(): { socket: Socket; url: string[]; open: (u: string) => Socket } {
  const socket = new Socket();
  const url: string[] = [];
  return { socket, url, open: (u) => (url.push(u), socket) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('cleanNote', () => {
  it('keeps one line of what was typed, trimmed', () => {
    expect(cleanNote('  the ferry\n\nsoftlocked\tagain  ')).toBe('the ferry softlocked again');
    expect(cleanNote(' \n ')).toBe('');
  });

  it('cuts at the relay cap without splitting an emoji', () => {
    expect(Array.from(cleanNote('😀'.repeat(FEEDBACK_MAX + 5)))).toHaveLength(FEEDBACK_MAX);
    expect(cleanNote('😀'.repeat(FEEDBACK_MAX + 5)).endsWith('😀')).toBe(true);
  });
});

describe('sendFeedback', () => {
  it('sends the note once the socket opens, and resolves sent on feedback_ok', async () => {
    const { socket, url, open } = opened();
    const done = sendFeedback('wss://relay.test', NOTE, open);
    expect(socket.sent).toEqual([]);
    socket.onopen?.({});
    expect(url).toEqual(['wss://relay.test']);
    expect(socket.sent).toEqual([NOTE]);
    // the boot info push is not the answer
    socket.say({ type: 'info', motd: [] });
    socket.say({ type: 'feedback_ok' });
    expect(await done).toBe('sent');
    expect(socket.closed).toBe(true);
  });

  it('passes on what the relay refused it for', async () => {
    for (const [reason, want] of [['busy', 'busy'], ['full', 'full'], ['empty', 'empty'], ['other', 'failed']] as const) {
      const { socket, open } = opened();
      const done = sendFeedback('wss://relay.test', NOTE, open);
      socket.onopen?.({});
      socket.say({ type: 'feedback_error', reason });
      expect(await done).toBe(want);
    }
  });

  it('fails when the socket closes or errors first', async () => {
    const a = opened();
    const closed = sendFeedback('wss://relay.test', NOTE, a.open);
    a.socket.onclose?.({});
    expect(await closed).toBe('failed');
    const b = opened();
    const errored = sendFeedback('wss://relay.test', NOTE, b.open);
    b.socket.onerror?.({});
    expect(await errored).toBe('failed');
  });

  it('fails when nothing answers in time (an older relay ignores the type)', async () => {
    vi.useFakeTimers();
    const { socket, open } = opened();
    const done = sendFeedback('wss://relay.test', NOTE, open, 8000);
    socket.onopen?.({});
    vi.advanceTimersByTime(7999);
    socket.say({ type: 'info' });
    vi.advanceTimersByTime(1);
    expect(await done).toBe('failed');
    expect(socket.closed).toBe(true);
  });

  it('fails, not throws, when the socket cannot even be made', async () => {
    const done = sendFeedback('not a url', NOTE, () => {
      throw new SyntaxError('bad url');
    });
    expect(await done).toBe('failed');
  });
});
