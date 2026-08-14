import sharp from 'sharp';
import { readdirSync } from 'node:fs';
const [dir, out, cellArg, colsArg] = process.argv.slice(2);
const cell = +cellArg || 280;
const cols = +colsArg || 10;
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
const rows = Math.ceil(files.length / cols);
const layers = await Promise.all(files.map(async (f, i) => ({
  input: await sharp(`${dir}/${f}`).resize(cell).png().toBuffer(),
  left: (i % cols) * cell,
  top: ((i / cols) | 0) * cell,
})));
await sharp({ create: { width: cols * cell, height: rows * cell, channels: 4, background: { r: 13, g: 11, b: 18, alpha: 1 } } })
  .composite(layers).png().toFile(out);
console.log(`grid ${files.length} images -> ${out}`);
