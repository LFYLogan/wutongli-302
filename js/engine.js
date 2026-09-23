/* ===========================================================
   梧桐里 302 — 游戏引擎
   纯前端、零依赖、可 file:// 直接打开
   -----------------------------------------------------------
   剧情 DSL 速查（详见 STORY_BIBLE.md）
     G.scene(id, {
       ch:'第一章 …', bg:'room', weather:'rain', who:'苏晚',
       text:'…' | ['段1','段2'] | (s)=>'…',
       fx:{wan:3, stress:-2},            // 进入时自动结算
       set:{metWan:true},
       onEnter(s, first){},              // 进入时执行（可做复杂逻辑）
       choices:[{t:'…', to:'id', tip:'晚 +3', tipKind:'', if:s=>…, do:s=>…, key:true, wide:true}],
       next:'id' | (s)=>'id',
       ending:'e1'                       // 终止场景
     })
     G.ending(id, {title, sub, route, rank, hint, order, text})
     G.clue(id, {name, desc})
   =========================================================== */
(function () {
'use strict';

/* ---------------- 常量 ---------------- */
var PREFIX       = 'wt302.';
var KEY_AUTO     = PREFIX + 'auto';
var KEY_SLOTS    = PREFIX + 'slot';
var KEY_GALLERY  = PREFIX + 'gallery';
var KEY_SETTINGS = PREFIX + 'settings';
var SLOT_COUNT   = 3;
var MAX_HIST     = 400;

var SPEEDS = {
  slow:    { ms: 46, label: '慢' },
  normal:  { ms: 22, label: '正常' },
  fast:    { ms: 9,  label: '快' },
  instant: { ms: 0,  label: '瞬间' }
};

/* ---------------- 运行时数据 ---------------- */
var scenes   = Object.create(null);
var endings  = Object.create(null);
var cluesDef = Object.create(null);

var state    = newState();
var settings = { speed: 'normal', sfx: true, skipRead: false };
var setup    = { mcGender: 'x', loveGender: 'f' };
var gallery  = {};   // { endingId: timestamp }

var typingTimer = null;
var typingState = null;
var pendingChoices = null;
var storyReady = false;

/* ---------------- 状态 ---------------- */
function newState() {
  return {
    v: 2,
    name: '陈默',
    mcGender: 'x',        // m / f / x（不想说）
    loveGender: 'f',      // f / m —— 三位攻略角色的性别版本
    sceneId: null,
    chapter: '',
    bg: 'night',
    fav: { wan: 0, xia: 0, he: 0 },
    stress: 20,
    perf: 30,
    flags: {},
    clues: [],
    visited: {},
    nights: 0,
    routes: { wan: 0, xia: 0, he: 0 },
    ending: null,
    hist: []
  };
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* ---------------- 存档 ---------------- */
function lsGet(key) {
  try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch (e) { return false; }
}
function lsDel(key) { try { localStorage.removeItem(key); } catch (e) {} }

function snapshot() {
  var s = state;
  return {
    v: 2, name: s.name, mcGender: s.mcGender, loveGender: s.loveGender,
    sceneId: s.sceneId, chapter: s.chapter, bg: s.bg,
    fav: { wan: s.fav.wan, xia: s.fav.xia, he: s.fav.he },
    stress: s.stress, perf: s.perf,
    flags: JSON.parse(JSON.stringify(s.flags)),
    clues: s.clues.slice(),
    visited: JSON.parse(JSON.stringify(s.visited)),
    nights: s.nights,
    routes: { wan: s.routes.wan, xia: s.routes.xia, he: s.routes.he },
    hist: s.hist.slice(-60),
    savedAt: Date.now()
  };
}
function restore(data) {
  var n = newState();
  if (!data) return false;
  n.name = data.name || n.name;
  if (data.mcGender) n.mcGender = data.mcGender;
  if (data.loveGender) n.loveGender = data.loveGender;
  n.sceneId = data.sceneId || null;
  n.chapter = data.chapter || '';
  n.bg = data.bg || 'night';
  if (data.fav) { n.fav.wan = +data.fav.wan || 0; n.fav.xia = +data.fav.xia || 0; n.fav.he = +data.fav.he || 0; }
  n.stress = +data.stress || 0;
  n.perf = +data.perf || 0;
  n.flags = data.flags || {};
  n.clues = data.clues || [];
  n.visited = data.visited || {};
  n.nights = data.nights || 0;
  if (data.routes) n.routes = data.routes;
  n.hist = data.hist || [];
  if (!n.sceneId || !scenes[n.sceneId]) return false;
  state = n;
  return true;
}

function autoSave() { lsSet(KEY_AUTO, snapshot()); }
function saveSlot(i) { return lsSet(KEY_SLOTS + i, snapshot()); }
function loadSlot(i) { var d = lsGet(KEY_SLOTS + i); return d && restore(d) ? d : false; }
function slotInfo(i) {
  var d = lsGet(KEY_SLOTS + i);
  if (!d) return null;
  return { chapter: d.chapter || '—', name: d.name || '', at: d.savedAt || 0, sceneId: d.sceneId };
}

/* ---------------- 设置 / 图鉴 ---------------- */
function loadSettings() {
  var d = lsGet(KEY_SETTINGS);
  if (d) {
    if (SPEEDS[d.speed]) settings.speed = d.speed;
    if (typeof d.sfx === 'boolean') settings.sfx = d.sfx;
    if (typeof d.skipRead === 'boolean') settings.skipRead = d.skipRead;
  }
}
function saveSettings() { lsSet(KEY_SETTINGS, settings); }
function loadGallery() { gallery = lsGet(KEY_GALLERY) || {}; }
function saveGallery() { lsSet(KEY_GALLERY, gallery); }
function unlockEnding(id) {
  if (!gallery[id]) { gallery[id] = Date.now(); saveGallery(); }
}

/* ---------------- 音效（WebAudio 合成，无外部资源） ---------------- */
var actx = null;
function tone(freq, dur, type, vol) {
  if (!settings.sfx) return;
  try {
    if (!actx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = new AC();
    }
    if (actx.state === 'suspended') actx.resume();
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.value = 0;
    o.connect(g); g.connect(actx.destination);
    var t = actx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol == null ? 0.05 : vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.03);
  } catch (e) {}
}
function sfx(kind) {
  if (kind === 'tap')   { tone(660, 0.05, 'triangle', 0.025); }
  else if (kind === 'up')    { tone(720, 0.09, 'sine', 0.05); setTimeout(function(){ tone(960, 0.11, 'sine', 0.045); }, 70); }
  else if (kind === 'down')  { tone(320, 0.12, 'sine', 0.045); }
  else if (kind === 'clue')  { tone(880, 0.10, 'triangle', 0.045); setTimeout(function(){ tone(1180, 0.16, 'triangle', 0.04); }, 90); }
  else if (kind === 'ending'){ tone(523, 0.30, 'sine', 0.05); setTimeout(function(){ tone(659, 0.30, 'sine', 0.05); }, 160); setTimeout(function(){ tone(784, 0.55, 'sine', 0.05); }, 320); }
}

/* ---------------- DOM ---------------- */
var $ = function (id) { return document.getElementById(id); };
var el = {};

/* ---------------- HTML 工具 ---------------- */
function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
/* 性别代词：三位攻略角色同性别，所以 {ta} 永远无歧义 */
function taLove() { return state.loveGender === 'm' ? '他' : '她'; }
function taMC() {
  if (state.mcGender === 'm') return '他';
  if (state.mcGender === 'f') return '她';
  return 'TA';
}

function fmt(text) {
  var s = String(text == null ? '' : text);
  s = s.replace(/\{name\}/g, state.name || '陈默');
  s = s.replace(/\{ta\}/g, taLove());
  s = s.replace(/\{taPlural\}/g, taLove() + '们');
  s = s.replace(/\{mcTa\}/g, taMC());
  s = s.replace(/\{girl\}/g, state.loveGender === 'm' ? '男孩' : '女孩');
  s = s.replace(/\{kid\}/g, state.loveGender === 'm' ? '小伙子' : '小姑娘');
  s = s.replace(/\{guy\}/g, state.loveGender === 'm' ? '男生' : '女生');
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/\[\[([^\]]+)\]\]/g, '<span class="em">$1</span>');
  return s;
}
function toHTML(text) {
  var s = typeof text === 'function' ? text(state) : text;
  if (s == null) s = '';
  var arr = Array.isArray(s) ? s : String(s).split(/\n{2,}/);
  return arr.map(function (p) { return '<p>' + fmt(p).replace(/\n/g, '<br>') + '</p>'; }).join('');
}

