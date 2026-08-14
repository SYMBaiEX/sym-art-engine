import { describe, expect, it } from 'vitest';
import { createRng, pickWeighted } from '../src/utils/prng.js';

describe('deterministic PRNG', () => {
  it('produces the identical stream for the same seed', () => {
    const a = createRng('SYMBIES_GENESIS');
    const b = createRng('SYMBIES_GENESIS');
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });

  it('diverges for different seeds', () => {
    const a = createRng('seed-a');
    const b = createRng('seed-b');
    const streamA = Array.from({ length: 10 }, () => a());
    const streamB = Array.from({ length: 10 }, () => b());
    expect(streamA).not.toEqual(streamB);
  });

  it('stays within [0,1)', () => {
    const rng = createRng('range');
    for (let i = 0; i < 10000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('respects weights over many draws', () => {
    const rng = createRng('weights');
    const items = [
      { id: 'common', weight: 900 },
      { id: 'rare', weight: 100 },
    ];
    let rare = 0;
    const draws = 10000;
    for (let i = 0; i < draws; i++) {
      if (pickWeighted(rng, items, (x) => x.weight).id === 'rare') rare++;
    }
    // Expect ~10% ± 1.5% (deterministic given the fixed seed)
    expect(rare / draws).toBeGreaterThan(0.085);
    expect(rare / draws).toBeLessThan(0.115);
  });
});
