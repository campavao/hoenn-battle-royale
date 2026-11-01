// The ticker's lines waiting their turn (main.ts hudFrame shows the next): six at most,
// and never the same line twice running, as Kanto's Ticker.push drops a repeat of the
// last (/classic/'s match/ticker.ts once()).

export interface Tick { text: string; alert: boolean }

export class Ticks {
  private readonly queue: Tick[] = [];
  private last = '';

  push(text: string, alert = false): void {
    if (text === this.last || this.queue.length >= 6) return;
    this.last = text;
    this.queue.push({ text, alert });
  }

  shift(): Tick | undefined {
    return this.queue.shift();
  }

  get length(): number {
    return this.queue.length;
  }

  /** A new round: nothing waiting, and its first line is said whatever the last was. */
  clear(): void {
    this.queue.length = 0;
    this.last = '';
  }
}