/* ---------------- 屏幕切换 ---------------- */
function show(screenId) {
  ['screen-title', 'screen-name', 'screen-game', 'screen-ending', 'screen-gallery'].forEach(function (id) {
    var e = $(id);
    if (e) e.classList.toggle('is-active', id === screenId);
  });
  if (screenId !== 'screen-game') closeModal();
}
function closeModal() { if (el.modal) el.modal.classList.remove('on'); }
function openModal(title, bodyHTML) {
  if (!el.modal) return;
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = bodyHTML;
  el.modal.classList.add('on');
}

/* ---------------- Toast ---------------- */
var TOAST_LABEL = { wan: '苏晚 好感', xia: '林知夏 好感', he: '顾清和 好感', stress: '压力', perf: '业绩' };
function labelFor(k) { return TOAST_LABEL[k] || k; }
function toast(msg, kind) {
  if (!el.toasts) return;
  var d = document.createElement('div');
  d.className = 'toast ' + (kind || '');
  d.textContent = msg;
  el.toasts.appendChild(d);
  setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 2600);
  while (el.toasts.children.length > 4) el.toasts.removeChild(el.toasts.firstChild);
}

/* ---------------- 数值结算 ---------------- */
var CLUE_NAME = { su: '苏晚的坦白', xia: '便利店的速写本', he: '没交出去的录音' };

