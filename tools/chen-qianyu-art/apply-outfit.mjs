// Fit the maintained artwork into Spine UV regions with a flared skirt blended across the moving waist and legs.
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
const refinements = [
  { file: 'refinement-identity.png', cols: 4, rows: 4, names: ['F_Eyes', 'F_B_Hair', 'F_F_Hair', 'F_L_Hair',
    'F_R_Hair_A', 'F_R_Hair_B', 'F_L_Braid', 'F_R_Braid', 'F_L_Horn', 'F_R_Horn', 'B_Head', 'B_F_Hair',
    'B_L_Braid', 'B_R_Braid', 'B_L_Horn', 'B_R_Horn'] },
  { file: 'refinement-gloves.png', cols: 5, rows: 4, names: ['F_L_Hand', 'F_R_Hand', 'F_L_Hand_B', 'F_L_Hand_C',
    'F_R_Hand_B', 'F_L_Finger', 'F_L_Finger_1', 'F_L_Finger_2', 'F_L_Finger_3', 'F_L_Finger_4', 'F_L_Finger_5',
    'B_L_Hand', 'B_R_Hand', 'B_L_Hand_B', 'B_L_Finger', 'B_L_Finger_1', 'B_L_Finger_2', 'B_L_Finger_3',
    'B_L_Finger_4', 'B_L_Finger_5'] },
  { file: 'refinement-tailoring.png', cols: 4, rows: 2, names: ['F_Waist_B', 'B_Waist', 'B_Hood', 'F_L_Calf',
    'F_R_Calf', 'B_L_Calf', 'B_R_Calf'] },
];

/** Remove detached transparent-edge noise and isolate the largest connected garment inside its fixed sheet cell. */
function garment(sheet, index, cols = 4, rows = 4, multiple = false) {
  const cellWidth = sheet.w / cols, cellHeight = sheet.h / rows;
  const x0 = Math.max(0, Math.floor(index % cols * cellWidth) - 12);
  const y0 = Math.max(0, Math.floor(Math.floor(index / cols) * cellHeight) - 8);
  const x1 = Math.min(sheet.w, Math.ceil((index % cols + 1) * cellWidth) + 12);
  const y1 = Math.min(sheet.h, Math.ceil((Math.floor(index / cols) + 1) * cellHeight) + 8);
  const width = x1 - x0, height = y1 - y0, visited = new Uint8Array(width * height);
  let largest = [];
  const components = [];
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
    components.push(queue);
  }
  assert.ok(largest.length > 100, `empty garment cell ${index}`);
  // Eyes are two separate clusters. Keeping just the largest would silently erase the other eye.
  if (multiple) largest = components.filter(c => c.length >= largest.length * .03).flat();
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
  upgradeAtlas(stem, side === 'front' ? 1024 : 512);
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
  for (const { file, cols, rows, names: parts } of refinements) {
    const detail = readPng(path.join(here, 'sources', file));
    for (const [index, name] of parts.entries()) {
      if (name.startsWith('B_') !== (side === 'back')) continue;
      const region = atlas.get(name); assert.ok(region, name);
      // Replace the hood with only a thin collar along its top; do not stretch it back into a hood-sized panel.
      const height = name === 'B_Hood' ? Math.round(region.sh * 4 / 21) : region.sh;
      const tile = fit(garment(detail, index, cols, rows, name === 'F_Eyes'), region.sw, height);
      for (let y = 0; y < region.sh; y++) for (let x = 0; x < region.sw; x++) {
        const xx = region.rotate ? region.x + y : region.x + x;
        const yy = region.rotate ? region.y + region.h - 1 - x : region.y + y;
        const dst = (yy * image.w + xx) * 4; allowed[yy * image.w + xx] = 1;
        image.data.fill(0, dst, dst + 4);
        if (y < height) tile.data.copy(image.data, dst, (y * tile.w + x) * 4, (y * tile.w + x) * 4 + 4);
      }
    }
  }
  for (let i = 0; i < allowed.length; i++) if (!allowed[i]) {
    assert.ok(image.data.subarray(i * 4, i * 4 + 4).equals(before.subarray(i * 4, i * 4 + 4)), 'a protected atlas pixel changed');
  }
  writePng(stem + '.png', image);
  fitSkirtMesh(stem + '.skel', side);
  console.log(`${side}: outfit fitted; skirt body/hem weights blended; other artwork, bones and non-skirt animation preserved.`);
}

