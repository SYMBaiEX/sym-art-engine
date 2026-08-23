import sharp from 'sharp';
import { applyOpacity, blankCanvas } from '../utils/images.js';
import type { PlacedAsset } from './renderPlan.js';

const BLEND_MAP = {
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
} as const;

export interface CompositeOptions {
  width: number;
  height: number;
  /** Optional pre-rendered base layer (e.g. checkerboard for previews). */
  base?: Buffer<ArrayBufferLike>;
  /** Downscale the final output to this width (previews). */
  resizeTo?: number;
  /** Per-asset preprocessed buffer cache (studio hot path). */
  bufferFor?: (asset: PlacedAsset) => Promise<Buffer<ArrayBufferLike>>;
}

/** Composite an ordered render plan into a PNG buffer. */
export async function compositePlan(
  plan: readonly PlacedAsset[],
  options: CompositeOptions,
): Promise<Buffer<ArrayBufferLike>> {
  const layers: Array<{
    input: Buffer<ArrayBufferLike> | string;
    blend: (typeof BLEND_MAP)[keyof typeof BLEND_MAP] | 'over';
    top: number;
    left: number;
  }> = [];
  for (const asset of plan) {
    let input: Buffer<ArrayBufferLike> | string;
    if (options.bufferFor) {
      input = await options.bufferFor(asset);
    } else if (asset.opacity < 1) {
      input = await applyOpacity(asset.absoluteFile, asset.opacity);
    } else {
      input = asset.absoluteFile;
    }
    const blend =
      asset.blend in BLEND_MAP
        ? BLEND_MAP[asset.blend as keyof typeof BLEND_MAP]
        : 'over';
    layers.push({
      input,
      blend,
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
