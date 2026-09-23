/* ===========================================================
   剧情图校验器：node tools/validate.mjs
   检查：语法 / 断链 / 孤立场景 / 结局可达性 / ID 约定
   =========================================================== */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STORY = join(ROOT, 'story');

const scenes = new Map();
const endings = new Map();
const clues = new Map();
const errors = [];
const warnings = [];

function scene(id, def) {
  if (scenes.has(id)) errors.push(`重复场景 ID：${id}`);
  scenes.set(id, def || {});
}
function ending(id, meta) {
  if (endings.has(id)) errors.push(`重复结局 ID：${id}`);
  endings.set(id, meta || {});
}
function clue(id, meta) { clues.set(id, meta || {}); }

globalThis.G = { scene, ending, clue };

const files = readdirSync(STORY).filter((f) => f.endsWith('.js')).sort();
for (const f of files) {
  const src = readFileSync(join(STORY, f), 'utf8');
  try {
    // 用 Function 构造器执行，等价于浏览器的 <script> 语义（无模块作用域）
    new Function(src)();
  } catch (e) {
    errors.push(`${f} 执行失败：${e.message}`);
  }
}

/* ---------- 收集出口 ---------- */
const targets = new Map();   // id -> [ {from, kind} ]
const incoming = new Map();
function addTarget(from, to, kind) {
  if (typeof to !== 'string') return;
  if (!targets.has(from)) targets.set(from, []);
  targets.get(from).push({ to, kind });
  if (!incoming.has(to)) incoming.set(to, []);
  incoming.get(to).push(from);
}

const ENTRY = 'start';
for (const [id, def] of scenes) {
  if (!def.text) warnings.push(`${id} 没有 text`);
  const hasExit = def.ending || def.next || (def.choices && def.choices.length);
  if (!hasExit) errors.push(`${id} 没有出口（next / choices / ending 全都没有）`);

  if (def.ending) {
    if (!endings.has(def.ending)) errors.push(`${id} 指向未注册的结局 "${def.ending}"`);
  }
  if (typeof def.next === 'string') addTarget(id, def.next, 'next');
  else if (typeof def.next === 'function') {
    // 动态 next：把函数体里出现的所有字符串字面量当成候选目标
    const body = def.next.toString();
    for (const m of body.matchAll(/['"]([a-zA-Z0-9_]+)['"]/g)) addTarget(id, m[1], 'next()');
  }
  if (Array.isArray(def.choices)) {
    for (const c of def.choices) {
      if (!c.t) errors.push(`${id} 有一个没有 t（选项文字）的选项`);
      if (!c.to) { errors.push(`${id} 的选项「${String(c.t).slice(0, 18)}」没有 to`); continue; }
      if (typeof c.to === 'string') addTarget(id, c.to, 'choice');
      else if (typeof c.to === 'function') {
        const body = c.to.toString();
        for (const m of body.matchAll(/['"]([a-zA-Z0-9_]+)['"]/g)) addTarget(id, m[1], 'choice()');
      }
      if (!c.if && !c.to) errors.push(`${id} 选项缺少跳转`);
    }
  }
}

/* ---------- 断链 ---------- */
for (const [from, list] of targets) {
  for (const { to, kind } of list) {
    if (!scenes.has(to)) errors.push(`断链：${from} --(${kind})--> "${to}" 不存在`);
  }
}

/* ---------- 可达性（从 start 出发） ---------- */
const reachable = new Set();
const queue = [ENTRY];
if (!scenes.has(ENTRY)) errors.push(`入口场景 "${ENTRY}" 不存在`);
while (queue.length) {
  const cur = queue.shift();
  if (reachable.has(cur)) continue;
  reachable.add(cur);
  for (const { to } of targets.get(cur) || []) if (scenes.has(to)) queue.push(to);
}
for (const id of scenes.keys()) {
  if (!reachable.has(id)) errors.push(`不可达场景：${id}（没有任何路径能走到它）`);
}

/* ---------- 结局可达性 ---------- */
const reachableEndings = new Set();
for (const id of reachable) {
  const e = scenes.get(id).ending;
  if (e) reachableEndings.add(e);
}
for (const id of endings.keys()) {
  if (!reachableEndings.has(id)) errors.push(`结局 "${id}" 没有任何场景能触发`);
}
for (const [id, def] of scenes) {
  if (def.ending && !reachable.has(id)) errors.push(`结局场景 ${id} 不可达`);
}

/* ---------- 线索一致性 ---------- */
const usedClues = new Set();
for (const f of files) {
  const src = readFileSync(join(STORY, f), 'utf8');
  for (const m of src.matchAll(/clueAdd\(\s*['"]([a-zA-Z0-9_]+)['"]/g)) usedClues.add(m[1]);
}
for (const id of usedClues) if (!clues.has(id)) warnings.push(`clueAdd('${id}') 没有对应的 G.clue 定义`);

/* ---------- 关键 flag 是否有人设置 ---------- */
const allSrc = files.map((f) => readFileSync(join(STORY, f), 'utf8')).join('\n');
for (const flag of ['wan_paint', 'xia_exam', 'he_stand', 'met_chiang', 'open_room']) {
  if (!new RegExp(`${flag}\\s*[:=]\\s*true`).test(allSrc)) errors.push(`关键 flag "${flag}" 从未被设置为 true`);
}

/* ---------- 报告 ---------- */
console.log(`\n场景 ${scenes.size} 个 · 结局 ${endings.size} 个 · 线索 ${clues.size} 个 · 文件 ${files.length} 个`);

const byChapter = new Map();
for (const [id, def] of scenes) {
  const ch = def.ch || '(继承)';
  if (!byChapter.has(ch)) byChapter.set(ch, 0);
  byChapter.set(ch, byChapter.get(ch) + 1);
}
console.log('\n各章节场景数：');
for (const [ch, n] of byChapter) console.log(`  ${ch.padEnd(28, ' ')} ${n}`);

if (warnings.length) {
  console.log(`\n⚠️  警告 ${warnings.length} 条：`);
  for (const w of warnings) console.log('   • ' + w);
}
if (errors.length) {
  console.log(`\n❌ 错误 ${errors.length} 条：`);
  for (const e of errors) console.log('   • ' + e);
  process.exit(1);
}
console.log('\n✅ 剧情图校验通过：无断链、无不可达场景，所有结局均可抵达。\n');
