/* ===========================================================
   立绘生成器
     node tools/gen-portraits.mjs            → 写入 assets/portraits/*.svg
     node tools/gen-portraits.mjs --sheet    → 另出 tools/_sheet.svg/.png 供审阅
   -----------------------------------------------------------
   风格：极简矢量海报风半身立绘。
   完整的头肩轮廓 / 发型剪影 / 服装 / 配色 / 光影，
   面部用克制的笔触处理——这种风格对手写 SVG 友好，
   而且以后想换成真人绘制的 PNG，直接替换同名文件即可。
   =========================================================== */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'portraits');

/* ---------------- 画布 ---------------- */
const W = 360, H = 480;

/* ---------------- 角色数据 ---------------- */
const PEOPLE = {
  wan: {
    label: '苏晚', age: 26,
    skin: '#f4dccd', skinShade: '#e3bda9', skinLine: '#c99a86',
    hair: '#c9cddc', hairDark: '#a3a8bd', hairLight: '#e6e9f4',
    eye: '#9b7fd4', eyeDark: '#6d55a8',
    cloth: '#4a4658', clothDark: '#37333f', clothLight: '#5d5870',
    accent: '#8f7fb8',
    bang: 'parted', length: 'medium', fringe: 'parted',
    outfit: 'knit', accessory: 'earring', tired: true, browShape: 'flat'
  },
  xia: {
    label: '林知夏', age: 22,
    skin: '#f8dfc9', skinShade: '#e9c1a4', skinLine: '#d09a7c',
    hair: '#8d5a37', hairDark: '#6d4227', hairLight: '#a97247',
    eye: '#d9932f', eyeDark: '#a86a17',
    cloth: '#e9e6df', clothDark: '#3f7d5c', clothLight: '#f6f4ef',
    accent: '#4c9a70',
    bang: 'straight', length: 'ponytail', fringe: 'air',
    outfit: 'apron', accessory: 'badge', tired: false, browShape: 'round'
  },
  gu: {
    label: '顾清和', age: 29,
    skin: '#f2d8c6', skinShade: '#dfb69c', skinLine: '#c28f74',
    hair: '#24262f', hairDark: '#14161d', hairLight: '#3b3f4d',
    eye: '#4f7fd6', eyeDark: '#2f56a0',
    cloth: '#222b3d', clothDark: '#161d2b', clothLight: '#33405a',
    accent: '#6f9ae8',
    bang: 'center', length: 'bob', fringe: 'center',
    outfit: 'blazer', accessory: 'none', tired: true, browShape: 'sharp'
  },
  chiang: {
    label: '江迟', age: 27,
    skin: '#eed7c6', skinShade: '#d9b39c', skinLine: '#bd8b72',
    hair: '#1b1d24', hairDark: '#0f1116', hairLight: '#2e323d',
    eye: '#6a5f52', eyeDark: '#463d33',
    cloth: '#3a3b40', clothDark: '#2a2b2f', clothLight: '#4b4d54',
    accent: '#8a8f9c',
    bang: 'messy', length: 'short', fringe: 'messy',
    outfit: 'sweater', accessory: 'none', tired: true, browShape: 'flat'
  }
};

/* 性别变体：轮廓与服装的巨大差异，配色保持一致 */
const GENDER = {
  f: { shoulder: 1.00, jaw: 1.00, neckW: 1.00, browY: 0, eyeH: 1.00, lip: '#c9808a' },
  m: { shoulder: 1.16, jaw: 1.09, neckW: 1.16, browY: -3, eyeH: 0.94, lip: '#b9837c' }
};

const MOODS = ['normal', 'smile', 'sad', 'surprise'];

/* ---------------- 表达式参数 ---------------- */
function moodParams(mood) {
  switch (mood) {
    case 'smile':    return { lidLower: 4.5, browTilt: -1.5, browUp: 1, mouth: 1, blush: 0.5, eyeScale: 0.97, shine: 1 };
    case 'sad':      return { lidLower: 0, browTilt: 7, browUp: -2, mouth: -1, blush: 0.16, eyeScale: 1.0, shine: 0.72, downcast: 2.5 };
    case 'surprise': return { lidLower: -2.5, browTilt: -2.5, browUp: 5, mouth: 2, blush: 0.24, eyeScale: 1.1, shine: 1.15 };
    default:         return { lidLower: 0, browTilt: 0, browUp: 0, mouth: 0, blush: 0.22, eyeScale: 1.0, shine: 1 };
  }
}

