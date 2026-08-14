import { beforeAll, describe, expect, it } from 'vitest';
import { loadProject, type LoadedProject } from '../src/config/loadProject.js';
import { selectEdition } from '../src/engine/selector.js';
import { createRng } from '../src/utils/prng.js';
import { createFixtureProject } from './helpers/fixtureProject.js';

let project: LoadedProject;

beforeAll(async () => {
  project = loadProject(await createFixtureProject());
});

describe('seeded trait selection', () => {
  it('is fully deterministic for the same seed', () => {
    const runs = [0, 1].map(() => {
      const rng = createRng('determinism');
      const picks: string[] = [];
      for (let i = 0; i < 50; i++) {
        const result = selectEdition(project, rng, new Map());
        expect(result.ok).toBe(true);
        if (result.ok) {
          picks.push([...result.traits.values()].map((t) => t.id).join(','));
        }
      }
      return picks;
    });
    expect(runs[0]).toEqual(runs[1]);
  });

  it('honors rarity weights across many selections', () => {
    const rng = createRng('weights-selection');
    let capCount = 0;
    const draws = 2000;
    for (let i = 0; i < draws; i++) {
      const result = selectEdition(project, rng, new Map());
      if (result.ok && result.traits.get('hat')?.id === 'hat_cap') capCount++;
    }
    // cap weight 600 / (600+100+300) = 60%, but crown is sometimes blocked
    // by the exclusive group / requires — allow a generous band.
    expect(capCount / draws).toBeGreaterThan(0.5);
    expect(capCount / draws).toBeLessThan(0.75);
  });

  it('selects None traits as first-class values', () => {
    const rng = createRng('none-selection');
    let none = 0;
    for (let i = 0; i < 500; i++) {
      const result = selectEdition(project, rng, new Map());
      if (result.ok && result.traits.get('aura')?.none) none++;
    }
    expect(none).toBeGreaterThan(100);
  });

  it('never produces a rule-violating combination', () => {
    const rng = createRng('legality');
    for (let i = 0; i < 300; i++) {
      const result = selectEdition(project, rng, new Map());
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const hat = result.traits.get('hat');
      const aura = result.traits.get('aura');
      // cap only allows soft/none auras
      if (hat?.id === 'hat_cap') {
        expect(['aura_soft', 'aura_none']).toContain(aura?.id);
      }
      // crown excludes soft aura (exclusive group) and chaos (conditional)
      if (hat?.id === 'hat_crown') {
        expect(aura?.id).toBe('aura_none');
      }
    }
  });

  it('enforces max occurrence caps', () => {
    const rng = createRng('occurrence');
    const occurrence = new Map<string, number>();
    let crowns = 0;
    for (let i = 0; i < 200; i++) {
      const result = selectEdition(project, rng, occurrence);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      for (const trait of result.traits.values()) {
        occurrence.set(trait.id, (occurrence.get(trait.id) ?? 0) + 1);
      }
      if (result.traits.get('hat')?.id === 'hat_crown') crowns++;
    }
    expect(crowns).toBeLessThanOrEqual(2); // crown rarity.max = 2
  });
});
