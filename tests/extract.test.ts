import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { extractLayer } from '../src/tools/assetTools.js';

const W = 128;
const H = 128;

async function image(
  patches: { left: number; top: number; size: number; rgb: [number, number, number] }[],
  bg: [number, number, number] = [141, 124, 181],
): Promise<Buffer> {
  const layers = await Promise.all(
    patches.map(async (p) => ({
      input: await sharp({
        create: {
          width: p.size,
          height: p.size,
          channels: 4,
          background: { r: p.rgb[0], g: p.rgb[1], b: p.rgb[2], alpha: 1 },
        },
      })
        .png()
        .toBuffer(),
      left: p.left,
      top: p.top,
    })),
  );
  return sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: { r: bg[0], g: bg[1], b: bg[2], alpha: 1 },
    },
  })
    .composite(layers)
    .png()
    .toBuffer();
}

async function opaquePixels(png: Buffer): Promise<Set<number>> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const set = new Set<number>();
  for (let p = 0; p < info.width * info.height; p++) {
    if ((data[p * 4 + 3] as number) > 128) set.add(p);
  }
  return set;
}

describe('layer extraction', () => {
  it('extracts only the changed region', async () => {
    const prev = await image([]);
    const next = await image([{ left: 40, top: 40, size: 30, rgb: [20, 20, 24] }]);
    const layer = await extractLayer(prev, next, { despeckle: 0, close: 0 });
    const pixels = await opaquePixels(layer);
    expect(pixels.has(50 * W + 50)).toBe(true); // inside the patch
    expect(pixels.has(10 * W + 10)).toBe(false); // untouched background
  });

  it('drops leftover speckles below minComponent, keeps real artwork', async () => {
    const prev = await image([]);
    const next = await image([
      { left: 30, top: 30, size: 40, rgb: [20, 20, 24] }, // real artwork (1600px)
      { left: 100, top: 10, size: 4, rgb: [90, 60, 120] }, // stray speckle (16px)
      { left: 8, top: 100, size: 3, rgb: [200, 40, 40] }, // stray speckle (9px)
    ]);
    const dirty = await extractLayer(prev, next, { despeckle: 0, close: 0 });
    const dirtyPixels = await opaquePixels(dirty);
    expect(dirtyPixels.has(12 * W + 102)).toBe(true); // speckle survives without filter

    const clean = await extractLayer(prev, next, {
      despeckle: 0,
      close: 0,
      minComponent: 100,
    });
    const cleanPixels = await opaquePixels(clean);
    expect(cleanPixels.has(50 * W + 50)).toBe(true); // artwork kept
    expect(cleanPixels.has(12 * W + 102)).toBe(false); // speckle gone
    expect(cleanPixels.has(101 * W + 9)).toBe(false); // speckle gone
  });
});
