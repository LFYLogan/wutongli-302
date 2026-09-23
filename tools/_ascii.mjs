/* 把 PNG 转成 ASCII 灰度图，让我能"看见"截图
   node tools/_ascii.mjs <png> [cols] [rows] [x0 y0 x1 y1] [--color]
   --color 模式：按颜色分类而非灰度（皮肤=@ 深色=. 亮白=# 中=+） */
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
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
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

const file = process.argv[2];
const cols = +(process.argv[3] || 150);
const rows = +(process.argv[4] || 46);
const box = process.argv.slice(5, 9).map(Number);
const colorMode = process.argv.includes('--color');
const [X0, Y0, X1, Y1] = (box.length === 4 && !box.some(isNaN)) ? box : null;

const img = decodePNG(readFileSync(file));
const x0 = X0 ?? 0, y0 = Y0 ?? 0, x1 = X1 ?? img.w, y1 = Y1 ?? img.h;
const cw = (x1 - x0) / cols, chh = (y1 - y0) / rows;

const RAMP = ' .:-=+*#%@';
let lines = [];
for (let r = 0; r < rows; r++) {
  let line = '';
  for (let c = 0; c < cols; c++) {
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let y = Math.floor(y0 + r * chh); y < Math.floor(y0 + (r + 1) * chh); y++) {
      for (let x = Math.floor(x0 + c * cw); x < Math.floor(x0 + (c + 1) * cw); x++) {
        if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
        const i = (y * img.w + x) * img.ch;
        sr += img.data[i]; sg += img.data[i + 1]; sb += img.data[i + 2]; n++;
      }
    }
    if (!n) { line += ' '; continue; }
    const R = sr / n, G = sg / n, B = sb / n;
    if (colorMode) {
      const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      const skin = R > 165 && G > 125 && B > 105 && R > B + 14;
      const amber = R > 150 && G > 110 && B < 130 && R - B > 50;
      const blue = B > R + 25 && B > 60;
      const green = G > R + 15 && G > B + 10;
      const pink = R > 150 && B > 120 && R > G + 30;
      line += skin ? '@' : amber ? '$' : pink ? '&' : blue ? 'b' : green ? 'g' : lum > 170 ? '#' : lum > 90 ? '+' : lum > 40 ? '-' : lum > 14 ? '.' : ' ';
    } else {
      const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      line += RAMP[Math.min(RAMP.length - 1, Math.round(lum / 255 * (RAMP.length - 1) * 1.7))];
    }
  }
  lines.push(line);
}
console.log(`# ${file}  ${img.w}x${img.h}   区域 (${x0},${y0})-(${x1},${y1})   ${cols}x${rows} 格`);
if (colorMode) console.log('# 图例  @皮肤  $暖黄  &粉  b蓝  g绿  #亮  +中  -暗  .很暗  空格=纯黑');
console.log('+' + '-'.repeat(cols) + '+');
lines.forEach((l, i) => console.log('|' + l + '|'));
console.log('+' + '-'.repeat(cols) + '+');