/** Double the UV page once so the new pupils/apron are not reduced to the original tiny texture tiles. */
function upgradeAtlas(stem, width) {
  const image = readPng(stem + '.png');
  if (image.w === width) return;
  assert.equal(image.w * 2, width, 'only a one-time 2x UV upgrade is supported');
  const result = { w: image.w * 2, h: image.h * 2, data: Buffer.alloc(image.data.length * 4) };
  // Nearest-neighbor preserves every original pixel/alpha value, including unaffected weapon and VFX pieces.
  for (let y = 0; y < result.h; y++) for (let x = 0; x < result.w; x++) {
    const src = (Math.floor(y / 2) * image.w + Math.floor(x / 2)) * 4;
    image.data.copy(result.data, (y * result.w + x) * 4, src, src + 4);
  }
  const atlas = fs.readFileSync(stem + '.atlas', 'utf8').replace(
    /^(\s*(?:size|xy|orig|offset):\s*)(-?\d+)\s*,\s*(-?\d+)/gm,
    (_, key, a, b) => `${key}${Number(a) * 2},${Number(b) * 2}`);
  writePng(stem + '.png', result);
  fs.writeFileSync(stem + '.atlas', atlas);
}

/** Follow the animated waist and flex the hem with its leg children; never bind to the stationary hip helper. */
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
      this.vertexStart = input.index;
      const result = super.readVertices(input, count);
      this.vertexEnd = input.index;
      return result;
    }
    readAnimation(input, clipName, data) {
      // The legacy waist attachment was a deforming torso panel. Keep its frame times/curves, but zero only
      // its explicit vertex offsets; the new multi-bone weights provide cloth movement instead.
      let context = null;
      const originals = data.skins.map(skin => skin.getAttachment);
      const readInt = input.readInt, readFloat = input.readFloat;
      const finishFrame = () => { context.remaining--; context.phase = context.remaining ? 'time' : 'done'; };
      data.skins.forEach((skin, i) => {
        skin.getAttachment = (...args) => {
          const attachment = originals[i].apply(skin, args);
          context = attachment?.path === name ? { phase: 'frames' } : null;
          return attachment;
        };
      });
      input.readInt = positive => {
        const value = readInt.call(input, positive);
        if (context?.phase === 'frames') { context.remaining = value; context.phase = 'time'; }
        else if (context?.phase === 'end') {
          context.count = value;
          if (value) context.phase = 'start'; else finishFrame();
        } else if (context?.phase === 'start') context.phase = 'vertices';
        return value;
      };
      input.readFloat = () => {
        const offset = input.index, value = readFloat.call(input);
        if (!this.readingCurve && context?.phase === 'time') context.phase = 'end';
        else if (!this.readingCurve && context?.phase === 'vertices') {
          (this.skirtDeformOffsets ??= []).push(offset);
          if (--context.count === 0) finishFrame();
        }
        return value;
      };
      try { return super.readAnimation(input, clipName, data); } finally {
        input.readInt = readInt; input.readFloat = readFloat;
        data.skins.forEach((skin, i) => { skin.getAttachment = originals[i]; });
      }
    }
    readCurve(input, frame, timeline) {
      this.readingCurve = true;
      try { return super.readCurve(input, frame, timeline); } finally { this.readingCurve = false; }
    }
  }
  const reader = new Reader(loader);
  // A fresh Uint8Array avoids Buffer.byteOffset ambiguity in the Spine BinaryInput DataView.
  const data = reader.readSkeletonData(new Uint8Array(bytes));
  const model = new spine.Skeleton(data); model.setToSetupPose(); model.updateWorldTransform();
  const entry = data.defaultSkin.getAttachments().find(e => e.attachment.path === name);
  assert.ok(entry && Number.isInteger(reader.vertexStart) && reader.vertexEnd > reader.vertexStart);
  const a = entry.attachment;
  const waist = model.slots[entry.slotIndex].bone;
  const prefix = side === 'front' ? 'F' : 'B';
  const legs = ['L', 'R'].map(leg => model.bones.find(b => b.data.name === `${prefix}_${leg}_Leg`))
    .sort((left, right) => left.worldX - right.worldX);
  assert.ok([waist, ...legs].every(bone => bone && bone.data.index < 128));
  const encoded = [Buffer.from([1])]; // weighted mesh; same UVs, triangle topology and number of world vertices
  for (let i = 0; i < a.regionUVs.length; i += 2) {
    const u = a.regionUVs[i], v = a.regionUVs[i + 1], width = 144 + 36 * Math.min(1, v * 2);
    const legWeight = .45 * v;
    const influences = [
      [waist, 1 - legWeight],
      [legs[0], legWeight * (1 - u)], [legs[1], legWeight * u],
    ].filter(([, weight]) => weight > .000001);
    encoded.push(Buffer.from([influences.length]));
    for (const [bone, weight] of influences) {
      const point = { x: (u - .5) * width, y: -168 + v * 87 }; bone.worldToLocal(point);
      const influence = Buffer.alloc(13);
      influence[0] = bone.data.index; // positive varint; this rig has fewer than 128 bones
      influence.writeFloatBE(point.x, 1); influence.writeFloatBE(point.y, 5); influence.writeFloatBE(weight, 9);
      encoded.push(influence);
    }
  }
  for (const offset of reader.skirtDeformOffsets ?? []) bytes.writeFloatBE(0, offset);
  fs.writeFileSync(file, Buffer.concat([bytes.subarray(0, reader.vertexStart), ...encoded, bytes.subarray(reader.vertexEnd)]));
}
