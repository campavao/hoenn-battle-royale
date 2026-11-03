// A log off the wire: rebuilt event by event, the bad ones dropped, never a throw.
import { describe, expect, it } from 'vitest';
import { chunkEvents, cleanEvent, cleanEvents, LOG_MSG_CHARS, LOG_MSG_EVENTS, LOG_TEXT_MAX } from './logwire';

const mon = { species: 280, level: 12, hp: 31, maxHp: 31, status: 0 };
const side = { seat: 1001, name: 'CAM', skin: 3, team: [mon] };

describe('cleanEvents', () => {
  it('lets every kind of event through as it is', () => {
    const log = [
      { e: 'start', a: side, b: { ...side, seat: 0, name: '' }, map: 'MAP_ROUTE101' },
      { e: 'send', side: 0, slot: 0 }, { e: 'back', side: 1 }, { e: 'text', text: 'Foe GLOOM used TOXIC!' },
      { e: 'hit', side: 1, move: 92 }, { e: 'hit', side: 0 }, { e: 'hp', side: 1, hp: 12 }, { e: 'status', side: 1, status: 0x80 },
      { e: 'faint', side: 1 }, { e: 'end', winner: 1001 },
    ];
    expect(cleanEvents(JSON.parse(JSON.stringify(log)))).toEqual(log);
  });

  it('drops what is not an event, whatever it is, without throwing', () => {
    const bad: unknown[] = [null, undefined, 7, 'x', [], {}, { e: 'nope' }, { e: 'send', side: 2, slot: 0 }, { e: 'send', side: 0, slot: 9 },
      { e: 'send', side: 0, slot: 1.5 }, { e: 'hp', side: 0, hp: -1 }, { e: 'hp', side: 0, hp: 'lots' }, { e: 'text', text: 5 }, { e: 'text', text: '' },
      { e: 'start', a: null, b: side, map: 'x' }, { e: 'start', a: side, b: side }, { e: 'start', a: { ...side, team: 'no' }, b: side, map: 'x' },
      { e: 'start', a: { ...side, team: Array(7).fill(mon) }, b: side, map: 'x' }, { e: 'start', a: { ...side, team: [{ species: 0 }] }, b: side, map: 'x' },
      { e: 'end', winner: -3 }, { e: 'end' }, { e: 'faint' }];
    expect(cleanEvents(bad)).toEqual([]);
    for (const junk of [null, undefined, 'nothing', 5, {}]) expect(cleanEvents(junk)).toEqual([]);
  });

  it('keeps the good among the bad, in order', () => {
    expect(cleanEvents([{ e: 'send', side: 0, slot: 0 }, { e: 'wat' }, null, { e: 'faint', side: 0 }])).toEqual([{ e: 'send', side: 0, slot: 0 }, { e: 'faint', side: 0 }]);
  });

  it('rebuilds each from its own fields: nothing extra rides in', () => {
    const ev = cleanEvent({ e: 'text', text: 'Hi', evil: '<script>', __proto__: { x: 1 } });
    expect(ev).toEqual({ e: 'text', text: 'Hi' });
    expect(cleanEvent({ e: 'start', a: { ...side, extra: 1 }, b: side, map: 'm', more: 2 })).not.toHaveProperty('more');
  });

  it('caps text, strips control characters, and caps the events of a message', () => {
    const t = cleanEvent({ e: 'text', text: 'a\u0000b\nc' + 'x'.repeat(500) }) as { text: string };
    expect(t.text.length).toBeLessThanOrEqual(LOG_TEXT_MAX);
    expect(t.text).not.toMatch(/[\u0000-\u001f]/);
    const many = cleanEvents(Array.from({ length: 5000 }, () => ({ e: 'faint', side: 0 })));
    expect(many).toHaveLength(LOG_MSG_EVENTS);
    expect(cleanEvents(Array.from({ length: 5000 }, () => ({ e: 'faint', side: 0 })), 3000)).toHaveLength(3000);
  });

  it('keeps an HP inside the mon, and a sane name', () => {
    const s = cleanEvent({ e: 'start', a: { ...side, name: 'N'.repeat(100), team: [{ ...mon, hp: 500, maxHp: 40 }] }, b: side, map: 'm' }) as { a: { name: string; team: { hp: number }[] } };
    expect(s.a.team[0].hp).toBe(40);
    expect(s.a.name.length).toBeLessThanOrEqual(24);
  });
});

describe('chunkEvents', () => {
  it('cuts a log into messages that each fit the relay\'s 4096-byte frame, in order, losing nothing', () => {
    const big = { ...mon, nickname: 'NICKNAMEXX', shiny: true, gender: 1 };
    const start = { e: 'start', a: { ...side, team: Array(6).fill(big) }, b: { ...side, team: Array(6).fill(big) }, map: 'MAP_SOOTOPOLIS_CITY_GYM_1F' } as const;
    const log = [start, ...Array.from({ length: 300 }, (_, i) => ({ e: 'text', text: 'Line ' + i + ' ' + 'z'.repeat(i % 150) }) as const)];
    const runs = chunkEvents(log as never);
    expect(runs.flat()).toEqual(log);
    for (const run of runs) {
      expect(JSON.stringify({ t: 'bl', f: 65535, events: run }).length).toBeLessThanOrEqual(LOG_MSG_CHARS);
      expect(run.length).toBeLessThanOrEqual(LOG_MSG_EVENTS);
    }
    expect(runs.length).toBeGreaterThan(1);
    expect(JSON.stringify({ t: 'bl', f: 1, events: [start] }).length, 'a start of two full teams is one small message').toBeLessThan(2500);
    expect(chunkEvents([])).toEqual([]);
  });
});