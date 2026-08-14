import { beforeAll, describe, expect, it } from 'vitest';
import { loadProject, type LoadedProject } from '../src/config/loadProject.js';
import { canonicalDnaSource, dnaHash } from '../src/engine/dna.js';
import type { Trait } from '../src/schemas/trait.js';
import { createFixtureProject } from './helpers/fixtureProject.js';

let project: LoadedProject;

const pick = (ids: Record<string, string>): Map<string, Trait> => {
  const map = new Map<string, Trait>();
  for (const [category, id] of Object.entries(ids)) {
    map.set(category, project.traitById.get(id) as Trait);
  }
  return map;
};

beforeAll(async () => {
  project = loadProject(await createFixtureProject());
});

describe('canonical DNA', () => {
  it('is built from trait ids in category order', () => {
    const source = canonicalDnaSource(
      pick({
        aura: 'aura_chaos',
        background: 'bg_red',
        hat: 'hat_cap',
        body: 'body_blue',
      }),
      project,
    );
    expect(source).toBe(
      'background=bg_red\nbody=body_blue\nhat=hat_cap\naura=aura_chaos',
    );
  });

  it('excludes None traits from DNA when the category opts out', () => {
    // aura has includeNoneInDna=false; hat keeps None in DNA
    const source = canonicalDnaSource(
      pick({ background: 'bg_red', body: 'body_blue', hat: 'hat_none', aura: 'aura_none' }),
      project,
    );
    expect(source).toBe('background=bg_red\nbody=body_blue\nhat=hat_none');
  });

  it('hashes identically across runs', () => {
    const traits = pick({ background: 'bg_red', body: 'body_blue', hat: 'hat_cap', aura: 'aura_soft' });
    expect(dnaHash(traits, project)).toBe(dnaHash(traits, project));
    expect(dnaHash(traits, project)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any trait changes', () => {
    const a = dnaHash(pick({ background: 'bg_red', body: 'body_blue', hat: 'hat_cap', aura: 'aura_soft' }), project);
    const b = dnaHash(pick({ background: 'bg_dark', body: 'body_blue', hat: 'hat_cap', aura: 'aura_soft' }), project);
    expect(a).not.toBe(b);
  });
});
