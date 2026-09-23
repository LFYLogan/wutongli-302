# 梧桐里 302 · 深夜加班恋爱物语

> 一款都市职场题材的中文**文字恋爱闯关游戏**。三个深夜，三段人生，九种结局。
> 纯前端、零依赖、无构建步骤 —— 打开 `index.html` 就能玩，托管到任何静态站点就能分享给所有人。

---

## 玩法

你 24 岁，跳槽进「星芒文化」创意部，工位是 **4A 区 07 号**。抽屉里有一把旧钥匙和一张便利贴：

> 「如果你看到这个，说明他们又招人了。——江」

为了省钱，你搬进梧桐里 7 号楼 **302 室**。深夜便利店的灯、没有人替你按掉的加班灯，和三个各自抱着秘密的人。

**开局先选两件事**：你叫什么名字 · 你的性别（男生 / 女生 / 不想说） · 你想攻略（女生 / 男生）。
三位角色的**剧情、秘密与九个结局完全一样**，只会换成对应性别的立绘与称呼 —— 男生女生都能玩，也都能选到想看的人。

- **6 个夜晚，每晚只够去一个地方** —— 陪伴是有代价的，选了谁就欠了谁。
- **3 位可攻略角色**：苏晚（合租室友 / 插画师）、林知夏（便利店夜班 / 考研二战）、顾清和（创意总监 / 你的上司）。
- **3 条关键线索**：散落在三个人手里。凑齐才能解锁隐藏真结局线。
- **9 个结局** + 结局图鉴（本机永久记录）。

### 数值

| 苏晚 | 林知夏 | 顾清和 | 压力 | 业绩 |
|---|---|---|---|---|
| 好感 0–100 | 好感 0–100 | 好感 0–100 | 0–100，加班会涨 | 0–100，决定你在提案日有没有资格说话 |

---

## 特性

- **全人物立绘**：5 位有台词的角色（苏晚 / 林知夏 / 顾清和 / 江迟 / 郑维），
  三位攻略角色各有男女两版，共 8 张。原图 25MB 压到 **约 1MB**（720×960 JPEG）
- **性别自选 + 性转模式**：896 处代词动态化，三种性别组合都能完整通关
- 手机 / 平板 / 桌面自适应，触控友好，支持键盘操作（`空格` 推进、`1`–`9` 选择、`L` 回顾、`Esc` 关闭）
- 3 个手动存档位 + 自动存档（回到最近一次决策点，不会卡在结局里）
- 对话回顾（backlog）、线索档案、结局图鉴
- 打字机文字效果（4 档速度）、已读跳过、合成音效（可关）
- 一键复制分享链接
- 离线可用：双击 `index.html` 即可，无需联网、无需服务器

---

## 换立绘

原始大图放在 `images/`（已被 gitignore，不占仓库）。文件名里带上性格描述就行，构建脚本按关键词匹配角色：

```powershell
powershell -File tools/build-cast.ps1
```

它会把图压成 720×960 的 JPEG 输出到 `assets/cast/`。要换角色对应关系，改脚本顶部的 `$map` 表。

引擎里的角色映射在 `js/engine.js`：

```js
var CHAR_KEY = { '苏晚':'wan', '林知夏':'xia', '顾清和':'gu', '江迟':'chiang', '郑维':'zheng' };
```

立绘是**带背景的整幅位图、没有透明通道**，所以 CSS 用下半部渐隐的遮罩 + 暗角把它融进场景。
尺寸相关的写法在 `css/style.css` 的 `.portrait` 上方有详细注释——那里踩过坑，改之前先读。

---

## 本地运行

直接双击 `index.html`。或者起一个静态服务器（推荐，避免个别浏览器对 `file://` 的限制）：

```bash
node tools/serve.mjs          # → http://127.0.0.1:8123/
```

> 不用 `python -m http.server`：Windows 上中文主机名会让 `socket.getfqdn()` 抛 `UnicodeDecodeError`。

立绘审阅页：`http://127.0.0.1:8123/tools/preview.html`

## 开发工具

```bash
node tools/validate.mjs       # 剧情图校验：断链 / 不可达场景 / 结局可达性 / 关键 flag
node tools/playtest.mjs       # 自动试玩：驱动引擎跑完 9 条路线 + 4 种性别组合渲染审计
node tools/playtest.mjs --trace --verbose   # 附压力轨迹与完整路线

node tools/gen-portraits.mjs --sheet        # 重新生成立绘 + 审阅接触表
node tools/check-portraits.mjs              # 逐像素检查立绘（覆盖率/五官位置/对称/渐隐）
```

