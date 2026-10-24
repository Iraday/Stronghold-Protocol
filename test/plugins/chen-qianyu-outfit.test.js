import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

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
    assert.ok(Math.abs(vertices[i] - (a.regionUVs[i] - .5) * 96) < .001);
    assert.ok(Math.abs(vertices[i + 1] - (-156 + a.regionUVs[i + 1] * 59)) < .001);
  }
  for (const clip of ['Idle', 'Attack', 'Skill', 'Start']) assert.ok(data.findAnimation(clip), clip);
  const order = data.slots.map(s => s.name);
  for (const leg of side === 'front' ? ['F_L_Leg', 'F_R_Leg'] : ['B_L_Leg', 'B_R_Leg']) {
    assert.ok(order.indexOf(name) > order.indexOf(leg), 'skirt must draw over both thighs');
  }
});
