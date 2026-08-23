import sharp from 'sharp';

/** Create a transparent RGBA canvas as a raw sharp instance. */
export function blankCanvas(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
}

/** Light-gray checkerboard used behind isolated trait previews. */
export async function checkerboard(
  width: number,
  height: number,
  cell = 50,
): Promise<Buffer> {
  const channels = 4;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const light = ((x / cell) | 0) % 2 === ((y / cell) | 0) % 2;
      const v = light ? 235 : 204;
      const i = (y * width + x) * channels;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

/** Multiply the alpha channel of a PNG buffer/file by `opacity` (0..1). */
export async function applyOpacity(
  input: string | Buffer<ArrayBufferLike>,
  opacity: number,
): Promise<Buffer<ArrayBufferLike>> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) {
    data[i] = Math.round((data[i] as number) * opacity);
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

/** Solid-color PNG, used to build flat backgrounds programmatically. */
export async function solidColor(
  width: number,
  height: number,
  hex: string,
): Promise<Buffer> {
  const { r, g, b } = hexToRgb(hex);
  return sharp({
    create: { width, height, channels: 4, background: { r, g, b, alpha: 1 } },
  })
    .png()
    .toBuffer();
}
