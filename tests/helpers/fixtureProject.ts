import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { ensureDir, writeJson } from '../../src/utils/fs.js';

export const FIXTURE_CANVAS = 64;

/**
 * Synthetic 64x64 project exercising every engine feature: multi-asset
 * traits, variants, None traits, families, allows/blocks/requires,
 * exclusive groups, conditional rules, palette rules, occurrence caps.
 */
export async function createFixtureProject(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'sym-fixture-'));
  const assets = ensureDir(join(dir, 'assets'));
  const traits = ensureDir(join(dir, 'traits'));
  ensureDir(join(dir, 'rules'));

  const solid = async (
    file: string,
    rgba: { r: number; g: number; b: number; alpha: number },
    region?: { left: number; top: number; size: number },
  ) => {
    if (region) {
      const patch = await sharp({
        create: { width: region.size, height: region.size, channels: 4, background: rgba },
      })
        .png()
        .toBuffer();
      const image = sharp({
        create: {
          width: FIXTURE_CANVAS,
          height: FIXTURE_CANVAS,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      }).composite([{ input: patch, left: region.left, top: region.top }]);
      writeFileSync(join(assets, file), await image.png().toBuffer());
      return;
    }

    const image = sharp({
      create: { width: FIXTURE_CANVAS, height: FIXTURE_CANVAS, channels: 4, background: rgba },
    });
    writeFileSync(join(assets, file), await image.png().toBuffer());
  };

  await solid('bg-red.png', { r: 200, g: 40, b: 40, alpha: 1 });
  await solid('bg-dark.png', { r: 16, g: 16, b: 20, alpha: 1 });
  await solid('body-blue.png', { r: 40, g: 60, b: 200, alpha: 1 });
  await solid('body-blue-capfit.png', { r: 40, g: 200, b: 200, alpha: 1 });
  await solid('cap-behind.png', { r: 20, g: 160, b: 20, alpha: 1 });
  await solid('cap-front.png', { r: 220, g: 30, b: 30, alpha: 1 }, { left: 0, top: 0, size: 16 });
  await solid('crown.png', { r: 240, g: 200, b: 40, alpha: 1 }, { left: 24, top: 0, size: 16 });
  await solid('aura-soft.png', { r: 250, g: 250, b: 250, alpha: 1 }, { left: 48, top: 48, size: 16 });
  await solid('aura-chaos.png', { r: 120, g: 0, b: 200, alpha: 1 }, { left: 0, top: 48, size: 16 });

  writeJson(join(dir, 'project.json'), {
    name: 'Fixture',
    slug: 'fixture',
    canvas: { width: FIXTURE_CANVAS, height: FIXTURE_CANVAS },
    slots: ['000_BG', '100_HAT_BEHIND', '200_BODY', '300_HAT_FRONT', '400_AURA'],
    categories: [
      { id: 'background', name: 'Background', order: 1, selectAfterCharacter: true },
      { id: 'body', name: 'Body', order: 2 },
      { id: 'hat', name: 'Hat', order: 3, optional: true },
      {
        id: 'aura',
        name: 'Aura',
        order: 4,
        optional: true,
        emitNoneInMetadata: false,
        includeNoneInDna: false,
      },
    ],
    metadata: {
      nameTemplate: 'Fixture #{editionPadded}',
      descriptionTemplate: 'test',
      imageTemplate: 'ipfs://X/{editionPadded}.png',
      editionPadding: 3,
    },
    generation: { maxRerolls: 100, paletteRerollBelow: null },
  });

  writeJson(join(dir, 'rules', 'rules.json'), {
    exclusiveGroups: [
      { name: 'statement-piece', members: ['hat:crown', 'aura:soft'] },
    ],
    conditional: [
      { name: 'crown-purity', when: ['hat:crown'], blocks: ['aura:chaos'] },
    ],
    synergies: [
      { name: 'cap-soft', when: ['Hat:Cap', 'Aura:Soft Glow'], score: 2 },
    ],
    palette: {
      colors: {
        blue: { hex: '#283cc8', luminance: 0.2, temperature: 'cool' },
      },
      minContrast: 0.15,
      targetContrast: 0.5,
      relationships: [
        { background: 'red', trait: 'blue', level: 'preferred' },
        { background: 'dark', trait: 'blue', level: 'discouraged' },
      ],
    },
  });

  const trait = (file: string, data: object) =>
    writeJson(join(traits, file), data);

  trait('bg-red.json', {
    id: 'bg_red',
    category: 'background',
    name: 'Red',
    family: 'background:red',
    rarity: { weight: 100 },
    background: { luminance: 0.8, family: 'red', temperature: 'warm' },
    assets: [{ slot: '000_BG', file: 'bg-red.png' }],
  });
  trait('bg-dark.json', {
    id: 'bg_dark',
    category: 'background',
    name: 'Dark',
    family: 'background:dark',
    rarity: { weight: 100 },
    background: { luminance: 0.1, family: 'dark', temperature: 'cool' },
    assets: [{ slot: '000_BG', file: 'bg-dark.png' }],
  });
  trait('body-blue.json', {
    id: 'body_blue',
    category: 'body',
    name: 'Blue',
    family: 'body:standard',
    palette: { primary: 'blue', temperature: 'cool' },
    rarity: { weight: 100 },
    assets: [{ slot: '200_BODY', file: 'body-blue.png' }],
    variants: [
      {
        when: { hatFamily: 'cap' },
        assets: [{ slot: '200_BODY', file: 'body-blue-capfit.png' }],
      },
    ],
  });
  trait('hat-cap.json', {
    id: 'hat_cap',
    category: 'hat',
    name: 'Cap',
    family: 'hat:cap',
    tags: ['casual'],
    rarity: { weight: 600 },
    assets: [
      { slot: '100_HAT_BEHIND', file: 'cap-behind.png' },
      { slot: '300_HAT_FRONT', file: 'cap-front.png' },
    ],
    allows: ['aura:none', 'aura:soft'],
  });
  trait('hat-crown.json', {
    id: 'hat_crown',
    category: 'hat',
    name: 'Crown',
    family: 'hat:crown',
    rarity: { weight: 100, max: 2 },
    requires: ['body:standard'],
    assets: [{ slot: '300_HAT_FRONT', file: 'crown.png' }],
  });
  trait('hat-none.json', {
    id: 'hat_none',
    category: 'hat',
    name: 'None',
    none: true,
    family: 'hat:none',
    rarity: { weight: 300 },
    assets: [],
  });
  trait('aura-soft.json', {
    id: 'aura_soft',
    category: 'aura',
    name: 'Soft Glow',
    family: 'aura:soft',
    rarity: { weight: 100 },
    assets: [{ slot: '400_AURA', file: 'aura-soft.png', opacity: 0.5 }],
  });
  trait('aura-chaos.json', {
    id: 'aura_chaos',
    category: 'aura',
    name: 'Chaos',
    family: 'aura:chaos',
    rarity: { weight: 100 },
    blocks: ['tag:casual'],
    assets: [{ slot: '400_AURA', file: 'aura-chaos.png' }],
  });
  trait('aura-none.json', {
    id: 'aura_none',
    category: 'aura',
    name: 'None',
    none: true,
    family: 'aura:none',
    rarity: { weight: 400 },
    assets: [],
  });

  return dir;
}
