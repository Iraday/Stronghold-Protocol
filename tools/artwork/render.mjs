import fs from 'node:fs';
/* global window */
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { ArtworkError, cachePath, loadCandidate, hash } from './project.mjs';
import { startWorkbench } from './server.mjs';
import { checkProject } from './check.mjs';

export function findChrome(explicit) {
  const choices = [explicit, process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  const binary = choices.find(p => p && fs.existsSync(p));
  if (!binary) throw new ArtworkError('CHROME', 'Chrome/Chromium is needed for rendering; use --chrome or CHROME_BIN. Inspect/check still work without a browser.');
  return binary;
}

export async function renderProject(ctx, { candidate = null, chrome, video = false } = {}) {
  const executablePath = findChrome(chrome), draft = candidate ? loadCandidate(ctx, candidate) : null;
  const report = checkProject(ctx, draft), dir = cachePath(ctx, `reports/${report.assetHash.slice(0, 16)}`);
  fs.mkdirSync(dir, { recursive: true });
  const service = await startWorkbench(ctx, { candidate }); let browser;
  try {
    browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 950 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    page.on('requestfailed', req => errors.push(`${req.url().replace(/#.*$/, '')}: ${req.failure()?.errorText}`));
    await page.goto(service.url, { waitUntil: 'networkidle0' });
    await page.evaluate(() => Promise.race([window.artwork.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Artwork preview did not load in 30 seconds')), 30000))]));
    await page.screenshot({ path: path.join(dir, 'editor.png') });
    const sheet = await page.evaluate(() => window.artwork.contactSheet());
    fs.writeFileSync(path.join(dir, 'poses.png'), Buffer.from(sheet.split(',')[1], 'base64'));
    if (video) {
      const base64 = await page.evaluate(() => window.artwork.record());
      fs.writeFileSync(path.join(dir, 'motion.webm'), Buffer.from(base64, 'base64'));
    }
    const snapshot = await page.evaluate(() => window.artwork.snapshot());
    if (errors.length) throw new ArtworkError('BROWSER', errors.join('\n'));
    const evidence = { ...report, browser: { errors, snapshot, poses: 'poses.png', video: video ? 'motion.webm' : null }, manualApproval: false };
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(evidence, null, 2) + '\n');
    return { directory: dir, screenshot: path.join(dir, 'editor.png'), poses: path.join(dir, 'poses.png'), video: video ? path.join(dir, 'motion.webm') : null,
      report: path.join(dir, 'report.json'), reportHash: hash(JSON.stringify(evidence)), failures: report.failures, manualPending: report.manualPending };
  } finally { await browser?.close(); await service.close(); }
}
