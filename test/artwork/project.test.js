import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fixture, edited, reviewInput, ROOT } from '../helpers/artwork.js';
import { schemaValidator } from '../helpers/jsonSchema.js';
import { validateProject, workspacePath, fileSnapshot, buildCandidate, loadCandidate, inspectProject, reviewDraft, packageDraft, saveProject, hash } from '../../tools/artwork/project.mjs';
import { checkProject } from '../../tools/artwork/check.mjs';
import { readPng, writePng } from '../../tools/artwork/png.mjs';
import { extractRegion } from '../../tools/artwork/image.mjs';

test('artwork schema accepts the worked recipe and both validators reject invalid authoring options', () => {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'artwork/chen-qianyu.json'))), schema = schemaValidator(path.join(ROOT, 'schemas'));
  assert.equal(validateProject(p), p); assert.deepEqual(schema.validate('artwork.schema.json', p), []);
  const broken = [q => q.operations.push({ command: 'arbitrary code' }), q => q.models[0].cloth.profile.hemLegWeight = 5,
    q => q.models[0].cloth.samples = 1.5, q => q.models[0].texture = 'bad.jpg', q => q.models[0].texture = '../escape.png', q => q.models[0].cloth.legBones = ['same', 'same'], q => q.details = [], q => q.version = 'latest'];
  for (const mutate of broken) { const q = structuredClone(p); mutate(q); assert.throws(() => validateProject(q)); assert.ok(schema.validate('artwork.schema.json', q).length); }
  const q = structuredClone(p); q.models[0].cloth.bodyBone = 'F_Hip'; assert.throws(() => validateProject(q), /forbidden/);
});
test('workspace paths reject traversal, hidden paths, absolute paths and directory junction escapes', t => {
  const ctx = fixture(t);
  for (const rel of ['../secret', '/etc/passwd', 'C:/secret', 'artwork/../data/assets.json', 'artwork\\other', '.git/config', '.cache/other/file']) assert.throws(() => workspacePath(ctx.root, rel, { cache: true }));
  const target = path.join(ctx.root, 'outside'), link = path.join(ctx.root, 'linked'); fs.mkdirSync(target);
  try { fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) { t.diagnostic('Link creation unavailable; non-link path rejection verified'); return; } throw e; }
  assert.throws(() => workspacePath(ctx.root, 'linked/anything', { exists: false }), /Linked/);
});
test('worked example rebuilds byte-for-byte twice, samples every clip and distinguishes moving waist from stationary hip', t => {
  const ctx = fixture(t), before = fileSnapshot(ctx.pluginDir), a = buildCandidate(ctx), b = buildCandidate(ctx);
  assert.notEqual(a.id, b.id); assert.equal(a.assetHash, b.assetHash); assert.deepEqual(a.changes, []); assert.deepEqual(fileSnapshot(ctx.pluginDir), before);
  const report = checkProject(ctx, a); assert.equal(report.failures, 0); assert.equal(report.manualPending, 12);
  const info = inspectProject(ctx), front = info.models.find(m => m.id === 'front');
  const span = bone => front.bones.find(b => b.name === bone).motion.find(m => m.clip === 'Start').span;
  assert.ok(span('F_Waist_B') > 1000); assert.ok(span('F_Hip') < 1);
  assert.equal(front.clips.length, 13); assert.equal(info.models.find(m => m.id === 'back').clips.length, 8);
});
test('a replacement changes only its selected atlas rectangle, while source bytes and protected rig stay untouched', t => {
  const ctx = edited(fixture(t)), before = fileSnapshot(ctx.pluginDir), draft = buildCandidate(ctx), report = checkProject(ctx, draft);
  assert.equal(report.failures, 0); assert.deepEqual(fileSnapshot(ctx.pluginDir), before);
  assert.deepEqual(draft.changes.sort(), ['art/spine/chen_qianyu.png', 'plugin.json', 'plugin.lock.json']);
  const info = inspectProject(ctx).models[0], a = readPng(path.join(ctx.pluginDir, ctx.project.models[0].texture)), b = readPng(path.join(draft.dir, ctx.project.models[0].texture));
  for (const r of info.regions.filter(r => r.name !== 'F_Head')) assert.deepEqual(extractRegion(a, r), extractRegion(b, r), r.name);
  assert.notDeepEqual(extractRegion(a, info.regions.find(r => r.name === 'F_Head')), extractRegion(b, info.regions.find(r => r.name === 'F_Head')));
});
test('packaging requires a full review of these exact bytes and produces a native locked ZIP without installation', t => {
  const ctx = edited(fixture(t)), before = fileSnapshot(ctx.pluginDir), d = buildCandidate(ctx), report = checkProject(ctx, d);
  assert.throws(() => packageDraft(ctx, d, report), /review every/);
  reviewDraft(ctx, d, reviewInput(ctx, d, ['eyes'])); assert.throws(() => packageDraft(ctx, d, checkProject(ctx, d)), /review every/);
  reviewDraft(ctx, d, reviewInput(ctx, d)); const ready = checkProject(ctx, d); assert.equal(ready.manualPending, 0);
  const result = packageDraft(ctx, d, ready), zip = fs.readFileSync(result.file);
  assert.equal(zip.readUInt32LE(0), 0x04034b50); assert.equal(result.sha256, hash(zip)); assert.equal(result.installed, false); assert.equal(result.deployed, false);
  assert.deepEqual(fileSnapshot(ctx.pluginDir), before);
  assert.throws(() => packageDraft(ctx, d, { ...ready, assetHash: 'wrong report' }), /review every/);
  fs.appendFileSync(path.join(d.dir, 'README.md'), '\ntampered\n'); assert.throws(() => loadCandidate(ctx, d.id), /changed after/);
});
test('changed artwork cannot reuse its installed release version', t => {
  const source = fixture(t), ctx = edited(source, { version: source.manifest.version }), d = buildCandidate(ctx); reviewDraft(ctx, d, reviewInput(ctx, d));
  assert.throws(() => packageDraft(ctx, d, checkProject(ctx, d)), /newer project.version/);
});
test('changing an input or reference invalidates review and blocks a previously passing package', t => {
  const ctx = edited(fixture(t)), d = buildCandidate(ctx); reviewDraft(ctx, d, reviewInput(ctx, d));
  const png = path.join(ctx.root, 'materials/piece.png'), tile = readPng(png); tile.data[0] ^= 1; writePng(png, tile);
  assert.throws(() => reviewDraft(ctx, d, reviewInput(ctx, d)), /changed/);
  assert.throws(() => packageDraft(ctx, d, checkProject(ctx, d)), /changed/);
  assert.equal(checkProject(ctx, d).manualPending, 12);
  const next = buildCandidate(ctx); reviewDraft(ctx, next, reviewInput(ctx, next));
  const ref = path.join(ctx.root, ctx.project.details.find(x => x.reference).reference); fs.mkdirSync(path.dirname(ref), { recursive: true }); fs.copyFileSync(png, ref);
  assert.throws(() => reviewDraft(ctx, next, reviewInput(ctx, next)), /changed/);
});
test('source edits and concurrent JSON edits cannot silently overwrite or retain an old review', t => {
  const ctx = fixture(t), original = fs.readFileSync(ctx.projectFile), digest = hash(original), d = buildCandidate(ctx); reviewDraft(ctx, d, reviewInput(ctx, d));
  fs.writeFileSync(ctx.projectFile, original + '\n'); assert.throws(() => saveProject(ctx, ctx.project, digest), /edited elsewhere/);
  fs.appendFileSync(path.join(ctx.pluginDir, 'README.md'), '\nexternal edit\n');
  assert.throws(() => buildCandidate(ctx, ctx.project, d.sourceHash), /Installed plugin changed/);
  assert.throws(() => packageDraft(ctx, d, checkProject(ctx, d)), /changed/);
});

