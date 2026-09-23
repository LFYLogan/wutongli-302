/* ===========================================================
   自动试玩器：node tools/playtest.mjs
   用最小的 DOM 桩驱动引擎，按策略走完 9 条路线，
   验证每个结局是否真的能抵达，并打印终局数值。
   =========================================================== */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STORY_DIR = join(ROOT, 'story');

const ENGINE_SRC = readFileSync(join(ROOT, 'js', 'engine.js'), 'utf8');
const STORY_FILES = readdirSync(STORY_DIR).filter((f) => f.endsWith('.js')).sort();
const STORY_SRCS = STORY_FILES.map((f) => [f, readFileSync(join(STORY_DIR, f), 'utf8')]);

/* ===========================================================
   最小 DOM 桩
   =========================================================== */
function makeElement(id) {
  const el = {
    id: id || '',
    _children: [],
    _listeners: {},
    _html: '',
    _q: {},
    dataset: {},
    style: {},
    textContent: '',
    disabled: false,
    offsetWidth: 0,
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, f) {
        if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
        else if (f) this._s.add(c); else this._s.delete(c);
      },
      contains(c) { return this._s.has(c); }
    },
    appendChild(c) { this._children.push(c); return c; },
    removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); return c; },
    removeAttribute() {},
    setAttribute() {},
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    click() { (this._listeners.click || []).forEach((fn) => fn({ target: this })); },
    closest() { return null; },
    querySelector(sel) { return this._q[sel] || (this._q[sel] = makeElement()); },
    querySelectorAll() { return []; }
  };
  Object.defineProperty(el, 'children', { get() { return el._children; } });
  Object.defineProperty(el, 'firstChild', { get() { return el._children[0]; } });
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = v; el._children.length = 0; }
  });
  return el;
}

