// Offline authoring projects. All builds are new drafts; never overwrite installed plugins or run plugin scripts.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readPng, writePng, readAtlas } from './png.mjs';
import { cropCell, replaceRegion, extractRegion } from './image.mjs';
import { parseModel, modelInfo, fitCloth, rigFingerprint } from './spine.mjs';
import { packPlugin, zipPlugin } from '../../server/plugins/pack.js';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const projectHash = project => hash(JSON.stringify(project));
export class ArtworkError extends Error {
  constructor(code, detail, status = 400) { super(detail); this.code = code; this.status = status; }
}
const fail = (code, detail) => { throw new ArtworkError(code, detail, code === 'STALE' ? 409 : 400); };
const RELEASE = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const keys = (v, allowed, at) => {
  if (!object(v)) fail('PROJECT', `${at}: expected an object`);
  for (const key of Object.keys(v)) if (!allowed.includes(key)) fail('PROJECT', `${at}.${key}: unknown field`);
};
const text = (v, at, max = 1000) => { if (typeof v !== 'string' || !v.trim() || v.length > max) fail('PROJECT', `${at}: expected 1–${max} characters`); };
const number = (v, min, max, at) => { if (!Number.isFinite(v) || v < min || v > max) fail('PROJECT', `${at}: expected ${min}–${max}`); };
export function plainRelative(rel, cache = false) {
  if (typeof rel !== 'string' || !rel || rel.length > 500 || rel.includes('\\') || rel.includes(':') || /[\x00-\x1f]/.test(rel)) fail('PATH', 'Expected a plain workspace-relative path');
  const parts = rel.split('/');
  if (parts.some((p, i) => !p || p === '.' || p === '..' || (p.startsWith('.') && !(cache && i === 0 && p === '.cache' && parts[1] === 'artwork')))) fail('PATH', 'Hidden paths, traversal and absolute paths are refused');
  return rel;
}

export function workspacePath(root, rel, { cache = false, exists = true } = {}) {
  plainRelative(rel, cache);
  let current = path.resolve(root);
  for (const segment of rel.split('/')) {
    current = path.join(current, segment);
    const st = fs.lstatSync(current, { throwIfNoEntry: false });
    if (st?.isSymbolicLink()) fail('LINK', `Linked path refused: ${rel}`);
  }
  if (exists && !fs.existsSync(current)) fail('MISSING', `Missing file: ${rel}`);
  return current;
}