test('agent CLI initializes real model members, records an explicit partial review and keeps packaging blocked', t => {
  const ctx = fixture(t), cli = path.join(ROOT, 'tools/artwork.mjs');
  const run = args => JSON.parse(execFileSync(process.execPath, [cli, ...args, '--root', ctx.root, '--json'], { encoding: 'utf8' }));
  const initialized = run(['init', '--plugin', ctx.project.plugin, '--project', 'artwork/new.json']);
  assert.equal(initialized.project, 'artwork/new.json');
  const made = JSON.parse(fs.readFileSync(path.join(ctx.root, 'artwork/new.json'))); assert.equal(made.models.length, 2); assert.ok(made.models.every(m => !m.cloth));
  const result = run(['build']); assert.equal(result.report.failures, 0);
  fs.writeFileSync(path.join(ctx.root, 'artwork/review.json'), JSON.stringify({ reviewer: 'CLI fixture', checked: ['eyes'], notes: 'Partial synthetic fixture' }));
  const reviewed = run(['review', '--candidate', result.id, '--review', 'artwork/review.json']); assert.deepEqual(reviewed.checked, ['eyes']);
  const report = run(['check', '--candidate', result.id]); assert.equal(report.manualPending, 11);
  assert.equal(fileSnapshot(ctx.pluginDir).hash, result.sourceHash);
});
