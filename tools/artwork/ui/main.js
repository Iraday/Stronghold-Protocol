import { t, setLang, addMessages } from '/shared/i18n.js';
const PIXI = globalThis.PIXI;
const token = new URLSearchParams(location.hash.slice(1)).get('key') || '';
history.replaceState(null, '', location.pathname + location.search);
const $ = id => document.getElementById(id);
const h = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
};
let state, project, app, records = [], clip = 'Idle', time = 0, duration = 1, playing = true, busy = false, dirty = false, selected = null, generation = 0;
const fail = e => { $('error').textContent = e.message || String(e); $('error').classList.remove('hidden'); };
const api = async (route, input) => {
  const response = await fetch('/api/' + route, { method: input === undefined ? 'GET' : 'POST', headers: { 'X-SP-Artwork': token, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: input === undefined ? undefined : JSON.stringify(input) });
  const data = await response.json(); if (!response.ok) throw new Error(`${data.error}: ${data.detail}`); return data;
};
const work = async action => {
  if (busy) return; busy = true; updateButtons(); $('error').classList.add('hidden');
  try { return await action(); } catch (e) { fail(e); } finally { busy = false; updateButtons(); }
};
const readEditor = () => JSON.parse($('project-json').value);
const markDirty = () => { dirty = true; updateButtons(); };
const writeEditor = p => { project = p; $('project-json').value = JSON.stringify(p, null, 2); markDirty(); };
const hex = name => Array.from(new TextEncoder().encode(name), b => b.toString(16).padStart(2, '0')).join('');

function updateButtons() {
  if (!$('build')) return;
  $('build').disabled = busy; $('refresh').disabled = busy; $('extract').disabled = busy; $('record').disabled = busy;
  $('review-save').disabled = busy || !state?.draft || dirty;
  $('pack').disabled = busy || dirty || !state?.draft || state.report.failures > 0 || state.report.manualPending > 0;
  $('status').textContent = busy ? t('正在处理…') : dirty ? t('未构建修改') : state?.draft ? t('草稿') + ' ' + state.draft.id.slice(0, 8) : t('已安装素材');
  $('status').classList.toggle('dirty', dirty);
}

function shell() {
  document.title = t('美术编辑工作台');
  $('app').replaceChildren(
    h('header', {}, h('div', { class: 'brand' }, h('h1', {}, t('美术编辑工作台')), h('small', {}, t('仅本机 · 草稿不会改动已安装插件'))),
      h('select', { id: 'language', 'aria-label': t('语言'), onChange: e => { const url = new URL(location.href); url.searchParams.set('lang', e.target.value); location.href = url; } }, ...[['zh', '中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['zh-TW', '繁體中文']].map(([value, name]) => h('option', { value, selected: value === (new URLSearchParams(location.search).get('lang') || 'zh') }, name)))),
    h('div', { class: 'actions' },
      h('button', { id: 'refresh', onClick: () => work(() => load(state?.draft?.id)) }, t('刷新项目')),
      h('button', { id: 'build', class: 'primary', onClick: () => work(async () => { const p = readEditor(); const built = await api('build', { project: p, fileHash: state.fileHash, sourceHash: state.sourceHash }); await load(built.id); }) }, t('保存并构建草稿')),
      h('button', { id: 'extract', onClick: () => work(async () => { const parts = await api('export', { draft: state?.draft?.id }); $('message').textContent = t('导出的贴图位于 {path}', { path: parts.directory }); }) }, t('导出独立贴图')),
      h('button', { id: 'pack', onClick: () => work(async () => { const result = await api('pack', { draft: state.draft.id }); $('download').href = result.url; $('download').download = result.file.split(/[\\/]/).pop(); $('download').textContent = t('已生成归档；尚未安装或部署。'); }) }, t('打包已审核草稿')),
      h('span', { id: 'status', class: 'status', role: 'status' }), h('a', { id: 'download' })),
    h('p', { id: 'error', class: 'error hidden', role: 'alert' }), h('p', { id: 'message', class: 'caption' }),
    h('div', { class: 'layout' },
      h('aside', { class: 'panel stack' }, h('h2', {}, t('贴图区域')), h('select', { id: 'model-pick', class: 'wide', onChange: fillRegions }), h('select', { id: 'region-pick', class: 'wide', onChange: chooseRegion }),
        h('img', { id: 'region-image', class: 'region-image', alt: t('区域预览') }), h('pre', { id: 'region-meta', class: 'region-meta' }),
        h('label', {}, t('上传区域 PNG'), h('input', { id: 'upload', type: 'file', accept: 'image/png,.png', onChange: upload })),
        h('p', { class: 'muted' }, t('默认只在草稿中应用。')), h('h2', {}, t('布料参数')), h('div', { id: 'cloth-fields', class: 'cloth' }),
        h('h2', {}, t('骨骼运动范围')), h('select', { id: 'bone-pick', class: 'wide', onChange: showBone }), h('pre', { id: 'bone-meta', class: 'region-meta' })),
      h('section', { class: 'panel viewer' },
        h('div', { class: 'transport' },
          h('label', {}, t('动画'), h('select', { id: 'clip', onChange: e => setClip(e.target.value) })),
          h('button', { id: 'play', onClick: () => { playing = !playing; $('play').textContent = playing ? t('暂停') : t('播放'); } }, t('暂停')),
          h('label', {}, t('速度'), h('select', { id: 'speed' }, ...[.25, .5, 1, 2].map(v => h('option', { value: v, selected: v === 1 }, `${v}×`)))),
          h('label', {}, t('时间'), h('input', { id: 'time', type: 'range', min: 0, max: 1, step: .001, value: 0, onInput: e => { playing = false; $('play').textContent = t('播放'); setTime(Number(e.target.value)); } })),
          h('label', {}, t('缩放'), h('input', { id: 'zoom', type: 'range', min: .5, max: 2, step: .05, value: 1, onInput: layoutModels }))),
        h('div', { class: 'viewer-tools' },
          h('label', {}, h('input', { id: 'bones', type: 'checkbox', onChange: draw }), t('骨骼')),
          h('label', {}, h('input', { id: 'mesh', type: 'checkbox', onChange: draw }), t('网格')),
          h('label', {}, h('input', { id: 'overlay', type: 'checkbox', onChange: draw }), t('对照原模型')),
          h('button', { id: 'record', onClick: () => work(async () => { const bytes = Uint8Array.from(atob(await record()), c => c.charCodeAt(0)); const a = h('a', { href: URL.createObjectURL(new Blob([bytes], { type: 'video/webm' })), download: 'artwork-motion.webm' }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }) }, t('录制动态预览'))),
        h('div', { id: 'stage' }), h('p', { id: 'caption', class: 'caption' }),
        h('div', { class: 'panel' }, h('h2', {}, t('数值检查')), h('div', { id: 'check-results', class: 'checks' }))),
      h('aside', { class: 'panel review' }, h('h2', {}, t('待人工审核')), h('p', { id: 'manual-hint' }, t('数值通过不等于外观通过。请观看动态并核对参考图。')),
        h('div', { id: 'manual-list', class: 'stack' }), h('div', { class: 'stack' },
          h('label', {}, t('复核者'), h('input', { id: 'reviewer', maxLength: 100 })), h('label', {}, t('审核备注'), h('textarea', { id: 'review-notes', rows: 3 })),
          h('button', { id: 'review-save', onClick: () => work(async () => { await api('review', { draft: state.draft.id, assetHash: state.draft.assetHash, reviewer: $('reviewer').value, notes: $('review-notes').value, checked: [...document.querySelectorAll('[data-detail]:checked')].map(input => input.dataset.detail) }); await load(state.draft.id); }) }, t('记录人工审核'))))),
    h('details', { class: 'panel bottom' }, h('summary', {}, t('项目 JSON')), h('p', { class: 'muted' }, t('素材或项目改变后，旧审核会失效。')), h('textarea', { id: 'project-json', rows: 20, spellcheck: false, 'aria-label': t('项目 JSON'), onInput: markDirty })),
    h('footer', {}, t('构建草稿后再记录审核。'), ' · ', h('span', { id: 'project-path', class: 'code' })));
}

async function load(id) {
  state = await api('state' + (id ? '?draft=' + encodeURIComponent(id) : '')); project = structuredClone(state.project); dirty = false;
  $('project-json').value = JSON.stringify(project, null, 2); $('message').textContent = project.name + ' · ' + project.plugin;
  $('model-pick').replaceChildren(...project.models.map(m => h('option', { value: m.id }, m.label)));
  $('project-path').textContent = `${project.id} / ${state.projectHash.slice(0, 12)} / ${state.sourceHash.slice(0, 12)}`;
  $('check-results').replaceChildren(...state.report.results.map(r => h('output', { class: r.status === 'pass' ? 'pass' : 'fail' }, `${r.status === 'pass' ? '✓' : '✕'} ${r.id}`, h('div', {}, r.detail || JSON.stringify(r.metrics)))));
  $('manual-list').replaceChildren(...state.report.manual.map(d => {
    const reference = state.references.find(r => r.id === d.id);
    return h('div', { class: 'check' }, h('label', {}, h('input', { type: 'checkbox', 'data-detail': d.id, checked: d.status === 'reviewed' }), d.label), h('p', {}, d.expected),
      reference?.available ? h('a', { href: reference.url, target: '_blank', rel: 'noopener' }, h('img', { class: 'reference', src: reference.url, alt: d.label })) : d.reference ? h('small', {}, t('参考图暂不可用')) : null);
  }));
  await scene(); fillRegions(); updateButtons();
}

async function scene() {
  const own = ++generation;
  if (!app) { app = new PIXI.Application({ width: 960, height: 650, backgroundColor: 0x18202b, antialias: true, preserveDrawingBuffer: true }); app.stop(); $('stage').append(app.view); }
  for (const node of app.stage.removeChildren()) node.destroy({ children: true, texture: false, baseTexture: false }); records = [];
  for (const [i, entry] of state.previewModels.entries()) {
    const result = await PIXI.Assets.load(entry.skel); if (own !== generation) return;
    const model = new PIXI.spine.Spine(result.spineData); model.autoUpdate = false;
    if (result.spineData.animations.length) model.state.setAnimation(0, result.spineData.findAnimation('Idle') ? 'Idle' : result.spineData.animations[0].name, true); model.update(.5);
    const bounds = model.getLocalBounds(), scale = Math.min(420 / bounds.width, 490 / bounds.height), center = i * 480 + 240;
    const record = { id: entry.id, data: result.spineData, model, graphics: new PIXI.Graphics(), scale,
      x: center - (bounds.x + bounds.width / 2) * scale, y: 610 - (bounds.y + bounds.height) * scale, label: new PIXI.Text(entry.label, { fontFamily: 'Arial', fontSize: 20, fill: 0xe6eef7 }) };
    record.label.anchor.set(.5, 0); record.label.position.set(center, 20);
    const base = await PIXI.Assets.load(state.sourceModels.find(m => m.id === entry.id).skel);
    record.original = new PIXI.spine.Spine(base.spineData); record.original.autoUpdate = false; record.original.alpha = .3; record.original.tint = 0x8fcaff;
    records.push(record); app.stage.addChild(record.original, model, record.graphics, record.label);
  }
  const clips = [...new Set(records.flatMap(r => r.data.animations.map(a => a.name)))];
  $('clip').replaceChildren(...clips.map(name => h('option', { value: name, selected: name === clip }, name)));
  if (!clips.includes(clip)) clip = clips[0]; layoutModels(); setClip(clip);
}

function layoutModels() {
  const zoom = Number($('zoom').value);
  for (const r of records) for (const node of [r.model, r.original, r.graphics]) { node.scale.set(r.scale * zoom); node.position.set(r.x - (zoom - 1) * 240, r.y + (zoom - 1) * 120); }
  draw();
}
function setClip(name) { clip = name; time = 0; duration = Math.max(.001, ...records.map(r => r.data.findAnimation(name)?.duration || 0)); $('clip').value = name; $('time').max = duration; setTime(0); }
function setTime(next) {
  time = Math.max(0, Math.min(duration, next));
  for (const r of records) for (const m of [r.model, r.original]) {
    m.state.clearTracks(); m.skeleton.setToSetupPose();
    const exists = m.spineData.findAnimation(clip), fallback = m.spineData.findAnimation('Idle')?.name || m.spineData.animations[0]?.name;
    if (exists || fallback) m.state.setAnimation(0, exists ? clip : fallback, false); m.update(exists ? time : .5);
  }
  $('time').value = time; draw();
}
function draw() {
  if (!app) return;
  for (const r of records) {
    r.original.visible = $('overlay').checked && !!state.draft; r.graphics.clear();
    if ($('bones').checked) for (const b of r.model.skeleton.bones) {
      if (!b.parent) continue; r.graphics.lineStyle(.8, 0x77f4c3, .85).moveTo(b.parent.worldX, b.parent.worldY).lineTo(b.worldX, b.worldY); r.graphics.beginFill(0x77f4c3).drawCircle(b.worldX, b.worldY, 1.7).endFill();
    }
    if ($('mesh').checked && selected?.model === r.id) for (const slot of r.model.skeleton.slots) {
      const a = slot.getAttachment(); if (a?.path !== selected.name || !a.triangles) continue;
      const vertices = new Float32Array(a.worldVerticesLength); a.computeWorldVertices(slot, 0, vertices.length, vertices, 0, 2);
      r.graphics.lineStyle(.8, 0xffd47b, .9);
      for (let i = 0; i < a.triangles.length; i += 3) { const [a0, b, c] = a.triangles.slice(i, i + 3); r.graphics.moveTo(vertices[a0 * 2], vertices[a0 * 2 + 1]).lineTo(vertices[b * 2], vertices[b * 2 + 1]).lineTo(vertices[c * 2], vertices[c * 2 + 1]).lineTo(vertices[a0 * 2], vertices[a0 * 2 + 1]); }
    }
  }
  const missing = records.filter(r => !r.data.findAnimation(clip)).map(r => r.id);
  $('caption').textContent = `${clip} · ${time.toFixed(2)} / ${duration.toFixed(2)} s${missing.length ? ' · ' + t('该视角无此动画') + ': ' + missing.join(', ') : ''}`;
  app.renderer.render(app.stage);
}

function fillRegions() {
  const model = project.models.find(m => m.id === $('model-pick').value), info = state.models.find(m => m.id === model.id);
  $('region-pick').replaceChildren(...info.regions.map(r => h('option', { value: r.name, selected: r.name === model.cloth?.attachment }, r.name)));
  $('bone-pick').replaceChildren(...info.bones.map(b => h('option', { value: b.name, selected: b.name === model.cloth?.bodyBone }, b.name)));
  showBone();
  const fields = [['topWidth', t('上宽')], ['hemWidth', t('下摆宽')], ['top', t('顶部')], ['length', t('长度')], ['hemLegWeight', t('腿部权重')]];
  $('cloth-fields').replaceChildren(...(model.cloth ? fields.map(([key, label]) => h('label', {}, label, h('input', { type: 'number', step: key === 'hemLegWeight' ? .05 : 1, value: model.cloth.profile[key], 'data-profile': key,
    onChange: e => { try { const p = readEditor(); p.models.find(m => m.id === model.id).cloth.profile[key] = Number(e.target.value); writeEditor(p); } catch (e) { fail(e); } } }))) : []));
  chooseRegion();
}
function showBone() { $('bone-meta').textContent = JSON.stringify(state.models.find(m => m.id === $('model-pick').value).bones.find(b => b.name === $('bone-pick').value), null, 2); }
function chooseRegion() {
  const model = $('model-pick').value, name = $('region-pick').value; selected = { model, name };
  const view = state.draft?.id || state.sourceModels[0].skel.split('/')[2];
  $('region-image').src = `/regions/${view}/${model}/${hex(name)}.png`;
  const info = state.models.find(m => m.id === model), rect = info.regions.find(r => r.name === name), attachment = info.attachments.find(a => a.path === name);
  $('region-meta').textContent = JSON.stringify({ rect, attachment }, null, 2); draw();
}
async function upload(event) {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  await work(async () => {
    if (!selected) throw new Error(t('请先选择一个贴图区域。'));
    if (file.size > 12 * 1024 * 1024 || !/\.png$/i.test(file.name)) throw new Error(t('仅支持不超过 12 MiB 的 PNG。'));
    const encoded = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.onerror = reject; r.readAsDataURL(file); });
    const source = await api('upload', { data: encoded }), p = readEditor();
    p.operations.push({ model: selected.model, region: selected.name, source: { path: source.path, components: 'all', trim: false } }); writeEditor(p);
  });
}

function contactSheet() {
  const sheet = new PIXI.Application({ width: 1280, height: records.length * 450, backgroundColor: 0x18202b, antialias: true, preserveDrawingBuffer: true }); sheet.stop();
  for (const [row, record] of records.entries()) for (const [col, name] of ['Idle', 'Attack', 'Skill', 'Start'].entries()) {
    if (!record.data.findAnimation(name)) continue;
    const model = new PIXI.spine.Spine(record.data); model.autoUpdate = false; model.state.setAnimation(0, name, false); model.update(name === 'Idle' ? .5 : .35);
    const b = model.getLocalBounds(), s = Math.min(290 / b.width, 350 / b.height); model.scale.set(s); model.position.set(col * 320 + 160 - (b.x + b.width / 2) * s, row * 450 + 420 - (b.y + b.height) * s); sheet.stage.addChild(model);
    const title = new PIXI.Text(`${record.id} / ${name}`, { fontFamily: 'Arial', fontSize: 18, fill: 0xe6eef7 }); title.anchor.set(.5, 0); title.position.set(col * 320 + 160, row * 450 + 16); sheet.stage.addChild(title);
  }
  sheet.renderer.render(sheet.stage); const png = sheet.view.toDataURL('image/png'); sheet.destroy(true, { children: true, texture: false, baseTexture: false }); return png;
}
async function record() {
  const wasPlaying = playing; playing = false;
  const chunks = [], stream = app.view.captureStream(30), recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 2500000 });
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); }; const stopped = new Promise(resolve => recorder.onstop = resolve); recorder.start();
  try {
    for (const name of ['Idle', 'Attack', 'Skill', 'Start']) {
      setClip(name); const length = Math.max(1.2, Math.min(2.5, duration + .15));
      for (let i = 0; i < length * 30; i++) { setTime(Math.min(duration, i / 30)); await new Promise(resolve => setTimeout(resolve, 1000 / 30)); }
    }
  } finally { recorder.stop(); await stopped; stream.getTracks().forEach(t => t.stop()); playing = wasPlaying; }
  return new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(new Blob(chunks, { type: recorder.mimeType })); });
}

let last = performance.now();
function tick(now) { const dt = Math.min(.1, (now - last) / 1000); last = now; if (playing && !busy && records.length) setTime((time + dt * Number($('speed').value)) % duration); requestAnimationFrame(tick); }
async function boot() {
  const lang = new URLSearchParams(location.search).get('lang') || 'zh';
  if (['en', 'ja', 'ko', 'zh-TW'].includes(lang)) { addMessages(lang, await (await fetch(`/i18n/${lang}.json`)).json()); setLang(lang); }
  shell(); await load(); requestAnimationFrame(tick);
}
const ready = boot().catch(e => { if ($('error')) fail(e); else $('app').textContent = t('请使用命令行打印的工作台地址。'); throw e; });
// Stable, documented automation hooks for agents and the headless renderer. No filesystem/eval access.
window.artwork = { ready, setClip, setTime, contactSheet, record, snapshot: () => ({ clip, time, duration, candidate: state?.draft?.id || null, sourceHash: state?.sourceHash,
  models: records.map(r => ({ id: r.id, clips: r.data.animations.map(a => a.name) })), selected, dirty }) };