export function validateProject(p) {
  keys(p, ['$schema', 'format', 'id', 'name', 'plugin', 'version', 'character', 'models', 'operations', 'details', 'checks', 'notes'], 'project');
  if (p.format !== 1) fail('PROJECT', 'Only artwork project format 1 is supported');
  if (p.$schema !== undefined) text(p.$schema, '$schema', 200);
  if (p.version !== undefined && (typeof p.version !== 'string' || !RELEASE.test(p.version))) fail('PROJECT', 'version must be a stable MAJOR.MINOR.PATCH release');
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(p.id) || !/^[a-z0-9][a-z0-9-]{1,31}$/.test(p.plugin)) fail('PROJECT', 'Invalid project/plugin id');
  text(p.name, 'name', 100); text(p.character, 'character', 128);
  if (!Array.isArray(p.models) || p.models.length < 1 || p.models.length > 2) fail('PROJECT', 'Supply front and/or back models');
  const ids = new Set();
  for (const m of p.models) {
    keys(m, ['id', 'label', 'skel', 'atlas', 'texture', 'groups', 'cloth'], 'model');
    if (!['front', 'back'].includes(m.id) || ids.has(m.id)) fail('PROJECT', 'Model ids are unique front/back'); ids.add(m.id);
    text(m.label, 'model.label', 100);
    for (const [key, ext] of [['skel', '.skel'], ['atlas', '.atlas'], ['texture', '.png']]) { plainRelative(m[key]); if (!m[key].endsWith(ext)) fail('PROJECT', `model.${key}: expected ${ext}`); }
    if (m.groups !== undefined) {
      if (!Array.isArray(m.groups) || m.groups.length > 30) fail('PROJECT', 'Too many region groups');
      for (const group of m.groups) { keys(group, ['label', 'regions'], 'group'); text(group.label, 'group.label', 100); if (!Array.isArray(group.regions) || group.regions.length > 200) fail('PROJECT', 'Invalid group regions'); group.regions.forEach(n => text(n, 'region', 128)); }
    }
    if (m.cloth) {
      const c = m.cloth;
      keys(c, ['attachment', 'bodyBone', 'legBones', 'forbiddenBones', 'profile', 'maxRadius', 'samples'], 'cloth');
      text(c.attachment, 'cloth.attachment', 128); text(c.bodyBone, 'cloth.bodyBone', 128);
      if (!Array.isArray(c.legBones) || c.legBones.length !== 2 || new Set(c.legBones).size !== 2) fail('PROJECT', 'Cloth requires two distinct leg bones'); c.legBones.forEach(n => text(n, 'leg bone', 128));
      if (!Array.isArray(c.forbiddenBones) || c.forbiddenBones.length > 20) fail('PROJECT', 'List stationary/forbidden bones explicitly'); c.forbiddenBones.forEach(n => text(n, 'forbidden bone', 128));
      if ([c.bodyBone, ...c.legBones].some(n => c.forbiddenBones.includes(n))) fail('BONE', 'A cloth influence names a forbidden/stationary bone');
      keys(c.profile, ['topWidth', 'hemWidth', 'flareAt', 'top', 'length', 'hemLegWeight'], 'profile');
      number(c.profile.topWidth, 1, 1000, 'topWidth'); number(c.profile.hemWidth, c.profile.topWidth, 1500, 'hemWidth');
      number(c.profile.flareAt, .05, 1, 'flareAt'); number(c.profile.top, -5000, 5000, 'top'); number(c.profile.length, 1, 1500, 'length'); number(c.profile.hemLegWeight, .01, .8, 'hemLegWeight');
      number(c.maxRadius, 1, 3000, 'maxRadius'); number(c.samples, 3, 120, 'samples'); if (!Number.isInteger(c.samples)) fail('PROJECT', 'samples must be an integer');
    }
  }
  if (!Array.isArray(p.operations) || p.operations.length > 256) fail('PROJECT', 'operations must be an array of at most 256 replacements');
  for (const op of p.operations) {
    keys(op, ['model', 'region', 'source', 'heightRatio'], 'operation');
    if (!ids.has(op.model)) fail('PROJECT', 'Replacement names an unknown model'); text(op.region, 'region', 128);
    keys(op.source, ['path', 'columns', 'rows', 'index', 'components', 'trim'], 'source'); plainRelative(op.source.path, true);
    if (!op.source.path.endsWith('.png')) fail('PROJECT', 'Region inputs must be PNG files');
    const { columns = 1, rows = 1, index = 0, components = 'all', trim = true } = op.source;
    for (const [n, v] of Object.entries({ columns, rows, index })) if (!Number.isInteger(v)) fail('PROJECT', `${n} must be an integer`);
    number(columns, 1, 16, 'columns'); number(rows, 1, 16, 'rows'); number(index, 0, columns * rows - 1, 'index');
    if (!['all', 'largest'].includes(components) || typeof trim !== 'boolean') fail('PROJECT', 'Invalid crop options');
    number(op.heightRatio ?? 1, .01, 1, 'heightRatio');
  }
  if (!Array.isArray(p.details) || !p.details.length || p.details.length > 100 || new Set(p.details.map(d => d.id)).size !== p.details.length) fail('PROJECT', 'details must have unique ids and include a visual review');
  for (const d of p.details) { keys(d, ['id', 'label', 'expected', 'reference'], 'detail'); text(d.id, 'detail.id', 64); text(d.label, 'detail.label', 100); text(d.expected, 'detail.expected'); if (d.reference !== undefined) { plainRelative(d.reference, true); if (!d.reference.endsWith('.png')) fail('PROJECT', 'References must be local PNG files'); } }
  if (!Array.isArray(p.checks) || p.checks.length > 150 || new Set(p.checks.map(c => c.id)).size !== p.checks.length) fail('PROJECT', 'checks must have unique ids');
  for (const c of p.checks) {
    keys(c, ['id', 'kind', 'model', 'region', 'color', 'minCount', 'minFraction', 'split', 'fromY', 'under', 'clips', 'uv'], 'check');
    text(c.id, 'check.id', 100); if (!ids.has(c.model)) fail('PROJECT', 'Check names an unknown model');
    if (!['color', 'transparent', 'coverage'].includes(c.kind)) fail('PROJECT', 'Unknown check kind');
    text(c.region, 'check.region', 128);
    if (c.kind === 'color') {
      if (!['red', 'pink', 'blue', 'sage', 'white', 'dark', 'charcoal'].includes(c.color)) fail('PROJECT', 'Unknown color predicate');
      number(c.minCount ?? 1, 1, 1000000, 'minCount'); number(c.minFraction ?? 0, 0, 1, 'minFraction');
      if (c.split !== undefined && c.split !== 'halves') fail('PROJECT', 'Unknown split');
      if (c.fromY !== undefined) number(c.fromY, 0, 1, 'fromY');
    } else if (c.kind === 'transparent') number(c.fromY, 0, 1, 'fromY');
    else {
      if (!Array.isArray(c.under) || !c.under.length || c.under.length > 8 || !Array.isArray(c.clips) || !c.clips.length || c.clips.length > 64 || !Array.isArray(c.uv) || !c.uv.length || c.uv.length > 50) fail('PROJECT', 'Invalid coverage samples');
      [...c.under, ...c.clips].forEach(v => text(v, 'coverage name', 128));
      for (const uv of c.uv) { if (!Array.isArray(uv) || uv.length !== 2) fail('PROJECT', 'UV sample is [u,v]'); uv.forEach(v => number(v, 0, 1, 'uv')); }
    }
  }
  if (p.notes !== undefined) text(p.notes, 'notes', 5000);
  return p;
}

