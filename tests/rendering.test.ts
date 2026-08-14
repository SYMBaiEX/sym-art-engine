import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadProject, type LoadedProject } from '../src/config/loadProject.js';
import { compositePlan } from '../src/engine/compositor.js';
import { buildMetadata } from '../src/engine/metadata.js';
import { buildRenderPlan } from '../src/engine/renderPlan.js';
import { resolveAssets } from '../src/engine/variants.js';
import type { Trait } from '../src/schemas/trait.js';
import { createFixtureProject, FIXTURE_CANVAS } from './helpers/fixtureProject.js';

let project: LoadedProject;
const t = (id: string): Trait => project.traitById.get(id) as Trait;

const selection = (ids: Record<string, string>): Map<string, Trait> => {
  const map = new Map<string, Trait>();
  for (const [category, id] of Object.entries(ids)) map.set(category, t(id));
  return map;
};

const pixelAt = async (png: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
};

beforeAll(async () => {
  project = loadProject(await createFixtureProject());
});

describe('multi-asset traits + render plan', () => {
  it('splits one trait across multiple slots in numeric order', () => {
    const plan = buildRenderPlan(
      selection({ background: 'bg_red', body: 'body_blue', hat: 'hat_cap' }),
      project,
    );
    expect(plan.map((p) => p.slot)).toEqual([
      '000_BG',
      '100_HAT_BEHIND',
      '200_BODY',
      '300_HAT_FRONT',
    ]);
    // both cap assets come from the single hat trait
    expect(plan.filter((p) => p.traitId === 'hat_cap')).toHaveLength(2);
  });

  it('emits ONE metadata attribute for a multi-asset trait', () => {
    const metadata = buildMetadata(
      7,
      selection({ background: 'bg_red', body: 'body_blue', hat: 'hat_cap', aura: 'aura_soft' }),
      project,
    );
    expect(metadata.name).toBe('Fixture #007');
    const hat = metadata.attributes.filter((a) => a.trait_type === 'Hat');
    expect(hat).toEqual([{ trait_type: 'Hat', value: 'Cap' }]);
  });

  it('hides None from metadata when the category opts out', () => {
    const withNone = buildMetadata(
      1,
      selection({ background: 'bg_red', body: 'body_blue', hat: 'hat_none', aura: 'aura_none' }),
      project,
    );
    // aura emitNoneInMetadata=false -> hidden; hat None stays visible
    expect(withNone.attributes.map((a) => a.trait_type)).toEqual([
      'Background',
      'Body',
      'Hat',
    ]);
    expect(withNone.attributes[2]).toEqual({ trait_type: 'Hat', value: 'None' });
  });

  it('composites slots bottom-to-top (body covers hat-behind, hat-front on top)', async () => {
    const plan = buildRenderPlan(
      selection({ background: 'bg_red', body: 'body_blue', hat: 'hat_cap' }),
      project,
    );
    const png = await compositePlan(plan, {
      width: FIXTURE_CANVAS,
      height: FIXTURE_CANVAS,
    });
    // top-left quarter: cap-front red patch drawn over body
    expect(await pixelAt(png, 4, 4)).toMatchObject({ r: 220, g: 30, b: 30 });
    // center: body covers the full-canvas hat-behind layer (capfit variant
    // is active because the cap is worn)
    expect(await pixelAt(png, 32, 32)).toMatchObject({ r: 40, g: 200, b: 200 });
  });

  it('applies per-asset opacity', async () => {
    const plan = buildRenderPlan(
      selection({ background: 'bg_dark', body: 'body_blue', aura: 'aura_soft' }),
      project,
    );
    const png = await compositePlan(plan, {
      width: FIXTURE_CANVAS,
      height: FIXTURE_CANVAS,
    });
    // aura-soft patch (bottom-right) is white at 50% over blue body
    const px = await pixelAt(png, 56, 56);
    expect(px.r).toBeGreaterThan(120);
    expect(px.r).toBeLessThan(170);
  });
});

describe('contextual variants', () => {
  it('swaps assets when the variant condition matches', () => {
    const withCap = resolveAssets(
      t('body_blue'),
      selection({ body: 'body_blue', hat: 'hat_cap' }),
      project,
    );
    expect(withCap[0]?.file).toBe('body-blue-capfit.png');
  });

  it('falls back to base assets when no variant matches', () => {
    const noCap = resolveAssets(
      t('body_blue'),
      selection({ body: 'body_blue', hat: 'hat_none' }),
      project,
    );
    expect(noCap[0]?.file).toBe('body-blue.png');
  });
});
