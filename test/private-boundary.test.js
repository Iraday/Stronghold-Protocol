import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { privatePath, credentialKinds, scanPrivateBoundary } from '../tools/check-private-boundary.mjs';
import { selectTracked } from '../tools/package.mjs';

test('public index contains only the private submodule pointer, no private payload or credential patterns', () => {
  const result = scanPrivateBoundary(fileURLToPath(new URL('../', import.meta.url)));
  assert.deepEqual(result.findings, [], 'Move flagged paths private or remove credentials; values are never printed.');
});
test('boundary distinguishes a private gitlink from leaked leaves, runtime packs and key material', () => {
  assert.equal(privatePath('editor', '160000'), false); assert.equal(privatePath('editor', '100644'), true);
  for (const file of ['editor/ops/targets.json', 'plugins/chen-qianyu/plugin.json', 'tools/artwork.mjs', '.env', 'ops/id_ed25519', 'secret.pem']) assert.equal(privatePath(file, '100644'), true, file);
  for (const file of ['plugins/_template/script/plugin.json', 'plugins/README.md', 'server/index.js', 'docs/EDITOR.md']) assert.equal(privatePath(file, '100644'), false, file);
  assert.deepEqual(credentialKinds('ghp_' + 'x'.repeat(36)), ['github-token']);
  assert.deepEqual(credentialKinds('-----BEGIN ' + 'OPENSSH PRIVATE KEY-----'), ['private-key']);
  assert.deepEqual(credentialKinds('a configuration field named apiKey, without a value'), []);
  assert.deepEqual(selectTracked(['editor', 'editor/ops/targets.json', 'editor/plugins/private/art.png']).keep, [], 'public release packaging excludes the submodule and its leaves');
});