/* ---------------- 几何 ---------------- */
const CX = 180;
const HEAD_TOP = 92, CHIN = 250;
const EYE_Y = 188, EYE_DX = 29;
const HEAD_HALF = 57;

function headPath(g) {
  const j = g.jaw;
  const cxx = CX;
  return [
    `M ${cxx} ${HEAD_TOP}`,
    `C ${cxx - 33} ${HEAD_TOP}, ${cxx - HEAD_HALF} ${HEAD_TOP + 26}, ${cxx - HEAD_HALF} ${HEAD_TOP + 65}`,
    `C ${cxx - HEAD_HALF} ${HEAD_TOP + 100}, ${cxx - 41 / j} ${HEAD_TOP + 128}, ${cxx - 21 / j} ${CHIN - 6}`,
    `C ${cxx - 13} ${CHIN + 1}, ${cxx - 5} ${CHIN + 3}, ${cxx} ${CHIN + 3}`,
    `C ${cxx + 5} ${CHIN + 3}, ${cxx + 13} ${CHIN + 1}, ${cxx + 21 / j} ${CHIN - 6}`,
    `C ${cxx + 41 / j} ${HEAD_TOP + 128}, ${cxx + HEAD_HALF} ${HEAD_TOP + 100}, ${cxx + HEAD_HALF} ${HEAD_TOP + 65}`,
    `C ${cxx + HEAD_HALF} ${HEAD_TOP + 26}, ${cxx + 33} ${HEAD_TOP}, ${cxx} ${HEAD_TOP} Z`
  ].join(' ');
}

function torsoPath(g, outfit) {
  const s = g.shoulder;
  const y0 = 288;
  const xL = CX - 118 * s, xR = CX + 118 * s;
  const nL = CX - 30, nR = CX + 30;
  return [
    `M ${CX} ${y0 - 22}`,
    `C ${nL} ${y0 - 20}, ${nL - 6} ${y0 - 4}, ${nL - 12} ${y0 + 6}`,
    `C ${CX - 96 * s} ${y0 + 20}, ${xL + 22} ${y0 + 52}, ${xL + 8} ${y0 + 90}`,
    `L ${xL - 6} ${H} L ${xR + 6} ${H}`,
    `L ${xR - 8} ${y0 + 90}`,
    `C ${xR - 22} ${y0 + 52}, ${CX + 96 * s} ${y0 + 20}, ${nR + 12} ${y0 + 6}`,
    `C ${nR + 6} ${y0 - 4}, ${nR} ${y0 - 20}, ${CX} ${y0 - 22} Z`
  ].join(' ');
}

/* ---------------- 发型 ----------------
   原则：只用少量、大块的规范形状。手写贝塞尔很容易画崩，
   所以后发是"一整块圆润轮廓"，前发是"覆盖额头的发帘"，两侧是"鬓发"。
   任何风格都不产生游离的碎片形状。 */

const HAIR = {
  short:    { halfW: 66, flare: 8,  yBot: 214 },
  medium:   { halfW: 68, flare: 14, yBot: 300 },
  bob:      { halfW: 68, flare: 10, yBot: 272 },
  ponytail: { halfW: 66, flare: 8,  yBot: 208 }
};

