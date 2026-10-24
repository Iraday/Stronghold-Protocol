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

function readModel(side) {
  const loader = {};
  for (const kind of ['Region', 'Mesh', 'BoundingBox', 'Path', 'Point', 'Clipping']) {
    loader[`new${kind}Attachment`] = (skin, name, p) => {
      const a = new spine[`${kind}Attachment`](name); a.path = p ?? name; return a;
    };
  }
  const file = path.join(assets, side === 'front' ? '' : 'back', 'chen_qianyu.skel');
  const data = new spine.SkeletonBinary(loader).readSkeletonData(new Uint8Array(fs.readFileSync(file)));
  const model = new spine.Skeleton(data); model.setToSetupPose(); model.updateWorldTransform();
  return { data, model };
}

for (const side of ['front', 'back']) test(`${side}: full flared skirt uses blended body weights, without torso-panel deformation`, () => {
  const { data, model } = readModel(side);
  const name = side === 'front' ? 'F_Waist_B' : 'B_Waist';
  const entry = data.defaultSkin.getAttachments().find(e => e.attachment.path === name);
  assert.ok(entry);
  const a = entry.attachment, vertices = new Float32Array(a.worldVerticesLength);
  a.computeWorldVertices(model.slots[entry.slotIndex], 0, vertices.length, vertices, 0, 2);
  for (let i = 0; i < vertices.length; i += 2) {
    const width = 144 + 36 * Math.min(1, a.regionUVs[i + 1] * 2);
    assert.ok(Math.abs(vertices[i] - (a.regionUVs[i] - .5) * width) < .001);
    assert.ok(Math.abs(vertices[i + 1] - (-168 + a.regionUVs[i + 1] * 87)) < .001);
  }
  assert.ok(a.bones, 'both views must use a weighted skirt');
  const prefix = side === 'front' ? 'F' : 'B';
  let boneOffset = 0, valueOffset = 0;
  for (let vertex = 0; vertex < a.regionUVs.length / 2; vertex++) {
    const count = a.bones[boneOffset++], weights = new Map();
    for (let influence = 0; influence < count; influence++) {
      weights.set(data.bones[a.bones[boneOffset++]].name, a.vertices[valueOffset + 2]); valueOffset += 3;
    }
    const v = a.regionUVs[vertex * 2 + 1];
    assert.ok(Math.abs([...weights.values()].reduce((sum, w) => sum + w, 0) - 1) < .00001);
    if (v < .001) assert.ok(weights.get(name) > .85, 'waistband must follow the torso, not remain a rigid hip plate');
    if (v > .99) {
      const legs = (weights.get(`${prefix}_L_Leg`) || 0) + (weights.get(`${prefix}_R_Leg`) || 0);
      assert.ok(legs > .35 && legs < .55, 'hem must flex with the legs');
      assert.ok(weights.get(name) > .5, 'hem follows the moving waist');
    }
    assert.ok(!weights.has(`${prefix}_Hip`), 'stationary entrance helper must not anchor any skirt vertex');
  }
  for (const clip of data.animations) for (const timeline of clip.timelines) {
    if (timeline.attachment !== a) continue;
    assert.ok(timeline.frameVertices.every(frame => frame.every(n => n === 0)), `${clip.name}: no legacy shirt deform`);
  }
  for (const clip of ['Idle', 'Attack', 'Skill', 'Start']) assert.ok(data.findAnimation(clip), clip);
  const order = data.slots.map(s => s.name);
  for (const leg of side === 'front' ? ['F_L_Leg', 'F_R_Leg'] : ['B_L_Leg', 'B_R_Leg']) {
    assert.ok(order.indexOf(name) > order.indexOf(leg), 'skirt must draw over both thighs');
  }
});

for (const side of ['front', 'back']) test(`${side}: skirt flexes with breathing instead of moving as a rigid pelvis card`, () => {
  const { data, model } = readModel(side), prefix = side === 'front' ? 'F' : 'B';
  const a = data.defaultSkin.getAttachments().find(e => e.attachment.path === (side === 'front' ? 'F_Waist_B' : 'B_Waist'));
  const pelvis = model.bones.find(b => b.data.name === `${prefix}_Hip`);
  const samples = [];
  for (const time of [0, .25, .5, .75, 1]) {
    model.setToSetupPose();
    const state = new spine.AnimationState(new spine.AnimationStateData(data));
    state.setAnimation(0, 'Idle', true); state.update(time); state.apply(model); model.updateWorldTransform();
    const vertices = new Float32Array(a.attachment.worldVerticesLength);
    a.attachment.computeWorldVertices(model.slots[a.slotIndex], 0, vertices.length, vertices, 0, 2);
    const relative = [];
    for (let i = 0; i < vertices.length; i += 2) {
      const point = { x: vertices[i], y: vertices[i + 1] }; pelvis.worldToLocal(point); relative.push(point.x, point.y);
    }
    samples.push(relative);
  }
  let flex = 0;
  for (const sample of samples) for (let i = 0; i < sample.length; i++) flex = Math.max(flex, Math.abs(sample[i] - samples[0][i]));
  assert.ok(flex > .05, `cloth must flex relative to pelvis; measured ${flex}`);
});

