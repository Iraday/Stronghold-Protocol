// Fit the imagegen outfit into Spine UV regions. Only the skirt mesh moves; bones, clips, face, hair and weapons stay intact.
// node tools/chen-qianyu-art/apply-outfit.mjs [plugin-spine-directory]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readPng, writePng, readAtlas } from './png.mjs';
const require = createRequire(import.meta.url);
const spine = require('@pixi-spine/runtime-3.8');

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || path.resolve(here, '../../plugins/chen-qianyu-art/art/spine');
const front = ['F_L_Coat', 'F_R_Coat', 'F_Chest', 'F_Waist_A', 'F_L_Hood', 'F_R_Hood',
  'F_L_Shoulder', 'F_R_Shoulder', 'F_L_Arm', 'F_R_Arm', 'F_Hip', 'F_Waist_B',
  'F_L_Leg', 'F_R_Leg', 'F_L_Calf', 'F_R_Calf'];
const back = ['B_Coat', 'B_Chest', 'B_Hip', 'B_Waist', 'B_Hood', 'B_L_Shoulder',
  'B_R_Shoulder', 'B_L_Arm', 'B_R_Arm', 'B_L_Leg', 'B_R_Leg', 'B_L_Calf', 'B_R_Calf'];

/** Remove detached transparent-edge noise and isolate the largest connected garment inside its fixed sheet cell. */
function garment(sheet, index) {
  const cell = sheet.w / 4;
  const x0 = Math.max(0, Math.floor(index % 4 * cell) - 12);
  const y0 = Math.max(0, Math.floor(Math.floor(index / 4) * cell) - 8);
  const x1 = Math.min(sheet.w, Math.ceil((index % 4 + 1) * cell) + 12);
  const y1 = Math.min(sheet.h, Math.ceil((Math.floor(index / 4) + 1) * cell) + 8);
  const width = x1 - x0, height = y1 - y0, visited = new Uint8Array(width * height);
  let largest = [];
  const alpha = i => sheet.data[((y0 + Math.floor(i / width)) * sheet.w + x0 + i % width) * 4 + 3];
  for (let first = 0; first < visited.length; first++) {
    if (visited[first] || alpha(first) < 128) continue;
    const queue = [first]; visited[first] = 1;
    for (let next = 0; next < queue.length; next++) {
      const at = queue[next], x = at % width, y = Math.floor(at / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, i = yy * width + xx;
        if (xx < 0 || xx >= width || yy < 0 || yy >= height || visited[i] || alpha(i) < 128) continue;
        visited[i] = 1; queue.push(i);
      }
    }
    if (queue.length > largest.length) largest = queue;
  }
  assert.ok(largest.length > 100, `empty garment cell ${index}`);
  const xs = largest.map(i => i % width), ys = largest.map(i => Math.floor(i / width));
  let left = width, right = 0, top = height, bottom = 0;
  for (let i = 0; i < xs.length; i++) { left = Math.min(left, xs[i]); right = Math.max(right, xs[i]); top = Math.min(top, ys[i]); bottom = Math.max(bottom, ys[i]); }
  const tile = { w: right - left + 1, h: bottom - top + 1, data: Buffer.alloc((right - left + 1) * (bottom - top + 1) * 4) };
  for (const i of largest) {
    const x = i % width, y = Math.floor(i / width), src = ((y0 + y) * sheet.w + x0 + x) * 4;
    sheet.data.copy(tile.data, ((y - top) * tile.w + x - left) * 4, src, src + 4);
  }
  return tile;
}

