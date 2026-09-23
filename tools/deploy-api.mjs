/* ===========================================================
   通过 GitHub REST API 同步仓库（绕开被间歇阻断的 github.com:443）
   -----------------------------------------------------------
   用法：
     $env:GH_TOKEN = '你的令牌'
     node tools/deploy-api.mjs --all              # 整个仓库同步
     node tools/deploy-api.mjs --all --dry        # 只看会改什么，不提交
     node tools/deploy-api.mjs 文件1 文件2 ...     # 只提交指定文件
     node tools/deploy-api.mjs 文件1 --rm 目录      # 顺带删除

   为什么需要它：国内网络下 github.com:443 经常被间歇阻断
   （Failed to connect to github.com port 443），
   但 api.github.com 通常一直可达。本脚本用 Git Data API
   （blob → tree → commit → 更新 ref）直接提交，完全绕开那个域名。

   令牌权限：经典令牌要 public_repo / repo；
   细粒度令牌要 Contents: Read and write，
   且 Repository access 必须显式勾选该仓库
   （选 "Public repositories" 只给读权限，会得到 403）。
   =========================================================== */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'LFYLogan';
const REPO = 'wutongli-302';
const BRANCH = 'main';
const API = 'https://api.github.com';

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const all = argv.includes('--all');
let addPaths = [], rmPaths = [], mode = 'add';
for (const a of argv) {
  if (a === '--dry' || a === '--all') continue;
  if (a === '--rm') { mode = 'rm'; continue; }
  (mode === 'add' ? addPaths : rmPaths).push(a);
}

const token = process.env.GH_TOKEN;
if (!token) {
  console.error('缺少 GH_TOKEN。先执行：  $env:GH_TOKEN = \'你的令牌\'');
  process.exit(1);
}

/* ---------------- HTTP ---------------- */
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
    const e = new Error(`${method} ${path} → ${r.status} ${msg}`);
    e.status = r.status;
    throw e;
  }
  return json;
}

/* ---------------- 0. 自检 ---------------- */
const me = await api('GET', '/user');
const repoInfo = await api('GET', `/repos/${OWNER}/${REPO}`);
const perm = repoInfo.permissions || {};
console.log(`身份 ${me.login}   仓库权限 push=${perm.push} pull=${perm.pull}`);
if (!perm.push) {
  console.error('\n❌ 这个令牌没有该仓库的写权限。');
  console.error('   经典令牌需要 public_repo 或 repo；');
  console.error('   细粒度令牌需要 Contents: Read and write，且要勾选该仓库。');
  process.exit(2);
}

/* ---------------- 1. 当前分支头 ---------------- */
const ref = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
const headSha = ref.object.sha;
const headCommit = await api('GET', `/repos/${OWNER}/${REPO}/git/commits/${headSha}`);
console.log(`远端 head ${headSha.slice(0, 10)}`);

/* ---------------- 2. --all：与远端做全量同步 ---------------- */
if (all) {
  const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean)
    .filter((p) => existsSync(join(ROOT, p)));

  const remoteTree = await api('GET', `/repos/${OWNER}/${REPO}/git/trees/${headCommit.tree.sha}?recursive=1`);
  const remoteFiles = (remoteTree.tree || []).filter((t) => t.type === 'blob').map((t) => t.path);
  const localSet = new Set(tracked);

  addPaths = tracked;
  rmPaths = remoteFiles.filter((p) => !localSet.has(p));
  console.log(`本地 ${tracked.length} 个文件，远端 ${remoteFiles.length} 个，需删除 ${rmPaths.length} 个`);
}

if (!addPaths.length && !rmPaths.length) { console.error('没有需要同步的内容'); process.exit(0); }

/* ---------------- 3. 上传 blob ---------------- */
const entries = [];
for (const p of addPaths) {
  const buf = readFileSync(join(ROOT, p));
  if (dry) {
    console.log(`  + ${p.padEnd(34)} ${String(buf.length).padStart(8)} bytes`);
    continue;
  }
  const blob = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
    content: buf.toString('base64'), encoding: 'base64'
  });
  entries.push({ path: p.replace(/\\/g, '/'), mode: '100644', type: 'blob', sha: blob.sha });
  console.log(`  + ${p.padEnd(34)} ${String(buf.length).padStart(8)} bytes`);
}

for (const p of rmPaths) {
  const path = p.replace(/\\/g, '/').replace(/\/$/, '');
  const isDir = !/\.[a-zA-Z0-9]+$/.test(path);
  console.log(`  - ${path.padEnd(34)} ${isDir ? '(目录)' : '(文件)'}`);
  if (!dry) entries.push({ path, mode: isDir ? '040000' : '100644', type: isDir ? 'tree' : 'blob', sha: null });
}

if (dry) { console.log('\n（--dry 模式，没有提交任何东西）'); process.exit(0); }
if (!entries.length) { console.log('\n没有变化。'); process.exit(0); }

/* ---------------- 4. 建 tree / commit / 更新 ref ---------------- */
const tree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, {
  base_tree: headCommit.tree.sha, tree: entries
});
const message = process.env.DEPLOY_MSG || `同步自本地：${addPaths.length} 个文件更新，${rmPaths.length} 个删除`;
const commit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
  message, tree: tree.sha, parents: [headSha]
});
await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false });

console.log(`\n✅ 已更新 ${BRANCH} → ${commit.sha.slice(0, 10)}`);
console.log(`   https://github.com/${OWNER}/${REPO}/commit/${commit.sha}`);
console.log(`   站点 https://${OWNER.toLowerCase()}.github.io/${REPO}/  （Pages 约 1 分钟后重建）`);