export function readJson(file, maxBytes = 1024 * 1024) {
  if (fs.statSync(file).size > maxBytes) fail('SIZE', 'JSON exceeds authoring size limit');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadProject(root, file) {
  const rel = path.relative(root, path.resolve(root, file)).replaceAll(path.sep, '/');
  const projectFile = workspacePath(root, rel), project = validateProject(readJson(projectFile));
  const pluginDir = workspacePath(root, `plugins/${project.plugin}`), manifest = readJson(workspacePath(pluginDir, 'plugin.json'));
  if (manifest.class !== 'cosmetic' || manifest.id !== project.plugin) fail('PLUGIN', 'Artwork projects edit cosmetic plugins only');
  const overlay = typeof manifest.assets === 'string' ? readJson(workspacePath(pluginDir, manifest.assets)) : manifest.assets;
  const character = overlay?.chars?.[project.character];
  if (!character) fail('PLUGIN', 'Character is not declared in this plugin overlay');
  for (const model of project.models) {
    const declared = character.spine?.[model.id];
    if (!declared || declared.skel !== model.skel || (declared.atlas || model.skel.replace(/\.skel$/, '.atlas')) !== model.atlas || (declared.textures || [model.skel.replace(/\.skel$/, '.png')]).length !== 1 || (declared.textures?.[0] || model.skel.replace(/\.skel$/, '.png')) !== model.texture) fail('PLUGIN', `Model ${model.id} must name the overlay's real single-page model`);
  }
  return { root: path.resolve(root), projectFile, project, pluginDir, manifest };
}

export function fileSnapshot(dir) {
  const files = {}; let total = 0;
  const walk = rel => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      if (name.startsWith('.') || name.startsWith('_')) continue;
      const key = rel ? `${rel}/${name}` : name, abs = workspacePath(dir, key), st = fs.lstatSync(abs);
      if (st.isDirectory()) walk(key);
      else if (st.isFile()) {
        total += st.size;
        if (st.size > 32 * 1024 * 1024 || total > 200 * 1024 * 1024 || Object.keys(files).length >= 2000) fail('SIZE', 'Plugin exceeds authoring limits');
        files[key] = hash(fs.readFileSync(abs));
      } else fail('PATH', 'Only regular plugin files are supported');
    }
  };
  walk(''); return { files, hash: hash(JSON.stringify(files)) };
}

