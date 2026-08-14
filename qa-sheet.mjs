import sharp from 'sharp';
const assets = process.argv[3].split(',');
const root = process.argv[2];
const out = process.argv[4];
const cell = 300, cols = 5;
const rows = Math.ceil(assets.length / cols);
// checkerboard cell background
const cb = Buffer.alloc(cell * cell * 4);
for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
  const light = (((x / 25) | 0) % 2) === (((y / 25) | 0) % 2);
  const v = light ? 235 : 204;
  const i = (y * cell + x) * 4;
  cb[i] = v; cb[i+1] = v; cb[i+2] = v; cb[i+3] = 255;
}
const board = await sharp(cb, { raw: { width: cell, height: cell, channels: 4 } }).png().toBuffer();
const layers = [];
for (let i = 0; i < assets.length; i++) {
  const img = await sharp(`${root}/${assets[i]}`).resize(cell).png().toBuffer();
  const tile = await sharp(board).composite([{ input: img }]).png().toBuffer();
  layers.push({ input: tile, left: (i % cols) * cell, top: ((i / cols) | 0) * cell });
}
await sharp({ create: { width: cols * cell, height: rows * cell, channels: 4, background: { r: 30, g: 27, b: 40, alpha: 1 } } })
  .composite(layers).png().toFile(out);
console.log('qa sheet:', out);
