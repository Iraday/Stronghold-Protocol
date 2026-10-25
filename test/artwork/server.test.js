import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fixture } from '../helpers/artwork.js';
import { startWorkbench } from '../../tools/artwork/server.mjs';
import { encodePng } from '../../tools/artwork/png.mjs';
import { fileSnapshot } from '../../tools/artwork/project.mjs';

test('local API gates assets and mutations by key, origin and direct loopback host', async t => {
  const ctx = fixture(t), before = fileSnapshot(ctx.pluginDir), service = await startWorkbench(ctx); t.after(() => service.close());
  const get = (route, headers = {}) => fetch(service.origin + route, { headers });
  assert.equal((await get('/')).status, 200);
  assert.equal((await get('/api/state')).status, 403);
  assert.equal((await get('/api/state', { 'X-SP-Artwork': 'é'.repeat(64) })).status, 403);
  assert.equal((await get('/api/state', { 'X-SP-Artwork': service.token, Origin: 'https://foreign.example' })).status, 403);
  const rebound = await new Promise((resolve, reject) => {
    http.get(service.origin + '/api/state', { headers: { 'X-SP-Artwork': service.token, Host: 'rebound.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(rebound, 403);
  assert.equal((await get('/api/state', { 'X-SP-Artwork': service.token, Forwarded: 'for=127.0.0.1' })).status, 403);
  const auth = { 'X-SP-Artwork': service.token }, response = await get('/api/state', auth), state = await response.json();
  assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal(state.report.failures, 0); assert.equal(state.report.manualPending, 12);
  assert.equal((await get('/api/state', { Cookie: `sp-artwork=${service.token}` })).status, 200);
  assert.equal((await get(state.sourceModels[0].skel)).status, 403);
  assert.equal((await get(state.sourceModels[0].skel, auth)).status, 200);
  assert.equal((await get('/models/source/front/plugin.json', auth)).status, 404);
  assert.equal((await get('/.git/config', auth)).status, 404);
  assert.deepEqual(fileSnapshot(ctx.pluginDir), before);
});

test('API saves isolated drafts, validates PNG uploads and refuses concurrent edits and stale source URLs', async t => {
  const ctx = fixture(t), service = await startWorkbench(ctx); t.after(() => service.close());
  const headers = { 'X-SP-Artwork': service.token, 'Content-Type': 'application/json', Origin: service.origin };
  const post = (route, value) => fetch(service.origin + '/api/' + route, { method: 'POST', headers, body: JSON.stringify(value) });
  const state = await (await fetch(service.origin + '/api/state', { headers })).json();
  assert.equal((await fetch(service.origin + '/api/upload', { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await post('upload', { data: Buffer.from('not png').toString('base64') })).status, 400);
  const data = encodePng({ w: 2, h: 2, data: Buffer.alloc(16, 255) }).toString('base64'), upload = await (await post('upload', { data })).json();
  assert.match(upload.path, /^\.cache\/artwork\/chen-qianyu\/uploads\/[a-f0-9]{64}\.png$/);
  const built = await (await post('build', { project: state.project, fileHash: state.fileHash, sourceHash: state.sourceHash })).json();
  assert.match(built.id, /^[a-f0-9]{16}$/); assert.equal(built.report.failures, 0); assert.equal(built.report.manualPending, 12);
  assert.equal((await post('pack', { draft: built.id })).status, 400);
  fs.appendFileSync(ctx.projectFile, '\n');
  assert.equal((await post('build', { project: state.project, fileHash: state.fileHash, sourceHash: state.sourceHash })).status, 409);
  fs.appendFileSync(path.join(ctx.pluginDir, 'README.md'), '\nexternal edit\n');
  assert.equal((await fetch(service.origin + state.sourceModels[0].skel, { headers })).status, 409);
  assert.equal((await post('review', { draft: built.id, assetHash: built.assetHash, reviewer: 'fixture', checked: [] })).status, 409);
});
