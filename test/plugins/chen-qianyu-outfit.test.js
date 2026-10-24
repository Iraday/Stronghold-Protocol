import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readPng, readAtlas } from '../../tools/chen-qianyu-art/png.mjs';

const require = createRequire(import.meta.url);
const spine = require('@pixi-spine/runtime-3.8');
const root = fileURLToPath(new URL('../../', import.meta.url));
const assets = path.join(root, 'plugins/chen-qianyu-art/art/spine');
const files = ['chen_qianyu.png', 'chen_qianyu.skel', 'chen_qianyu.atlas',
  'back/chen_qianyu.png', 'back/chen_qianyu.skel', 'back/chen_qianyu.atlas'];

test('the maintained outfit rebuild is byte-identical and does not drift when repeated', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cqy-outfit-'));
  t.after(() => {
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('cqy-outfit-'));
    fs.rmSync(temp, { recursive: true, force: true });
  });
  fs.cpSync(assets, temp, { recursive: true });
  const before = files.map(file => fs.readFileSync(path.join(temp, file)));
  for (let i = 0; i < 2; i++) {
    execFileSync(process.execPath, [path.join(root, 'tools/chen-qianyu-art/apply-outfit.mjs'), temp]);
    for (const [index, file] of files.entries()) {
      assert.deepEqual(fs.readFileSync(path.join(temp, file)), before[index], `${file}: rebuild ${i + 1}`);
    }
  }
});

function pixels(side, name) {
  const stem = path.join(assets, side === 'front' ? '' : 'back', 'chen_qianyu');
  const image = readPng(stem + '.png'), r = readAtlas(stem + '.atlas').get(name), out = [];
  assert.ok(r, name);
  for (let y = 0; y < r.sh; y++) for (let x = 0; x < r.sw; x++) {
    const xx = r.rotate ? r.x + y : r.x + x, yy = r.rotate ? r.y + r.h - 1 - x : r.y + y;
    out.push({ x, y, rgba: [...image.data.subarray((yy * image.w + xx) * 4, (yy * image.w + xx) * 4 + 4)], w: r.sw, h: r.sh });
  }
  return out;
}

test('both gray eyes retain red pupils, and all four horn roots have pink accents', () => {
  const eyes = pixels('front', 'F_Eyes').filter(p => p.rgba[3] > 127);
  const red = eyes.filter(({ rgba: [r, g, b] }) => r > 100 && r > g * 1.6 && r > b * 1.3);
  for (const half of [0, 1]) assert.ok(red.filter(p => +(p.x >= p.w / 2) === half).length >= 2, 'red pupil in each eye');
  for (const side of ['front', 'back']) for (const hand of ['L', 'R']) {
    const pink = pixels(side, `${side === 'front' ? 'F' : 'B'}_${hand}_Horn`)
      .filter(p => p.y > p.h * .6 && p.rgba[3] > 127)
      .filter(({ rgba: [r, g, b] }) => r > 100 && r > g * 1.3 && r > b * .95);
    assert.ok(pink.length > 3, `${side} ${hand}: pink horn root`);
  }
});

test('front apron is pale green over white, back skirt is white, and lower legs are fully dark stockings', () => {
  const visible = (side, name) => pixels(side, name).filter(p => p.rgba[3] > 180);
  const mint = visible('front', 'F_Waist_B').filter(({ rgba: [r, g, b] }) => g - r >= 10 && g >= b && g > 140);
  assert.ok(mint.length > 30, 'sage apron remains visible at game resolution');
  for (const side of ['front', 'back']) {
    const white = visible(side, side === 'front' ? 'F_Waist_B' : 'B_Waist')
      .filter(({ rgba: [r, g, b] }) => Math.min(r, g, b) > 200 && Math.max(r, g, b) - Math.min(r, g, b) < 22);
    assert.ok(white.length > 30, `${side}: white skirt remains exposed`);
    for (const leg of ['L', 'R']) {
      const lower = visible(side, `${side === 'front' ? 'F' : 'B'}_${leg}_Calf`);
      assert.ok(lower.length > 300);
      assert.ok(lower.every(p => Math.max(...p.rgba.slice(0, 3)) < 140), `${side} ${leg}: no bare lower leg`);
    }
  }
});

test('back neckline has only a thin collar, not a blue hood', () => {
  const collar = pixels('back', 'B_Hood'), height = Math.round(collar[0].h * 4 / 21);
  assert.ok(collar.some(p => p.rgba[3] > 127));
  assert.ok(collar.filter(p => p.y >= height).every(p => p.rgba[3] === 0));
});

test('both views use lighter blue gloves and softly highlighted charcoal hair', () => {
  for (const side of ['front', 'back']) {
    const prefix = side === 'front' ? 'F' : 'B';
    for (const name of [`${prefix}_L_Hand`, `${prefix}_R_Hand`, `${prefix}_L_Finger_1`]) {
      const visible = pixels(side, name).filter(p => p.rgba[3] > 180);
      const blue = visible.filter(({ rgba: [r, g, b] }) => g > r * 1.15 && b > g && b > 70);
      assert.ok(blue.length > visible.length * .25, `${name}: blue glove material`);
    }
    const hair = pixels(side, side === 'front' ? 'F_F_Hair' : 'B_Head')
      .filter(p => p.rgba[3] > 180 && Math.abs(p.rgba[0] - p.rgba[1]) < 20);
    const lightness = hair.reduce((sum, p) => sum + (p.rgba[0] + p.rgba[1] + p.rgba[2]) / 3, 0) / hair.length;
    assert.ok(lightness > 45 && lightness < 115, `${side}: charcoal, not deep black or pale gray`);
  }
});

for (const side of ['front', 'back']) test(`${side}: continuous skirt is on the hips and animation clips remain available`, () => {
  const loader = {};
  for (const kind of ['Region', 'Mesh', 'BoundingBox', 'Path', 'Point', 'Clipping']) {
    loader[`new${kind}Attachment`] = (skin, name, p) => {
      const a = new spine[`${kind}Attachment`](name); a.path = p ?? name; return a;
    };
  }
  const file = path.join(assets, side === 'front' ? '' : 'back', 'chen_qianyu.skel');
  const data = new spine.SkeletonBinary(loader).readSkeletonData(new Uint8Array(fs.readFileSync(file)));
  const model = new spine.Skeleton(data); model.setToSetupPose(); model.updateWorldTransform();
  const name = side === 'front' ? 'F_Waist_B' : 'B_Waist';
  const entry = data.defaultSkin.getAttachments().find(e => e.attachment.path === name);
  assert.ok(entry);
  const a = entry.attachment, vertices = new Float32Array(a.worldVerticesLength);
  a.computeWorldVertices(model.slots[entry.slotIndex], 0, vertices.length, vertices, 0, 2);
  for (let i = 0; i < vertices.length; i += 2) {
    assert.ok(Math.abs(vertices[i] - (a.regionUVs[i] - .5) * 116) < .001);
    assert.ok(Math.abs(vertices[i + 1] - (-156 + a.regionUVs[i + 1] * 75)) < .001);
  }
  for (const clip of ['Idle', 'Attack', 'Skill', 'Start']) assert.ok(data.findAnimation(clip), clip);
  const order = data.slots.map(s => s.name);
  for (const leg of side === 'front' ? ['F_L_Leg', 'F_R_Leg'] : ['B_L_Leg', 'B_R_Leg']) {
    assert.ok(order.indexOf(name) > order.indexOf(leg), 'skirt must draw over both thighs');
  }
});
