/* ===========================================================
   通过 GitHub REST API 部署（绕开被间歇阻断的 github.com:443）
     $env:GH_TOKEN = '...';  node tools/deploy-api.mjs <文件1> <文件2> ...
   -----------------------------------------------------------
   github.com:443 在国内经常被阻断，但 api.github.com 通常可达。
   本脚本用 Git Data API 把本地文件写成一次提交并更新 main 分支，
   GitHub Pages 会自动重新构建。
   =========================================================== */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'LFYLogan';
const REPO = 'wutongli-302';
const BRANCH = 'main';
const API = 'https://api.github.com';

const token = process.env.GH_TOKEN;
if (!token) { console.error('缺少 GH_TOKEN'); process.exit(1); }
const paths = process.argv.slice(2);
if (!paths.length) { console.error('没有指定要部署的文件'); process.exit(1); }

const H = {
  Authorization: `Bearer ${token}`,
  'User-Agent': 'wutongli-deploy',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
};

async function api(method, path, body) {
  const r = await fetch(API + path, {
    method, headers: H,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
  if (!r.ok) {
    const msg = json && json.message ? json.message : text.slice(0, 200);
    const err = new Error(`${method} ${path} → ${r.status} ${msg}`);
    err.status = r.status;
    err.body = json;
    throw err;
  }
  return json;
}

/* ---------- 0. 自检 ---------- */
const me = await api('GET', '/user');
console.log(`身份        ${me.login}`);

const repoInfo = await api('GET', `/repos/${OWNER}/${REPO}`);
const perm = repoInfo.permissions || {};
console.log(`仓库权限    admin=${perm.admin}  push=${perm.push}  pull=${perm.pull}`);
if (!perm.push) {
  console.error('\n❌ 这个令牌没有该仓库的写权限（push=false）。');
  console.error('   经典令牌需要 public_repo 或 repo 权限；');
  console.error('   细粒度令牌需要 Contents: Read and write。');
  process.exit(2);
}

/* ---------- 1. 当前分支头 ---------- */
const ref = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
const headSha = ref.object.sha;
const headCommit = await api('GET', `/repos/${OWNER}/${REPO}/git/commits/${headSha}`);
console.log(`当前 head   ${headSha.slice(0, 10)}`);
console.log(`基线 tree   ${headCommit.tree.sha.slice(0, 10)}\n`);

/* ---------- 2. 上传 blob ---------- */
const entries = [];
for (const p of paths) {
  const abs = join(ROOT, p);
  const buf = readFileSync(abs);
  const blob = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
    content: buf.toString('base64'),
    encoding: 'base64'
  });
  entries.push({ path: p.replace(/\\/g, '/'), mode: '100644', type: 'blob', sha: blob.sha });
  console.log(`  blob  ${p.padEnd(28)} ${String(buf.length).padStart(7)} bytes  ${blob.sha.slice(0, 8)}`);
}

/* ---------- 3. 建 tree ---------- */
const tree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, {
  base_tree: headCommit.tree.sha,
  tree: entries
});
console.log(`\n新 tree     ${tree.sha.slice(0, 10)}`);

/* ---------- 4. 建 commit ---------- */
const message = [
  '修复立绘渲染尺寸/位置错误',
  '',
  '.portrait 只设了 height 和 right、没设 width，绝对定位元素走 shrink-to-fit，',
  '而子元素 img 的 height:100% 是百分比高度，在推导首选宽度时会被当成 auto，',
  '导致布局算出的盒子是 347x463、绘制时却按约 198px 宽贴右边缘渲染。',
  '',
  '改为显式宽高 + object-fit:contain；',
  '并把“默认可见、用 .hide 隐藏”作为基础状态，',
  '不再让入场过渡动画承担“能不能显示”。'
].join('\n');

const commit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
  message,
  tree: tree.sha,
  parents: [headSha]
});
console.log(`新 commit   ${commit.sha.slice(0, 10)}`);

/* ---------- 5. 更新分支 ---------- */
await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false });
console.log(`\n✅ 已更新 ${BRANCH} → ${commit.sha.slice(0, 10)}`);
console.log(`   https://github.com/${OWNER}/${REPO}/commit/${commit.sha}`);
console.log(`   站点 https://${OWNER.toLowerCase()}.github.io/${REPO}/  （Pages 约 1 分钟后重建）`);
