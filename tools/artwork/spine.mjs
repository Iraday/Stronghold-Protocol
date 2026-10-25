// Spine 3.8 inspection and constrained cloth fitting. Never executes plugin code.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const spine = require('@pixi-spine/runtime-3.8');

function positiveVarint(n) {
  const bytes = [];
  do { const b = n & 127; n >>>= 7; bytes.push(b | (n ? 128 : 0)); } while (n);
  return Buffer.from(bytes);
}

export function parseModel(bytes) {
  const loader = {};
  for (const kind of ['Region', 'Mesh', 'BoundingBox', 'Path', 'Point', 'Clipping']) {
    loader[`new${kind}Attachment`] = (skin, name, p) => { const a = new spine[`${kind}Attachment`](name); a.path = p ?? name; return a; };
  }
  const data = new spine.SkeletonBinary(loader).readSkeletonData(new Uint8Array(bytes));
  if (!String(data.version).startsWith('3.8.')) throw new Error('Artwork editing supports Spine 3.8 binary models only');
  return data;
}

export function modelInfo(data) {
  const motion = new Map(data.bones.map(b => [b.name, []]));
  for (const animation of data.animations.filter(a => ['Idle', 'Attack', 'Skill', 'Start'].includes(a.name))) {
    const extents = data.bones.map(() => [Infinity, Infinity, -Infinity, -Infinity]);
    for (let i = 0; i <= 16; i++) {
      const posed = poseModel(data, animation.name, animation.duration * i / 16);
      for (const [j, bone] of posed.bones.entries()) { const e = extents[j]; e[0] = Math.min(e[0], bone.worldX); e[1] = Math.min(e[1], bone.worldY); e[2] = Math.max(e[2], bone.worldX); e[3] = Math.max(e[3], bone.worldY); }
    }
    for (const [j, bone] of data.bones.entries()) {
      const e = extents[j].map(v => Math.round(v * 1000) / 1000);
      motion.get(bone.name).push({ clip: animation.name, x: [e[0], e[2]], y: [e[1], e[3]], span: Math.hypot(e[2] - e[0], e[3] - e[1]) });
    }
  }
  const influences = (a, slotIndex) => {
    if (!a.bones) return [data.slots[slotIndex].boneData.name];
    const names = new Set(); let at = 0;
    while (at < a.bones.length) { const count = a.bones[at++]; for (let i = 0; i < count; i++) names.add(data.bones[a.bones[at++]]?.name); }
    return [...names];
  };
  return {
    version: data.version,
    bones: data.bones.map(b => ({ name: b.name, parent: b.parent?.name ?? null, index: b.index, motion: motion.get(b.name) })),
    clips: data.animations.map(a => ({ name: a.name, duration: a.duration })),
    attachments: data.defaultSkin.getAttachments().map(({ slotIndex, name, attachment: a }) => ({
      name, path: a.path, slot: data.slots[slotIndex].name, bone: data.slots[slotIndex].boneData.name,
      type: a.type, vertices: a.worldVerticesLength / 2 || 0,
      influences: influences(a, slotIndex),
    })),
  };
}

export function poseModel(data, clip, time) {
  const model = new spine.Skeleton(data), state = new spine.AnimationState(new spine.AnimationStateData(data));
  if (!data.findAnimation(clip)) throw new Error(`Unknown animation: ${clip}`);
  model.setToSetupPose(); state.setAnimation(0, clip, false); state.update(time); state.apply(model); model.updateWorldTransform();
  return model;
}

export function worldVertices(slot) {
  const a = slot.getAttachment(), out = new Float32Array(a.worldVerticesLength);
  a.computeWorldVertices(slot, 0, out.length, out, 0, 2); return out;
}