for (const side of ['front', 'back']) test(`${side}: skirt stays with the body without detachment/stretching through every clip`, () => {
  const { data, model } = readModel(side), name = side === 'front' ? 'F_Waist_B' : 'B_Waist';
  const entry = data.defaultSkin.getAttachments().find(e => e.attachment.path === name), waist = model.slots[entry.slotIndex].bone;
  for (const clip of data.animations) for (let i = 0; i <= 30; i++) {
    model.setToSetupPose();
    const state = new spine.AnimationState(new spine.AnimationStateData(data));
    state.setAnimation(0, clip.name, false); state.update(clip.duration * i / 30); state.apply(model); model.updateWorldTransform();
    const a = entry.attachment, vertices = new Float32Array(a.worldVerticesLength);
    a.computeWorldVertices(model.slots[entry.slotIndex], 0, vertices.length, vertices, 0, 2);
    const scale = Math.max(.01, Math.hypot(waist.matrix.a, waist.matrix.b), Math.hypot(waist.matrix.c, waist.matrix.d));
    for (let vertex = 0; vertex < vertices.length; vertex += 2) {
      const distance = Math.hypot(vertices[vertex] - waist.worldX, vertices[vertex + 1] - waist.worldY) / scale;
      assert.ok(distance < 200, `${clip.name} frame ${i}: skirt detached or stretched (${distance})`);
    }
  }
});

function weights(points, triangle, point) {
  const [a, b, c] = triangle.map(i => [points[i * 2], points[i * 2 + 1]]);
  const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(det) < 1e-8) return null;
  const x = ((b[1] - c[1]) * (point[0] - c[0]) + (c[0] - b[0]) * (point[1] - c[1])) / det;
  const y = ((c[1] - a[1]) * (point[0] - c[0]) + (a[0] - c[0]) * (point[1] - c[1])) / det;
  return Math.min(x, y, 1 - x - y) >= -.0001 ? [x, y, 1 - x - y] : null;
}

function mapPoint(slot, point, fromUv) {
  const a = slot.getAttachment(), world = new Float32Array(a.worldVerticesLength);
  a.computeWorldVertices(slot, 0, world.length, world, 0, 2);
  const from = fromUv ? a.regionUVs : world, to = fromUv ? world : a.regionUVs;
  for (let i = 0; i < a.triangles.length; i += 3) {
    const triangle = Array.from(a.triangles.slice(i, i + 3)), w = weights(from, triangle, point);
    if (w) return [0, 1].map(axis => triangle.reduce((sum, vertex, j) => sum + w[j] * to[vertex * 2 + axis], 0));
  }
  return null;
}

for (const side of ['front', 'back']) test(`${side}: skirt covers upper-thigh roots in idle, attack and skill poses`, () => {
  const { data, model } = readModel(side), prefix = side === 'front' ? 'F' : 'B';
  const stem = path.join(assets, side === 'front' ? '' : 'back', 'chen_qianyu');
  const image = readPng(stem + '.png'), region = readAtlas(stem + '.atlas').get(side === 'front' ? 'F_Waist_B' : 'B_Waist');
  for (const clip of ['Idle', 'Attack', 'Skill']) {
    model.setToSetupPose();
    const state = new spine.AnimationState(new spine.AnimationStateData(data));
    state.setAnimation(0, clip, false); state.update(clip === 'Idle' ? .5 : .35); state.apply(model); model.updateWorldTransform();
    const skirt = model.slots.find(slot => slot.getAttachment()?.path === (side === 'front' ? 'F_Waist_B' : 'B_Waist'));
    for (const leg of ['L', 'R']) {
      const slot = model.slots.find(s => s.getAttachment()?.path === `${prefix}_${leg}_Leg`);
      for (const v of [.12, .3]) {
        const world = mapPoint(slot, [.5, v], true); assert.ok(world);
        const uv = mapPoint(skirt, world, false);
        assert.ok(uv, `${clip} ${leg} v=${v} world=${world}: upper thigh remains inside skirt mesh`);
        const x = Math.max(0, Math.min(region.sw - 1, Math.round(uv[0] * (region.sw - 1))));
        const y = Math.max(0, Math.min(region.sh - 1, Math.round(uv[1] * (region.sh - 1))));
        const xx = region.rotate ? region.x + y : region.x + x;
        const yy = region.rotate ? region.y + region.h - 1 - x : region.y + y;
        assert.ok(image.data[(yy * image.w + xx) * 4 + 3] > 127, `${clip} ${leg} v=${v} uv=${uv}: opaque cloth covers upper thigh`);
      }
    }
  }
});
