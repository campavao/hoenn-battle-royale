import { describe, expect, it } from 'vitest';
import { guessedStickKeys, learnAxis, loadStickMap, stickKeys, type StickMap } from './pad';

describe('a learned stick (POK-321)', () => {
  // Cam's pad: the stick's vertical is axis 0 and its horizontal axis 1, the reverse of
  // the standard layout, and pushing up reads negative.
  const rest = [0, 0, 0.2, -1];
  const learned: StickMap = { up: { axis: 0, sign: -1 }, right: { axis: 1, sign: 1 } };

  it('is learned from whichever axis moves, in whichever direction', () => {
    expect(learnAxis([-0.9, 0, 0.2, -1], rest)).toEqual({ axis: 0, sign: -1 });
    expect(learnAxis([0, 0.8, 0.2, -1], rest)).toEqual({ axis: 1, sign: 1 });
    expect(learnAxis([0.1, -0.2, 0.2, -1], rest), 'nothing past half throw').toBeNull();
    expect(learnAxis([0, 0, 0.2, -1, 0, 0, 0, 0, 0, 1], [0, 0, 0.2, -1, 0, 0, 0, 0, 0, 1.29]), 'the hat is not a stick').toBeNull();
  });

  it('reads the directions off the learned axes and nothing else', () => {
    expect(stickKeys([-0.9, 0, 0.2, -1], rest, learned)).toEqual(['up']);
    expect(stickKeys([0.9, 0, 0.2, -1], rest, learned)).toEqual(['down']);
    expect(stickKeys([0, 0.9, 0.2, -1], rest, learned)).toEqual(['right']);
    expect(stickKeys([-0.7, -0.7, 0.2, -1], rest, learned)).toEqual(['up', 'left']);
    expect(stickKeys([0, 0, 0.9, 0.9], rest, learned), 'a trigger or a second stick').toEqual([]);
  });

  it('the guess, without a lesson, is the standard layout', () => {
    expect(guessedStickKeys([-0.9, 0, 0.2, -1], rest).keys, 'and it is what Cam saw: up reads as left').toEqual(['left']);
    expect(guessedStickKeys([0, 0.9, 0.2, -1], rest)).toEqual({ keys: ['down'], moved: ['1+'] });
  });

  it('loads only a well-formed lesson', () => {
    const store = (v: string | null) => ({ getItem: () => v });
    expect(loadStickMap(store(JSON.stringify(learned)))).toEqual(learned);
    expect(loadStickMap(store('{"up":{"axis":0}}'))).toBeNull();
    expect(loadStickMap(store('nonsense'))).toBeNull();
    expect(loadStickMap(store(null))).toBeNull();
    expect(loadStickMap(null)).toBeNull();
  });
});
