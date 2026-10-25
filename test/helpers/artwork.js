import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadProject, modelFiles } from '../../tools/artwork/project.mjs';
import { extractRegion } from '../../tools/artwork/image.mjs';
import { writePng } from '../../tools/artwork/png.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-artwork-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('sp-artwork-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'plugins'), { recursive: true }); fs.mkdirSync(path.join(root, 'artwork')); fs.mkdirSync(path.join(root, 'data'));
  fs.cpSync(path.join(ROOT, 'plugins/chen-qianyu-art'), path.join(root, 'plugins/chen-qianyu-art'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'artwork/chen-qianyu.json'), path.join(root, 'artwork/chen-qianyu.json'));
  fs.copyFileSync(path.join(ROOT, 'data/assets.json'), path.join(root, 'data/assets.json'));
  return loadProject(root, 'artwork/chen-qianyu.json');
}
export function edited(ctx, { version = ctx.manifest.version.replace(/\d+$/, patch => String(Number(patch) + 1)) } = {}) {
  const f = modelFiles(ctx, ctx.project.models[0]), tile = extractRegion(f.image, f.regions.get('F_Head'));
  const at = tile.data.findIndex((_, i) => i % 4 === 3 && tile.data[i] === 255) - 3;
  assert.ok(at >= 0); tile.data[at] ^= 1;
  fs.mkdirSync(path.join(ctx.root, 'materials'), { recursive: true }); writePng(path.join(ctx.root, 'materials/piece.png'), tile);
  const p = structuredClone(ctx.project); p.version = version;
  p.operations.push({ model: 'front', region: 'F_Head', source: { path: 'materials/piece.png', trim: false } });
  fs.writeFileSync(ctx.projectFile, JSON.stringify(p)); return loadProject(ctx.root, ctx.projectFile);
}
export const reviewInput = (ctx, draft, checked = ctx.project.details.map(d => d.id)) => ({
  assetHash: draft.assetHash, reviewer: 'Automated fixture only', checked, notes: 'Exercises the review gate on disposable test bytes; this is not an artwork approval.',
});
