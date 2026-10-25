import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { decodePng, encodePng } from '../../tools/artwork/png.mjs';
import { extractRegion, replaceRegion, cropCell, resize } from '../../tools/artwork/image.mjs';

const image = (w, h) => ({ w, h, data: Buffer.alloc(w * h * 4) });
const pixel = (img, x, y, rgba) => img.data.set(rgba, (y * img.w + x) * 4);
test('rotated atlas replacement round-trips the tile and preserves every outside pixel', () => {
  const page = image(11, 9); for (let i = 0; i < page.data.length; i++) page.data[i] = i % 251;
  const before = Buffer.from(page.data), region = { x: 3, y: 2, sw: 3, sh: 5, w: 5, h: 3, rotate: true }, tile = image(3, 5);
  for (let i = 0; i < tile.data.length; i++) tile.data[i] = (i * 19) % 255;
  replaceRegion(page, region, tile); assert.deepEqual(extractRegion(page, region), tile);
  for (let y = 0; y < page.h; y++) for (let x = 0; x < page.w; x++) {
    if (x >= 3 && x < 8 && y >= 2 && y < 5) continue;
    const at = (y * page.w + x) * 4; assert.deepEqual(page.data.subarray(at, at + 4), before.subarray(at, at + 4));
  }
  assert.throws(() => replaceRegion(page, { ...region, x: 10 }, tile), /outside page/);
});
test('paired eyes survive disconnected-component trimming; exact mode preserves translucent pixels', () => {
  const eyes = image(12, 6);
  for (const x of [2, 3, 8, 9]) for (const y of [2, 3]) pixel(eyes, x, y, [130, 150, 180, 255]);
  pixel(eyes, 11, 5, [255, 0, 0, 255]); pixel(eyes, 0, 0, [255, 255, 255, 50]);
  const all = cropCell(eyes), largest = cropCell(eyes, { components: 'largest' });
  assert.equal(all.w, 8); assert.equal(all.h, 2); assert.equal(largest.w, 2);
  assert.deepEqual(cropCell(eyes, { trim: false }), eyes);
  assert.throws(() => cropCell(image(1, 1), { columns: 2, trim: false }), /at least one pixel/);
});
test('premultiplied alpha fitting avoids dark fringes and leaves unused collar area transparent', () => {
  const tile = image(2, 1); pixel(tile, 0, 0, [220, 180, 130, 255]);
  const scaled = resize(tile, 4, 1);
  assert.deepEqual([...scaled.data.subarray(4, 7)], [220, 180, 130]);
  const page = image(4, 4); page.data.fill(255);
  replaceRegion(page, { x: 0, y: 0, w: 4, h: 4, sw: 4, sh: 4 }, tile, { heightRatio: .25 });
  assert.ok(page.data.subarray(16).every(n => n === 0));
});
test('PNG decoder checks corruption, bounds, format and decoded length before accepting an upload', () => {
  const source = image(3, 2); source.data.fill(127); const png = encodePng(source);
  assert.deepEqual(decodePng(png), source);
  const corrupt = Buffer.from(png); corrupt[corrupt.length - 1] ^= 1; assert.throws(() => decodePng(corrupt), /CRC/);
  assert.throws(() => decodePng(png.subarray(0, 20)), /bounded/);
  const huge = Buffer.from(png); huge.writeUInt32BE(4097, 16); huge.writeUInt32BE(zlib.crc32(huge.subarray(12, 29)) >>> 0, 29);
  assert.throws(() => decodePng(huge), /dimensions/);
  const indexed = Buffer.from(png); indexed[25] = 3; indexed.writeUInt32BE(zlib.crc32(indexed.subarray(12, 29)) >>> 0, 29);
  assert.throws(() => decodePng(indexed), /unsupported/);
});
