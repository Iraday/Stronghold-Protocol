#!/usr/bin/env node
// Agent-friendly offline artwork authoring; no deployment, Git operations or installed-plugin writes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArtworkError, loadProject, validateProject, workspacePath, readJson, inspectProject, buildCandidate, loadCandidate, exportParts, packageDraft, reviewDraft } from './artwork/project.mjs';
import { checkProject } from './artwork/check.mjs';
import { startWorkbench } from './artwork/server.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HELP = {
  format: 1, tool: 'Stronghold Protocol artwork workbench', defaultProject: 'artwork/chen-qianyu.json',
  commands: {
    init: '--plugin <id> [--character <id>] [--project artwork/new.json]',
    inspect: '[--project <file>] --json', extract: '[--project <file>] [--candidate <id>] --json',
    build: '[--project <file>] --json', check: '[--project <file>] [--candidate <id>] --json',
    serve: '[--project <file>] [--candidate <id>] [--port 0]',
    render: '[--project <file>] [--candidate <id>] [--chrome <exe>] [--video] --json',
    review: '--candidate <id> --review <workspace-json> --json; records explicit visual checklist findings',
    pack: '--candidate <id> [--project <file>] --json; requires current visual review and passing checks',
  },
  workflow: ['inspect', 'extract', 'edit project / provide generated PNG pieces', 'build', 'check', 'render --video', 'inspect visuals against references', 'review', 'pack'],
  safety: 'Builds stay in .cache/artwork. No plugin installation, server deployment, match termination, Git push or AI image generation is automatic.',
};

function args(argv) {
  const command = argv[0] && !argv[0].startsWith('-') ? argv.shift() : 'help', opts = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]; if (!['--project', '--root', '--plugin', '--character', '--candidate', '--port', '--chrome', '--review', '--json', '--video'].includes(flag)) throw new ArtworkError('ARGUMENT', `Unknown option: ${flag}`);
    const key = flag.slice(2);
    if (['json', 'video'].includes(key)) opts[key] = true;
    else { if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new ArtworkError('ARGUMENT', `Missing value for ${flag}`); opts[key] = argv[++i]; }
  }
  return { command, opts };
}

function init(root, opts) {
  if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(opts.plugin)) throw new ArtworkError('ARGUMENT', 'init requires --plugin <cosmetic-plugin-id>');
  const plugin = workspacePath(root, `plugins/${opts.plugin}`), manifest = readJson(workspacePath(plugin, 'plugin.json'));
  if (manifest.class !== 'cosmetic') throw new ArtworkError('PLUGIN', 'Only cosmetic plugins are supported');
  const overlay = typeof manifest.assets === 'string' ? readJson(workspacePath(plugin, manifest.assets)) : manifest.assets;
  const names = Object.keys(overlay?.chars || {}).filter(id => overlay.chars[id].spine);
  const character = opts.character || (names.length === 1 ? names[0] : null);
  if (!names.includes(character)) throw new ArtworkError('CHARACTER', 'Choose --character from the plugin overlay: ' + names.join(', '));
  const id = opts.plugin.replace(/-art$/, ''), models = Object.entries(overlay.chars[character].spine).map(([side, value]) => {
    if (!['front', 'back'].includes(side) || !value?.skel || value.ref || (value.textures?.length || 1) !== 1) throw new ArtworkError('MODEL', 'Initialize from actual single-page front/back model files, not references');
    return { id: side, label: side, skel: value.skel, atlas: value.atlas || value.skel.replace(/\.skel$/, '.atlas'), texture: value.textures?.[0] || value.skel.replace(/\.skel$/, '.png'), groups: [] };
  });
  const project = validateProject({ $schema: '../schemas/artwork.schema.json', format: 1, id, name: manifest.name?.en || manifest.name?.zh || id, plugin: opts.plugin, version: manifest.version, character, models, operations: [],
    details: [{ id: 'identity', label: 'Identity and reference fidelity', expected: 'Compare face, eye/pupil details, hair, horns, clothing, gloves and front/back consistency with authorized references.' },
      { id: 'motion', label: 'Motion and silhouette', expected: 'Watch every animation, especially Start, Attack and Skill, at normal and slow speed. Still images do not approve motion.' },
      { id: 'integrity', label: 'Protected artwork and rights', expected: 'Unselected atlas regions/rig tracks remain unchanged. Confirm source rights and credits; packing is not deployment permission.' }], checks: [], notes: 'Inspect bone motion before adding cloth constraints. Use Chen Qianyu as a worked example, not hardcoded bone names for a different character.' });
  const relative = opts.project || `artwork/${id}.json`, file = workspacePath(root, relative, { exists: false });
  if (fs.existsSync(file)) throw new ArtworkError('EXISTS', 'Project exists; it was not overwritten');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(project, null, 2) + '\n', { flag: 'wx' });
  return { project: relative, next: `node tools/artwork.mjs inspect --project ${relative} --json` };
}

export async function main(argv = process.argv.slice(2)) {
  const { command, opts } = args([...argv]), root = path.resolve(opts.root || ROOT);
  const emit = value => process.stdout.write(JSON.stringify(value, null, opts.json ? 0 : 2) + '\n');
  if (command === 'help') { emit(HELP); return; }
  if (command === 'init') { emit(init(root, opts)); return; }
  if (!Object.hasOwn(HELP.commands, command)) throw new ArtworkError('ARGUMENT', `Unknown command: ${command}`);
  const ctx = loadProject(root, opts.project || HELP.defaultProject), draft = opts.candidate ? loadCandidate(ctx, opts.candidate) : null;
  if (command === 'inspect') emit(inspectProject(ctx, draft?.dir));
  if (command === 'extract') emit(exportParts(ctx, draft?.dir));
  if (command === 'build') { const d = buildCandidate(ctx); emit({ id: d.id, assetHash: d.assetHash, sourceHash: d.sourceHash, changes: d.changes, report: checkProject(ctx, d) }); }
  if (command === 'check') { const report = checkProject(ctx, draft); emit(report); if (report.failures) process.exitCode = 1; }
  if (command === 'review') {
    if (!draft || !opts.review) throw new ArtworkError('REVIEW', 'review requires --candidate and --review <workspace-json>');
    const input = readJson(workspacePath(ctx.root, opts.review, { cache: true }));
    emit(reviewDraft(ctx, draft, { ...input, assetHash: draft.assetHash }));
  }
  if (command === 'pack') { if (!draft) throw new ArtworkError('DRAFT', 'pack requires --candidate'); emit(packageDraft(ctx, draft, checkProject(ctx, draft))); }
  if (command === 'render') { const { renderProject } = await import('./artwork/render.mjs'); const result = await renderProject(ctx, { candidate: opts.candidate, chrome: opts.chrome, video: opts.video }); emit(result); if (result.failures) process.exitCode = 1; }
  if (command === 'serve') {
    const service = await startWorkbench(ctx, { port: opts.port === undefined ? 0 : Number(opts.port), candidate: opts.candidate });
    emit({ url: service.url, loopbackOnly: true, sourceWrites: false, project: path.relative(root, ctx.projectFile) });
    const stop = async () => { await service.close(); process.exit(0); }; process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => {
  process.stderr.write(JSON.stringify({ error: e.code || 'ARTWORK', detail: e.message }) + '\n'); process.exitCode = 1;
});
