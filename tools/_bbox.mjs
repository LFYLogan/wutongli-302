/* 在指定区域内测量肤色像素的包围盒，用来确认立绘的位置与尺寸
   node tools/_bbox.mjs <png> x0 y0 x1 y1 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const d = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); colorType = d[9]; }
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[rp++], row = raw.subarray(rp, rp + stride); rp += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev ? prev[x] : 0, c = (prev && x >= ch) ? prev[x - ch] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

const [file, ...rest] = process.argv.slice(2);
const [X0, Y0, X1, Y1] = (rest.length === 4 ? rest : [0, 0, 1e9, 1e9]).map(Number);
const img = decodePNG(readFileSync(file));

/* 逐行统计肤色像素，画出"每行的跨度"，直接看出人形 */
const rowsOut = [];
let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, cnt = 0;
const rowSpan = new Map();
for (let y = Math.max(0, Y0); y < Math.min(img.h, Y1); y++) {
  for (let x = Math.max(0, X0); x < Math.min(img.w, X1); x++) {
    const i = (y * img.w + x) * img.ch;
    const R = img.data[i], G = img.data[i + 1], B = img.data[i + 2];
    if (R > 165 && G > 125 && B > 105 && R > B + 14) {
      cnt++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      const s = rowSpan.get(y) || [x, x];
      s[0] = Math.min(s[0], x); s[1] = Math.max(s[1], x);
      rowSpan.set(y, s);
    }
  }
}
console.log(`肤色像素 ${cnt}`);
if (!cnt) { console.log('区域内没有肤色像素'); process.exit(0); }
console.log(`包围盒  x ${minX} - ${maxX}  (宽 ${maxX - minX + 1})`);
console.log(`        y ${minY} - ${maxY}  (高 ${maxY - minY + 1})`);
console.log(`中心    (${Math.round((minX + maxX) / 2)}, ${Math.round((minY + maxY) / 2)})`);
console.log('\n每 12 行的肤色跨度（左边界 → 右边界，宽度）：');
for (let y = minY; y <= maxY; y += 12) {
  const s = rowSpan.get(y);
  if (s) console.log(`  y=${String(y).padStart(4)}   ${String(s[0]).padStart(4)} → ${String(s[1]).padStart(4)}   宽 ${s[1] - s[0] + 1}`);
}