function applyFx(fx, opts) {
  if (!fx) return;
  opts = opts || {};
  var parts = [];
  ['wan', 'xia', 'he'].forEach(function (k) {
    if (fx[k]) {
      var before = state.fav[k];
      state.fav[k] = clamp(before + fx[k], 0, 100);
      var d = state.fav[k] - before;
      if (d) {
        parts.push({ t: labelFor(k) + ' ' + (d > 0 ? '+' : '') + d, kind: d > 0 ? 'up' : 'bad', k: 'fav.' + k });
        if (d > 0) state.routes[k] = (state.routes[k] || 0) + d;
        if (!opts.silent) sfx('up');
      }
    }
  });
  ['stress', 'perf'].forEach(function (k) {
    if (fx[k]) {
      var b2 = state[k];
      state[k] = clamp(b2 + fx[k], 0, 100);
      var d2 = state[k] - b2;
      if (d2) {
        parts.push({ t: labelFor(k) + ' ' + (d2 > 0 ? '+' : '') + d2, kind: k === 'stress' ? (d2 > 0 ? 'bad' : 'good') : 'blue', k: k });
        if (!opts.silent) sfx(d2 > 0 && k === 'stress' ? 'down' : 'tap');
      }
    }
  });
  if (!opts.silent) {
    parts.forEach(function (p, i) {
      setTimeout(function () { toast(p.t, p.kind); pulseStat(p.k); }, i * 220);
    });
  }
  updateHUD(parts.map(function (p) { return p.k; }));
}

function addClue(id) {
  if (!id || state.clues.indexOf(id) >= 0) return false;
  state.clues.push(id);
  var nm = (cluesDef[id] && cluesDef[id].name) || CLUE_NAME[id] || id;
  toast('获得线索 · ' + nm, 'clue');
  sfx('clue');
  updateHUD(['clue']);
  return true;
}

function pulseStat(key) {
  var map = { 'fav.wan': 'stat-wan', 'fav.xia': 'stat-xia', 'fav.he': 'stat-he', stress: 'stat-stress', perf: 'stat-perf', clue: 'stat-clue' };
  var id = map[key]; if (!id) return;
  var e = $(id); if (!e) return;
  e.classList.remove('pulse');
  void e.offsetWidth;
  e.classList.add('pulse');
}

function updateHUD(changed) {
  if (!el.hud) return;
  $('hud-chapter').textContent = state.chapter || '';
  $('hud-night').textContent = state.nights > 0 ? ('第 ' + state.nights + ' 个夜晚') : '';
  setStat('stat-wan', state.fav.wan);
  setStat('stat-xia', state.fav.xia);
  setStat('stat-he', state.fav.he);
  setStat('stat-stress', state.stress);
  setStat('stat-perf', state.perf);
  var ce = $('stat-clue');
  if (ce) { ce.querySelector('b').textContent = state.clues.length; }
  (changed || []).forEach(function (k) { if (k.indexOf('fav.') === 0) pulseStat(k); });
}
function setStat(id, v) {
  var e = $(id); if (!e) return;
  e.querySelector('b').textContent = v;
  var bar = e.querySelector('.bar em');
  if (bar) bar.style.width = v + '%';
  if (id === 'stat-wan') e.dataset.id = 'wan';
  if (id === 'stat-xia') e.dataset.id = 'xia';
  if (id === 'stat-he')  e.dataset.id = 'he';
}

/* ---------------- 背景 ---------------- */
function setBG(bg, weather) {
  if (bg) { document.body.dataset.bg = bg; state.bg = bg; }
  var w = $('stage-weather');
  if (w) {
    w.className = 'stage-weather';
    if (weather === 'rain') { w.classList.add('rain', 'on'); }
  }
}

/* ---------------- 立绘 ---------------- */
var CHAR_KEY = { '苏晚': 'wan', '林知夏': 'xia', '顾清和': 'gu', '江迟': 'chiang' };
var PORTRAIT_MOODS = ['normal', 'smile', 'sad', 'surprise'];
var curPortrait = '';

/* 情绪关键词：场景没写 mood 时自动推断，写了就以场景为准 */
var MOOD_WORDS = [
  ['smile', ['笑了', '笑出来', '笑起来', '微微一笑', '弯起', '眯', '扬起嘴角', '忍不住笑', '笑了一下', '笑得']],
  ['sad', ['哭', '眼泪', '眼眶', '红了眼', '声音很低', '发抖', '声音很轻', '沉默了很久', '别过脸', '鼻音', '哽']],
  ['surprise', ['愣', '怔', '睁大', '停了一瞬', '顿住', '惊讶', '突然抬头', '没想到', '没想到']]
];

function inferMood(text) {
  var t = String(text || '');
  var best = 'normal', bestN = 0;
  for (var i = 0; i < MOOD_WORDS.length; i++) {
    var n = 0, ws = MOOD_WORDS[i][1];
    for (var j = 0; j < ws.length; j++) {
      var idx = t.indexOf(ws[j]);
      while (idx >= 0) { n++; idx = t.indexOf(ws[j], idx + 1); }
    }
    if (n > bestN) { bestN = n; best = MOOD_WORDS[i][0]; }
  }
  return bestN > 0 ? best : 'normal';
}

function portraitSrc(who, mood) {
  var key = CHAR_KEY[who];
  if (!key) return null;
  var g = (key === 'chiang') ? 'm' : (state.loveGender === 'm' ? 'm' : 'f');
  var m = PORTRAIT_MOODS.indexOf(mood) >= 0 ? mood : 'normal';
  return 'assets/portraits/' + key + '_' + g + '_' + m + '.svg';
}

