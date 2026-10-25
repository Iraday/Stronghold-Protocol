import assert from 'node:assert/strict';

export function extractRegion(image, r) {
  assert.ok([r.x, r.y, r.sw, r.sh].every(Number.isInteger) && r.x >= 0 && r.y >= 0 && r.sw > 0 && r.sh > 0);
  assert.ok(r.x + r.w <= image.w && r.y + r.h <= image.h, 'atlas region outside page');
  const tile = { w: r.sw, h: r.sh, data: Buffer.alloc(r.sw * r.sh * 4) };
  for (let y = 0; y < tile.h; y++) for (let x = 0; x < tile.w; x++) {
    const xx = r.rotate ? r.x + y : r.x + x, yy = r.rotate ? r.y + r.h - 1 - x : r.y + y;
    image.data.copy(tile.data, (y * tile.w + x) * 4, (yy * image.w + xx) * 4, (yy * image.w + xx) * 4 + 4);
  }
  return tile;
}

/** Preserve paired eyes/detached fingers by default; discard only tiny disconnected edge noise. */
export function cropCell(image, { columns = 1, rows = 1, index = 0, components = 'all', trim = true } = {}) {
  const x0 = Math.floor(index % columns * image.w / columns), y0 = Math.floor(Math.floor(index / columns) * image.h / rows);
  const w = Math.floor((index % columns + 1) * image.w / columns) - x0, h = Math.floor((Math.floor(index / columns) + 1) * image.h / rows) - y0;
  assert.ok(w > 0 && h > 0, 'source sheet cells must contain at least one pixel');
  const tile = { w, h, data: Buffer.alloc(w * h * 4) };
  for (let y = 0; y < h; y++) image.data.copy(tile.data, y * w * 4, ((y0 + y) * image.w + x0) * 4, ((y0 + y) * image.w + x0 + w) * 4);
  if (!trim) return tile;
  const visited = new Uint8Array(w * h), groups = [];
  for (let i = 0; i < visited.length; i++) {
    if (visited[i] || tile.data[i * 4 + 3] < 128) continue;
    const queue = [i]; visited[i] = 1;
    for (let at = 0; at < queue.length; at++) {
      const p = queue[at], x = p % w, y = Math.floor(p / w);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, next = yy * w + xx;
        if (xx < 0 || xx >= w || yy < 0 || yy >= h || visited[next] || tile.data[next * 4 + 3] < 128) continue;
        visited[next] = 1; queue.push(next);
      }
    }
    groups.push(queue);
  }
  groups.sort((a, b) => b.length - a.length);
  assert.ok(groups.length, 'source cell has no opaque component');
  const kept = components === 'largest' ? [groups[0]] : groups.filter(g => g.length >= Math.max(2, groups[0].length * .03));
  let left = w, top = h, right = 0, bottom = 0;
  for (const group of kept) for (const p of group) { left = Math.min(left, p % w); right = Math.max(right, p % w); top = Math.min(top, Math.floor(p / w)); bottom = Math.max(bottom, Math.floor(p / w)); }
  const result = { w: right - left + 1, h: bottom - top + 1, data: Buffer.alloc((right - left + 1) * (bottom - top + 1) * 4) };
  for (const group of kept) for (const p of group) tile.data.copy(result.data, ((Math.floor(p / w) - top) * result.w + p % w - left) * 4, p * 4, p * 4 + 4);
  return result;
}

export function resize(tile, w, h) {
  const result = { w, h, data: Buffer.alloc(w * h * 4) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.max(0, Math.min(tile.w - 1, (x + .5) * tile.w / w - .5)), sy = Math.max(0, Math.min(tile.h - 1, (y + .5) * tile.h / h - .5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0, rgb = [0, 0, 0]; let alpha = 0;
    for (const [xx, yy, weight] of [[x0, y0, (1 - fx) * (1 - fy)], [Math.min(tile.w - 1, x0 + 1), y0, fx * (1 - fy)], [x0, Math.min(tile.h - 1, y0 + 1), (1 - fx) * fy], [Math.min(tile.w - 1, x0 + 1), Math.min(tile.h - 1, y0 + 1), fx * fy]]) {
      const at = (yy * tile.w + xx) * 4, a = tile.data[at + 3] / 255 * weight;
      for (let k = 0; k < 3; k++) rgb[k] += tile.data[at + k] * a;
      alpha += a;
    }
    const at = (y * w + x) * 4;
    if (alpha) for (let k = 0; k < 3; k++) result.data[at + k] = Math.round(rgb[k] / alpha);
    result.data[at + 3] = Math.round(alpha * 255);
  }
  return result;
}

export function replaceRegion(image, region, source, { heightRatio = 1 } = {}) {
  extractRegion(image, region); // validate every bound before writing
  const height = Math.max(1, Math.round(region.sh * heightRatio)), tile = resize(source, region.sw, height);
  for (let y = 0; y < region.sh; y++) for (let x = 0; x < region.sw; x++) {
    const xx = region.rotate ? region.x + y : region.x + x, yy = region.rotate ? region.y + region.h - 1 - x : region.y + y, at = (yy * image.w + xx) * 4;
    image.data.fill(0, at, at + 4);
    if (y < height) tile.data.copy(image.data, at, (y * tile.w + x) * 4, (y * tile.w + x) * 4 + 4);
  }
}