function hairBack(P, g) {
  const h = HAIR[P.length] || HAIR.medium;
  const hw = h.halfW, fl = h.flare, yb = h.yBot;
  /* 一整块后发轮廓 */
  let s = `<path d="M ${CX} ${HEAD_TOP - 24}
    C ${CX - hw * 0.72} ${HEAD_TOP - 24}, ${CX - hw} ${HEAD_TOP + 16}, ${CX - hw} ${HEAD_TOP + 64}
    C ${CX - hw - fl} ${HEAD_TOP + 108}, ${CX - hw - fl} ${yb - 44}, ${CX - hw - fl * 0.7} ${yb}
    C ${CX - hw * 0.42} ${yb + 12}, ${CX + hw * 0.42} ${yb + 12}, ${CX + hw + fl * 0.7} ${yb}
    C ${CX + hw + fl} ${yb - 44}, ${CX + hw + fl} ${HEAD_TOP + 108}, ${CX + hw} ${HEAD_TOP + 64}
    C ${CX + hw} ${HEAD_TOP + 16}, ${CX + hw * 0.72} ${HEAD_TOP - 24}, ${CX} ${HEAD_TOP - 24} Z"
    fill="${P.hairDark}"/>`;

  /* 后发上的两片受光 */
  s += `<path d="M ${CX - hw + 6} ${HEAD_TOP + 30} C ${CX - hw - 4} ${HEAD_TOP + 96}, ${CX - hw - 6} ${yb - 70}, ${CX - hw} ${yb - 16}
    C ${CX - hw + 14} ${yb - 60}, ${CX - hw + 16} ${HEAD_TOP + 96}, ${CX - hw + 22} ${HEAD_TOP + 34} Z"
    fill="${P.hair}" opacity="0.55"/>`;
  s += `<path d="M ${CX + hw - 6} ${HEAD_TOP + 30} C ${CX + hw + 4} ${HEAD_TOP + 96}, ${CX + hw + 6} ${yb - 70}, ${CX + hw} ${yb - 16}
    C ${CX + hw - 14} ${yb - 60}, ${CX + hw - 16} ${HEAD_TOP + 96}, ${CX + hw - 22} ${HEAD_TOP + 34} Z"
    fill="${P.hair}" opacity="0.35"/>`;

  /* 马尾：一条从右后侧垂下的发束 */
  if (P.length === 'ponytail') {
    s += `<path d="M ${CX + 52} ${HEAD_TOP + 44}
      C ${CX + 104} ${HEAD_TOP + 76}, ${CX + 122} ${HEAD_TOP + 168}, ${CX + 116} ${HEAD_TOP + 250}
      C ${CX + 112} ${HEAD_TOP + 300}, ${CX + 96} ${HEAD_TOP + 316}, ${CX + 80} ${HEAD_TOP + 318}
      C ${CX + 96} ${HEAD_TOP + 262}, ${CX + 92} ${HEAD_TOP + 176}, ${CX + 62} ${HEAD_TOP + 108} Z" fill="${P.hair}"/>`;
    s += `<path d="M ${CX + 74} ${HEAD_TOP + 70}
      C ${CX + 108} ${HEAD_TOP + 112}, ${CX + 114} ${HEAD_TOP + 200}, ${CX + 104} ${HEAD_TOP + 288}
      C ${CX + 100} ${HEAD_TOP + 226}, ${CX + 94} ${HEAD_TOP + 150}, ${CX + 68} ${HEAD_TOP + 96} Z" fill="${P.hairDark}" opacity="0.5"/>`;
    s += `<ellipse cx="${CX + 58}" cy="${HEAD_TOP + 46}" rx="17" ry="12" fill="${P.accent}" opacity="0.75"/>`;
  }
  return s;
}

