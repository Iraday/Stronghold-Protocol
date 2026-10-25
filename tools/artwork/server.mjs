import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ArtworkError, hash, workspacePath, loadProject, inspectProject, buildCandidate, loadCandidate, exportParts, saveProject, reviewDraft, packageDraft, fileSnapshot } from './project.mjs';
import { checkProject } from './check.mjs';
import { decodePng, encodePng } from './png.mjs';
import { extractRegion } from './image.mjs';
import { modelFiles } from './project.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.skel': 'application/octet-stream', '.atlas': 'text/plain; charset=utf-8', '.zip': 'application/zip' };
// The bundled Pixi 7 renderer generates shader/uniform accessors with Function(). No author JSON is executable.
const CSP = "default-src 'none'; script-src 'self' 'unsafe-eval'; worker-src blob:; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; media-src blob:; base-uri 'none'; frame-ancestors 'none'; object-src 'none'";
const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const same = (a, b) => typeof a === 'string' && /^[a-f0-9]{64}$/.test(a) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function body(req, max = 1024 * 1024) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new ArtworkError('TYPE', 'JSON body required', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > max) throw new ArtworkError('SIZE', 'Request body is too large', 413); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function startWorkbench(ctx, { port = 0, candidate = null } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ArtworkError('PORT', 'Port must be 0–65535');
  const token = randomBytes(32).toString('hex'), downloads = new Map();
  const draftOf = id => id && !/^source(?:-[a-f0-9]{16})?$/.test(id) ? loadCandidate(ctx, id) : null;
  const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': MIME['.json'] }); res.end(JSON.stringify(value)); };
  const send = (res, file, contentType) => { res.writeHead(200, { 'Content-Type': contentType || MIME[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file)); };
  const urls = (project, view) => project.models.map(m => ({ id: m.id, label: m.label,
    skel: `/models/${view}/${m.id}/${encodeURIComponent(path.basename(m.skel))}`, atlas: `/models/${view}/${m.id}/${encodeURIComponent(path.basename(m.atlas))}`,
    texture: `/models/${view}/${m.id}/${encodeURIComponent(path.basename(m.texture))}` }));
  let origin;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Security-Policy', CSP);
    try {
      // A separate developer service: loopback only, no forwarded/tunnel mode and no permissive CORS.
      const allowedHosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
      if (!allowedHosts.includes(req.headers.host) || ['forwarded', 'x-forwarded-for', 'x-real-ip', 'cf-connecting-ip'].some(k => req.headers[k])) throw new ArtworkError('LOCAL', 'Direct loopback access only', 403);
      if (req.headers.origin && req.headers.origin !== origin) throw new ArtworkError('ORIGIN', 'Cross-origin requests are refused', 403);
      const url = new URL(req.url, origin), route = decodeURIComponent(url.pathname);
      if (route.includes('..') || route.includes('\\') || /[\x00-\x1f]/.test(route)) throw new ArtworkError('PATH', 'Invalid route');
      const publicFiles = { '/': 'tools/artwork/ui/index.html', '/ui/main.js': 'tools/artwork/ui/main.js', '/ui/style.css': 'tools/artwork/ui/style.css',
        '/vendor/pixi.min.js': 'public/vendor/pixi.min.js', '/vendor/pixi-spine.js': 'public/vendor/pixi-spine.js',
        '/shared/i18n.js': 'shared/i18n.js', '/shared/i18nPacks.js': 'shared/i18nPacks.js' };
      if (req.method === 'GET' && publicFiles[route]) { send(res, path.join(APP_ROOT, publicFiles[route])); return; }
      if (req.method === 'GET' && /^\/i18n\/(en|ja|ko|zh-TW)\.json$/.test(route)) { send(res, path.join(APP_ROOT, 'public', route)); return; }
      const cookie = /(?:^|;\s*)sp-artwork=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      if (!same(req.headers['x-sp-artwork'], token) && !same(cookie, token)) throw new ArtworkError('KEY', 'Open the workbench address printed by the local CLI', 403);
      res.setHeader('Set-Cookie', `sp-artwork=${token}; HttpOnly; SameSite=Strict; Path=/`);
      if (route.startsWith('/api/')) {
        const fresh = loadProject(ctx.root, ctx.projectFile);
        if (fresh.project.id !== ctx.project.id || fresh.project.plugin !== ctx.project.plugin || fresh.project.character !== ctx.project.character) throw new ArtworkError('STALE', 'Restart the workbench after changing project identity');
        ctx.project = fresh.project; ctx.manifest = fresh.manifest;
      }
      if (req.method === 'GET' && route === '/api/capabilities') {
        json(res, { format: 1, commands: ['init', 'inspect', 'extract', 'build', 'check', 'serve', 'render', 'review', 'pack'], sourceWrites: false, deployment: false,
          header: 'X-SP-Artwork', schema: 'schemas/artwork.schema.json', projectFile: path.relative(ctx.root, ctx.projectFile).replaceAll(path.sep, '/') }); return;
      }
      if (req.method === 'GET' && route === '/api/state') {
        const draft = draftOf(url.searchParams.get('draft') || candidate), info = inspectProject(ctx, draft?.dir);
        const references = ctx.project.details.map(d => {
          let available = false;
          try { if (d.reference?.endsWith('.png')) { decodePng(fs.readFileSync(workspacePath(ctx.root, d.reference, { cache: true }))); available = true; } } catch { /* optional references stay visibly unavailable */ }
          return { id: d.id, available, url: available ? `/references/${encodeURIComponent(d.id)}` : null };
        });
        const sourceView = 'source-' + info.sourceHash.slice(0, 16);
        json(res, { ...info, fileHash: hash(fs.readFileSync(ctx.projectFile)), draft, references, sourceModels: urls(ctx.project, sourceView), previewModels: urls(draft?.project || ctx.project, draft?.id || sourceView), report: checkProject(ctx, draft) }); return;
      }
      if (req.method === 'POST' && route === '/api/build') {
        const input = await body(req);
        if (input.project) saveProject(ctx, input.project, input.fileHash);
        const draft = buildCandidate(ctx, ctx.project, input.sourceHash); candidate = draft.id;
        json(res, { id: draft.id, assetHash: draft.assetHash, changes: draft.changes, report: checkProject(ctx, draft) }); return;
      }
      if (req.method === 'POST' && route === '/api/export') {
        const input = await body(req), draft = draftOf(input.draft); json(res, exportParts(ctx, draft?.dir)); return;
      }
      if (req.method === 'POST' && route === '/api/upload') {
        const input = await body(req, 18 * 1024 * 1024);
        if (typeof input.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)) throw new ArtworkError('PNG', 'A base64 PNG is required');
        const bytes = Buffer.from(input.data, 'base64'); decodePng(bytes);
        const rel = `.cache/artwork/${ctx.project.id}/uploads/${hash(bytes)}.png`, file = workspacePath(ctx.root, rel, { cache: true, exists: false });
        fs.mkdirSync(path.dirname(file), { recursive: true }); if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { flag: 'wx' });
        json(res, { path: rel }); return;
      }
      if (req.method === 'POST' && route === '/api/review') {
        const input = await body(req), draft = draftOf(input.draft); if (!draft) throw new ArtworkError('DRAFT', 'Build a draft before reviewing');
        json(res, reviewDraft(ctx, draft, input)); return;
      }
      if (req.method === 'POST' && route === '/api/pack') {
        const input = await body(req), draft = draftOf(input.draft); if (!draft) throw new ArtworkError('DRAFT', 'Build a draft before packaging');
        const result = packageDraft(ctx, draft, checkProject(ctx, draft)); downloads.set(draft.id, result.file);
        json(res, { ...result, url: `/downloads/${draft.id}.zip` }); return;
      }
      const modelRoute = /^\/(models|regions)\/(source(?:-[a-f0-9]{16})?|[a-f0-9]{16})\/(front|back)\/(.+)$/.exec(route);
      if (req.method === 'GET' && modelRoute) {
        const [, kind, view, id, filename] = modelRoute, draft = draftOf(view), model = (draft?.project || ctx.project).models.find(m => m.id === id);
        if (view.startsWith('source-') && view !== 'source-' + fileSnapshot(ctx.pluginDir).hash.slice(0, 16)) throw new ArtworkError('STALE', 'Source model changed; reload the editor', 409);
        if (!model) throw new ArtworkError('MODEL', 'Unknown model', 404);
        if (kind === 'regions') {
          if (!/^[a-f0-9]{2,1024}\.png$/.test(filename)) throw new ArtworkError('REGION', 'Invalid region id');
          const name = Buffer.from(filename.slice(0, -4), 'hex').toString('utf8'), f = modelFiles(ctx, model, draft?.dir), r = f.regions.get(name);
          if (!r) throw new ArtworkError('REGION', 'Unknown region', 404);
          res.writeHead(200, { 'Content-Type': MIME['.png'] }); res.end(encodePng(extractRegion(f.image, r))); return;
        }
        const allowed = [model.skel, model.atlas, model.texture].find(p => path.basename(p) === filename);
        if (!allowed) throw new ArtworkError('MODEL', 'Unknown model member', 404);
        send(res, workspacePath(draft?.dir || ctx.pluginDir, allowed)); return;
      }
      const reference = /^\/references\/([^/]+)$/.exec(route);
      if (req.method === 'GET' && reference) {
        const detail = ctx.project.details.find(d => d.id === reference[1]);
        if (!detail?.reference?.endsWith('.png')) throw new ArtworkError('REFERENCE', 'No local reference', 404);
        const file = workspacePath(ctx.root, detail.reference, { cache: true }); decodePng(fs.readFileSync(file)); send(res, file, MIME['.png']); return;
      }
      const download = /^\/downloads\/([a-f0-9]{16})\.zip$/.exec(route);
      if (req.method === 'GET' && download && downloads.has(download[1])) { send(res, downloads.get(download[1]), MIME['.zip']); return; }
      throw new ArtworkError('NOT_FOUND', 'Unknown artwork endpoint', 404);
    } catch (e) { if (!res.headersSent) json(res, { error: e.code || 'ARTWORK', detail: e.message }, e.status || 400); else res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, token, url: `${origin}/#key=${token}`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
