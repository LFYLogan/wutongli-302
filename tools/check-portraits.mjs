/* ===========================================================
   立绘质量检查（盲画时的"眼睛"）
     node tools/check-portraits.mjs [--verbose]
   把每个立绘渲染成 PNG，直接解码像素，验证：
     · 覆盖率合理（不是空的，也不是一整块糊）
     · 四角透明（没有游离的碎片跑到画面外）
     · 头发确实覆盖在头顶
     · 眼睛位置确实有深色像素（脸没画歪）
     · 面部中心是肤色（不是被头发盖住）
     · 左右基本对称
     · 底部有渐隐
   =========================================================== */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'assets', 'portraits');
const verbose = process.argv.includes('--verbose');

const CW = 360, CH = 480, SS = 1;   // 渲染尺寸

/* ---------------- 极简 PNG 解码（8 位 RGBA / RGB） ---------------- */
function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('只支持 8 位 PNG');
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!ch) throw new Error('不支持的 colorType ' + colorType);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const row = raw.subarray(rp, rp + stride); rp += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = (prev && x >= ch) ? prev[x - ch] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, ch, data: out };
}

function px(img, x, y) {
  x = Math.max(0, Math.min(img.w - 1, Math.round(x)));
  y = Math.max(0, Math.min(img.h - 1, Math.round(y)));
  const i = (y * img.w + x) * img.ch;
  return {
    r: img.data[i], g: img.data[i + 1], b: img.data[i + 2],
    a: img.ch === 4 ? img.data[i + 3] : 255
  };
}
function luminance(p) { return 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b; }

/* 一块区域里最暗 / 平均亮度、非透明比例 */
function region(img, x0, y0, x1, y1) {
  let min = 999, sum = 0, n = 0, opaque = 0, total = 0;
  for (let y = Math.round(y0); y < y1; y += 2) {
    for (let x = Math.round(x0); x < x1; x += 2) {
      const p = px(img, x, y);
      total++;
      if (p.a > 40) {
        opaque++;
        const l = luminance(p);
        sum += l; n++;
        if (l < min) min = l;
      }
    }
  }
  return { minLum: min, avgLum: n ? sum / n : 0, opaqueRatio: opaque / total, samples: total };
}

/* ---------------- 期望值 ---------------- */
const EXPECT = {
  wan:    { hairDarkMax: 235, fringeMin: 0 },
  xia:    { hairDarkMax: 235, fringeMin: 0 },
  gu:     { hairDarkMax: 120, fringeMin: 0 },
  chiang: { hairDarkMax: 120, fringeMin: 0 }
};

const files = readdirSync(DIR).filter((f) => f.endsWith('.svg')).sort();
let pass = 0, fail = 0;
const problems = [];

console.log(`\n检查 ${files.length} 个立绘\n`);

for (const f of files) {
  const svg = readFileSync(join(DIR, f), 'utf8');

  /* 先做静态检查 */
  const nans = (svg.match(/NaN|undefined|null/g) || []).length;
  const badColors = (svg.match(/(?:fill|stroke)="(?!#[0-9a-fA-F]{3,8}|none|url\()/g) || []).length;
  if (nans) problems.push(`${f}: SVG 里有 ${nans} 处 NaN/undefined`);
  if (badColors) problems.push(`${f}: 有 ${badColors} 处非法颜色值`);

  const img = decodePNG(new Resvg(svg, {
    fitTo: { mode: 'width', value: CW * SS }
  }).render().asPng());

  const all = region(img, 0, 0, img.w, img.h);
  const corners = ['tl', 'tr', 'bl', 'br'].map((c) => {
    const x0 = c[1] === 'l' ? 0 : img.w - 26, y0 = c[0] === 't' ? 0 : img.h - 26;
    return region(img, x0, y0, x0 + 26, y0 + 26).opaqueRatio;
  });
  const topHair = region(img, 145 * SS, 88 * SS, 215 * SS, 118 * SS);
  const eyeL = region(img, 134 * SS, 178 * SS, 170 * SS, 200 * SS);
  const eyeR = region(img, 190 * SS, 178 * SS, 226 * SS, 200 * SS);
  const face = region(img, 168 * SS, 200 * SS, 192 * SS, 226 * SS);
  const chin = region(img, 160 * SS, 240 * SS, 200 * SS, 252 * SS);
  const leftHalf = region(img, 0, 0, img.w / 2, img.h);
  const rightHalf = region(img, img.w / 2, 0, img.w, img.h);
  const bottomRow = region(img, 100 * SS, img.h - 8, 260 * SS, img.h);

  const errs = [];
  if (all.opaqueRatio < 0.25) errs.push(`内容太少（覆盖率 ${(all.opaqueRatio * 100).toFixed(0)}%）`);
  if (all.opaqueRatio > 0.92) errs.push(`内容过多（覆盖率 ${(all.opaqueRatio * 100).toFixed(0)}%，可能糊成一块）`);
  if (Math.max(...corners) > 0.06) errs.push(`角落有游离内容（${corners.map((c) => (c * 100).toFixed(0) + '%').join('/')}）`);
  if (topHair.opaqueRatio < 0.85) errs.push(`头顶没有被头发盖住（${(topHair.opaqueRatio * 100).toFixed(0)}%）`);
  if (eyeL.opaqueRatio < 0.9 || eyeR.opaqueRatio < 0.9) errs.push('眼部区域不完整');
  if (eyeL.minLum > 70 || eyeR.minLum > 70) errs.push(`眼睛不够深（左${eyeL.minLum.toFixed(0)} 右${eyeR.minLum.toFixed(0)}），可能没画上`);
  if (face.opaqueRatio < 0.9) errs.push('面部中心被遮挡');
  if (face.avgLum < 120) errs.push(`面部太暗（${face.avgLum.toFixed(0)}），肤色可能被覆盖`);
  if (chin.opaqueRatio < 0.8) errs.push('下巴区域缺失');
  const sym = Math.abs(leftHalf.opaqueRatio - rightHalf.opaqueRatio) / Math.max(leftHalf.opaqueRatio, rightHalf.opaqueRatio);
  if (sym > 0.22) errs.push(`左右不对称（差 ${(sym * 100).toFixed(0)}%）`);
  if (bottomRow.opaqueRatio > 0.5) errs.push('底部没有渐隐');

  if (errs.length) { fail++; problems.push(`${f}: ` + errs.join('；')); }
  else pass++;

  if (verbose || errs.length) {
    console.log(`${errs.length ? '❌' : '✅'} ${f.padEnd(24)} 覆盖${(all.opaqueRatio * 100).toFixed(0)}% ` +
      `顶${(topHair.opaqueRatio * 100).toFixed(0)}% 眼暗${eyeL.minLum.toFixed(0)}/${eyeR.minLum.toFixed(0)} ` +
      `脸亮${face.avgLum.toFixed(0)} 对称${(sym * 100).toFixed(1)}%`);
  }
}

console.log(`\n════ ${pass} 通过 / ${fail} 有问题 ════`);
if (problems.length) {
  console.log('');
  for (const p of problems) console.log('  • ' + p);
  process.exit(1);
}
console.log('\n所有立绘的几何与明暗都符合预期。\n');