function hairFront(P, g, mood) {
  const c = P.hair, l = P.hairLight;
  const T = 78;                       // 发际线附近
  let s = '';

  /* 发帘（覆盖额头，底边按风格变化） */
  if (P.fringe === 'straight') {
    s += `<path d="M ${CX - 64} 154 C ${CX - 62} 100, ${CX - 34} 74, ${CX} 74 C ${CX + 34} 74, ${CX + 62} 100, ${CX + 64} 154
      C ${CX + 40} 150, ${CX + 16} 156, ${CX} 156 C ${CX - 16} 156, ${CX - 40} 150, ${CX - 64} 154 Z" fill="${c}"/>`;
    s += `<path d="M ${CX - 46} 96 C ${CX - 30} 84, ${CX - 10} 80, ${CX + 8} 82 C ${CX - 14} 88, ${CX - 32} 96, ${CX - 46} 108 Z" fill="${l}" opacity="0.6"/>`;
  } else if (P.fringe === 'air') {
    s += `<path d="M ${CX - 62} 148 C ${CX - 58} 100, ${CX - 32} 76, ${CX} 76 C ${CX + 32} 76, ${CX + 58} 100, ${CX + 62} 148
      C ${CX + 44} 132, ${CX + 22} 126, ${CX + 2} 132 C ${CX - 20} 138, ${CX - 44} 140, ${CX - 62} 148 Z" fill="${c}"/>`;
    s += `<path d="M ${CX - 40} 100 C ${CX - 22} 88, ${CX} 84, ${CX + 18} 88 C ${CX - 6} 92, ${CX - 26} 98, ${CX - 40} 110 Z" fill="${l}" opacity="0.62"/>`;
    s += `<path d="M ${CX - 26} 140 C ${CX - 18} 126, ${CX - 6} 120, ${CX + 6} 122 C ${CX - 6} 128, ${CX - 18} 136, ${CX - 24} 148 Z" fill="${c}" opacity="0.9"/>`;
  } else if (P.fringe === 'center') {
    s += `<path d="M ${CX} ${T - 4} C ${CX - 30} ${T - 4}, ${CX - 60} ${T + 20}, ${CX - 64} 152
      C ${CX - 56} 128, ${CX - 38} 106, ${CX - 18} 90 C ${CX - 12} 86, ${CX - 6} 82, ${CX} 82 Z" fill="${c}"/>`;
    s += `<path d="M ${CX} ${T - 4} C ${CX + 30} ${T - 4}, ${CX + 60} ${T + 20}, ${CX + 64} 152
      C ${CX + 56} 128, ${CX + 38} 106, ${CX + 18} 90 C ${CX + 12} 86, ${CX + 6} 82, ${CX} 82 Z" fill="${c}"/>`;
    s += `<path d="M ${CX - 6} 88 C ${CX - 22} 100, ${CX - 38} 120, ${CX - 46} 144 C ${CX - 36} 120, ${CX - 20} 100, ${CX - 6} 92 Z" fill="${l}" opacity="0.5"/>`;
  } else {
    /* parted / messy：偏分大刘海 */
    s += `<path d="M ${CX - 64} 152 C ${CX - 68} 98, ${CX - 36} 72, ${CX + 6} 74
      C ${CX + 38} 76, ${CX + 60} 100, ${CX + 64} 148
      C ${CX + 46} 118, ${CX + 18} 102, ${CX - 12} 108 C ${CX - 36} 113, ${CX - 54} 130, ${CX - 64} 152 Z" fill="${c}"/>`;
    s += `<path d="M ${CX + 2} 76 C ${CX + 30} 82, ${CX + 50} 102, ${CX + 58} 128 C ${CX + 44} 106, ${CX + 22} 90, ${CX + 2} 84 Z" fill="${l}" opacity="0.58"/>`;
    if (P.fringe === 'messy') {
      s += `<path d="M ${CX - 30} 138 C ${CX - 22} 120, ${CX - 8} 110, ${CX + 8} 110 C ${CX - 8} 118, ${CX - 20} 128, ${CX - 26} 146 Z" fill="${c}"/>`;
      s += `<path d="M ${CX + 6} 112 C ${CX + 20} 118, ${CX + 32} 130, ${CX + 38} 144 C ${CX + 30} 130, ${CX + 18} 120, ${CX + 6} 116 Z" fill="${c}" opacity="0.85"/>`;
    }
  }

  /* 鬓发：贴着脸颊两侧，左右对称 */
  s += `<path d="M ${CX - 60} 128 C ${CX - 72} 172, ${CX - 70} 214, ${CX - 58} 248
    C ${CX - 46} 240, ${CX - 44} 206, ${CX - 46} 176 C ${CX - 48} 154, ${CX - 52} 138, ${CX - 60} 128 Z" fill="${c}"/>`;
  s += `<path d="M ${CX + 60} 128 C ${CX + 72} 172, ${CX + 70} 214, ${CX + 58} 248
    C ${CX + 46} 240, ${CX + 44} 206, ${CX + 46} 176 C ${CX + 48} 154, ${CX + 52} 138, ${CX + 60} 128 Z" fill="${c}"/>`;

  /* 头顶高光带 */
  s += `<path d="M ${CX - 44} 104 C ${CX - 26} 88, ${CX + 26} 88, ${CX + 44} 104
    C ${CX + 24} 96, ${CX - 24} 96, ${CX - 44} 104 Z" fill="${l}" opacity="0.42"/>`;

  return s;
}

