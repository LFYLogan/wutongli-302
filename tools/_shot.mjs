/* 截图区域像素分析：node tools/_shot.mjs <png> <x0> <y0> <x1> <y1>
   判断指定区域里有没有"人物皮肤/五官"级别的像素，用来验证立绘到底渲染出来没有。 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!ch) throw new Error('colorType ' + colorType);
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
const px = (img, x, y) => { const i = (y * img.w + x) * img.ch; return { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] }; };
const lum = (p) => 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b;
const isSkin = (p) => p.r > 170 && p.g > 130 && p.b > 110 && p.r > p.b + 15;

const [file, x0, y0, x1, y1] = process.argv.slice(2);
const img = decodePNG(readFileSync(file));
const X0 = +x0, Y0 = +y0, X1 = +x1, Y1 = +y1;

let skin = 0, bright = 0, total = 0, darkish = 0;
const hist = {};
for (let y = Y0; y < Math.min(Y1, img.h); y++) {
  for (let x = X0; x < Math.min(X1, img.w); x++) {
    const p = px(img, x, y); total++;
    const l = lum(p);
    if (isSkin(p)) skin++;
    if (l > 170) bright++;
    if (l < 60) darkish++;
    const key = `${p.r >> 5},${p.g >> 5},${p.b >> 5}`;
    hist[key] = (hist[key] || 0) + 1;
  }
}
const top = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 6)
  .map(([k, v]) => { const [r, g, b] = k.split(',').map(Number); return `rgb(${r << 5},${g << 5},${b << 5})×${(v / total * 100).toFixed(1)}%`; });

console.log(`图像        ${img.w} x ${img.h}`);
console.log(`区域        (${X0},${Y0}) - (${X1},${Y1})  共 ${total} 像素`);
console.log(`肤色像素    ${skin}  (${(skin / total * 100).toFixed(1)}%)`);
console.log(`高亮像素    ${bright}  (${(bright / total * 100).toFixed(1)}%)`);
console.log(`深色像素    ${darkish}  (${(darkish / total * 100).toFixed(1)}%)`);
console.log(`主色        ${top.join('  ')}`);
console.log(`判定        ${skin / total > 0.08 ? '★ 有立绘（检测到成片肤色）' : '✗ 该区域没有人物'}`);