export function mapPoint(slot, point, fromUv) {
  const a = slot.getAttachment(), world = worldVertices(slot);
  if (!a.triangles || !a.regionUVs) throw new Error('Coverage checks require a mesh attachment');
  const from = fromUv ? a.regionUVs : world, to = fromUv ? world : a.regionUVs;
  for (let i = 0; i < a.triangles.length; i += 3) {
    const triangle = Array.from(a.triangles.slice(i, i + 3)), [p, q, r] = triangle.map(j => [from[j * 2], from[j * 2 + 1]]);
    const det = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]);
    if (Math.abs(det) < 1e-8) continue;
    const x = ((q[1] - r[1]) * (point[0] - r[0]) + (r[0] - q[0]) * (point[1] - r[1])) / det;
    const y = ((r[1] - p[1]) * (point[0] - r[0]) + (p[0] - r[0]) * (point[1] - r[1])) / det, w = [x, y, 1 - x - y];
    if (Math.min(...w) < -.0001) continue;
    return [0, 1].map(axis => triangle.reduce((sum, vertex, j) => sum + w[j] * to[vertex * 2 + axis], 0));
  }
  return null;
}

export function rigFingerprint(data, ignored = []) {
  return JSON.stringify({ bones: data.bones, slots: data.slots, skins: data.skins, animations: data.animations }, function(k, v) {
    if (['id', 'timelineIds', 'deformAttachment', 'region', 'parentMesh'].includes(k)) return undefined;
    if (k === 'attachment') return v?.path;
    if (['vertices', 'bones'].includes(k) && ignored.includes(this.path)) return '<edited mesh>';
    if (k === 'frameVertices' && ignored.includes(this.attachment?.path)) return '<edited mesh deform>';
    return v;
  });
}

export function fitCloth(bytesInput, config) {
  const bytes = Buffer.from(bytesInput);
  const loader = {};
  for (const kind of ['Region', 'Mesh', 'BoundingBox', 'Path', 'Point', 'Clipping']) {
    loader[`new${kind}Attachment`] = (skin, name, p) => {
      const a = new spine[`${kind}Attachment`](name); a.path = p ?? name; return a;
    };
  }
  const name = config.attachment;
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
  const waist = model.bones.find(b => b.data.name === config.bodyBone);
  const legs = config.legBones.map(name => model.bones.find(b => b.data.name === name))
    .sort((left, right) => left.worldX - right.worldX);
  assert.ok([waist, ...legs].every(bone => bone && bone.data.index < 4096));
  for (const leg of legs) { let parent = leg.parent; while (parent && parent !== waist) parent = parent.parent; assert.ok(parent === waist, 'cloth legs must inherit the moving body bone'); }
  const encoded = [Buffer.from([1])]; // weighted mesh; same UVs, triangle topology and number of world vertices
  for (let i = 0; i < a.regionUVs.length; i += 2) {
    const u = a.regionUVs[i], v = a.regionUVs[i + 1], width = config.profile.topWidth + (config.profile.hemWidth - config.profile.topWidth) * Math.min(1, v / config.profile.flareAt);
    const legWeight = config.profile.hemLegWeight * v;
    const influences = [
      [waist, 1 - legWeight],
      [legs[0], legWeight * (1 - u)], [legs[1], legWeight * u],
    ].filter(([, weight]) => weight > .000001);
    encoded.push(positiveVarint(influences.length));
    for (const [bone, weight] of influences) {
      const point = { x: (u - .5) * width, y: config.profile.top + v * config.profile.length }; bone.worldToLocal(point);
      const influence = Buffer.alloc(12);
      influence.writeFloatBE(point.x, 0); influence.writeFloatBE(point.y, 4); influence.writeFloatBE(weight, 8);
      encoded.push(positiveVarint(bone.data.index), influence);
    }
  }
  for (const offset of reader.skirtDeformOffsets ?? []) bytes.writeFloatBE(0, offset);
  return Buffer.concat([bytes.subarray(0, reader.vertexStart), ...encoded, bytes.subarray(reader.vertexEnd)]);
}