/* ---------------- 五官 ---------------- */
function eye(cx, P, gp, mp, side) {
  const w = 18, h = 11.4 * gp.eyeH * mp.eyeScale;
  const lid = mp.lidLower;
  const dy = mp.downcast || 0;
  const y = EYE_Y + dy;
  const iris = P.eye, irisD = P.eyeDark;

  return `
<g>
  <ellipse cx="${cx}" cy="${y + 1}" rx="${w}" ry="${h}" fill="#fffdfa"/>
  <ellipse cx="${cx}" cy="${y + 1}" rx="${w}" ry="${h - lid * 0.35}" fill="url(#irisGrad-${P.key})" clip-path="url(#eyeClip-${P.key}-${side})"/>
  <circle cx="${cx}" cy="${y + 2}" r="${7.2}" fill="${iris}" opacity="0.95"/>
  <circle cx="${cx}" cy="${y + 3}" r="${3.4}" fill="${irisD}"/>
  <circle cx="${cx - 3.1}" cy="${y - 2.6}" r="${2.5 * mp.shine}" fill="#ffffff" opacity="0.92"/>
  <circle cx="${cx + 3.4}" cy="${y + 5.4}" r="${1.35 * mp.shine}" fill="#ffffff" opacity="0.6"/>
  <ellipse cx="${cx}" cy="${y - h + 2}" rx="${w}" ry="${h * 0.5}" fill="${P.skinShade}" opacity="0.55"/>
  <ellipse cx="${cx}" cy="${y + h - lid}" rx="${w - 1}" ry="${2.1}" fill="${P.skinShade}" opacity="0.5"/>
  <path d="M ${cx - w} ${y - h * 0.35} C ${cx - w * 0.55} ${y - h - 3.2}, ${cx + w * 0.55} ${y - h - 3.2}, ${cx + w} ${y - h * 0.45}"
        stroke="#2b2530" stroke-width="3.4" stroke-linecap="round" fill="none"/>
  <path d="M ${cx + w - 2} ${y - h * 0.5} L ${cx + w + 3.6} ${y - h * 0.85}"
        stroke="#2b2530" stroke-width="2.8" stroke-linecap="round"/>
  <path d="M ${cx - w + 2} ${y + h * 0.72} C ${cx} ${y + h * 1.02}, ${cx + w - 2} ${y + h * 0.72}"
        stroke="${P.skinLine}" stroke-width="1.9" stroke-linecap="round" fill="none" opacity="0.75"/>
</g>`;
}

function brow(cx, P, gp, mp) {
  const y = EYE_Y - 30 + gp.browY - mp.browUp;
  const t = mp.browTilt;
  const sharp = P.browShape === 'sharp';
  const inner = cx + (cx < CX ? 20 : -20);
  const outer = cx + (cx < CX ? -20 : 20);
  const yi = y + (cx < CX ? t : t);
  const yo = y - (cx < CX ? t * 0.25 : t * 0.25);
  const w = sharp ? 3.6 : 3.9;
  return `<path d="M ${outer} ${yo} C ${outer + (cx < CX ? 12 : -12)} ${y - 4.5}, ${inner - (cx < CX ? 10 : -10)} ${yi - 2}, ${inner} ${yi + 3.2}"
    stroke="${P.hairDark}" stroke-width="${w}" stroke-linecap="round" fill="none" opacity="0.94"/>`;
}

function mouth(P, mp) {
  const y = 232;
  if (mp.mouth >= 2) {
    return `<ellipse cx="${CX}" cy="${y + 1}" rx="6.4" ry="7.4" fill="#7d3f46"/>
            <ellipse cx="${CX}" cy="${y + 3.6}" rx="4.2" ry="3.4" fill="#c9707c" opacity="0.9"/>`;
  }
  if (mp.mouth >= 1) {
    return `<path d="M ${CX - 11} ${y - 1.5} C ${CX - 4} ${y + 6.5}, ${CX + 4} ${y + 6.5}, ${CX + 11} ${y - 1.5}"
      stroke="#8c4a52" stroke-width="2.7" stroke-linecap="round" fill="none"/>
      <path d="M ${CX - 7} ${y + 3.4} C ${CX - 3} ${y + 6}, ${CX + 3} ${y + 6}, ${CX + 7} ${y + 3.4}" fill="#d98b95" opacity="0.5"/>`;
  }
  if (mp.mouth <= -1) {
    return `<path d="M ${CX - 9} ${y + 3.6} C ${CX - 3} ${y - 2.4}, ${CX + 3} ${y - 2.4}, ${CX + 9} ${y + 3.6}"
      stroke="#8c4a52" stroke-width="2.6" stroke-linecap="round" fill="none"/>`;
  }
  return `<path d="M ${CX - 8.5} ${y + 1.2} C ${CX - 3} ${y + 4.6}, ${CX + 3} ${y + 4.6}, ${CX + 8.5} ${y + 1.2}"
    stroke="#8c4a52" stroke-width="2.5" stroke-linecap="round" fill="none"/>`;
}

