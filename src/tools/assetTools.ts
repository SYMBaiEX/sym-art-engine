import sharp from 'sharp';
import { hexToRgb } from '../utils/images.js';

/**
 * Asset-pipeline helpers used to turn AI-generated (or scanned/painted)
 * cumulative stage art into clean, aligned, transparent layer PNGs.
 * Generic image ops — nothing SYMBIES-specific lives here.
 */

export interface KeyOptions {
  /** Background color to remove (hex). */
  color: string;
  /** Color distance where alpha reaches 0 (fully background). */
  tolerance?: number;
  /** Color distance where alpha reaches 1 (fully foreground). */
  softness?: number;
}

/**
 * Chroma-key a solid background color out of an image, un-mixing edge
 * pixels so antialiased outlines keep their true foreground color
 * instead of a background-tinted fringe.
 */
export async function keyBackground(
  input: string | Buffer,
  options: KeyOptions,
): Promise<Buffer> {
  const tolerance = options.tolerance ?? 26;
  const softness = options.softness ?? 60;
  const key = hexToRgb(options.color);
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;
    const dist = Math.sqrt(
      (r - key.r) ** 2 + (g - key.g) ** 2 + (b - key.b) ** 2,
    );
    let alpha: number;
    if (dist <= tolerance) alpha = 0;
    else if (dist >= softness) alpha = 1;
    else alpha = (dist - tolerance) / (softness - tolerance);

    // Never resurrect pixels that are already transparent — keying a
    // layer that carries alpha must only ever remove, not add.
    alpha = Math.min(alpha, (data[i + 3] as number) / 255);

    if (alpha === 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    } else if (alpha < 1) {
      // Un-mix: pixel = alpha*fg + (1-alpha)*key  =>  recover fg
      data[i] = clamp255((r - (1 - alpha) * key.r) / alpha);
      data[i + 1] = clamp255((g - (1 - alpha) * key.g) / alpha);
      data[i + 2] = clamp255((b - (1 - alpha) * key.b) / alpha);
      data[i + 3] = Math.round(alpha * 255);
    }
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

export interface ExtractOptions {
  /** Per-channel max delta below which a pixel counts as unchanged. */
  threshold?: number;
  /** Erode+dilate radius (px) to kill isolated speckle. */
  despeckle?: number;
  /** Dilate radius (px) applied after despeckle to close gaps. */
  close?: number;
  /** Fill regions fully enclosed by changed pixels (hoodie interiors). */
  fillHoles?: boolean;
  /**
   * With fillHoles: don't flood from the bottom border, so garment
   * interiors that bleed off the bottom of a chest-up portrait still
   * count as enclosed and get filled.
   */
  fillHolesIgnoreBottom?: boolean;
  /** Feather the mask edge by ~1px for soft compositing. */
  feather?: boolean;
  /**
   * Drop connected mask components smaller than this many pixels.
   * Kills stray leftover speckles around the extracted artwork without
   * touching the artwork itself.
   */
  minComponent?: number;
}

/**
 * Extract the layer a cumulative art stage added: diff `next` against
 * `prev`, build a cleaned change mask, and emit `next`'s pixels inside
 * the mask as a transparent-layer PNG. Because layers are composited in
 * the same order the stages were painted, re-compositing all extracted
 * layers reproduces the final stage exactly.
 */
export async function extractLayer(
  prev: string | Buffer,
  next: string | Buffer,
  options: ExtractOptions = {},
): Promise<Buffer> {
  const threshold = options.threshold ?? 18;
  const despeckle = options.despeckle ?? 2;
  const close = options.close ?? 3;

  const a = await sharp(prev).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(next).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    throw new Error(
      `extractLayer: dimensions differ (${a.info.width}x${a.info.height} vs ${b.info.width}x${b.info.height})`,
    );
  }
  const { width, height } = b.info;
  const n = width * height;

  let mask: Uint8Array = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const dr = Math.abs((a.data[i] as number) - (b.data[i] as number));
    const dg = Math.abs((a.data[i + 1] as number) - (b.data[i + 1] as number));
    const db = Math.abs((a.data[i + 2] as number) - (b.data[i + 2] as number));
    if (Math.max(dr, dg, db) > threshold) mask[p] = 1;
  }

  if (despeckle > 0) {
    mask = erode(mask, width, height, despeckle);
    mask = dilate(mask, width, height, despeckle);
  }
  if (close > 0) {
    mask = dilate(mask, width, height, close);
    mask = erode(mask, width, height, close);
  }
  if (options.fillHoles) {
    mask = fillEnclosedHoles(mask, width, height, !options.fillHolesIgnoreBottom);
  }
  if (options.minComponent && options.minComponent > 0) {
    mask = dropSmallComponents(mask, width, height, options.minComponent);
  }

  const out = Buffer.alloc(n * 4);
  for (let p = 0; p < n; p++) {
    if (mask[p]) {
      const i = p * 4;
      out[i] = b.data[i] as number;
      out[i + 1] = b.data[i + 1] as number;
      out[i + 2] = b.data[i + 2] as number;
      out[i + 3] = 255;
    }
  }

  const image = sharp(out, { raw: { width, height, channels: 4 } }).png();
  if (options.feather !== false) {
    // Soften the hard mask edge: 1px blur on alpha only via extract/blur trick
    const buf = await image.toBuffer();
    return featherAlpha(buf, width, height);
  }
  return image.toBuffer();
}