export function modelFiles(ctx, model, dir = ctx.pluginDir) {
  const skel = workspacePath(dir, model.skel), atlas = workspacePath(dir, model.atlas), texture = workspacePath(dir, model.texture);
  const atlasText = fs.readFileSync(atlas, 'utf8');
  const pages = atlasText.split(/\r?\n/).filter((line, i, lines) => line.trim() && !/^\s/.test(line) && /^size:/.test(lines[i + 1] || ''));
  if (pages.length !== 1 || path.posix.basename(pages[0]) !== path.posix.basename(model.texture)) fail('ATLAS', 'Authoring supports a single PNG atlas page with an exact texture name');
  const image = readPng(texture), regions = new Map([...readAtlas(atlas)].filter(([, r]) => Number.isInteger(r.x)));
  for (const r of regions.values()) extractRegion(image, r);
  const bytes = fs.readFileSync(skel), data = parseModel(bytes);
  for (const { attachment: a } of data.defaultSkin.getAttachments()) if ([0, 2].includes(a.type) && !regions.has(a.path)) fail('ATLAS', `Missing atlas attachment: ${a.path}`);
  return { skel, atlas, texture, image, regions, bytes, data };
}

export function inspectProject(ctx, dir = ctx.pluginDir) {
  return { format: 1, project: ctx.project, projectHash: projectHash(ctx.project), sourceHash: fileSnapshot(ctx.pluginDir).hash,
    models: ctx.project.models.map(m => { const f = modelFiles(ctx, m, dir); return { id: m.id, width: f.image.w, height: f.image.h, regions: [...f.regions].map(([name, rect]) => ({ name, ...rect })), ...modelInfo(f.data) }; }) };
}

export function cachePath(ctx, rel) { return workspacePath(ctx.root, `.cache/artwork/${ctx.project.id}/${rel}`, { cache: true, exists: false }); }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); fs.renameSync(temporary, file);
}

/** Include optional references: adding/removing a reference invalidates an earlier review as well. */
export function inputSnapshot(ctx, project = ctx.project) {
  const files = {};
  for (const rel of [...new Set([...project.operations.map(o => o.source.path), ...project.details.map(d => d.reference).filter(Boolean)])].sort()) {
    const file = workspacePath(ctx.root, rel, { cache: true, exists: false });
    if (!fs.existsSync(file) && !project.operations.some(o => o.source.path === rel)) { files[rel] = null; continue; }
    if (fs.statSync(file).size > 32 * 1024 * 1024) fail('SIZE', 'Input PNG exceeds limit');
    files[rel] = hash(fs.readFileSync(file));
  }
  return { files, hash: hash(JSON.stringify(files)) };
}

export function assertFresh(ctx, draft) {
  if (projectHash(ctx.project) !== draft.projectHash || fileSnapshot(ctx.pluginDir).hash !== draft.sourceHash || inputSnapshot(ctx, draft.project).hash !== draft.inputHash) fail('STALE', 'Project, source plugin or input/reference image changed; rebuild and review again');
}

