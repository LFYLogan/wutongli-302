/* 两张截图的差异区域：node tools/_diff.mjs a.png b.png [cols] [rows]
   输出差异像素的包围盒 + ASCII 掩膜，用来确定某个元素真实渲染在哪里、多大 */
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

const [fa, fb, ca, ra] = process.argv.slice(2);
const A = decodePNG(readFileSync(fa)), B = decodePNG(readFileSync(fb));
if (A.w !== B.w || A.h !== B.h) { console.log('尺寸不同，无法比较'); process.exit(1); }

const cols = +(ca || 150), rows = +(ra || 46);
const cw = A.w / cols, chh = A.h / rows;
let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, cnt = 0;
const mask = [];
for (let r = 0; r < rows; r++) {
  let line = '';
  for (let c = 0; c < cols; c++) {
    let diffN = 0, tot = 0;
    for (let y = Math.floor(r * chh); y < Math.floor((r + 1) * chh); y++) {
      for (let x = Math.floor(c * cw); x < Math.floor((c + 1) * cw); x++) {
        const i = (y * A.w + x) * A.ch;
        tot++;
        const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
        if (d > 24) {
          diffN++; cnt++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    const p = diffN / tot;
    line += p > 0.6 ? '#' : p > 0.35 ? '*' : p > 0.15 ? '+' : p > 0.04 ? '.' : ' ';
  }
  mask.push(line);
}
console.log(`差异像素 ${cnt}`);
console.log(`包围盒  x ${minX} - ${maxX} (宽 ${maxX - minX + 1})   y ${minY} - ${maxY} (高 ${maxY - minY + 1})`);
console.log(`中心    (${Math.round((minX + maxX) / 2)}, ${Math.round((minY + maxY) / 2)})`);
console.log('\n差异掩膜：');
console.log('+' + '-'.repeat(cols) + '+');
mask.forEach((l) => console.log('|' + l + '|'));
console.log('+' + '-'.repeat(cols) + '+');
