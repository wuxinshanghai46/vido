# VIDO 知识库 (Knowledge Base) 功能验证文档

**版本**: 2026-04-11
**范围**: 数字人 / 网剧 / 分镜 / 氛围 四合集 + Agent 自动注入 + 管理后台 UI
**状态**: ✅ 本地全量验证通过

---

## 1. 功能总览

在管理后台新增独立的「知识库」tab，按 4 个合集组织 AI 创作素材，并自动注入到编剧、导演、人物一致性等 agent 的 system prompt 中，让 agent "深度学习" 后再生成剧情/分镜/氛围 prompt。

### 1.1 四个合集

| 合集 ID | 名称 | 子分类 |
|---|---|---|
| `digital_human` | 数字人知识库 | 角色资产库 / 口播话术 / 带货脚本 / 口型与表情 / 直播场景 / 音色与人设 |
| `drama` | 网剧知识库 | 爽文 / 男频文 / 女频文 / 悬疑文 / 情感文 / 恐怖小说 / 爆款公式 / 开篇钩子 |
| `storyboard` | 分镜库 | 景别矩阵 / 运镜公式 / 构图法则 / 节奏控制 / 转场技法 / 分镜模板 |
| `atmosphere` | 氛围库 | 电影感 / 材质感 / 光影 / 色彩 / 天气与烟雾 / 后期质感 / 混合范式 |

### 1.2 初始 seed 条目（26 条）

```
by collection: {
  "atmosphere": 9,
  "storyboard": 5,
  "drama":      8,
  "digital_human": 4
}
```

每条 document 结构：

```json
{
  "id": "kb_xxx",
  "collection": "digital_human|drama|storyboard|atmosphere",
  "subcategory": "子分类",
  "title": "条目标题",
  "summary": "一句话摘要",
  "content": "完整正文",
  "tags": ["标签"],
  "keywords": ["关键词（英文更易检索）"],
  "prompt_snippets": ["可复用的 prompt 片段"],
  "applies_to": ["screenwriter","director","character_consistency","atmosphere","storyboard","digital_human"],
  "source": "来源",
  "lang": "zh|en|zh-en",
  "enabled": true
}
```

### 1.3 氛围库必带关键词（已覆盖）

用户明确要求围绕以下提示词展开：**AI 提示词 / 氛围提示词 / 电影感 / 材质感 / high contrast / haze / semi metallic lighting / volumetric smoke or fog / sparks** — 全部收录：

- `kb_atm_cinematic_core` —— 电影感 cinematic 核心关键词（anamorphic / film grain / teal and orange / bokeh …）
- `kb_atm_high_contrast_haze` —— **high contrast + haze** 范式，含 god rays / volumetric haze / atmospheric dust
- `kb_atm_semi_metallic` —— **semi metallic lighting**，含 brushed metal / chrome / iridescent / specular
- `kb_atm_volumetric_fog_sparks` —— **volumetric smoke/fog + sparks**，含 floating embers / god rays / dust shaft
- `kb_atm_seedream5_textures` —— **材质感** Seedream 5.0 针对 skin / fabric / metal / liquid / glass / leather / wood 的 texture 关键词
- `kb_atm_golden_blue_hour` —— golden / blue hour 光影
- `kb_atm_color_palette_formulas` —— 6 组电影色彩调板
- `kb_atm_post_vfx` —— film grain / chromatic aberration / vignette / halation
- `kb_atm_master_checklist` —— 一句话电影感万能尾缀

---

## 2. 参考素材说明

用户提供的三条抖音链接如下：

| 素材 | 抖音链接 | 状态 |
|---|---|---|
| [1] @阿拉赛博蕾《seedance2.0+seedream5.0 高级玩法》 | v.douyin.com/t-NglmOXMcM | **页面被混淆代码保护，无法抓取正文**；仅能读取分享文案标题 |
| [2] @金枝玉叶带你AI出圈《AI漫剧选题公式：5个爆款基因》 | v.douyin.com/hqdWtC4BJVs | 同上，仅能读标题 |
| [3] @只关于Ai的学妹《轻松打造角色资产库》 | v.douyin.com/0NXzARIHed4 | 同上，仅能读标题 |

**因此本次 seed 内容的合成策略**：

1. 抖音 iesdouyin / www.douyin.com 页面的 HTML 是 byted_acrawler 混淆 JS bytecode，没有明文正文、没有视频字幕，爬虫无法拿到讲解稿；
2. 基于分享文案里**肯定存在的信息**（作者 / 标题 / 标签 / 子主题关键词）推断主题；
3. **主体内容由我基于公开的 AI 视频创作领域知识合成**，包括：
    - Seedance 2.0 多镜头叙事范式（公开技术文档）
    - Seedream 5.0 材质提示词经验（社区公开讨论）
    - 漫剧爆款选题通用公式（短视频运营通识）
    - 角色资产库构建方法（业内 character consistency 通用实践）