export function buildCandidate(ctx, project = ctx.project, expectedSource) {
  validateProject(project);
  if (project.id !== ctx.project.id || project.plugin !== ctx.project.plugin || project.character !== ctx.project.character) fail('PROJECT', 'Project identity cannot be changed by a draft request');
  if (JSON.stringify(project.models.map(m => [m.id, m.skel, m.atlas, m.texture])) !== JSON.stringify(ctx.project.models.map(m => [m.id, m.skel, m.atlas, m.texture]))) fail('PROJECT', 'Model file identities are fixed; initialize a new project to change them');
  const source = fileSnapshot(ctx.pluginDir);
  const inputs = inputSnapshot(ctx, project);
  if (expectedSource && expectedSource !== source.hash) fail('STALE', 'Installed plugin changed; reload before building');
  const id = randomUUID().replaceAll('-', '').slice(0, 16), home = cachePath(ctx, `drafts/${id}`), dir = path.join(home, 'plugin', project.plugin);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of Object.keys(source.files)) { const to = workspacePath(dir, file, { exists: false }); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(workspacePath(ctx.pluginDir, file), to, fs.constants.COPYFILE_EXCL); }
  if (project.version && project.version !== ctx.manifest.version) {
    const manifestFile = workspacePath(dir, 'plugin.json'), manifest = readJson(manifestFile);
    manifest.version = project.version; writeJson(manifestFile, manifest);
  }
  const materials = {};
  for (const m of project.models) {
    const f = modelFiles(ctx, m, dir);
    for (const op of project.operations.filter(op => op.model === m.id)) {
      const sourceFile = workspacePath(ctx.root, op.source.path, { cache: true }); materials[op.source.path] = hash(fs.readFileSync(sourceFile));
      const region = f.regions.get(op.region); if (!region) fail('REGION', `Unknown atlas region: ${op.region}`);
      replaceRegion(f.image, region, cropCell(readPng(sourceFile), op.source), { heightRatio: op.heightRatio });
    }
    if (project.operations.some(op => op.model === m.id)) writePng(f.texture, f.image);
    if (m.cloth) {
      const rewritten = fitCloth(f.bytes, m.cloth);
      if (rigFingerprint(f.data, [m.cloth.attachment]) !== rigFingerprint(parseModel(rewritten), [m.cloth.attachment])) fail('RIG', 'A non-cloth rig field changed');
      fs.writeFileSync(f.skel, rewritten);
    }
  }
  if (fileSnapshot(ctx.pluginDir).hash !== source.hash || inputSnapshot(ctx, project).hash !== inputs.hash) fail('STALE', 'Plugin or input changed during build; rebuild');
  const packed = packPlugin(dir, { vanilla: readJson(path.join(ctx.root, 'data/assets.json'), 32 * 1024 * 1024), where: `artwork/${project.id}/` });
  const findings = [...(packed.build?.problems || []), ...(packed.build?.warnings || []), ...(packed.check?.problems || []), ...(packed.check?.warnings || [])];
  if (findings.length || !packed.wrote) fail('PACK', findings.join('\n') || 'Candidate lock was not written');
  const snapshot = fileSnapshot(dir);
  const meta = { format: 1, id, project, projectHash: projectHash(project), sourceHash: source.hash, sourceFiles: source.files, materials, inputHash: inputs.hash,
    assetHash: snapshot.hash, fileHashes: snapshot.files, changes: Object.keys(snapshot.files).filter(file => snapshot.files[file] !== source.files[file]) };
  writeJson(path.join(home, 'draft.json'), meta);
  return { ...meta, dir, home };
}

export function loadCandidate(ctx, id) {
  if (!/^[a-f0-9]{16}$/.test(id)) fail('DRAFT', 'Invalid draft id');
  const home = cachePath(ctx, `drafts/${id}`), meta = readJson(workspacePath(home, 'draft.json'));
  if (meta.project.id !== ctx.project.id || meta.project.plugin !== ctx.project.plugin) fail('DRAFT', 'Draft belongs to another project');
  const dir = workspacePath(home, `plugin/${ctx.project.plugin}`);
  if (fileSnapshot(dir).hash !== meta.assetHash) fail('TAMPER', 'Draft bytes changed after building');
  return { ...meta, dir, home };
}