function updatePortrait(who, text, mood) {
  var box = $('portrait'), img = $('portrait-img');
  if (!box || !img) return;
  var src = who ? portraitSrc(who, mood || inferMood(text)) : null;
  if (!src) { hidePortrait(); return; }
  box.dataset.who = CHAR_KEY[who];
  if (src !== curPortrait) {
    img.setAttribute('src', src);
    try { img.src = src; } catch (e) {}
    img.setAttribute('alt', who);
    curPortrait = src;
    box.classList.remove('on');
    void box.offsetWidth;         // 强制重排，让淡入动画重新播放
  }
  box.classList.add('on');
}

function hidePortrait() {
  var box = $('portrait');
  if (box) box.classList.remove('on');
  curPortrait = '';
}

function preloadPortraits() {
  if (typeof Image !== 'function' || !state.loveGender) return;
  ['wan', 'xia', 'gu'].forEach(function (k) {
    PORTRAIT_MOODS.forEach(function (m) {
      var im = new Image();
      im.src = 'assets/portraits/' + k + '_' + state.loveGender + '_' + m + '.svg';
    });
  });
}

/* ===========================================================
   场景推进
   =========================================================== */
function goto(id) {
  var sc = scenes[id];
  if (!sc) {
    renderText([{ who: '⚠️ 引擎', text: '找不到场景「' + id + '」。这大概是个 bug，请把这个编号记下来。' }], null);
    return;
  }
  var first = !state.visited[id];
  state.visited[id] = (state.visited[id] || 0) + 1;
  state.sceneId = id;
  if (sc.ch) state.chapter = sc.ch;
  if (sc.bg !== undefined) setBG(sc.bg, sc.weather);
  else if (sc.weather) setBG(null, sc.weather);

  if (sc.set) { for (var k in sc.set) if (Object.prototype.hasOwnProperty.call(sc.set, k)) state.flags[k] = sc.set[k]; }
  if (sc.fx) applyFx(sc.fx);
  if (typeof sc.onEnter === 'function') { try { sc.onEnter(state, first); } catch (e) { console.error(e); } }

  updateHUD();

  var rawText = typeof sc.text === 'function' ? sc.text(state) : sc.text;
  var line = { who: sc.who || null, text: rawText };
  state.hist.push({ who: line.who, text: flatten(rawText) });
  if (state.hist.length > MAX_HIST) state.hist.splice(0, state.hist.length - MAX_HIST);

  updatePortrait(sc.who, flatten(rawText), sc.mood);

  // 终止场景（结局）
  if (sc.ending) {
    // 保留上一处检查点，不覆盖自动存档
    renderText([line], function () { finishEnding(sc.ending); });
    return;
  }

  autoSave();
  renderText([line], function () { afterText(sc); });
}

function flatten(t) {
  if (t == null) return '';
  if (Array.isArray(t)) return t.join('\n\n');
  return String(t);
}

function afterText(sc) {
  var chs = buildChoices(sc);
  if (chs && chs.length) {
    pendingChoices = chs;
    renderChoices(chs);
    return;
  }
  if (typeof sc.next === 'function') { goto(sc.next(state)); return; }
  if (typeof sc.next === 'string') { goto(sc.next); return; }
  // 无出口：给出提示而不是白屏
  renderText([{ who: '⚠️ 引擎', text: '场景「' + state.sceneId + '」没有出口（未定义 next / choices / ending）。' }], null);
}

function buildChoices(sc) {
  if (!sc.choices) return null;
  var out = [];
  for (var i = 0; i < sc.choices.length; i++) {
    var c = sc.choices[i];
    var ok = true;
    if (typeof c['if'] === 'function') { try { ok = !!c['if'](state); } catch (e) { ok = false; } }
    else if (typeof c['if'] === 'string') { ok = !!state.flags[c['if']]; }
    if (!ok) continue;
    out.push(c);
  }
  return out;
}

/* ---------------- 文本渲染 ---------------- */
function renderText(lines, done) {
  if (!el.text) return;
  var spk = $('speaker'), tx = $('text'), adv = $('advance');
  $('choices').innerHTML = '';
  pendingChoices = null;
  adv.classList.remove('on');

  var last = lines[lines.length - 1];
  if (last.who) { spk.textContent = last.who; spk.dataset.who = last.who; spk.classList.add('on'); }
  else { spk.classList.remove('on'); spk.textContent = ''; spk.removeAttribute('data-who'); }

  tx.innerHTML = toHTML(last.text);
  tx.classList.remove('instant');

  var alreadyRead = false;
  if (settings.skipRead && state.visited[state.sceneId] > 1) alreadyRead = true;

  var speed = SPEEDS[settings.speed] ? settings.speed : 'normal';
  if (alreadyRead) speed = 'instant';

  typeIn(tx, SPEEDS[speed].ms, function () {
    if (typeof done === 'function') done();
    else if (!pendingChoices) adv.classList.add('on');
  }, adv);
}