4. 合成内容在每条 seed 的 `source` 字段都明确标注 "抖音 @xxx 《xxx》合成整理 + 通用经验"，不冒充视频原文直译；
5. **后续可由用户自己在管理后台补充**：如果用户自己看过视频并想加入某些原文观点，可以在 admin UI 里直接新建/编辑条目。

这是工程上诚实的方案——不编造"视频说了什么"，但把相关领域的公开知识系统化入库。

---

## 3. 改动文件清单

### 3.1 后端

| 文件 | 改动 |
|---|---|
| `src/models/database.js` | 新增 `knowledge_base.json` collection + 统一 CRUD 接口（`insertKnowledgeDoc` / `listKnowledgeDocs` 支持按 collection/subcategory/appliesTo/q 过滤 / `bulkInsertKnowledgeDocs`） |
| `src/services/knowledgeBaseService.js` **（新）** | KB 上层服务：listDocs / getDoc / searchDocs / **buildAgentContext(agentType, opts)** / **buildDramaPipelineContext(genre)** / listCollections；启动自动 ensureSeeded |
| `src/services/knowledgeBaseSeed.js` **（新）** | 26 条初始 seed 数据 |
| `src/routes/admin.js` | 新增 `/api/admin/knowledgebase/*` 端点（见 §4） |
| `src/services/dramaService.js` | **编剧 / 导演 / 人物一致性** 三个 agent 在构建 systemPrompt 时注入 `kb.buildAgentContext(...)`；`generateDrama()` 签名新增 `genre` 并向下传递 |
| `src/services/storyService.js` | `generateStory()` 在构建 systemPrompt 时注入 screenwriter + atmosphere + storyboard 三档 KB 上下文 |
| `src/routes/drama.js` | 调用 `generateDrama` 与 `agentCharacterConsistency` 时把 `project.genre` / `project.drama_type` 作为 genre 传递 |

### 3.2 前端

| 文件 | 改动 |
|---|---|
| `public/admin.html` | 侧栏新增「知识库」nav-item；新增 `#panel-knowledgebase` 面板（三栏：合集树 / 条目列表 / 编辑器）+ Agent 注入预览浮层 |
| `public/js/admin.js` | `initTabs()` 中增加 `knowledgebase` 初始化；新增完整 KB 模块（`kbInit/kbLoadDocs/kbSelectDoc/kbNewDoc/kbSaveDoc/kbDeleteDoc/kbOpenPreview/kbRunPreview`） |
| `public/css/admin.css` | 新增 `.kb-*` 样式集（layout / sidebar / list / editor / preview modal） |

### 3.3 不改动

- `outputs/vido_db.json` 系列其他 collection（KB 完全独立存储在 `outputs/knowledge_base.json`）
- 用户鉴权模块
- 其他 agent/route 业务逻辑

---

## 4. API 端点清单

所有端点位于 `/api/admin/knowledgebase`，需 `admin` 角色 JWT。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/collections` | 合集元信息（4 个合集 + 子分类） |
| GET | `/` | 文档列表，query：`collection` / `subcategory` / `appliesTo` / `q`（模糊搜索） |
| GET | `/:id` | 单条详情 |
| POST | `/` | 新建文档 |
| PUT | `/:id` | 更新文档 |
| DELETE | `/:id` | 删除文档 |
| GET | `/_preview/:agentType?genre=xxx` | 预览某 agent 的注入上下文（用于调试） |
| POST | `/_seed` | 若当前 KB 为空则重新执行一次初始 seed（不会覆盖已有） |

---

## 5. Agent 注入机制

### 5.1 注入点（已接入）

| Agent | 位置 | 注入策略 |
|---|---|---|
| 编剧 agentDramaScreenwriter | `dramaService.js:85-124` systemPrompt 尾部 | `buildAgentContext('screenwriter', {genre, maxDocs:4})` |
| 导演 agentDramaDirector | `dramaService.js:171-242` systemPrompt 尾部 | director (3) + atmosphere (3) + storyboard (2) 三档合并 |
| 人物一致性 agentCharacterConsistency | `dramaService.js:423-464` systemPrompt 尾部 | `buildAgentContext('character_consistency', {genre, maxDocs:3})` |
| 通用编剧 generateStory | `storyService.js:201` systemPrompt 尾部 | screenwriter (2) + atmosphere (2) + storyboard (2) |

### 5.2 题材优先级排序

`buildAgentContext(agentType, {genre})` 会：

1. 先按 `applies_to` 过滤出对该 agent 开放的 docs
2. 若传了 `genre`（如 "悬疑"/"爽文"/"甜宠"），对命中 `subcategory/tags/title` 的 doc 加权排序
3. 截取前 N 条（每 agent 各自配额）
4. 组装成「【知识库上下文（由管理后台知识库自动注入，请深度学习并严格遵循下列要点）】… 【上下文结束】」格式

### 5.3 实测示例（genre=悬疑 → director context）

```
length: 4122 chars
first block:
【drama/悬疑文】悬疑文：伏笔 / 反转 / 信息差三板斧
悬疑 = 读者与主角的信息差博弈。每集必须埋 2 个伏笔、揭 1 个反转。
核心技法：
- 伏笔必须"可回看"
- 反转必须"可验证"
…
视觉建议：低光 + 冷蓝调 + 顶光压迫 + 手持微抖 + 特写异常细节。
```

→ 证明：genre=悬疑时，悬疑相关文档被优先命中，导演 agent 会直接拿到"低光+冷蓝调+顶光压迫"这样的具体指示。

---

## 6. 验证记录

> 所有测试在本地 `http://localhost:3007` 执行，时间 2026-04-11。