/** Premultiplied-alpha bilinear resampling keeps transparent sprite edges free of a background matte. */
function fit(tile, w, h) {
  const result = { w, h, data: Buffer.alloc(w * h * 4) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.max(0, Math.min(tile.w - 1, (x + .5) * tile.w / w - .5));
    const sy = Math.max(0, Math.min(tile.h - 1, (y + .5) * tile.h / h - .5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(tile.w - 1, x0 + 1), y1 = Math.min(tile.h - 1, y0 + 1);
    const fx = sx - x0, fy = sy - y0, rgb = [0, 0, 0]; let alpha = 0;
    for (const [xx, yy, weight] of [[x0, y0, (1 - fx) * (1 - fy)], [x1, y0, fx * (1 - fy)], [x0, y1, (1 - fx) * fy], [x1, y1, fx * fy]]) {
      const i = (yy * tile.w + xx) * 4, a = tile.data[i + 3] / 255 * weight;
      for (let k = 0; k < 3; k++) rgb[k] += tile.data[i + k] * a;
      alpha += a;
    }
    const i = (y * w + x) * 4;
    if (alpha) for (let k = 0; k < 3; k++) result.data[i + k] = Math.round(rgb[k] / alpha);
    result.data[i + 3] = Math.round(alpha * 255);
  }
  return result;
}

for (const [side, names] of [['front', front], ['back', back]]) {
  const sheet = readPng(path.join(here, `sources/outfit-${side}.png`));
  assert.equal(sheet.w, sheet.h, 'garment sheet must be square');
  const stem = path.join(target, side === 'back' ? 'back' : '', 'chen_qianyu');
  const atlas = readAtlas(stem + '.atlas'), image = readPng(stem + '.png');
  const before = Buffer.from(image.data), allowed = new Uint8Array(image.w * image.h);
  const selected = names.filter(n => !/_Hip$/.test(n) && n !== 'B_Chest');
  for (const name of selected) {
    const region = atlas.get(name); assert.ok(region, name);
    // Waist is the last torso layer, after both thighs. Move its mesh below the waist instead of painting
    // a skirt on the hip layer (which the original rig draws behind one thigh).
    let source = /Waist_B$|B_Waist$/.test(name) ? side === 'front' ? 'F_Hip' : 'B_Hip' : name;
    if (/_Leg$/.test(name)) source = name.replace('_Leg', '_Calf');
    const cropped = /Coat$/.test(name);
    const height = cropped ? Math.round(region.sh * .72) : region.sh;
    const input = /_Calf$/.test(name) ? readPng(path.join(here, `sources/boot-${name.includes('_L_') ? 'left' : 'right'}.png`))
      : name === 'F_Waist_A' ? garment(readPng(path.join(here, 'sources/outfit-back.png')), back.indexOf('B_Waist'))
      : garment(sheet, names.indexOf(source));
    const tile = fit(input, region.sw, height);
    for (let y = 0; y < region.sh; y++) for (let x = 0; x < region.sw; x++) {
      const xx = region.rotate ? region.x + y : region.x + x;
      const yy = region.rotate ? region.y + region.h - 1 - x : region.y + y;
      const dst = (yy * image.w + xx) * 4; allowed[yy * image.w + xx] = 1;
      image.data.fill(0, dst, dst + 4);
      if (y < tile.h) tile.data.copy(image.data, dst, (y * tile.w + x) * 4, (y * tile.w + x) * 4 + 4);
    }
  }
  for (let i = 0; i < allowed.length; i++) if (!allowed[i]) {
    assert.ok(image.data.subarray(i * 4, i * 4 + 4).equals(before.subarray(i * 4, i * 4 + 4)), 'a protected atlas pixel changed');
  }
  writePng(stem + '.png', image);
  fitSkirtMesh(stem + '.skel', side);
  console.log(`${side}: ${selected.length} outfit regions updated; skirt mesh fitted; other regions and animation data preserved.`);
}

/** Patch only the skirt mesh's position floats; keep weights, animations, bones and other attachment bytes. */
function fitSkirtMesh(file, side) {
  const bytes = Buffer.from(fs.readFileSync(file));
  const loader = {};
  for (const kind of ['Region', 'Mesh', 'BoundingBox', 'Path', 'Point', 'Clipping']) {
    loader[`new${kind}Attachment`] = (skin, name, p) => {
      const a = new spine[`${kind}Attachment`](name); a.path = p ?? name; return a;
    };
  }
  const name = side === 'front' ? 'F_Waist_B' : 'B_Waist';
  class Reader extends spine.SkeletonBinary {
    readAttachment(input, data, skin, slotIndex, attachmentName, nonessential) {
      this.activeName = attachmentName;
      return super.readAttachment(input, data, skin, slotIndex, attachmentName, nonessential);
    }
    readVertices(input, count) {
      if (this.activeName !== name) return super.readVertices(input, count);
      this.vertexOffsets = [];
      const read = input.readFloat;
      input.readFloat = () => { this.vertexOffsets.push(input.index); return read.call(input); };
      try { return super.readVertices(input, count); } finally { input.readFloat = read; }
    }
  }
  const reader = new Reader(loader);
  // A fresh Uint8Array avoids Buffer.byteOffset ambiguity in the Spine BinaryInput DataView.
  const data = reader.readSkeletonData(new Uint8Array(bytes));
  const model = new spine.Skeleton(data); model.setToSetupPose(); model.updateWorldTransform();
  const entry = data.defaultSkin.getAttachments().find(e => e.attachment.path === name);
  assert.ok(entry && reader.vertexOffsets.length);
  const a = entry.attachment;
  let weightIndex = 0, floatIndex = 0;
  for (let i = 0; i < a.regionUVs.length; i += 2) {
    const count = a.bones ? a.bones[weightIndex++] : 1;
    for (let j = 0; j < count; j++) {
      const bone = a.bones ? model.bones[a.bones[weightIndex++]] : model.slots[entry.slotIndex].bone;
      const point = { x: (a.regionUVs[i] - .5) * 96, y: -156 + a.regionUVs[i + 1] * 59 };
      bone.worldToLocal(point);
      bytes.writeFloatBE(point.x, reader.vertexOffsets[floatIndex++]);
      bytes.writeFloatBE(point.y, reader.vertexOffsets[floatIndex++]);
      if (a.bones) floatIndex++; // preserve the following weight float
    }
  }
  assert.equal(floatIndex, reader.vertexOffsets.length, 'every skirt coordinate was accounted for');
  fs.writeFileSync(file, bytes);
}