function typeIn(node, msPerChar, done, advEl) {
  stopTyping();
  var chars = wrapChars(node);
  if (msPerChar <= 0 || !chars.length) {
    node.classList.add('instant');
    if (typeof done === 'function') done();
    return;
  }
  var i = 0, acc = 0, last = (window.performance || Date).now();
  typingState = { node: node, chars: chars, done: done, advEl: advEl };
  typingTimer = setInterval(function () {
    var now = (window.performance || Date).now();
    acc += now - last; last = now;
    while (i < chars.length && acc > 0) {
      var ch = chars[i].textContent;
      var cost = msPerChar * (PUNCT.indexOf(ch) >= 0 ? 3.4 : 1);
      if (acc < cost) break;
      acc -= cost;
      chars[i].classList.add('on');
      i++;
    }
    if (i >= chars.length) {
      finishTyping();
    }
  }, 18);
}
var PUNCT = '。！？…，、；：—～!?,.';

function wrapChars(root) {
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
  var nodes = [], n;
  while ((n = walker.nextNode())) nodes.push(n);
  nodes.forEach(function (tn) {
    var t = tn.nodeValue;
    if (!t) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < t.length; i++) {
      var sp = document.createElement('span');
      sp.className = 'ch';
      sp.textContent = t.charAt(i);
      frag.appendChild(sp);
    }
    tn.parentNode.replaceChild(frag, tn);
  });
  return root.querySelectorAll('.ch');
}
function finishTyping() {
  if (!typingState) return;
  if (typingTimer) { clearInterval(typingTimer); typingTimer = null; }
  var st = typingState;
  typingState = null;
  for (var i = 0; i < st.chars.length; i++) st.chars[i].classList.add('on');
  st.node.classList.add('instant');
  if (typeof st.done === 'function') st.done();
}
function stopTyping() {
  if (typingTimer) { clearInterval(typingTimer); typingTimer = null; }
  typingState = null;
}
function isTyping() { return !!typingState; }

/* ---------------- 选项渲染 ---------------- */
function renderChoices(list) {
  var box = $('choices');
  box.innerHTML = '';
  list.forEach(function (c, i) {
    var b = document.createElement('button');
    b.className = 'choice' + (c.key ? ' key' : '') + (c.wide ? ' wide' : '');
    b.innerHTML = '<span class="idx">' + (i + 1) + '</span><span class="ct">' + fmt(c.t) +
      (c.tip ? '<span class="tip ' + (c.tipKind || '') + '">' + fmt(c.tip) + '</span>' : '') + '</span>';
    b.addEventListener('click', function () {
      sfx('tap');
      $('choices').innerHTML = '';
      pendingChoices = null;
      if (typeof c.do === 'function') { try { c.do(state); } catch (e) { console.error(e); } }
      if (c.fx) applyFx(c.fx);
      if (c.set) { for (var k in c.set) if (Object.prototype.hasOwnProperty.call(c.set, k)) state.flags[k] = c.set[k]; }
      if (c.remember) state.hist.push({ who: null, text: '▶ ' + flatten(c.t) });
      goto(typeof c.to === 'function' ? c.to(state) : c.to);
    });
    box.appendChild(b);
  });
}

/* ---------------- 结局 ---------------- */
function finishEnding(endId) {
  var meta = endings[endId] || { title: endId, sub: '', route: '', text: '' };
  unlockEnding(endId);
  state.ending = endId;
  sfx('ending');
  lsDel(KEY_AUTO);          // 让"继续"回到结局前的最后一个决策点
  $('ending-kicker').textContent = meta.trueEnd ? 'TRUE  ENDING' : 'ENDING';
  $('ending-title').textContent = meta.title || endId;
  $('ending-sub').textContent = (meta.route ? '· ' + meta.route + ' · ' : '') + (meta.sub || '');
  $('ending-text').innerHTML = toHTML(typeof meta.text === 'function' ? meta.text(state) : (meta.text || ''));
  $('ending-stat').textContent = summaryLine();
  show('screen-ending');
  refreshTitle();
}

function summaryLine() {
  return '苏晚 ' + state.fav.wan + ' · 林知夏 ' + state.fav.xia + ' · 顾清和 ' + state.fav.he +
    ' ｜ 压力 ' + state.stress + ' · 业绩 ' + state.perf +
    ' ｜ 线索 ' + state.clues.length + '/3 ｜ 图鉴 ' + Object.keys(gallery).length + '/' + endingList().length +
    ' ｜ 本局：' + (state.mcGender === 'm' ? '男主角' : state.mcGender === 'f' ? '女主角' : '性别未说明') +
    ' × 攻略对象' + (state.loveGender === 'm' ? '男生' : '女生');
}

function endingList() {
  var arr = [];
  for (var k in endings) if (Object.prototype.hasOwnProperty.call(endings, k)) arr.push({ id: k, meta: endings[k] });
  arr.sort(function (a, b) { return (a.meta.order || 99) - (b.meta.order || 99); });
  return arr;
}