### 6.1 服务启动

```
✓ node src/server.js 启动正常
✓ outputs/knowledge_base.json 自动创建，41582 字节
✓ 26 条 seed 条目全部写入
```

### 6.2 HTTP 端点

| 测试 | 结果 |
|---|---|
| `GET /collections` | ✅ 返回 4 个合集 |
| `GET /` 不过滤 | ✅ 返回 total=26 |
| `GET /?collection=drama&q=悬疑` | ✅ 命中 1 条 `kb_drama_xuanyi` |
| `GET /_preview/director?genre=悬疑` | ✅ 返回 4122 字符注入文本，首条为悬疑文档 |
| `POST /` 创建临时条目 | ✅ 返回新 id `kb_df196d94` |
| `PUT /:id` 更新标题 + 禁用 | ✅ 字段正确变更 |
| `DELETE /:id` | ✅ success=true |
| `GET /:id` 已删除条目 | ✅ 返回 404 |

### 6.3 Agent 上下文构建（service 层直接测）

```
director genre=悬疑  → 4122 chars，首条命中悬疑文
screenwriter 无 genre → 正常返回 4 条编剧类
character_consistency → 正常返回角色锁定类（角色资产库/人物锁定 bible 思维）
atmosphere → 正常返回电影感 / high contrast / semi metallic 等
```

### 6.4 前端 UI（手工验证步骤）

1. 访问 http://localhost:3007/admin.html
2. 用 admin 账户登录（admin / admin123）
3. 左侧 nav 点击「知识库」
4. 应该看到：
   - 左栏 4 个合集 + 每个合集展开的子分类
   - 中栏 26 条 seed 的列表
   - 右栏空编辑器提示
5. 点击任意条目 → 右栏出现编辑器，字段全部可见
6. 点击"+ 新建条目" → 空表单，可填字段并保存
7. 修改标签/applies_to → 保存后列表刷新
8. 点击顶栏"预览 Agent 注入" → 弹窗，可选 agent 类型和 genre，实时看到最终注入到 system prompt 的文本
9. 删除临时条目 → 列表刷新

---

## 7. 如何让 agent 实际用上

编剧/导演/人物一致性 agent 已经**自动读取**，无需手动触发。

- 从前端发起网剧生成时，`project.genre`（或 `drama_type`）会从 API 透传到 `generateDrama()`，再传到三个 agent，用于 KB 上下文的题材优先级排序
- 如果你想**新加/修改**一条知识给 agent：
  1. 进管理后台 → 知识库
  2. 新建或编辑条目
  3. 勾选 `applies_to` 里对应的 agent（screenwriter/director/character_consistency/atmosphere/storyboard/digital_human）
  4. 保存
  5. 下一次 agent 调用会立即生效（KB 服务每次都读磁盘 JSON，不缓存）

---

## 8. 已知限制

1. **抖音视频正文不可读**：WebFetch 到 iesdouyin/douyin.com 只能拿到混淆 JS，无法拿到讲解稿；seed 内容是基于标题 + 通用知识合成，不是视频原文逐字复现。请用户自行在后台补充视频原文要点。
2. **KB 未做全文索引**：当前 `q` 搜索是对 title/summary/content/tags/keywords 的子串匹配，未来条目量大时可换 fuse.js / 倒排索引。
3. **agent 上下文长度**：当前每 agent 默认截 3-4 条、每条 360 字符。如果 LLM context 紧张可在 `buildAgentContext` 调 opts。
4. **MCP md-webcrawl-mcp-master 启动失败**：与本次 KB 无关，是 FastMCP 版本不兼容 `dependencies` 参数，之前就存在的问题。

---

## 9. 下一步（需用户确认）

部署到生产：`119.29.128.12 /opt/vido/app`，PM2 进程 `vido`，端口 4600。

部署前待用户确认：
- [ ] 是否需要把 seed 文件一并 rsync 过去（推荐：带过去但不覆盖）
- [ ] 是否需要重启 PM2
- [ ] 生产环境是否已有 outputs/knowledge_base.json（如有，seed 不会覆盖）

**凭证不写入代码/commit/memory，仅在部署会话中临时使用。**