/* ---------------- 服装 ---------------- */
function outfit(P, g) {
  const t = torsoPath(g, P.outfit);
  const c = P.cloth, d = P.clothDark, l = P.clothLight;
  let s = `<path d="${t}" fill="${c}"/>`;

  if (P.outfit === 'knit') {
    s += `<path d="M 180 268 C 158 268, 142 280, 134 300 C 150 288, 166 282, 180 282 C 194 282, 210 288, 226 300 C 218 280, 202 268, 180 268 Z" fill="${d}" opacity="0.85"/>`;
    s += `<path d="M 118 330 C 138 348, 150 386, 152 430" stroke="${d}" stroke-width="2" fill="none" opacity="0.4"/>`;
    s += `<path d="M 244 336 C 226 356, 216 392, 214 436" stroke="${d}" stroke-width="2" fill="none" opacity="0.4"/>`;
    s += `<path d="M 92 350 C 84 400, 80 444, 82 476 L 62 476 C 60 430, 66 380, 78 342 Z" fill="${d}" opacity="0.5"/>`;
  } else if (P.outfit === 'apron') {
    s += `<path d="M 180 276 C 152 276, 130 292, 122 316 L 132 480 L 228 480 L 238 316 C 230 292, 208 276, 180 276 Z" fill="${l}"/>`;
    s += `<path d="M 136 300 C 150 290, 210 290, 224 300 L 228 340 L 132 340 Z" fill="${P.accent}" opacity="0.92"/>`;
    s += `<path d="M 140 292 L 168 292 L 160 340 L 134 340 Z" fill="${l}"/>`;
    s += `<path d="M 220 292 L 192 292 L 200 340 L 226 340 Z" fill="${l}"/>`;
    s += `<path d="M 128 344 L 232 344 L 234 372 L 126 372 Z" fill="${d}" opacity="0.55"/>`;
    s += `<rect x="196" y="392" width="34" height="24" rx="4" fill="#f4f2ec" opacity="0.9"/>`;
    s += `<path d="M 200 400 L 226 400 M 200 407 L 220 407" stroke="#9aa3b2" stroke-width="2" stroke-linecap="round"/>`;
  } else if (P.outfit === 'blazer') {
    s += `<path d="M 180 268 C 168 268, 158 274, 152 284 L 158 480 L 122 480 L 130 300 C 148 280, 164 270, 180 270 Z" fill="${l}"/>`;
    s += `<path d="M 180 268 C 192 268, 202 274, 208 284 L 202 480 L 238 480 L 230 300 C 212 280, 196 270, 180 270 Z" fill="${l}"/>`;
    s += `<path d="M 180 270 L 152 284 L 168 336 L 180 300 Z" fill="${d}" opacity="0.9"/>`;
    s += `<path d="M 180 270 L 208 284 L 192 336 L 180 300 Z" fill="${d}" opacity="0.9"/>`;
    s += `<path d="M 180 300 L 172 336 L 180 480 L 188 336 Z" fill="${P.accent}" opacity="0.9"/>`;
    s += `<path d="M 126 306 L 148 288 M 234 306 L 212 288" stroke="${d}" stroke-width="2.4" fill="none" opacity="0.6"/>`;
  } else {
    s += `<path d="M 180 268 C 156 268, 140 282, 134 302 C 152 288, 166 282, 180 282 C 194 282, 208 288, 226 302 C 220 282, 204 268, 180 268 Z" fill="${d}" opacity="0.9"/>`;
    s += `<path d="M 104 356 C 96 404, 92 446, 94 476 L 76 476 C 74 428, 80 382, 92 348 Z" fill="${d}" opacity="0.45"/>`;
    s += `<path d="M 256 356 C 264 404, 268 446, 266 476 L 284 476 C 286 428, 280 382, 268 348 Z" fill="${d}" opacity="0.45"/>`;
  }
  return s;
}

