// Match the back model to the existing front's atlas-region palette, without changing UVs, alpha or animation data.
// node tools/chen-qianyu-art/recolor-back.mjs [official-back-directory] [plugin-back-directory]
// The source directory contains char_010_chen.{png,atlas,skel}; source game assets remain local.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readPng, writePng, readAtlas } from './png.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = process.argv[2] || path.join(root, 'public/assets/spine/op/char_010_chen/back');
const target = process.argv[3] || path.join(root, 'plugins/chen-qianyu-art/art/spine/back');
const input = path.join(source, 'char_010_chen');
const output = path.join(target, 'chen_qianyu');
const image = readPng(input + '.png');
const regions = readAtlas(input + '.atlas');
const pixels = Buffer.from(image.data);

function toHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), light = (max + min) / 2, delta = max - min;
  if (!delta) return [0, 0, light];
  const saturation = delta / (1 - Math.abs(2 * light - 1));
  const hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [(hue * 60 + 360) % 360, saturation, light];
}

function toRgb(h, s, l) {
  s = Math.min(1, Math.max(0, s)); l = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgb.map(v => Math.round((v + m) * 255));
}

const blue = (h, s) => h >= 195 && h <= 270 && s > 0.12;
const red = (h, s) => (h >= 330 || h <= 22) && s > 0.25;
const dark = (h, s, l) => l >= 0.06 && l < 0.45 && (s < 0.35 || (h >= 195 && h <= 270));
// These are the existing front recolor's HSL transforms, applied to the corresponding B_* atlas regions.
const rules = [
  { names: ['B_Head', 'B_F_Hair', 'B_L_Braid', 'B_R_Braid'], when: blue,
    map: (_h, s, l) => [228, s * 0.4, l * 0.42 + 0.02] },
  { names: ['B_L_Horn', 'B_R_Horn'], when: (h, s, l) => (h <= 50 || h >= 330) && s > 0.15 && l < 0.6,
    map: (_h, s, l) => [214, Math.min(1, s * 0.6 + 0.35), Math.min(0.7, l * 1.25 + 0.04)] },
  { names: ['B_Red Weapon'], when: red,
    map: (_h, s, l) => [184, Math.min(1, s * 0.9), Math.min(0.78, l * 1.12 + 0.04)] },
  { names: ['B_Coat'], when: (_h, s, l) => s < 0.16 && l > 0.7,
    map: (_h, _s, l) => [336, 0.7, l * 0.68] },
  { names: ['B_Coat', 'B_Hood', 'B_L_Shoulder', 'B_R_Shoulder'], when: dark,
    map: (_h, _s, l) => [213, 0.55, 0.22 + l * 1.1] },
  { names: ['B_Hip'], when: (h, s, l) => dark(h, s, l) && s < 0.5,
    map: (_h, _s, l) => [220, 0.08, 0.7 + l * 0.8] },
  { names: ['B_Tail'], when: blue,
    map: (_h, s, l) => [196, Math.min(1, s * 1.3 + 0.1), Math.min(0.62, l * 1.6 + 0.05)] },
  { names: ['B_Tail'], when: red, map: (_h, s, l) => [336, s, l] },
];

let recolored = 0;
for (const rule of rules) for (const name of rule.names) {
  const region = regions.get(name);
  assert.ok(region && Number.isFinite(region.w), `missing atlas region: ${name}`);
  for (let y = region.y; y < region.y + region.h; y++) for (let x = region.x; x < region.x + region.w; x++) {
    const offset = (y * image.w + x) * 4;
    if (!image.data[offset + 3]) continue;
    const color = toHsl(...image.data.subarray(offset, offset + 3));
    if (!rule.when(...color)) continue;
    const rgb = toRgb(...rule.map(...color));
    for (let k = 0; k < 3; k++) pixels[offset + k] = rgb[k];
    recolored++;
  }
}
assert.ok(recolored > 0, 'the palette must change visible pixels');
for (let i = 3; i < pixels.length; i += 4) assert.equal(pixels[i], image.data[i], 'atlas alpha must remain unchanged');
fs.mkdirSync(target, { recursive: true });
writePng(output + '.png', { ...image, data: pixels });
fs.copyFileSync(input + '.skel', output + '.skel');
fs.writeFileSync(output + '.atlas', fs.readFileSync(input + '.atlas', 'utf8')
  .replace(/\r\n/g, '\n').replace(/^char_010_chen\.png/, 'chen_qianyu.png'));
console.log(`Back model: ${image.w}x${image.h}, ${recolored} palette edits; original alpha, atlas regions and skeleton preserved.`);
