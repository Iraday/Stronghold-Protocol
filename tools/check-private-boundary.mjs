#!/usr/bin/env node
// Public index policy. A gitlink is allowed; private source, credentials and runtime packs are not.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PRIVATE_PATHS = ['artwork/', 'tools/artwork/', 'tools/artwork.mjs', 'tools/chen-qianyu-art/', 'test/artwork/', 'test/helpers/artwork.js', 'test/plugins/chen-qianyu-outfit.test.js', 'schemas/artwork.schema.json', 'docs/ARTWORK-WORKBENCH.md', 'docs/CHEN-QIANYU-DEPLOY.md'];
export function privatePath(file, mode) {
  if (file === 'editor') return mode !== '160000';
  if (file.startsWith('editor/')) return true;
  if (PRIVATE_PATHS.some(p => p.endsWith('/') ? file.startsWith(p) : file === p)) return true;
  if (file.startsWith('plugins/') && !file.startsWith('plugins/_template/') && !['plugins/README.md', 'plugins/AGENTS.md'].includes(file)) return true;
  return /(?:^|\/)(?:\.env(?:\..*)?|\.local|id_rsa.*|id_ed25519.*)(?:\/|$)/.test(file) || /\.(?:pem|key)$/.test(file);
}
export function credentialKinds(text) {
  const patterns = [
    ['private-key', /-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----/],
    ['github-token', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})/],
    ['cloud-key', /AKIA[0-9A-Z]{16}/],
  ];
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
}
export function scanPrivateBoundary(root) {
  let records;
  try { records = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\0').filter(Boolean); }
  catch { return { skipped: 'not a Git checkout', files: 0, findings: [] }; }
  const findings = [];
  for (const record of records) {
    const [info, file] = record.split('\t'), mode = info.split(' ')[0];
    if (privatePath(file, mode)) findings.push({ file, kind: 'private-path' });
    if (mode === '160000') continue;
    const absolute = path.join(root, file), stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size > 4 * 1024 * 1024) continue;
    const text = fs.readFileSync(absolute).toString('utf8'); if (text.includes('\0')) continue;
    for (const kind of credentialKinds(text)) findings.push({ file, kind });
  }
  return { files: records.length, findings };
}
const main = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (main) {
  const result = scanPrivateBoundary(path.resolve(process.argv[2] || fileURLToPath(new URL('../', import.meta.url))));
  console.log(JSON.stringify(result)); if (result.findings.length) process.exitCode = 1;
}
