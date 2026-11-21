import { describe, expect, it } from 'vitest';
import { seen, seenUrl, type SeenStep } from './seen';

function deps(quiet = false) {
  const map = new Map<string, string>();
  const sent: SeenStep[] = [];
  return {
    sent,
    map,
    d: { store: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }, send: (s: SeenStep) => void sent.push(s), quiet },
  };
}

describe('the way in, counted (Cam, 11-21: conversion)', () => {
  it('sends each step once per browser, and nothing past the landing without it', () => {
    const { d, sent } = deps();
    expect(seen('rom', d), 'a ROM from before this shipped is not a newcomer').toBe(false);
    expect(seen('landing', d)).toBe(true);
    expect(seen('landing', d)).toBe(false);
    seen('ask', d);
    seen('bad-game', d);
    seen('ask', d);
    seen('rom', d);
    seen('match', d);
    seen('match', d);
    expect(sent).toEqual(['landing', 'ask', 'bad-game', 'rom', 'match']);
  });

  it('sends nothing from a test or a dev build, or for a player with play stats off', () => {
    const quiet = deps(true);
    expect(seen('landing', quiet.d)).toBe(false);
    const off = deps();
    off.map.set('hbr:stats', JSON.stringify({ solo: 0, off: true }));
    expect(seen('landing', off.d) && off.sent.length).toBeFalsy();
  });

  it("posts to the relay's own address over http", () => {
    expect(seenUrl('wss://hoenn-relay-production.up.railway.app')).toBe('https://hoenn-relay-production.up.railway.app/seen');
    expect(seenUrl('ws://localhost:7790')).toBe('http://localhost:7790/seen');
  });
});
