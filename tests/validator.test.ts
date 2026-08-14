import { join } from 'node:path';
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadProject } from '../src/config/loadProject.js';
import { validateProject } from '../src/engine/validator.js';
import { writeJson } from '../src/utils/fs.js';
import { createFixtureProject } from './helpers/fixtureProject.js';

let dir: string;

beforeAll(async () => {
  dir = await createFixtureProject();
});

describe('project validator', () => {
  it('passes a clean project', async () => {
    const report = await validateProject(loadProject(dir));
    expect(report.errors).toEqual([]);
  });

  it('detects wrong asset dimensions with actionable expected/actual', async () => {
    const bad = await createFixtureProject();
    const wrong = await sharp({
      create: { width: 32, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer();
    writeFileSync(join(bad, 'assets', 'body-blue.png'), wrong);
    const report = await validateProject(loadProject(bad));
    const issue = report.errors.find((e) => e.code === 'wrong-dimensions');
    expect(issue).toBeDefined();
    expect(issue?.expected).toBe('64x64');
    expect(issue?.actual).toBe('32x64');
    expect(issue?.trait).toBe('body_blue');
  });

  it('detects missing files, unknown slots, and duplicate names', async () => {
    const bad = await createFixtureProject();
    writeJson(join(bad, 'traits', 'broken.json'), {
      id: 'hat_broken',
      category: 'hat',
      name: 'Cap',
      assets: [{ slot: '999_NOPE', file: 'does-not-exist.png' }],
    });
    const report = await validateProject(loadProject(bad));
    const codes = report.errors.map((e) => e.code);
    expect(codes).toContain('missing-file');
    expect(codes).toContain('unknown-slot');
    expect(codes).toContain('duplicate-name');
  });

  it('detects contradictory requires/blocks', async () => {
    const bad = await createFixtureProject();
    writeJson(join(bad, 'traits', 'contradiction.json'), {
      id: 'aura_paradox',
      category: 'aura',
      name: 'Paradox',
      requires: ['body:standard'],
      blocks: ['trait:body_blue'],
      assets: [{ slot: '400_AURA', file: 'aura-chaos.png' }],
    });
    const report = await validateProject(loadProject(bad));
    expect(report.errors.some((e) => e.code === 'contradictory-rules')).toBe(true);
  });

  it('detects empty categories', async () => {
    const bad = await createFixtureProject();
    const config = JSON.parse(
      (await import('node:fs')).readFileSync(join(bad, 'project.json'), 'utf8'),
    );
    config.categories.push({ id: 'ghost', name: 'Ghost', order: 9 });
    writeJson(join(bad, 'project.json'), config);
    const report = await validateProject(loadProject(bad));
    expect(report.errors.some((e) => e.code === 'empty-category')).toBe(true);
  });
});
