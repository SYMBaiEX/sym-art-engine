import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadProject, type LoadedProject } from '../src/config/loadProject.js';
import { compositePlan } from '../src/engine/compositor.js';
import { canonicalDnaSource, dnaHash } from '../src/engine/dna.js';
import { buildMetadata } from '../src/engine/metadata.js';
import { buildRenderPlan } from '../src/engine/renderPlan.js';
import { resolveFixedEdition } from '../src/engine/selector.js';
import { sha256 } from '../src/utils/hash.js';
import type { Trait } from '../src/schemas/trait.js';

/**
 * Golden test for Symbie #0001: the deterministic prototype edition.
 * Same project + assets + configuration + seed => same DNA and same
 * output image hash, forever. Render assertions are skipped until the
 * production asset PNGs exist.
 */
const SYMBIES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'projects', 'symbies',
);

const GOLDEN_DNA_SOURCE = [
  'background=background_lavender',
  'body=body_standard_charcoal',
  'clothing=clothing_black_hoodie',
  'neck=neck_sym_chain',
  'growth=growth_purple_rear_crystals',
  'eyes=eyes_white_neutral',
  'mark=mark_diamond_rune',
  'ear=ear_x_tag',
  'headwear=headwear_black_cap',
  'special=special_none',
].join('\n');

const GOLDEN_DNA_HASH =
  '603cb3bca46bd15907873179e6405130a5bdce67f0330d54ecb00224e27c3aaf';

let project: LoadedProject;
let selected: Map<string, Trait>;

beforeAll(() => {
  project = loadProject(SYMBIES_DIR);
  const fixed = project.config.fixedEditions.find((f) => f.edition === 1);
  if (!fixed) throw new Error('Symbie #0001 fixed edition missing');
  selected = resolveFixedEdition(project, fixed.traits);
});

describe('Symbie #0001 golden', () => {
  it('has the exact canonical DNA', () => {
    expect(canonicalDnaSource(selected, project)).toBe(GOLDEN_DNA_SOURCE);
    expect(dnaHash(selected, project)).toBe(GOLDEN_DNA_HASH);
  });

  it('emits the exact public metadata', () => {
    const metadata = buildMetadata(1, selected, project);
    expect(metadata.name).toBe('Symbie #0001');
    expect(metadata.description).toBe('A Symbie from the SYMBaiEX ecosystem.');
    expect(metadata.image).toBe('ipfs://PLACEHOLDER/0001.png');
    expect(metadata.attributes).toEqual([
      { trait_type: 'Background', value: 'Lavender' },
      { trait_type: 'Body', value: 'Standard Charcoal' },
      { trait_type: 'Clothing', value: 'Black Hoodie' },
      { trait_type: 'Neck Accessory', value: 'SYM Chain' },
      { trait_type: 'Head Growth', value: 'Purple Rear Crystals' },
      { trait_type: 'Eyes', value: 'White Neutral' },
      { trait_type: 'Forehead Mark', value: 'Diamond Rune' },
      { trait_type: 'Ear / Side Accessory', value: 'X Tag' },
      { trait_type: 'Headwear', value: 'Black Cap' },
      { trait_type: 'Special Effect', value: 'None' },
    ]);
  });

  it('renders reproducibly at exactly 2000x2000', async () => {
    const plan = buildRenderPlan(selected, project);
    const missing = plan.filter((p) => !existsSync(p.absoluteFile));
    if (missing.length > 0) {
      // Assets not generated yet — DNA/metadata goldens above still guard.
      console.warn(
        `Skipping render golden: missing assets ${missing.map((m) => m.file).join(', ')}`,
      );
      return;
    }
    const { width, height } = project.config.canvas;
    const first = await compositePlan(plan, { width, height });
    const second = await compositePlan(plan, { width, height });
    expect(sha256(first)).toBe(sha256(second));
    const meta = await sharp(first).metadata();
    expect(meta.width).toBe(2000);
    expect(meta.height).toBe(2000);
    expect(meta.format).toBe('png');
  });
});