/* ---------------- 组装 ---------------- */
function portraitInner(key, gender, mood) {
  const base = PEOPLE[key];
  if (!base) throw new Error('unknown person ' + key);
  const P = { ...base, key: key + '_' + gender };
  const g = GENDER[gender];
  const mp = moodParams(mood);
  const eyeDx = EYE_DX + (gender === 'm' ? 1.5 : 0);

  const defs = `
<defs>
  <linearGradient id="skinGrad-${P.key}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${P.skin}"/><stop offset="1" stop-color="${P.skinShade}"/>
  </linearGradient>
  <linearGradient id="hairGrad-${P.key}" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0" stop-color="${P.hairLight}"/><stop offset="0.45" stop-color="${P.hair}"/><stop offset="1" stop-color="${P.hairDark}"/>
  </linearGradient>
  <linearGradient id="irisGrad-${P.key}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${P.eyeDark}"/><stop offset="0.55" stop-color="${P.eye}"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.75"/>
  </linearGradient>
  <clipPath id="eyeClip-${P.key}-l"><ellipse cx="${CX - eyeDx}" cy="${EYE_Y + (mp.downcast || 0) + 1}" rx="18" ry="${11.4 * g.eyeH * mp.eyeScale}"/></clipPath>
  <clipPath id="eyeClip-${P.key}-r"><ellipse cx="${CX + eyeDx}" cy="${EYE_Y + (mp.downcast || 0) + 1}" rx="18" ry="${11.4 * g.eyeH * mp.eyeScale}"/></clipPath>
  <radialGradient id="halo-${P.key}" cx="0.5" cy="0.42" r="0.6">
    <stop offset="0" stop-color="${P.accent}" stop-opacity="0.24"/>
    <stop offset="1" stop-color="${P.accent}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="blush-${P.key}" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#e2798a" stop-opacity="${mp.blush}"/>
    <stop offset="1" stop-color="#e2798a" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="fade-${P.key}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0.62" stop-color="#ffffff"/>
    <stop offset="1" stop-color="#000000"/>
  </linearGradient>
  <mask id="fadeMask-${P.key}"><rect x="0" y="0" width="${W}" height="${H}" fill="url(#fade-${P.key})"/></mask>
</defs>`;

  const body = `
<g mask="url(#fadeMask-${P.key})">
  <ellipse cx="180" cy="220" rx="176" ry="196" fill="url(#halo-${P.key})"/>
  ${hairBack(P, g)}
  ${outfit(P, g)}
  <path d="M ${CX - 26 * g.neckW} 236 L ${CX - 24 * g.neckW} 282 C ${CX - 24 * g.neckW} 294, ${CX + 24 * g.neckW} 294, ${CX + 24 * g.neckW} 282 L ${CX + 26 * g.neckW} 236 Z" fill="${P.skinShade}"/>
  <path d="M ${CX - 26 * g.neckW} 236 L ${CX - 24 * g.neckW} 268 C ${CX - 10} 280, ${CX + 10} 280, ${CX + 24 * g.neckW} 268 L ${CX + 26 * g.neckW} 236 Z" fill="${P.skin}"/>
  <ellipse cx="${CX}" cy="252" rx="${30 * g.neckW}" ry="16" fill="${P.skinShade}" opacity="0.75"/>
  <path d="${headPath(g)}" fill="url(#skinGrad-${P.key})"/>
  <ellipse cx="${CX - HEAD_HALF + 4}" cy="196" rx="9" ry="15" fill="${P.skinShade}"/>
  <ellipse cx="${CX + HEAD_HALF - 4}" cy="196" rx="9" ry="15" fill="${P.skinShade}"/>
  <ellipse cx="${CX - 40}" cy="212" rx="17" ry="10" fill="url(#blush-${P.key})"/>
  <ellipse cx="${CX + 40}" cy="212" rx="17" ry="10" fill="url(#blush-${P.key})"/>
  <ellipse cx="${CX}" cy="${HEAD_TOP + 66}" rx="${HEAD_HALF - 6}" ry="30" fill="${P.skinShade}" opacity="0.30"/>
  ${hairFront(P, g, mood)}
  ${brow(CX - eyeDx, P, g, mp)}
  ${brow(CX + eyeDx, P, g, mp)}
  ${eye(CX - eyeDx, P, g, mp, 'l')}
  ${eye(CX + eyeDx, P, g, mp, 'r')}
  <path d="M ${CX + 1.5} 210 C ${CX + 5} 214.5, ${CX + 3} 217, ${CX - 1} 217.5" stroke="${P.skinLine}" stroke-width="2.1" stroke-linecap="round" fill="none" opacity="0.8"/>
  ${mouth(P, mp)}
  ${P.tired ? `<path d="M ${CX - eyeDx - 15} 204 C ${CX - eyeDx - 6} 208.5, ${CX - eyeDx + 6} 208.5, ${CX - eyeDx + 15} 204" stroke="#b98fa0" stroke-width="1.7" stroke-linecap="round" fill="none" opacity="0.45"/>
  <path d="M ${CX + eyeDx - 15} 204 C ${CX + eyeDx - 6} 208.5, ${CX + eyeDx + 6} 208.5, ${CX + eyeDx + 15} 204" stroke="#b98fa0" stroke-width="1.7" stroke-linecap="round" fill="none" opacity="0.45"/>` : ''}
  ${P.accessory === 'earring' ? `<circle cx="${CX + HEAD_HALF - 3}" cy="216" r="4.6" fill="${P.accent}"/><circle cx="${CX + HEAD_HALF - 3}" cy="216" r="2.1" fill="#ffe9f0" opacity="0.8"/>` : ''}
  ${P.accessory === 'badge' ? `<rect x="${CX - 62}" y="352" width="30" height="20" rx="3" fill="#f7f6f2"/><rect x="${CX - 58}" y="358" width="22" height="3" rx="1.5" fill="#8fb9a3"/><rect x="${CX - 58}" y="364" width="14" height="3" rx="1.5" fill="#b9cfc3"/>` : ''}
  <path d="M ${CX + 46} ${HEAD_TOP + 26} C ${CX + 56} ${HEAD_TOP + 62}, ${CX + 54} ${HEAD_TOP + 106}, ${CX + 34} ${CHIN - 12}"
        stroke="${P.hairLight}" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.42"/>
  <path d="M ${CX + 96 * g.shoulder} ${H - 92} C ${CX + 108 * g.shoulder} ${H - 56}, ${CX + 112 * g.shoulder} ${H - 26}, ${CX + 112 * g.shoulder} ${H}"
        stroke="${P.accent}" stroke-width="3.4" stroke-linecap="round" fill="none" opacity="0.3"/>
</g>`;

  return defs + body;
}

