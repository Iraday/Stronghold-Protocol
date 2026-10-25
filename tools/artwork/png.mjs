// Shared offline PNG/atlas primitives for the artwork workbench and the maintained Chen Qianyu recipe.
import fs from 'node:fs';
import zlib from 'node:zlib';

export function readPng(file) {
  return decodePng(fs.readFileSync(file), String(file));
}
export function decodePng(buf, file = '<buffer>') {
  if (buf.length < 33 || buf.length > 32 * 1024 * 1024 || !buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`${file}: not a bounded PNG`);
  let p = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    if (p + 12 > buf.length) throw new Error(`${file}: truncated PNG chunk`);
    const len = buf.readUInt32BE(p), kind = buf.toString('latin1', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (p + 12 + len > buf.length) throw new Error(`${file}: truncated PNG chunk`);
    if ((zlib.crc32(buf.subarray(p + 4, p + 8 + len)) >>> 0) !== buf.readUInt32BE(p + 8 + len)) throw new Error(`${file}: PNG CRC mismatch`);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || (type !== 6 && type !== 2) || interlace) throw new Error(`${file}: unsupported PNG (depth ${depth}, type ${type}, interlace ${interlace})`);
  if (!w || !h || w > 4096 || h > 4096) throw new Error(`${file}: PNG dimensions must be 1–4096`);
  const bpp = type === 6 ? 4 : 3, stride = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * h });
  if (raw.length !== (stride + 1) * h) throw new Error(`${file}: PNG decoded size mismatch`);
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    if (f > 4) throw new Error(`${file}: unsupported PNG filter`);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[x] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      out[(y * w + x) * 4] = line[x * bpp]; out[(y * w + x) * 4 + 1] = line[x * bpp + 1]; out[(y * w + x) * 4 + 2] = line[x * bpp + 2];
      out[(y * w + x) * 4 + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { w, h, data: out };
}

export function encodePng({ w, h, data }) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) data.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); // filter 0
  const chunk = (kind, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const kb = Buffer.from(kind, 'latin1'), crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([kb, body])) >>> 0);
    return Buffer.concat([len, kb, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
export function writePng(file, image) { fs.writeFileSync(file, encodePng(image)); }

/** Atlas regions of a Spine 3.x/4.x atlas: name → { x, y, w, h } on the page (rotation already applied). */
export function readAtlas(file) {
  const out = new Map();
  let name = null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { name = line.includes(':') ? null : line; if (name) out.set(name, {}); continue; }
    if (!name) continue;
    const [k, v] = line.trim().split(/:\s*/);
    const r = out.get(name);
    if (k === 'rotate') r.rotate = v === 'true' || v === '90';
    else if (k === 'xy') [r.x, r.y] = v.split(',').map(Number);
    else if (k === 'size') [r.sw, r.sh] = v.split(',').map(Number);
    else if (k === 'bounds') [r.x, r.y, r.sw, r.sh] = v.split(',').map(Number);
  }
  for (const r of out.values()) { r.w = r.rotate ? r.sh : r.sw; r.h = r.rotate ? r.sw : r.sh; }
  return out;
}
