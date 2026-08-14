import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadProject, type LoadedProject } from '../src/config/loadProject.js';
import { generateCollection } from '../src/engine/generator.js';
import { createFixtureProject } from './helpers/fixtureProject.js';

let project: LoadedProject;

const outDir = () => mkdtempSync(join(tmpdir(), 'sym-out-'));

beforeAll(async () => {
  project = loadProject(await createFixtureProject());
});

describe('collection generator', () => {
  it('dry-run evaluates rules and distributions without rendering', async () => {
    const out = outDir();
    const result = await generateCollection(project, {
      count: 6,
      seed: 'DRY',
      outDir: out,
      dryRun: true,
    });
    expect(result.report.stats.generated).toBe(6);
    expect(existsSync(join(out, 'reports', 'dry-run-report.json'))).toBe(true);
    expect(existsSync(join(out, 'reports', 'dry-run-report.html'))).toBe(true);
    expect(existsSync(join(out, 'images'))).toBe(false);
    // co-occurrence matrix exists and counts pairs
    expect(result.report.coOccurrence.length).toBeGreaterThan(0);
  });

  it('prevents duplicate DNA within a build', async () => {
    const result = await generateCollection(project, {
      count: 6,
      seed: 'UNIQUE',
      outDir: outDir(),
      dryRun: true,
    });
    const dnas = result.editions.map((e) => e.dna);
    expect(new Set(dnas).size).toBe(dnas.length);
  });

  it('reproduces the exact same collection from the same seed', async () => {
    const a = await generateCollection(project, {
      count: 4,
      seed: 'REPRO',
      outDir: outDir(),
      dryRun: true,
    });
    const b = await generateCollection(project, {
      count: 4,
      seed: 'REPRO',
      outDir: outDir(),
      dryRun: true,
    });
    expect(a.editions.map((e) => e.dna)).toEqual(b.editions.map((e) => e.dna));
    expect(a.editions.map((e) => e.traits)).toEqual(b.editions.map((e) => e.traits));
  });

  it('produces different collections for different seeds', async () => {
    const a = await generateCollection(project, {
      count: 4,
      seed: 'SEED_A',
      outDir: outDir(),
      dryRun: true,
    });
    const b = await generateCollection(project, {
      count: 4,
      seed: 'SEED_B',
      outDir: outDir(),
      dryRun: true,
    });
    expect(a.editions.map((e) => e.dna)).not.toEqual(b.editions.map((e) => e.dna));
  });

  it('renders images + metadata + build manifest on a full build', async () => {
    const out = outDir();
    const result = await generateCollection(project, {
      count: 3,
      seed: 'FULL',
      outDir: out,
      debug: true,
    });
    expect(existsSync(join(out, 'images', '001.png'))).toBe(true);
    expect(existsSync(join(out, 'metadata', '001.json'))).toBe(true);
    expect(existsSync(join(out, 'reports', 'debug', '001.json'))).toBe(true);
    expect(result.manifestPath && existsSync(result.manifestPath)).toBe(true);
    const manifest = (await import(`${result.manifestPath}`, { with: { type: 'json' } })).default;
    expect(manifest.seed).toBe('FULL');
    expect(manifest.generatedEditions).toBe(3);
    expect(manifest.outputDnaHashes).toHaveLength(3);
    expect(manifest.projectConfigHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails loudly when uniqueness is exhausted', async () => {
    // The fixture pool has a small number of legal unique combinations;
    // requesting far more must abort with an actionable error.
    await expect(
      generateCollection(project, {
        count: 500,
        seed: 'EXHAUST',
        outDir: outDir(),
        dryRun: true,
      }),
    ).rejects.toThrow(/Could not generate edition/);
  });
});
