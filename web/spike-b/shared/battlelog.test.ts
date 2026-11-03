import { describe, expect, it } from 'vitest';
import { applyEvent, emptyState, eventMs, logMs, stateAt, type BattleEvent, type LogMon } from './battlelog';

const mon = (species: number, hp = 50): LogMon => ({ species, level: 30, hp, maxHp: 50, status: 0 });
const side = (seat: number, ...team: LogMon[]) => ({ seat, name: `T${seat}`, skin: 0, team });
const LOG: BattleEvent[] = [
  { e: 'start', a: side(2, mon(25), mon(1)), b: side(3, mon(4)), map: 'MAP_ROUTE101' },
  { e: 'send', side: 0, slot: 0 },
  { e: 'send', side: 1, slot: 0 },
  { e: 'text', text: 'PIKACHU used THUNDERBOLT!' },
  { e: 'hit', side: 1, move: 85 },
  { e: 'hp', side: 1, hp: 0 },
  { e: 'faint', side: 1 },
  { e: 'end', winner: 2 },
];

describe('a battle log', () => {
  it('plays to the state it describes', () => {
    const s = LOG.reduce(applyEvent, emptyState());
    expect(s.active).toEqual([0, -1]);
    expect(s.b!.team[0].hp).toBe(0);
    expect(s.a!.team[0].hp).toBe(50);
    expect(s.winner).toBe(2);
    expect(s.text).toBe('PIKACHU used THUNDERBOLT!');
  });

  it("doesn't change the start event it was handed", () => {
    LOG.reduce(applyEvent, emptyState());
    expect((LOG[0] as Extract<BattleEvent, { e: 'start' }>).b.team[0].hp).toBe(50);
  });

  it('a late watcher is dropped in where it stands', () => {
    const upTo = (n: number) => LOG.slice(0, n).reduce((t, ev) => t + eventMs(ev), 0);
    const at = stateAt(LOG, upTo(5));
    expect(at.next).toBe(5);
    expect(at.state.b!.team[0].hp).toBe(50);
    expect(stateAt(LOG, upTo(6)).state.b!.team[0].hp).toBe(0);
    expect(stateAt(LOG, logMs(LOG) + 1).state.winner).toBe(2);
    expect(stateAt(LOG, 0).next).toBe(0);
  });

  it('a long line holds longer than a short one', () => {
    expect(eventMs({ e: 'text', text: 'x'.repeat(80) })).toBeGreaterThan(eventMs({ e: 'text', text: 'x' }));
  });

  it('survives events out of order, since a network brings them', () => {
    const s = emptyState();
    for (const ev of [{ e: 'hp', side: 0, hp: 1 }, { e: 'send', side: 1, slot: 9 }, { e: 'faint', side: 0 }, { e: 'status', side: 1, status: 1 }] as BattleEvent[]) applyEvent(s, ev);
    expect(s.active).toEqual([-1, -1]);
    const started = applyEvent(emptyState(), LOG[0]);
    applyEvent(started, { e: 'send', side: 0, slot: 0 });
    applyEvent(started, { e: 'hp', side: 0, hp: 999 });
    expect(started.a!.team[0].hp).toBe(50);
    applyEvent(started, { e: 'hp', side: 0, hp: -5 });
    expect(started.a!.team[0].hp).toBe(0);
  });
});
