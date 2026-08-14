import sharp from 'sharp';
import { applyOpacity, blankCanvas } from '../utils/images.js';
import type { PlacedAsset } from './renderPlan.js';

const BLEND_MAP: Record<string, sharp.Blend> = {
  normal: 'over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'soft-light': 'soft-light',
  'hard-light': 'hard-light',
  difference: 'difference',
  exclusion: 'exclusion',
};

export interface CompositeOptions {
  width: number;
  height: number;
  /** Optional pre-rendered base layer (e.g. checkerboard for previews). */
  base?: Buffer;
  /** Downscale the final output to this width (previews). */
  resizeTo?: number;
  /** Per-asset preprocessed buffer cache (studio hot path). */
  bufferFor?: (asset: PlacedAsset) => Promise<Buffer>;
}

/** Composite an ordered render plan into a PNG buffer. */
export async function compositePlan(
  plan: readonly PlacedAsset[],
  options: CompositeOptions,
): Promise<Buffer> {
  const layers: sharp.OverlayOptions[] = [];
  for (const asset of plan) {
    let input: Buffer | string;
    if (options.bufferFor) {
      input = await options.bufferFor(asset);
    } else if (asset.opacity < 1) {
      input = await applyOpacity(asset.absoluteFile, asset.opacity);
    } else {
      input = asset.absoluteFile;
    }
    layers.push({
      input,
      blend: BLEND_MAP[asset.blend] ?? 'over',
      top: 0,
      left: 0,
    });
  }

  let image = blankCanvas(options.width, options.height);
  if (options.base) {
    image = sharp(options.base);
  }
  const out = image.composite(layers).png();
  if (options.resizeTo) {
    // composite + resize in one pipeline is unreliable pre-flatten; do two passes
    const full = await out.toBuffer();
    return sharp(full).resize(options.resizeTo).png().toBuffer();
  }
  return out.toBuffer();
}
