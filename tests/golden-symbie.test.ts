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
 * Golden test for DAZREN #1: the deterministic collection anchor edition.
 * Same project + assets + configuration + seed => same DNA and same
 * output image hash, forever. Render assertions are skipped until the
 * production asset PNGs exist.
 */
const SYMBIES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'projects', 'symbies',
);

const GOLDEN_DNA_SOURCE = [
  'background=background_void',
  'body=body_standard_charcoal',
  'eyes=eyes_signal',
  'clothing=clothing_black_hoodie',
  'ear=ear_x_tag',
  'mark=mark_diamond_rune',
  'glasses=glasses_none',
  'headwear=headwear_black_cap',
].join('\n');

const GOLDEN_DNA_HASH =
  'c2638c14f15bec21490431e58777d500d90ef4b1175c2537066000f7982f4749';

let project: LoadedProject;
let selected: Map<string, Trait>;

beforeAll(() => {
  project = loadProject(SYMBIES_DIR);
  const fixed = project.config.fixedEditions.find((f) => f.edition === 1);
  if (!fixed) throw new Error('DAZREN #1 fixed edition missing');
  selected = resolveFixedEdition(project, fixed.traits);
});

describe('DAZREN #1 golden', () => {
  it('has the exact canonical DNA', () => {
    expect(canonicalDnaSource(selected, project)).toBe(GOLDEN_DNA_SOURCE);
    expect(dnaHash(selected, project)).toBe(GOLDEN_DNA_HASH);
  });

  it('emits the exact public metadata', () => {
    const metadata = buildMetadata(1, selected, project);
    expect(metadata.name).toBe('Dazren #1');
    expect(metadata.description).toBe(
      'One of 4,181 machine-born entities in the DAZREN Order, with a deterministic identity assembled from the hand-finished SYMBIES trait system.',
    );
    expect(metadata.image).toBe('ipfs://REPLACE_WITH_IMAGE_CID/1.png');
    expect(metadata.external_url).toBe('https://nft.dazren.com');
    expect(metadata.attributes).toEqual([
      { trait_type: 'Background', value: 'Void' },
      { trait_type: 'Body', value: 'Standard Charcoal' },
      { trait_type: 'Eyes', value: 'Signal' },
      { trait_type: 'Clothing', value: 'Black Hoodie' },
      { trait_type: 'Ears', value: 'X Tag' },
      { trait_type: 'Mark', value: 'Diamond Rune' },
      { trait_type: 'Eyewear', value: 'None' },
      { trait_type: 'Headwear', value: 'Black Cap' },
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