export function exportParts(ctx, dir = ctx.pluginDir) {
  const home = cachePath(ctx, `exports/${randomUUID().slice(0, 8)}`), manifest = { project: ctx.project.id, models: [] };
  for (const model of ctx.project.models) {
    const f = modelFiles(ctx, model, dir), parts = [];
    for (const [name, rect] of f.regions) {
      const filename = `${Buffer.from(name).toString('hex')}.png`, file = path.join(home, model.id, filename);
      fs.mkdirSync(path.dirname(file), { recursive: true }); writePng(file, extractRegion(f.image, rect));
      parts.push({ name, file: `${model.id}/${filename}`, ...rect });
    }
    manifest.models.push({ id: model.id, parts });
  }
  writeJson(path.join(home, 'parts.json'), manifest); return { directory: home, ...manifest };
}

export function saveProject(ctx, project, expectedHash) {
  validateProject(project);
  if (project.id !== ctx.project.id || project.plugin !== ctx.project.plugin || project.character !== ctx.project.character) fail('PROJECT', 'Project identity is fixed');
  if (JSON.stringify(project.models.map(m => [m.id, m.skel, m.atlas, m.texture])) !== JSON.stringify(ctx.project.models.map(m => [m.id, m.skel, m.atlas, m.texture]))) fail('PROJECT', 'Model file identities are fixed');
  if (hash(fs.readFileSync(ctx.projectFile)) !== expectedHash) fail('STALE', 'Project was edited elsewhere; reload before saving');
  writeJson(ctx.projectFile, project); ctx.project = project; return inspectProject(ctx);
}

export function reviewDraft(ctx, draft, { assetHash, reviewer, checked, notes = '' }) {
  assertFresh(ctx, draft); loadCandidate(ctx, draft.id);
  if (assetHash !== draft.assetHash) fail('STALE', 'Review names different draft bytes');
  text(reviewer, 'reviewer', 100);
  if (!Array.isArray(checked) || checked.some(id => !ctx.project.details.some(d => d.id === id))) fail('REVIEW', 'Unknown visual checklist item');
  if (typeof notes !== 'string' || notes.length > 5000) fail('REVIEW', 'Review notes exceed limit');
  const review = { assetHash, projectHash: draft.projectHash, inputHash: draft.inputHash, reviewer, checked: [...new Set(checked)], notes, time: new Date().toISOString() };
  writeJson(cachePath(ctx, `reviews/${draft.assetHash}.json`), review); return review;
}

export function readReview(ctx, draft) {
  const file = cachePath(ctx, `reviews/${draft.assetHash}.json`);
  return fs.existsSync(file) ? readJson(file) : null;
}

export function packageDraft(ctx, draft, report) {
  const review = readReview(ctx, draft);
  assertFresh(ctx, draft);
  if (report.assetHash !== draft.assetHash || report.projectHash !== draft.projectHash || report.failures || !review || review.assetHash !== draft.assetHash || review.inputHash !== draft.inputHash || review.projectHash !== draft.projectHash || ctx.project.details.some(d => !review.checked.includes(d.id))) fail('REVIEW', 'Pass checks and explicitly review every visual detail before packaging');
  loadCandidate(ctx, draft.id); // recheck exact bytes, not just the name of a previous report
  const zip = zipPlugin(draft.dir), version = readJson(path.join(draft.dir, 'plugin.json')).version;
  if (draft.changes.some(f => !['plugin.json', 'plugin.lock.json'].includes(f))) {
    const current = ctx.manifest.version.split(/[.+-]/).slice(0, 3).map(Number), next = version.split('.').map(Number);
    const delta = next[0] - current[0] || next[1] - current[1] || next[2] - current[2];
    if (!RELEASE.test(version) || !(delta > 0)) fail('VERSION', 'Changed artwork needs a newer project.version; build and review that release');
  }
  const file = cachePath(ctx, `releases/${ctx.project.plugin}-${version}-${draft.assetHash.slice(0, 8)}.zip`);
  for (const [material, digest] of Object.entries(draft.materials)) if (hash(fs.readFileSync(workspacePath(ctx.root, material, { cache: true }))) !== digest) fail('STALE', 'An input image changed after review');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, zip.body);
  return { file, sha256: hash(zip.body), installed: false, deployed: false };
}
