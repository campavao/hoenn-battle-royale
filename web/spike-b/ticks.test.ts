import { describe, expect, it } from 'vitest';
import { Ticks } from './ticks';

describe("spike B's ticker lines", () => {
  it('drops a repeat of the last line, as Kanto\'s Ticker.push does', () => {
    const t = new Ticks();
    t.push('MAY wins!');
    t.push('MAY wins!');
    t.push('Catch what you can! 5s');
    t.push('MAY wins!');
    const said: string[] = [];
    for (let x = t.shift(); x; x = t.shift()) said.push(x.text);
    expect(said).toEqual(['MAY wins!', 'Catch what you can! 5s', 'MAY wins!']);
  });

  it('a repeat is dropped even once the first has been shown', () => {
    const t = new Ticks();
    t.push('The fog is coming!', true);
    expect(t.shift()).toEqual({ text: 'The fog is coming!', alert: true });
    t.push('The fog is coming!', true);
    expect(t.length).toBe(0);
  });

  it('holds six at most, and a new round starts clean', () => {
    const t = new Ticks();
    for (let i = 0; i < 9; i++) t.push(`line ${i}`);
    expect(t.length).toBe(6);
    t.clear();
    expect(t.length).toBe(0);
    t.push('line 5');
    expect(t.length).toBe(1);
  });
});