/* ---------------- 图鉴 ---------------- */
function renderGallery() {
  var list = endingList(), got = Object.keys(gallery).length;
  var badge = got + '/' + list.length;
  if ($('gallery-badge')) $('gallery-badge').textContent = badge;
  if ($('gallery-badge-2')) $('gallery-badge-2').textContent = badge;
  if ($('gallery-sub')) {
    $('gallery-sub').textContent = got === list.length
      ? '全部结局都已抵达。你把这个城市里所有人的深夜都走了一遍。'
      : '已经抵达 ' + got + ' / ' + list.length + ' 个结局。线索与选择会把你推向不同的深夜。';
  }
  var grid = $('gallery-grid');
  grid.innerHTML = '';
  list.forEach(function (item, i) {
    var open = !!gallery[item.id];
    var d = document.createElement('div');
    d.className = 'gcard ' + (open ? 'unlocked' : 'locked') + (item.meta.trueEnd ? ' true-end' : '');
    if (open) {
      d.innerHTML = '<div class="num">ENDING ' + String(i + 1).padStart(2, '0') + (item.meta.rank ? ' · ' + item.meta.rank : '') + '</div>' +
        '<div class="tt">' + esc(item.meta.title || item.id) + '</div>' +
        '<div class="rt">' + esc(item.meta.route || '') + '</div>' +
        '<div class="hk">' + esc(item.meta.sub || '') + '</div>';
    } else {
      d.innerHTML = '<div class="num">ENDING ' + String(i + 1).padStart(2, '0') + ' · ???</div>' +
        '<div class="tt">？？？？</div>' +
        '<div class="rt">' + esc(item.meta.route || '') + '</div>' +
        '<div class="hk">' + esc(item.meta.hint || '尚未抵达。') + '</div>';
    }
    grid.appendChild(d);
  });
}

/* ---------------- 标题刷新 ---------------- */
function refreshTitle() {
  var list = endingList(), got = Object.keys(gallery).length;
  var total = 0; for (var k in scenes) if (Object.prototype.hasOwnProperty.call(scenes, k)) total++;
  var seen = Object.keys(state.visited).length;
  var pct = total ? Math.round(seen / total * 100) : 0;
  var auto = lsGet(KEY_AUTO);
  var btn = $('btn-continue');
  if (btn) btn.disabled = !auto;
  if ($('progress-line')) {
    $('progress-line').textContent = '结局 ' + got + '/' + list.length +
      ' · 本次探索 ' + pct + '%' +
      (state.sceneId ? ' · ' + (state.loveGender === 'm' ? '男生版' : '女生版') : '');
  }
  if ($('gallery-badge')) $('gallery-badge').textContent = got + '/' + list.length;
}