async function featherAlpha(
  png: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const { data } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alpha = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) alpha[p] = data[p * 4 + 3] as number;
  const blurred = boxBlur(alpha, width, height, 1);
  for (let p = 0; p < width * height; p++) {
    // Only ever reduce alpha at edges — never bleed outward.
    data[p * 4 + 3] = Math.min(alpha[p] as number, blurred[p] as number);
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function boxBlur(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  const size = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        sum += src[y * width + xx] as number;
      }
      tmp[y * width + x] = Math.round(sum / size);
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        sum += tmp[yy * width + x] as number;
      }
      out[y * width + x] = Math.round(sum / size);
    }
  }
  return out;
}

function erode(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  return morph(mask, width, height, radius, true);
}

function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  return morph(mask, width, height, radius, false);
}

/** Separable square-kernel morphology (min for erode, max for dilate). */
function morph(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
  isErode: boolean,
): Uint8Array {
  const pass = (src: Uint8Array, horizontal: boolean): Uint8Array => {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let v = isErode ? 1 : 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = horizontal ? Math.min(width - 1, Math.max(0, x + k)) : x;
          const yy = horizontal ? y : Math.min(height - 1, Math.max(0, y + k));
          const s = src[yy * width + xx] as number;
          if (isErode) v = Math.min(v, s);
          else v = Math.max(v, s);
        }
        out[y * width + x] = v;
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

/**
 * Label 4-connected mask components and zero out any smaller than
 * `minArea` pixels — stray speckles left around the real artwork.
 */
function dropSmallComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  minArea: number,
): Uint8Array {
  const out = new Uint8Array(mask.length);
  const visited = new Uint8Array(mask.length);
  const stack: number[] = [];
  const component: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    stack.length = 0;
    component.length = 0;
    stack.push(start);
    visited[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop() as number;
      component.push(p);
      const x = p % width;
      const y = (p / width) | 0;
      const tryPush = (q: number) => {
        if (mask[q] && !visited[q]) {
          visited[q] = 1;
          stack.push(q);
        }
      };
      if (x > 0) tryPush(p - 1);
      if (x < width - 1) tryPush(p + 1);
      if (y > 0) tryPush(p - width);
      if (y < height - 1) tryPush(p + width);
    }
    if (component.length >= minArea) {
      for (const p of component) out[p] = 1;
    }
  }
  return out;
}

/**
 * Flood-fill the inverse mask from the borders; anything unreachable is
 * an enclosed hole (e.g. hoodie interior matching the body color) and
 * gets added to the mask.
 */
function fillEnclosedHoles(
  mask: Uint8Array,
  width: number,
  height: number,
  floodBottom = true,
): Uint8Array {
  const outside = new Uint8Array(mask.length);
  const stack: number[] = [];
  const push = (p: number) => {
    if (!mask[p] && !outside[p]) {
      outside[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    if (floodBottom) push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (stack.length > 0) {
    const p = stack.pop() as number;
    const x = p % width;
    const y = (p / width) | 0;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (y > 0) push(p - width);
    if (y < height - 1) push(p + width);
  }
  const out = new Uint8Array(mask.length);
  for (let p = 0; p < mask.length; p++) {
    out[p] = mask[p] || !outside[p] ? 1 : 0;
  }
  return out;
}

/** Resize/pad any input to an exact canvas (contain, transparent pad). */
export async function normalizeToCanvas(
  input: string | Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  return sharp(input)
    .resize(width, height, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