全部零依赖（只有立绘光栅化需要 `npm i -D @resvg/resvg-js`）。改完剧情跑一遍就知道有没有写坏。

---

## 目录

```
index.html            外壳（纯静态，按顺序加载剧情文件）
css/style.css         样式（深色「深夜加班 / 便利店灯」气质）
js/engine.js          引擎：分支推进 / 数值 / 立绘 / 性别代词 / 存档 / 图鉴 / 打字机 / 音效
assets/portraits/     28 张 SVG 立绘
story/00-prologue.js  序章「4A-07」
story/01-chapter1.js  第一章「梧桐里 302」
story/02-chapter2.js  第二章「加班的形状」（夜晚 1–3）
story/03-chapter3.js  第三章「各自的深夜」（夜晚 4–6、线索、支线 flag）
story/04-chapter4.js  第四章「一年前」（真相汇聚）
story/05-chapter5.js  第五章「提案日」（最终抉择与分流）
story/09-endings.js   9 个结局
story/99-side.js      线索档案 + 组合台词工具
STORY_BIBLE.md        故事圣经 + 剧情 DSL / 性别系统 / 立绘规范（改剧情前必读）
tools/                校验器、试玩器、立绘生成器、审阅页
```

---

## 改剧情

剧情文件是**普通脚本**，通过 `G.scene()` 注册场景。完整规范在 `STORY_BIBLE.md`，速览：

```js
G.scene('c1_demo', {
  ch: '第一章 · 梧桐里 302',      // HUD 章节名
  bg: 'store',                     // office|room|store|street|rain|roof|dawn|bar|night|black
  who: '林知夏',                   // 说话人；省略 = 旁白
  text: '第一段。\n\n第二段。',     // 也支持数组或 (s)=>字符串，{name} 是主角名
  fx: { xia: 3, stress: -2 },      // 进入时结算数值（会弹提示）
  set: { met_xia: true },          // 进入时设置 flag
  choices: [
    { t: '买那份关东煮', to: 'c1_next', tip: '夏 +5', fx: { xia: 5 } },
    { t: '只买一瓶水',   to: 'c1_other', if: s => s.perf > 40, key: true }
  ],
  next: 'c1_fallback'              // 没有 choices 时的自动出口
});
```

改完记得跑 `node tools/validate.mjs && node tools/playtest.mjs`。

---

## 部署到 GitHub Pages

仓库已经配好，推上去就会自动重建：

```
https://lfylogan.github.io/wutongli-302/
```

把这个链接发给任何人，手机、电脑、平板都能直接玩，不需要安装任何东西。

### 方式一：git push

```bash
git add -A && git commit -m "更新"
git push origin main
```

> 如果 `credential.helper` 指向未安装的 GCM，用 `git -c credential.helper= push origin main` 绕开，它会直接提示输入用户名和密码（密码填 Personal Access Token）。

### 方式二：走 API 推送（**国内网络推荐**）

`github.com:443` 在国内经常被间歇性阻断（表现为 `Failed to connect to github.com port 443`），
但 `api.github.com` 通常一直可达。这个脚本用 Git Data API 直接提交，**完全绕开被阻断的域名**：

```bash
$env:GH_TOKEN = '你的令牌'
node tools/deploy-api.mjs 改动文件1 改动文件2 ...
```

它会先自检令牌权限（`push=true` 才继续），然后建 blob → tree → commit → 更新 `main`，
一次提交完成，Pages 约 1 分钟后自动重建。

列出上次推送以来改了哪些文件：

```bash
git diff --name-status <上次成功的commit>..HEAD
```

令牌权限：经典令牌需要 `public_repo`（公开仓库够用）或 `repo`；
细粒度令牌需要 **Contents: Read and write**，且 Repository access 必须显式勾选该仓库
（选 "Public repositories" 只给读权限，会得到 `403 Permission denied`）。

### 方式三：SSH over 443

如果 `api.github.com` 也被挡，用这条通道（实测在国内多数网络下可达）：

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_wutongli -N ""
# 把 ~/.ssh/id_ed25519_wutongli.pub 贴到 https://github.com/settings/ssh/new
git remote set-url origin ssh://git@ssh.github.com:443/LFYLogan/wutongli-302.git
git config core.sshCommand "ssh -i ~/.ssh/id_ed25519_wutongli -o IdentitiesOnly=yes"
git push -u origin main
```

---

## 授权

剧情与代码归作者所有。字体使用系统中文字体，无外部素材依赖。
