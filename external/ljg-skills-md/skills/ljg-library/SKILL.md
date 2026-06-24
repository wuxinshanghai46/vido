---
name: ljg-library
description: "一本书 → 一幅清晰的「取景框」意向画面 → 一张 2050 图书馆借书卡（PNG）。取景框 = 作者从哪个角度看什么问题、看到了哪幅画面；卡上有真实封面、作者头像、书目信息。取景框 block 用费曼式讲解把这幅意向画面讲得通俗又准确，图解 block 白底黑墨手绘风、精确呈现该意向画面让人一眼即懂（画面里本来有「你」才嵌继刚墨像，否则只画画面）。浅色光学玻璃风、卡身强调色从封面动态提取、宽高自适应。合上书记住这幅画面，就没白读。Use when user says '取景框卡', '图书馆卡', 'library card', '书卡', '铸书卡', '一本书一句话一张卡', '/ljg-library', or provides a book name and wants it distilled into one collectible card. NOT FOR 拆书结构分析（用 ljg-book）、纯文字金句（用 ljg-card -b）、信息图（用 ljg-card -i）、视觉笔记（用 ljg-card -v）。"
user_invocable: true
version: "2.3.0"
---

# ljg-library：取景框借书卡

一本书，铸成一张 2050 图书馆借书卡。封面、作者、书目是身份；**核心是把这本书独创的「取景框」压成一幅意向画面**——作者从某个角度看某个问题，看到了一幅别人没看到的画面。文字 block 用费曼式把这幅画面讲透，图形 block 把它精确画出来。合上书半年后，瞥一眼这张卡，那幅画面回来——这是「没白读」的物证。

> 图解 block 用手绘解释的风格、白底黑墨，**精确呈现意向画面**；继刚墨像（`assets/ljg-portrait.png`，由其头像抠底而成）是可选构图件，仅当画面里本来有个「你」才嵌入。完整设计历程见 `~/.claude/PAI/MEMORY/WORK/ljg-oneliner-design/ISA.md`。

## 约束

输出为视觉文件（PNG），不适用 Markdown / Denote / ASCII-only 规范。

## 灵魂：意向画面提炼 + 图文同呈

卡好不好看是壳，**能不能从一本书提炼出它独创的看世界方式、压成一幅意向画面、用费曼讲解 + 手绘图形分别呈现它，才是命**。这一步若失手，整张卡退化成豆瓣读书卡。

> **核心：取景框 = 角度 + 问题 + 画面。** 作者从某个机位看某个问题，看到一幅别人没看到的画面。这幅意向画面是枢轴——文字讲它、图形画它，两者是同一幅画面的两次呈现。

> **第一要义：把画面讲清楚，不求压短。** 取消一切「压成一句」之类的字数约束——画面具体、讲解通俗准确，比讲短重要。

执行前，**先 Read `references/extraction.md`**：第一部分走取景六步（对象 → 角度 → 旧画面 → 意向画面 → 费曼讲解 → 校验）产出意向画面 + 文字（主句 `{{FRAME}}` + 费曼讲解 `{{EXP}}`，**`{{EXP}}` 必走 `feynman-eli5` skill**）；第二部分把意向画面精确画成图（`{{SKETCH_SVG}}`，复用 `<defs>` 组件与骨架）——**继刚墨像听画面调度：画面里有「你」才嵌，没有就只画画面**。

**输入弹性**：继刚常常自己已经想透（读完顺手就想铸卡）。给了思想就直接用（只走校验 + 画图）；没给则走全程提炼。

## 视觉规格

生成 HTML 前，**先 Read `references/visual.md`**——浅色玻璃卡身规格、卡身动态色 vs 图解板白底黑墨两套配色、字体、图解板（意向画面、墨像可选）规格、踩过的坑全在里面。这是视觉质量底线。

## 流程