function standalone(key, gender, mood) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${PEOPLE[key].label}">${portraitInner(key, gender, mood)}</svg>`;
}

/* ---------------- 输出 ---------------- */
mkdirSync(OUT, { recursive: true });
const jobs = [];
for (const key of Object.keys(PEOPLE)) {
  const genders = key === 'chiang' ? ['m'] : ['f', 'm'];
  for (const gd of genders) {
    for (const mood of MOODS) {
      jobs.push({ key, gender: gd, mood, file: `${key}_${gd}_${mood}.svg` });
    }
  }
}
for (const j of jobs) {
  writeFileSync(join(OUT, j.file), standalone(j.key, j.gender, j.mood), 'utf8');
}
console.log(`写入 ${jobs.length} 个立绘 → assets/portraits/`);

/* ---------------- 审阅用接触表 ---------------- */
if (process.argv.includes('--sheet')) {
  const COLS = 6, CW = W * 0.62, CH = H * 0.62, PAD = 10;
  const rows = Math.ceil(jobs.length / COLS);
  const sw = COLS * (CW + PAD) + PAD, sh = rows * (CH + PAD) + PAD;
  let cells = '';
  jobs.forEach((j, i) => {
    const c = i % COLS, r = Math.floor(i / COLS);
    const x = PAD + c * (CW + PAD), y = PAD + r * (CH + PAD);
    cells += `<g transform="translate(${x},${y}) scale(${CW / W})">${portraitInner(j.key, j.gender, j.mood)}</g>`;
    cells += `<rect x="${x}" y="${y}" width="${CW}" height="${CH}" fill="none" stroke="#ffffff22" stroke-width="1"/>`;
    cells += `<text x="${x + 6}" y="${y + 18}" font-family="sans-serif" font-size="13" fill="#8fa0b8">${j.key}_${j.gender}_${j.mood}</text>`;
  });
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}" viewBox="0 0 ${sw} ${sh}"><rect width="${sw}" height="${sh}" fill="#0b0d12"/>${cells}</svg>`;
  writeFileSync(join(ROOT, 'tools', '_sheet.svg'), sheet, 'utf8');
  console.log('接触表 → tools/_sheet.svg');

  const { Resvg } = await import('@resvg/resvg-js');
  const r = new Resvg(sheet, { fitTo: { mode: 'width', value: Math.min(sw, 1500) }, background: '#0b0d12', font: { loadSystemFonts: true } });
  writeFileSync(join(ROOT, 'tools', '_sheet.png'), r.render().asPng());
  console.log('接触表 → tools/_sheet.png');
}