/* ---------------- 存档 UI ---------------- */
function openSaves(mode) {
  var html = '<div class="slots">';
  for (var i = 1; i <= SLOT_COUNT; i++) {
    var info = slotInfo(i);
    var when = info ? new Date(info.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    html += '<div class="slot ' + (info ? '' : 'empty') + '">' +
      '<span class="n">' + i + '</span>' +
      '<button class="info" data-slot="' + i + '" style="background:none;border:none;text-align:left;padding:0;flex:1 1 auto;min-width:0">' +
      '<div class="t1">' + (info ? esc(info.chapter) : '空存档位') + '</div>' +
      '<div class="t2">' + (info ? esc(info.name) + ' · ' + when : (mode === 'save' ? '点击存入当前进度' : '暂无可读取的进度')) + '</div>' +
      '</button>' +
      (info ? '<button class="del" data-del="' + i + '">删除</button>' : '') +
      '</div>';
  }
  html += '</div><p style="font-size:12px;color:#69717f;margin:14px 0 0">进度自动保存在这台设备的浏览器里，换设备或清理浏览器数据会丢失。</p>';
  openModal('存 档', html);
}

/* ---------------- 线索档案 ---------------- */
function openClues() {
  var all = [];
  for (var k in cluesDef) if (Object.prototype.hasOwnProperty.call(cluesDef, k)) all.push(k);
  var got = state.clues;
  var html = '<p style="font-size:12.5px;color:#69717f;margin:0 0 14px">一共三条关键线索。凑满三条，才有可能在提案日那天把话说完。</p>';
  html += all.map(function (id) {
    var c = cluesDef[id] || { name: id, desc: '' };
    var open = got.indexOf(id) >= 0;
    if (!open) {
      return '<div class="slot empty" style="cursor:default">' +
        '<span class="n">？</span><div class="info"><div class="t1">尚未掌握</div>' +
        '<div class="t2">把某个人的线走得更深一些。</div></div></div>';
    }
    return '<div class="slot" style="cursor:default;align-items:flex-start">' +
      '<span class="n">✓</span><div class="info"><div class="t1">' + esc(c.name) + '</div>' +
      '<div class="t2" style="line-height:1.85;margin-top:6px">' + esc(c.desc) + '</div></div></div>';
  }).join('');
  html += '<p style="font-size:12.5px;color:#69717f;margin:16px 0 0">已掌握 ' + got.length + ' / ' + all.length + ' 条。</p>';
  openModal('线 索 档 案', html);
}

/* ---------------- 回顾 ---------------- */
function openBacklog() {
  var items = state.hist.slice(-120).reverse();
  var html = '<div class="backlog">' + items.map(function (h) {
    return '<div class="bl-item">' + (h.who ? '<div class="w">' + esc(h.who) + '</div>' : '') +
      '<div class="c">' + esc(h.text).replace(/\n/g, '<br>') + '</div></div>';
  }).join('') + '</div>';
  openModal('回 顾', html || '<p style="color:#69717f">还没有任何记录。</p>');
}

/* ---------------- 设置 UI ---------------- */
function openSettings() {
  var html = '';
  html += '<div class="setrow"><div class="lbl">文字速度<small>也可随时点击文本框立即显示全文</small></div><div class="seg" data-seg="speed">' +
    Object.keys(SPEEDS).map(function (k) {
      return '<button data-val="' + k + '" class="' + (settings.speed === k ? 'on' : '') + '">' + SPEEDS[k].label + '</button>';
    }).join('') + '</div></div>';
  html += '<div class="setrow"><div class="lbl">音效<small>纯合成的轻音，无外部素材</small></div>' +
    '<button class="switch ' + (settings.sfx ? 'on' : '') + '" data-toggle="sfx"></button></div>';
  html += '<div class="setrow"><div class="lbl">重读时跳过已看过的文本<small>重玩同一条线会更流畅</small></div>' +
    '<button class="switch ' + (settings.skipRead ? 'on' : '') + '" data-toggle="skipRead"></button></div>';
  html += '<div class="setrow"><div class="lbl">清空本机数据<small>存档、图鉴、设置都会被删除</small></div>' +
    '<button class="btn" style="padding:8px 14px;font-size:12.5px" data-act="wipe">清 空</button></div>';
  openModal('设 置', html);
}

/* ---------------- 分享 ---------------- */
function share() {
  var url = location.href.split('#')[0];
  function fallback() {
    if (navigator.share) {
      navigator.share({ title: '梧桐里 302 · 深夜加班恋爱物语', text: '一款文字恋爱闯关游戏，九种结局。', url: url }).catch(function(){});
    } else {
      window.prompt('复制这个链接发给朋友（手机、电脑都能直接玩）：', url);
    }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(function () {
      toast('链接已复制，发给朋友即可畅玩', 'good');
    }).catch(fallback);
  } else { fallback(); }
}

/* ===========================================================
   启动
   =========================================================== */
function boot() {
  el.modal = $('modal');
  el.toasts = $('toasts');
  el.text = $('text');
  el.hud = document.querySelector('.hud');

  loadSettings();
  loadGallery();

  /* 全局点击代理 */
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act]');
    if (t) {
      var act = t.dataset.act;
      sfx('tap');
      if (act === 'new')            { setup.mcGender = state.mcGender || 'x'; setup.loveGender = state.loveGender || 'f';
                                      syncSetupUI(); show('screen-name'); setTimeout(function(){ $('name-input').focus(); }, 120); }
      else if (act === 'continue')  { doContinue(); }
      else if (act === 'gallery')   { renderGallery(); show('screen-gallery'); }
      else if (act === 'settings')  { openSettings(); }
      else if (act === 'share')     { share(); }
      else if (act === 'back-title'){ stopTyping(); hidePortrait(); show('screen-title'); document.body.dataset.bg = 'night'; refreshTitle(); }
      else if (act === 'confirm-name') { confirmName(); }
      else if (act === 'restart')   { newGame(); }
      else if (act === 'close-modal') { closeModal(); }
      else if (act === 'wipe')      { wipeAll(); }
      else if (act === 'quit')      { autoSave(); hidePortrait(); show('screen-title'); document.body.dataset.bg = 'night'; refreshTitle(); }
      else if (act === 'backlog')   { openBacklog(); }
      else if (act === 'saves')     { openSaves('save'); }
      return;
    }
    /* 存档槽 */
    if (ev.target.closest('#stat-clue')) { openClues(); return; }
    var s = ev.target.closest('[data-slot]');
    if (s) {
      var i = +s.dataset.slot;
      if (s.closest('.modal').querySelector('.modal-head h3').textContent.indexOf('存') >= 0) {
        if (saveSlot(i)) toast('已存入存档位 ' + i, 'good');
      }
      if (loadSlot(i)) { closeModal(); resumeGame(); toast('已读取存档位 ' + i, 'good'); }
      else { toast('这个位置还没有存档', 'bad'); }
      return;
    }
    var dl = ev.target.closest('[data-del]');
    if (dl) { lsDel(KEY_SLOTS + dl.dataset.del); openSaves('save'); toast('已删除存档位 ' + dl.dataset.del, 'bad'); return; }

    var seg = ev.target.closest('.seg button');
    if (seg) {
      var segBox = seg.closest('.seg');
      var grp = segBox.dataset.seg;
      if (grp === 'speed') { settings.speed = seg.dataset.val; saveSettings(); openSettings(); }
      else if (grp === 'mcGender' || grp === 'loveGender') {
        setup[grp] = seg.dataset.val;
        var btns = segBox.querySelectorAll('button');
        for (var bi = 0; bi < btns.length; bi++) btns[bi].classList.toggle('on', btns[bi] === seg);
        updateSetupHint();
      }
      return;
    }
    var sw = ev.target.closest('[data-toggle]');
    if (sw) {
      var key = sw.dataset.toggle;
      settings[key] = !settings[key];
      saveSettings(); openSettings();
      return;
    }
    /* 点击空白处关闭弹窗 */
    if (ev.target === el.modal) closeModal();
  });

  /* 点击文本框：打字中→立即显示；否则→推进 */
  var box = $('textbox');
  box.addEventListener('click', function () {
    if (isTyping()) { finishTyping(); return; }
    if (pendingChoices && pendingChoices.length === 1) {
      var b = $('choices').querySelector('.choice');
      if (b) b.click();
    }
  });

  /* 键盘 */
  document.addEventListener('keydown', function (ev) {
    if ($('screen-game').classList.contains('is-active')) {
      if (el.modal.classList.contains('on')) { if (ev.key === 'Escape') closeModal(); return; }
      if (ev.key === ' ' || ev.key === 'Enter') {
        ev.preventDefault();
        if (isTyping()) { finishTyping(); return; }
        if (pendingChoices && pendingChoices.length === 1) {
          var b = $('choices').querySelector('.choice'); if (b) b.click();
        }
        return;
      }
      if (/^[1-9]$/.test(ev.key)) {
        var idx = +ev.key - 1;
        var btns = $('choices').querySelectorAll('.choice');
        if (btns[idx]) btns[idx].click();
      }
      if (ev.key === 'l' || ev.key === 'L') openBacklog();
    }
    if (ev.key === 'Escape' && el.modal.classList.contains('on')) closeModal();
  });

  /* 命名输入 */
  $('name-input').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') confirmName();
  });

  /* 页面隐藏时自动存档 */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state.sceneId && $('screen-game').classList.contains('is-active') && !state.ending) autoSave();
  });

  /* 唤醒条件：故事数据必须已加载 */
  var count = 0; for (var k in scenes) if (Object.prototype.hasOwnProperty.call(scenes, k)) count++;
  if (count === 0) {
    document.body.dataset.bg = 'black';
    alert('剧情数据没有加载成功。请确认 story/ 目录下的文件都在，并且是通过 index.html 打开的。');
    return;
  }
  storyReady = true;
  state.chapter = '序章';
  updateHUD();
  refreshTitle();
  console.log('[梧桐里302] 场景 ' + count + ' 个 · 结局 ' + endingList().length + ' 个');
}