function installDOM() {
  const registry = new Map();
  const singleton = new Map();
  const store = new Map();

  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
  globalThis.NodeFilter = { SHOW_TEXT: 4 };
  globalThis.window = globalThis;
  globalThis.alert = () => {};

  const doc = {
    body: makeElement('body'),
    documentElement: makeElement('html'),
    hidden: false,
    getElementById(id) {
      if (!registry.has(id)) registry.set(id, makeElement(id));
      return registry.get(id);
    },
    querySelector(sel) {
      if (!singleton.has(sel)) singleton.set(sel, makeElement(sel));
      return singleton.get(sel);
    },
    querySelectorAll() { return []; },
    createElement() { return makeElement(); },
    createDocumentFragment() { return makeElement(); },
    createTreeWalker() { return { nextNode() { return null; } }; },
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.document = doc;
  return doc;
}

/* ===========================================================
   启动一局全新游戏
   =========================================================== */
function bootGame() {
  const doc = installDOM();
  new Function(ENGINE_SRC)();                 // 建立全新的引擎闭包
  const G = globalThis.G;
  if (!G) throw new Error('engine.js 没有导出 window.G');
  const defs = {};
  const origScene = G.scene;
  G.scene = function (id, def) { defs[id] = def || {}; return origScene(id, def); };
  for (const [name, src] of STORY_SRCS) {
    try { new Function(src)(); }
    catch (e) { throw new Error(`${name} 执行失败：${e.message}`); }
  }
  G.boot();
  return { G, defs, doc, choicesBox: doc.getElementById('choices') };
}

/* ===========================================================
   策略：按 fx 权重 + 目的地白/黑名单给选项打分
   =========================================================== */
function strategy({ weights = {}, preferTo = [], preferStrong = [], avoidTo = [], keyBonus = 8, softAvoid = [] }) {
  return function pick(visible) {
    let best = 0, bestScore = -Infinity;
    visible.forEach((c, i) => {
      const fx = c.fx || {};
      let sc = 0;
      for (const k in weights) sc += (fx[k] || 0) * weights[k];
      if (c.key) sc += keyBonus;
      const to = String(c.to || '');
      for (const p of preferTo) if (to.includes(p)) sc += 60;
      for (const p of preferStrong) if (to.includes(p)) sc += 300;
      for (const a of avoidTo) if (to.includes(a)) sc -= 400;
      for (const a of softAvoid) if (to.includes(a)) sc -= 60;
      if (sc > bestScore) { bestScore = sc; best = i; }
    });
    return best;
  };
}

const LOVE_AVOID = ['c5_ordinary', 'c5_true', 'c4_rest', 'n3_rest'];

/* ===========================================================
   模拟一局
   =========================================================== */
function simulate(name, pick, { trace = false } = {}) {
  const { G, defs, choicesBox } = bootGame();
  const state = G.getState();
  G.goto('start');

  const trail = [];
  const marks = [];
  let steps = 0;

  while (!state.ending && steps++ < 5000) {
    if (trace && (/_hub$/.test(state.sceneId) || state.sceneId === 'c5_open')) {
      marks.push(`${state.sceneId}:压${state.stress}`);
    }
    const def = defs[state.sceneId];
    if (!def) throw new Error(`${name}: 场景 "${state.sceneId}" 不存在`);
    const visible = (def.choices || []).filter((c) => {
      try {
        if (!c.if) return true;
        return typeof c.if === 'function' ? !!c.if(state) : !!state.flags[c.if];
      } catch (e) { return false; }
    });
    if (!visible.length) {
      throw new Error(`${name}: 在 ${state.sceneId} 没有任何可选项（可能是死路）`);
    }
    const idx = pick(visible, state);
    const btn = choicesBox.children[idx];
    if (!btn) throw new Error(`${name}: ${state.sceneId} 第 ${idx} 个按钮不存在`);
    trail.push(`${state.sceneId}›${String(visible[idx].t || '').slice(0, 16)}`);
    btn.click();
  }

  return {
    name,
    ending: state.ending,
    fav: { ...state.fav },
    stress: state.stress,
    perf: state.perf,
    clues: state.clues.slice(),
    flags: { ...state.flags },
    steps,
    trail,
    marks
  };
}

/* ===========================================================
   九条路线
   =========================================================== */
const ROUTES = [
  {
    name: '苏晚 · Good',
    want: 'su_good',
    pick: strategy({
      weights: { wan: 10, stress: -0.3, perf: 0.15, xia: -0.5, he: -0.5 },
      preferTo: ['_home', 'c1_su1', 'c4_ask_su', 'c4_room', 'c5_su', 'p_013a', 'c1_start_a', 'p_019b', 'p_017b'],
      preferStrong: ['n5_home_deep', 'n6_home_deep'],
      avoidTo: [...LOVE_AVOID, 'c5_xia', 'c5_he', '_store', '_office']
    })
  },
  {
    name: '苏晚 · Normal',
    want: 'su_normal',
    pick: strategy({
      weights: { wan: 10, stress: -0.3, perf: 0.15, xia: -0.5, he: -0.5 },
      preferTo: ['n1_home', 'n2_home', 'n3_home', 'n4_home', 'n5_home', 'n6_home', 'c1_su1', 'c4_ask_su', 'c4_room', 'c5_su', 'p_013a', 'c1_start_a'],
      avoidTo: [...LOVE_AVOID, 'c5_xia', 'c5_he', '_deep', '_store', '_office']
    })
  },
  {
    name: '林知夏 · Good',
    want: 'xia_good',
    pick: strategy({
      weights: { xia: 10, stress: -0.3, perf: 0.15, wan: -0.5, he: -0.5 },
      preferTo: ['_store', 'c1_xia1', 'c4_ask_xia', 'c4_room', 'c5_xia', 'p_017a', 'p_019b', 'p_013b'],
      preferStrong: ['n5_store_deep', 'n6_store_deep'],
      avoidTo: [...LOVE_AVOID, 'c5_su', 'c5_he', '_home', '_office']
    })
  },
  {
    name: '林知夏 · Normal',
    want: 'xia_normal',
    pick: strategy({
      weights: { xia: 10, stress: -0.3, perf: 0.15, wan: -0.5, he: -0.5 },
      preferTo: ['n1_store', 'n2_store', 'n3_store', 'n4_store', 'n5_store', 'n6_store', 'c1_xia1', 'c4_ask_xia', 'c4_room', 'c5_xia', 'p_017a', 'p_019b', 'p_013b'],
      avoidTo: [...LOVE_AVOID, 'c5_su', 'c5_he', '_deep', '_home', '_office']
    })
  },
  {
    name: '顾清和 · Good',
    want: 'he_good',
    pick: strategy({
      weights: { he: 10, perf: 3, stress: -0.25, wan: -0.5, xia: -0.5 },
      preferTo: ['_office', 'c1_he1', 'c4_ask_he', 'c4_room', 'c5_he', 'p_009c', 'c1_office_b', 'c1_zhou', 'p_014'],
      preferStrong: ['n5_office_deep', 'n6_office_deep'],
      avoidTo: [...LOVE_AVOID, 'c5_su', 'c5_xia', '_home', '_store']
    })
  },
  {
    name: '顾清和 · Normal',
    want: 'he_normal',
    pick: strategy({
      weights: { he: 10, perf: 3, stress: -0.25, wan: -0.5, xia: -0.5 },
      preferTo: ['n1_office', 'n2_office', 'n3_office', 'n4_office', 'n5_office', 'n6_office', 'c1_he1', 'c4_ask_he', 'c4_room', 'c5_he', 'p_009c', 'c1_office_b', 'c1_zhou', 'p_014'],
      avoidTo: [...LOVE_AVOID, 'c5_su', 'c5_xia', '_deep', '_home', '_store']
    })
  },
  {
    name: '普通结局',
    want: 'ordinary',
    pick: strategy({
      weights: { stress: -1, wan: -1, xia: -1, he: -1 },
      preferTo: ['c5_ordinary', 'c4_rest', 'n3_rest', 'p_013b', 'p_017b'],
      avoidTo: ['c5_su', 'c5_xia', 'c5_he', 'c5_true']
    })
  },
  {
    name: '崩坏结局',
    want: 'collapse',
    pick: strategy({
      weights: { stress: 10, wan: -1, xia: -1, he: -1, perf: -0.5 },
      preferTo: ['_office', 'c4_archive', 'c4_ask_su', 'c4_ask_xia', 'c4_ask_he', 'c4_room', 'c4_bookstore', 'c5_su'],
      avoidTo: ['c4_rest', 'n3_rest', 'c5_ordinary', 'c5_true']
    })
  },
  {
    name: '真结局 · 归鸟',
    want: 'true_end',
    pick: strategy({
      weights: { wan: 1, xia: 1, stress: -0.4, perf: 0.6, he: 0.5 },
      preferTo: ['n1_store', 'n2_store', 'n3_store', 'n4_store', 'n5_store', 'n6_office',
        'c1_su1', 'c4_ask_su', 'c4_ask_he', 'c4_room', 'c5_true',
        'p_013a', 'c1_start_a', 'p_017a', 'p_019b'],
      preferStrong: ['n5_store_deep'],
      avoidTo: [...LOVE_AVOID.filter((x) => x !== 'c5_true'), 'c5_su', 'c5_xia', 'c5_he']
    })
  }
];

/* ===========================================================
   跑
   =========================================================== */
const verbose = process.argv.includes('--verbose');
const trace = process.argv.includes('--trace');
let pass = 0, fail = 0;
const errors = [];

console.log('\n════════ 自动试玩 ════════\n');

for (const r of ROUTES) {
  let res;
  try {
    res = simulate(r.name, r.pick, { trace });
  } catch (e) {
    fail++;
    errors.push(`${r.name}: ${e.message}`);
    console.log(`❌ ${r.name.padEnd(14, '　')} 崩溃 → ${e.message}`);
    continue;
  }
  const ok = res.ending === r.want;
  if (ok) pass++; else { fail++; errors.push(`${r.name}: 期望 ${r.want}，实际 ${res.ending}`); }
  console.log(
    `${ok ? '✅' : '❌'} ${r.name.padEnd(14, '　')} → ${String(res.ending).padEnd(11)} ` +
    `晚${String(res.fav.wan).padStart(3)} 夏${String(res.fav.xia).padStart(3)} 和${String(res.fav.he).padStart(3)} ` +
    `压${String(res.stress).padStart(3)} 绩${String(res.perf).padStart(3)} ` +
    `线索${res.clues.length} 步数${res.steps}`
  );
  if (trace) console.log('    压力轨迹：' + res.marks.join(' → '));
  if (!ok || verbose) {
    console.log('    路线：' + res.trail.join(' | '));
  }
}

console.log(`\n════════ ${pass} 通过 / ${fail} 失败 ════════`);
if (errors.length) {
  console.log('\n问题：');
  for (const e of errors) console.log('  • ' + e);
  process.exit(1);
}
console.log('\n🎉 九条路线全部抵达预期结局。\n');
process.exit(0);
