import { describe, expect, it } from 'vitest';
import { loadProject } from '../src/config/loadProject.js';
import { compositePlan } from '../src/engine/compositor.js';
import { canonicalDnaSource, dnaHash } from '../src/engine/dna.js';
import { buildMetadata } from '../src/engine/metadata.js';
import { buildRenderPlan } from '../src/engine/renderPlan.js';
import { selectEdition } from '../src/engine/selector.js';
import { sha256 } from '../src/utils/hash.js';
import { createRng } from '../src/utils/prng.js';
import { createFixtureProject } from './helpers/fixtureProject.js';

describe('collection-agnostic golden fixture', () => {
  it('keeps selection, metadata, and rendering deterministic', async () => {
    const project = loadProject(await createFixtureProject());
    const first = selectEdition(project, createRng('stable-fixture'), new Map());
    const second = selectEdition(project, createRng('stable-fixture'), new Map());

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('fixture selection failed');

    expect(canonicalDnaSource(first.traits, project)).toBe(
      canonicalDnaSource(second.traits, project),
    );
    expect(dnaHash(first.traits, project)).toBe(dnaHash(second.traits, project));

    const metadata = buildMetadata(7, first.traits, project);
    expect(metadata).toMatchObject({
      name: 'Fixture #007',
      image: 'ipfs://X/007.png',
    });
    expect(metadata.attributes.length).toBeGreaterThan(0);

    const plan = buildRenderPlan(first.traits, project);
    const imageA = await compositePlan(plan, project.config.canvas);
    const imageB = await compositePlan(plan, project.config.canvas);
    expect(sha256(imageA)).toBe(sha256(imageB));
  });
});