```
输入：书名（或 书名 + 已想透的取景框思想）
  ↓
1. weread 取真封面 + 书目（见下「素材获取」）
2. web 抓作者头像
3. 提封面主色 → 卡身动态强调色（python assets/extract_color.py <封面>）
4. 提炼意向画面：对象 + 角度 → 意向画面（用户给了→校验，没给→走 extraction.md 取景六步）
5. 费曼讲解 → {{FRAME}}（一句话点画面）+ {{EXP}}（走 feynman-eli5 把画面讲透）
6. 画意向画面 SVG {{SKETCH_SVG}}：精确呈现那幅画面，墨像听调度（含「你」才嵌 ljg-portrait.png；复用 extraction.md 的 defs + 骨架）
7. 填 assets/library_template.html 的占位变量
8. 渲染（capture.js，fullpage 自适应高度）
9. Read 自验（含放大看图形板，确认图文同一幅画面）→ 交付路径
```

## 素材获取（关键，按此顺序降级）

### 封面 + 书目（weread）

继刚有微信读书。走 weread skill 的 `/store/search`（先 Read `~/.claude/skills/weread/search.md`）：

```bash
curl -s -X POST "https://i.weread.qq.com/api/agent/gateway" \
  -H "Authorization: Bearer $WEREAD_API_KEY" -H "Content-Type: application/json" \
  -d '{"api_name":"/store/search","keyword":"<书名>","scope":10,"skill_version":"1.0.3"}'
```

- 回包 `results[].books[].bookInfo`（每个 result 组一本）有 `title / author / translator / cover / publisher`。
- **封面 cover URL 是 `s_` 缩略图（70×100，太小会糊）。把 `s_` 换成 `t7_` 拿高清（285×411）**：`.../cover/942/635942/t7_635942.jpg`。下载时带 `-H "Referer: https://weread.qq.com/"`。
- 取不到 weread → 联网搜豆瓣封面（web-access / markdown-proxy）→ 仍无则 CSS 占位书封。

### 作者头像（web）

维基百科原图最稳。Wikipedia API 直接拿 original 图 URL：

```bash
curl -s -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" \
  "https://en.wikipedia.org/w/api.php?action=query&titles=<英文名>&prop=pageimages&piprop=original&format=json"
# 拿到 .original.source 后下载（带 UA）：
curl -sL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" -o /tmp/lib_avatar.jpg "<original-url>"
```

- **坑：thumb 路径（`/thumb/.../480px-xxx.jpg`）若该尺寸未缓存会返 HTML 错误页。用原图路径（去掉 /thumb/ 和尺寸段），并必须带 User-Agent（缺 UA 被 Wikimedia 拦）。**
- 无头像 → 省略头像（模板作者行不显示 avatar），不阻塞。

### 墨像（可选，已就位）

图解板若需放「你」，用继刚本人墨像，资产 `assets/ljg-portrait.png`（黑墨线稿 on 透明，落白板上即白底墨像）已生成、固定复用，无需每次重做。**但墨像不是每张必上**——只在意向画面本来含「你」时嵌入（判断见 extraction.md 第二部分）。源头像若更新需重做：PIL 读 head.png，`lum<120` 暗墨像素映射为 `#241a12`、其余透明，裁掉透明边。

### 卡身动态强调色

```bash
python3 assets/extract_color.py /tmp/lib_cover.jpg
# 输出形如：#c43d30
```

从封面提取最显著的**彩色**作卡身强调色（换书自动换色：红封→红卡、蓝封→蓝卡）。脚本默认挑「最频繁的彩色」——若封面主体是大面积米 / 灰背景，它会挑出发闷的背景色；**这时改按「鲜艳度 × 频次」重排，从真实像素里挑一个撑得住的彩色**（别凭空写死）。注意：这只是卡身色；图解板固定白底 `#fdfdfb` + 墨 `#241a12`，不动。

## 模板变量（library_template.html）

