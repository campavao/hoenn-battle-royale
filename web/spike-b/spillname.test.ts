import { describe, expect, it } from 'vitest';
import { spillName } from './spillname';

const item = (id: number) => (id === 7 ? 'GOLD BALL' : '');
const bag = (over: object) => ({ name: '', bag: { items: [], money: 0, ...over } });

describe('what a piece on the ground is called', () => {
  it("an event's pieces say what is in them, never \"'s bag\" (Cam, 11-10)", () => {
    expect(spillName(bag({ mons: [{ species: 1, level: 5 }] }), "'s bag", item)).toBe('BULBASAUR');
    expect(spillName(bag({ items: [{ id: 7, n: 1 }] }), "'s bag", item)).toBe('GOLD BALL');
    expect(spillName(bag({ items: [{ id: 7, n: 1 }, { id: 8, n: 3 }] }), "'s bag", item)).toBe('Supplies');
    expect(spillName(bag({ items: [{ id: 7, n: 1 }, { id: 8, n: 3 }] }), "'s BAG", item)).toBe('SUPPLIES');
  });
  it("a trainer's bag is still theirs", () => {
    expect(spillName({ name: 'MAY', bag: { items: [{ id: 7, n: 1 }, { id: 8, n: 3 }], money: 0 } }, "'s bag", item)).toBe("MAY's bag");
  });
});
