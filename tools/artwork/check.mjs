import { modelFiles, projectHash, fileSnapshot, readReview, assertFresh } from './project.mjs';
import { poseModel, worldVertices, mapPoint } from './spine.mjs';
import { extractRegion } from './image.mjs';

const colors = {
  red: ([r, g, b]) => r > 100 && r > g * 1.6 && r > b * 1.3,
  pink: ([r, g, b]) => r > 100 && r > g * 1.3 && r > b * .95,
  blue: ([r, g, b]) => g > r * 1.15 && b > g && b > 70,
  sage: ([r, g, b]) => g - r >= 10 && g >= b && g > 140,
  white: ([r, g, b]) => Math.min(r, g, b) > 200 && Math.max(r, g, b) - Math.min(r, g, b) < 22,
  dark: ([r, g, b]) => Math.max(r, g, b) < 140,
  charcoal: ([r, g, b]) => (r + g + b) / 3 > 45 && (r + g + b) / 3 < 115 && Math.max(r, g, b) - Math.min(r, g, b) < 30,
};

/** Numeric checks are evidence, never a substitute for the recorded human visual checklist. */
export function checkProject(ctx, draft = null) {
  const project = draft?.project || ctx.project, dir = draft?.dir || ctx.pluginDir, results = [];
  const run = (id, action) => {
    try { const metrics = action(); results.push({ id, status: 'pass', metrics }); }
    catch (e) { results.push({ id, status: 'fail', detail: e.message }); }
  };
  const require = (value, message) => { if (!value) throw new Error(message); };
  const files = new Map();
  for (const model of project.models) run(`${model.id}/atlas-and-rig`, () => {
    const f = modelFiles(ctx, model, dir); files.set(model.id, f);
    return { dimensions: [f.image.w, f.image.h], regions: f.regions.size, clips: f.data.animations.length };
  });
  for (const model of project.models) {
    const f = files.get(model.id); if (!f) continue;
    run(`${model.id}/all-animation-frames`, () => {
      let samples = 0, maxRadius = 0;
      for (const clip of f.data.animations) for (let i = 0; i < (model.cloth?.samples || 31); i++) {
        const posed = poseModel(f.data, clip.name, clip.duration * i / ((model.cloth?.samples || 31) - 1)); samples++;
        for (const slot of posed.slots) {
          const a = slot.getAttachment(); if (!a?.worldVerticesLength) continue;
          const vertices = worldVertices(slot); require(vertices.every(Number.isFinite), `${clip.name}: non-finite vertices`);
          if (model.cloth?.attachment !== a.path) continue;
          const body = posed.bones.find(b => b.data.name === model.cloth.bodyBone);
          require(body, 'Unknown moving body bone');
          const scale = Math.max(.01, Math.hypot(body.matrix.a, body.matrix.b), Math.hypot(body.matrix.c, body.matrix.d));
          for (let v = 0; v < vertices.length; v += 2) {
            const radius = Math.hypot(vertices[v] - body.worldX, vertices[v + 1] - body.worldY) / scale;
            maxRadius = Math.max(maxRadius, radius); require(radius < model.cloth.maxRadius, `${clip.name} sample ${i}: cloth detached/stretched (${radius.toFixed(2)})`);
          }
        }
      }
      return { samples, maxBodyRadius: maxRadius };
    });
    if (model.cloth) run(`${model.id}/cloth-influences`, () => {
      const a = f.data.defaultSkin.getAttachments().find(e => e.attachment.path === model.cloth.attachment)?.attachment;
      require(a?.bones, 'Cloth must use explicit weighted influences');
      const forbidden = new Set(model.cloth.forbiddenBones), used = new Set(); let at = 0, value = 0;
      while (at < a.bones.length) {
        const count = a.bones[at++]; let sum = 0;
        for (let i = 0; i < count; i++) {
          const bone = f.data.bones[a.bones[at++]], weight = a.vertices[value + 2]; value += 3;
          require(bone && !forbidden.has(bone.name), `Stationary/forbidden influence: ${bone?.name}`);
          sum += weight; used.add(bone.name);
        }
        require(Math.abs(sum - 1) < .00001, 'Weights do not sum to one');
      }
      require(used.has(model.cloth.bodyBone), 'Cloth must follow the moving body');
      return { influences: [...used] };
    });
  }
  for (const c of project.checks) run(c.id, () => {
    const f = files.get(c.model); require(f, 'Model failed validation');
    const region = f.regions.get(c.region); require(region, `Unknown region: ${c.region}`);
    const tile = extractRegion(f.image, region);
    if (c.kind === 'transparent') {
      let opaque = 0;
      for (let y = Math.ceil(tile.h * c.fromY); y < tile.h; y++) for (let x = 0; x < tile.w; x++) if (tile.data[(y * tile.w + x) * 4 + 3]) opaque++;
      require(!opaque, `${opaque} pixels remain below the thin collar/occupied band`); return { opaque };
    }
    if (c.kind === 'color') {
      const groups = c.split === 'halves' ? [0, 1] : [null], counts = [];
      for (const half of groups) {
        let visible = 0, matching = 0;
        for (let y = Math.floor(tile.h * (c.fromY || 0)); y < tile.h; y++) for (let x = 0; x < tile.w; x++) {
          if (half !== null && +(x >= tile.w / 2) !== half) continue;
          const rgba = tile.data.subarray((y * tile.w + x) * 4, (y * tile.w + x) * 4 + 4);
          if (rgba[3] < 128) continue; visible++; if (colors[c.color](rgba)) matching++;
        }
        require(visible && matching >= (c.minCount || 1) && matching / visible >= (c.minFraction || 0), `${c.color}: ${matching}/${visible} pixels match${half === null ? '' : ` in eye half ${half}`}`);
        counts.push({ visible, matching });
      }
      return { color: c.color, counts };
    }
    let samples = 0;
    for (const clip of c.clips) {
      const posed = poseModel(f.data, clip, clip === 'Idle' ? .5 : .35);
      const cloth = posed.slots.find(s => s.getAttachment()?.path === c.region); require(cloth, `Missing cloth slot: ${c.region}`);
      for (const name of c.under) {
        const under = posed.slots.find(s => s.getAttachment()?.path === name); require(under, `Missing under-layer: ${name}`);
        for (const sample of c.uv) {
          const world = mapPoint(under, sample, true); require(world, `UV sample outside ${name}`);
          const uv = mapPoint(cloth, world, false); require(uv, `${clip}/${name}: hip-root point outside skirt mesh`);
          const x = Math.max(0, Math.min(tile.w - 1, Math.round(uv[0] * (tile.w - 1)))), y = Math.max(0, Math.min(tile.h - 1, Math.round(uv[1] * (tile.h - 1))));
          require(tile.data[(y * tile.w + x) * 4 + 3] > 127, `${clip}/${name}: transparent gap over upper thigh`); samples++;
        }
      }
    }
    return { samples };
  });
  if (draft) run('draft-freshness', () => {
    require(draft.assetHash === fileSnapshot(draft.dir).hash, 'Draft bytes changed');
    assertFresh(ctx, draft);
    return { assetHash: draft.assetHash };
  });
  const review = draft ? readReview(ctx, draft) : null;
  const fresh = !results.some(r => r.id === 'draft-freshness' && r.status === 'fail');
  const manual = project.details.map(detail => ({ ...detail, status: fresh && review?.inputHash === draft?.inputHash && review?.projectHash === projectHash(project) && review.checked.includes(detail.id) ? 'reviewed' : 'pending' }));
  return { format: 1, project: project.id, projectHash: projectHash(project), assetHash: draft?.assetHash || fileSnapshot(dir).hash,
    results, failures: results.filter(r => r.status === 'fail').length, manual, manualPending: manual.filter(d => d.status !== 'reviewed').length };
}