| 变量 | 内容 |
|------|------|
| `{{ACCENT}}` | 卡身动态强调色 hex（如 `#c43d30`，从封面提取） |
| `{{COVER}}` | 封面的 `file://` 绝对路径 |
| `{{AVATAR_IMG}}` | 整个头像 `<img class="avatar" src="file://…">`（无头像填空字符串，作者行自动省 avatar） |
| `{{TITLE}}` `{{EN}}` `{{SUBTITLE}}` | 书名中 / 英 / 副标题 |
| `{{TAGS}}` | 3-4 个主题标签（书的核心概念），每个 `<span class="tag">…</span>` |
| `{{AUTHOR_CN}}` `{{AUTHOR_META}}` | 作者中文名 / 「英文名 · 出版社 年份」 |
| `{{FRAME}}` | 意向画面**主句**：一句话点出这幅画面的换眼睛主张，关键词用 `<span class="hl">…</span>` 染卡身强调色 |
| `{{EXP}}` | **费曼讲解**：走 feynman-eli5 把这幅意向画面讲通俗讲准、完整流畅，关键词同样 `<span class="hl">` |
| `{{SKETCH_TITLE}}` | 图形板的名字（英文 + 中文，如 `Ergodicity 遍历性`） |
| `{{SKETCH_SVG}}` | 手绘图形整段 `<svg>…</svg>`（白底黑墨、精确呈现意向画面、墨像听画面调度，见 extraction.md 第二部分） |

## 渲染

```bash
node ~/.claude/skills/ljg-card/assets/capture.js \
  /tmp/ljg_library_{name}.html ~/Downloads/{name}.png 1080 1440 fullpage
```

复用 ljg-card 的 capture.js（playwright 已装在 ljg-card/node_modules）。**必须 `fullpage`**——卡片高度自适应内容，不留底部空白。`file://` 引用本地封面 / 头像 / 墨像可直接渲染。

## 交付

1. Read 输出的 PNG 亲眼验图，并**放大看图形板**（封面/头像加载 ✓、费曼讲解把意向画面讲透 ✓、卡身色协调 ✓、图形精确呈现意向画面一眼即懂 ✓、含「你」时墨像清晰群众无脸成对比／无「你」时纯画画面 ✓、墨线手绘抖 + 批注清晰 ✓、图文同一幅画面 ✓、右侧无空白 ✓）。
2. 报告文件路径 + 一句意向画面提炼说明。

## Gotchas（务必避开）

- **封面尺寸**：weread `s_` 前缀是 70×100 缩略图，必糊。换 `t7_` 拿 285×411 高清，下载带 `Referer`。
- **头像 thumb 陷阱**：Wikimedia `/thumb/.../NNNpx-` 特定尺寸未缓存会返 HTML 错误页。用原图路径 + User-Agent。
- **墨像可选，要放就嵌真墨像不手绘**：决定放继刚墨像时，用 `<image href="…/assets/ljg-portrait.png">`，鲜明 + 像素级一致；手绘小人既不像他又每次漂移，已弃。**但不是每张必上**——画面无「你」就别放，硬塞反糊画面、违背「一眼即懂」。
- **图解板是手写 SVG**：线条 / 图形套 `filter="url(#rough)"` 出手绘抖动；**文字 / 批注 / 墨像绝不套滤镜**（糊）。复用组件 + 骨架见 extraction.md。
- **无脸群众只在有墨像「你」时用**：放了墨像「你」，群众才用 `#person` 无脸小墨人作对比——「你 vs 一群人」靠这个，别给群众画脸。画面无「你」时，群众也未必需要。
- **图解板白底黑墨两色**：白 `#fdfdfb` 底 + 墨 `#241a12`。两套色别串：卡身动态色从封面提取、不写死；图解板白底 + 墨、写死。
- **意向画面是认知位移的成像，不是摘要**：主句「原来不是 X，其实是 Y」+ 费曼讲解讲透机制，不是「本书讲了……」。验收尺：凉脑子瞥一眼，那幅画面回不回得来。