function confirmName() {
  var v = ($('name-input').value || '').trim().slice(0, 8) || '陈默';
  state.name = v;
  state.mcGender = setup.mcGender;
  state.loveGender = setup.loveGender;
  newGame();
}

var SETUP_HINT = {
  'x|f': '不说明性别，把三位都当作{ta}来相处。三条线的剧情、秘密和结局完全一样。',
  'x|m': '不说明性别，三位角色会是男生的版本。'
};
function loveWord() { return setup.loveGender === 'm' ? '男生' : '女生'; }
function mcWord() { return setup.mcGender === 'm' ? '男生' : setup.mcGender === 'f' ? '女生' : '不想说'; }
function updateSetupHint() {
  var h = $('setup-hint');
  if (!h) return;
  h.textContent = '你：' + mcWord() + ' ｜ 攻略对象：' + loveWord() +
    '。三位角色的剧情、秘密与九个结局完全一样，只换成对应性别的立绘与称呼。';
}
function syncSetupUI() {
  var boxes = document.querySelectorAll('.seg[data-seg]');
  for (var i = 0; i < boxes.length; i++) {
    var grp = boxes[i].dataset.seg;
    if (grp !== 'mcGender' && grp !== 'loveGender') continue;
    var btns = boxes[i].querySelectorAll('button');
    for (var j = 0; j < btns.length; j++) btns[j].classList.toggle('on', btns[j].dataset.val === setup[grp]);
  }
  updateSetupHint();
}

function newGame() {
  var nm = state.name || '陈默';
  var mg = state.mcGender, lg = state.loveGender;
  state = newState();
  state.name = nm;
  state.mcGender = mg || 'x';
  state.loveGender = lg || 'f';
  lsDel(KEY_AUTO);
  preloadPortraits();
  resumeGame();
  goto('start');
}

function doContinue() {
  var d = lsGet(KEY_AUTO);
  if (!d || !restore(d)) { toast('没有可继续的进度', 'bad'); return; }
  resumeGame();
  goto(state.sceneId);
}

function resumeGame() {
  show('screen-game');
  setBG(state.bg || 'night');
  updateHUD();
  preloadPortraits();
}

function wipeAll() {
  lsDel(KEY_AUTO);
  for (var i = 1; i <= SLOT_COUNT; i++) lsDel(KEY_SLOTS + i);
  lsDel(KEY_GALLERY);
  lsDel(KEY_SETTINGS);
  gallery = {};
  settings = { speed: 'normal', sfx: true, skipRead: false };
  state = newState();
  closeModal();
  refreshTitle();
  toast('本机数据已清空', 'bad');
}

/* ===========================================================
   对外的编剧 API
   =========================================================== */
window.G = {
  scene: function (id, def) { scenes[id] = def || {}; return def; },
  ending: function (id, meta) { endings[id] = meta || {}; return meta; },
  clue: function (id, meta) { cluesDef[id] = meta || {}; return meta; },
  goto: function (id) { show('screen-game'); goto(id); },
  boot: boot,
  /* 供剧情逻辑使用的小工具 */
  fav: function (s, k) { return (s.fav && s.fav[k]) || 0; },
  has: function (s, clueId) { return s.clues.indexOf(clueId) >= 0; },
  flag: function (s, k) { return !!s.flags[k]; },
  best: function (s) {
    var b = 'wan', v = -1;
    ['wan', 'xia', 'he'].forEach(function (k) { if (s.fav[k] > v) { v = s.fav[k]; b = k; } });
    return b;
  },
  add: function (s, fx) { applyFx(fx); },
  clueAdd: addClue,
  toast: toast,
  getState: function () { return state; }
};

})();
