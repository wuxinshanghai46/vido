# VIDO IP 资产库 PRD v1.0

**文档状态**：待你拍板 2 个未决问题后冻结
**最后更新**：2026-05-03
**作者**：product_manager agent
**目标读者**：admin（你）+ 后续接手的 project_manager / 前后端

---

## 0. 一句话定义

让 admin 把"角色脸 + 商品 + 场景"一次性入库，创作用户下拉选就能出片 —— **跳过 Step1 nano-banana**，同一张脸拍 1000 条视频不漂移。

---

## 1. 背景与目标

### 1.1 痛点

1. 每次生成视频时，Step1 角色形象都从头跑 nano-banana（30–60s + ¥0.1/次），但很多时候用户想反复用同一个 IP 拍 50+ 条视频
2. 角色长相在不同视频间漂移，没有"角色一致性"保障
3. 商品库是 0，每次都要重新上传产品图
4. 场景描述靠用户每次手敲 prompt

### 1.2 商业目标

做出抖音 @叶子aigc 那种 **"1 个 IP 一年发 1000+ 条短视频"** 的批量生产能力：
- 一次建好 IP 资产 → 终身复用
- 单条视频成本降 60–80%（省 Step1 nano-banana 调用）
- admin 可控制哪些资产对哪些用户开放
- 一致性 ↑↑（同一脸跨视频不漂移）

### 1.3 已有基础设施（不重建）

- ✅ 工作流引擎：`src/services/workflowEngine.js` + 12 节点能力库 + 3 内置工作流
- ✅ 后台 admin 面板：用户/角色/积分/AI 配置/AI 工作流/知识库/AI 团队 已就位
- ✅ JSON 文件存储：`outputs/*.json`，无 SQL
- ✅ 用户体系：admin/user 两级 + permissions + allowed_models
- ✅ 静态资源公网路由：`/public/workflow-assets/...` + `/public/jimeng-assets/...`

---

## 2. 用户故事

### US-001（P0）角色入库
> As an admin, I want to upload a character's reference photo and save it as a named IP asset, so that users never need to re-generate the same face.

**验收标准**：
1. 上传图片后系统自动生成 ip_assets 记录，type=character，asset_id 唯一
2. admin 界面可看到头像缩略图 + 上传时间 + 引用次数
3. 上传失败（格式非 jpg/png/webp，或 >10MB）返回明确报错，不写入 DB

### US-002（P0）角色选用
> As a creator, I want to select a saved IP character from a dropdown at Step 1, so that I skip nano-banana generation and go directly to voice/script.

**验收标准**：
1. 下拉列表只显示对该用户"可见"的资产（由 admin 控制）
2. 选中后 digital_human_wizard Step1 显示已选角色缩略图，Next 按钮立即可点（不等生成）
3. 后续 Step3 出片时 ip_asset_id 写入 avatar_task 记录

### US-003（P0）商品入库
> As an admin, I want to upload a product image with name and bullet-point features, so that creators can pick a product without re-uploading each time.

**验收标准**：
1. 上传白底产品图 + 填 name / 卖点（最多 5 条）/ 关键词（最多 10 个）
2. 自动生成 asset_id，存 `outputs/ip-assets/products/` 目录
3. admin 可删除资产，删除前若有"活跃引用"（past 30 天被用过）系统弹确认框

### US-004（P1）商品选用
> As a creator, I want to pick a saved product in the digital-human wizard, so that the product image and selling points are pre-filled without copy-pasting.

**验收标准**：
1. Step2（文案写作/脚本）区域新增"选商品"入口，弹出商品选择 modal
2. 选中后 product name + bullet points 自动填入脚本 prompt 上下文
3. 脚本中 `{{product_name}}` 占位符被替换，创作者可手动覆盖

### US-005（P1）场景模板入库
> As an admin, I want to create scene templates with name + prompt template + optional reference image.

**验收标准**：
1. 场景模板支持 prompt 内 `{{product}}` `{{character_style}}` 变量占位
2. 可选上传参考图（存 scenes/ 目录），最多 2 张
3. 模板可设置"推荐镜头角度"（正面/侧面/俯拍/仰拍），多选

### US-006（P0）权限分配
> As an admin, I want to control per-user visibility of IP assets via a grid view, so that premium characters are only usable by paying users.

**验收标准**：
1. 权限面板展示「用户×资产」矩阵，checkbox 控制可见性
2. 权限变更立即生效（不需要重新登录），API 层做实时校验
3. admin 可批量授权（选中一行用户 → 勾选所有资产）

### US-007（P1）使用次数限制
> As an admin, I want to set a monthly usage quota per asset per user.

**验收标准**：
1. 权限矩阵支持 quota 字段（0=无限，正整数=上限）
2. 超配额时 API 返回 403 + "本月该资产额度已用尽"
3. 每月 1 日自动重置计数（cron 或惰性重置）

### US-008（P2）引用次数追踪
> As an admin, I want to see how many times each asset has been used.

**验收标准**：
1. 资产详情页展示 total_uses + monthly_uses（近 30 天滚动）
2. 每次 avatar_task 完成后自增，失败任务不计
3. 数据在资产卡片上用小角标显示

---

## 3. 核心功能模块

### 3.1 角色 Bible（Character Asset）

| 字段 | 类型 | 验证规则 | 说明 |
|---|---|---|---|
| id | uuid | 自动 | 资产唯一 ID |
| name | string | 2–30 字 | 角色名 |
| cover_url | string | 必填，jpg/png/webp ≤10MB | 主参考图（正脸） |
| variant_urls | string[] | 最多 5 张 | 不同角度/服装变体 |
| style_tags | string[] | 每个 ≤20 字，最多 8 个 | "商务"/"活泼"/... |
| tone | enum | natural/calm/warm/serious/excited 等 12 种 | 直接映射现有 _toneTtsParams |
| voice_id | string | 可选 | 绑定 TTS voice |
| description | string | ≤200 字 | 性格背景简介 |
| is_public | bool | - | true=全用户可见 |
| created_by | uuid | - | 创建人 |
| total_uses | int | - | 累计使用次数 |

**关键交互**：上传调用现有 `/api/dh/images/upload` 端点，复用减集成成本。

### 3.2 商品库（Product Asset）

| 字段 | 类型 | 验证规则 |
|---|---|---|
| id | uuid | 自动 |
| name | string | 2–50 字 |
| category | string | 选填："美妆"/"3C"/"食品"等 |
| cover_url | string | 白底产品主图 |
| extra_urls | string[] | 场景图/屏幕截图，≤4 张 |
| bullet_points | string[] | 1–5 条，每条 ≤50 字 |
| keywords | string[] | 1–10 个 |
| price | string | 选填，展示用 "¥299" |
| script_hint | string | ≤300 字，给 AI 写脚本时的 hint |

### 3.3 场景模板（Scene Asset）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | - |
| name | string | "现代简约办公室" |
| prompt_template | string | 含 `{{product}}` `{{character_style}}` 占位符 |
| negative_prompt | string | 可选 |
| ref_image_urls | string[] | ≤2 张参考图 |
| recommended_angles | enum[] | front/side/top/low |
| aspect_ratio | string | 16:9 / 9:16 / 1:1 |

**变量替换**：渲染时 `{{product}}` 替换 product.name，`{{character_style}}` 替换 character.style_tags.join(',')。

### 3.4 权限矩阵（Grant）

平铺记录而非嵌套（查询按 user_id + asset_id 单条查找，O(n) 可接受）：

| 字段 | 说明 |
|---|---|
| user_id | 被授权用户 |
| asset_id | 资产 ID |
| asset_type | character/product/scene |
| visible | bool |
| quota_monthly | 0=无限，>0=每月上限 |
| used_this_month | 本月已用次数 |
| quota_reset_month | 上次重置 YYYY-MM |

**API 校验时机**：在 `/api/ip-assets/use/:id`（新建端点）里校验，不在 middleware 层做。

### 3.5 一键调用（创作端集成）

数字人向导 Step1 现状：生成图 or 上传图 → 保存为 portrait。

**集成方案**：
- Step1 顶部增加"选已有 IP" Tab，列表从 `/api/ip-assets/characters` 拿
- 选中后将 `ip_asset_id` 写入 wizard 状态，跳过图片生成
- Step3 出片时 avatar_task 携带 `ip_asset_id`，后端自增 total_uses

---

## 4. 数据库 Schema

**文件**：`outputs/ip_assets_db.json`

```json
{
  "characters": [],
  "products": [],
  "scenes": [],
  "grants": [],
  "_meta": { "version": 1, "created_at": "ISO8601" }
}
```

**Mock 角色样例**：
```json
{
  "id": "chr_001",
  "name": "小雅-商务女主播",
  "cover_url": "/public/ip-assets/characters/chr_001_main.jpg",
  "variant_urls": [],
  "style_tags": ["商务", "知性", "30代"],
  "tone": "warm",
  "voice_id": "cosyvoice-v3.5-plus-vido-xxx",
  "description": "适合金融/教育/职场类产品口播",
  "is_public": false,
  "created_by": "admin-uuid",
  "total_uses": 47,
  "created_at": "2026-04-01T08:00:00Z"
}
```

**Mock 商品样例**：
```json
{
  "id": "prd_001",
  "name": "氨基酸洗面奶 150ml",
  "category": "美妆",
  "cover_url": "/public/ip-assets/products/prd_001_main.jpg",
  "bullet_points": ["温和不刺激，敏感肌可用", "泡沫细腻，深层清洁", "无硅油配方"],
  "keywords": ["洗面奶", "氨基酸", "敏感肌"],
  "price": "¥89",
  "script_hint": "强调温和护肤卖点，目标 25-35 岁女性"
}
```

**Mock 授权样例**：
```json
{
  "id": "grant_001",
  "user_id": "testuser-uuid",
  "asset_id": "chr_001",
  "asset_type": "character",
  "visible": true,
  "quota_monthly": 20,
  "used_this_month": 3,
  "quota_reset_month": "2026-05",
  "granted_at": "2026-05-01T00:00:00Z"
}
```

---

## 5. UI 草图（文字描述）

### 5.1 后台「🎭 IP 资产库」面板

**入口**：admin 左侧导航，"AI 工作流"之后新增"IP 资产库"。

**布局**：左侧 4 个竖排 Tab（角色 / 商品 / 场景 / 权限矩阵）+ 右侧主内容区，点击卡片用右侧 slide-in panel 展开详情。

**角色 Tab**：
- 顶部"+ 新建角色"按钮靠右
- Grid 布局（4 列）
- 每个卡片：1:1 头像缩略 + 角色名 + style_tags(2-3 个 pill) + 引用次数小角标
- hover 显示"编辑 | 删除"
- 点击卡片打开右侧 panel：完整字段表单 + 变体图上传 + voice_id 选择

**商品 Tab**：与角色同构，卡片显示 16:9 主图 + 商品名 + 分类 tag + 价格。

**场景 Tab**：卡片展示 prompt_template 前 50 字 + 参考图缩略 + 角度 icon。

**权限矩阵 Tab**：
- 顶部筛选：用户下拉 + 资产类型切换
- 主体 Table：行=用户，列=资产，单元格=checkbox + quota 输入框
- 底部"批量保存"（一次性 PUT，避免请求风暴）

### 5.2 创作端集成（数字人向导 Step1）

**不重新设计** Step1，只在现有"生成形象"和"上传照片"两个 Tab 同级增加第三个 Tab：「选已有 IP」。

Tab 内部：搜索框 + 角色卡片列表（横向滚动，80×80 头像 + 角色名 + 2 个 pill）+ 选中状态高亮（cyan #21FFF3）。

**Step2 选商品**：脚本编辑区上方加折叠"关联商品"行，展开后显示商品选择按钮。选中后商品 name+bullet 以只读标签显示在 prompt context 区。

---

## 6. API 端点

所有路由挂在 `/api/ip-assets`，新建 `src/routes/ipAssets.js`。

| 方法 | 路径 | 描述 | 权限 |
|---|---|---|---|
| GET | `/characters` | 列出（带可见性过滤） | user/admin |
| POST | `/characters` | 新建 | admin |
| PUT | `/characters/:id` | 更新 | admin |
| DELETE | `/characters/:id` | 删除（检查活跃引用） | admin |
| GET | `/products` | 列出 | user/admin |
| POST | `/products` | 新建 | admin |
| PUT/DELETE | `/products/:id` | 同上 | admin |
| GET | `/scenes` | 列出 | user/admin |
| POST | `/scenes` | 新建 | admin |
| PUT/DELETE | `/scenes/:id` | 同上 | admin |
| GET | `/grants` | 读权限矩阵 | admin |
| PUT | `/grants/batch` | 批量保存权限 | admin |
| POST | `/use/:id` | 记录使用（扣配额+计数） | user |

**与 workflow 引擎衔接**：`POST /use/:id` 成功后返回资产完整对象（含 cover_url），调用方拿到后直接作为 portrait_url 写入 wizard 状态，不动 workflowEngine.js。

---

## 7. 端到端验收用例

**E2E-001（核心路径）**
1. admin 上传角色图，填名"小雅"
2. admin 在权限矩阵将 testuser 对"小雅"设为 visible=true, quota=10
3. testuser 登录 → 数字人向导 Step1 → "选已有IP" Tab → 选中"小雅" → Next
4. Step1 跳过，Step3 出片后 avatar_task 含 ip_asset_id=chr_xxx
5. admin 看到"小雅" total_uses=1，testuser grant used_this_month=1

**E2E-002（配额限制）**
1. admin 设 testuser 某角色 quota=2
2. testuser 用 2 次成功
3. 第 3 次调用 `/use/:id` → 返回 403 "本月已用尽"
4. 前端在该角色卡片显示灰色"本月已达上限"

**E2E-003（权限隔离）**
1. admin 创建角色，未给 testuser 授权
2. testuser GET `/characters` → 该角色不出现
3. testuser 直接 GET `/characters/:id` → 403

**E2E-004（商品注入脚本）**
1. admin 创建商品"洗面奶"，3 条 bullet
2. testuser 数字人向导 Step2 选该商品
3. AI 写稿 prompt 含 bullet 内容，最终脚本含"温和"/"敏感肌"
4. testuser 可手动改脚本，商品关联不影响手动编辑

**E2E-005（资产删除保护）**
1. "小雅" past 30 天 total_uses > 0
2. admin 点删除 → 弹"近 30 天已被使用 N 次，确认？"
3. admin 确认 → 状态改为 archived，现有 avatar_task 引用不断链
4. testuser 端列表中该角色消失

---

## 8. 优先级分级

### P0 — MVP（1.5 天交付）
- 角色 Bible CRUD（后端 API + JSON 存储 + 复用现有图片上传）
- Step1 增加"选已有 IP" Tab（前端最小改动）
- admin 权限矩阵（可见性 checkbox，**无 quota**）
- `/api/ip-assets/use/:id` 使用记录接口

### P1 — 第二阶段（再 1 天）
- 商品库 CRUD + Step2 关联商品 + 脚本 prompt 注入
- 月度配额控制（quota_monthly + used_this_month + 惰性重置）
- 场景模板 CRUD（无前端选择入口，先给 admin 建库用）
- 引用次数追踪（avatar_task 完成后 hook 自增）

### P2 — 锦上添花（后续）
- 场景模板在数字人向导 Step2 的选择入口
- 权限批量操作
- 角色变体图 Gallery
- 资产使用数据看板（图表）
- 角色绑定 voice_id 在 Step3 自动预填

---

## 9. 风险与未解问题

### 风险

**1 — 人脸 IP 授权（法律）**
真实自然人照片商用需本人书面授权。建议：上传时增加"授权确认" checkbox，记录勾选时间戳到 asset 记录，不做实质性法律审核，但留存自述证据。

**2 — 存储体积**
按每个角色主图 2MB + 5 张变体 = 10MB，100 个角色 = 1GB。服务器 `/data` 50GB 短期 OK，需规划：archived 资产 90 天后提示物理清除。

**3 — 性能边界**
JSON 遍历 grants 表：100 用户 × 500 资产 = 50K 条，单次全量 5–10MB，Node 解析 ~50ms 可接受。超过 10 万条需要拆 JSON 或 SQLite。

**4 — 集成成本**
数字人向导 Step1 状态在前端 `digital-human.js`，需确认 wizard 状态对象有 `ip_asset_id` 扩展点。avatar_task schema 加 `ip_asset_id` 字段无破坏性。

### ⚠️ 未解问题（需你拍板）

**Q1 — 资产使用是否消耗积分？**
- A：不扣积分，只看配额
- B：每次扣 N 积分（N 由你定）
- C：免费角色不扣，付费角色扣

**Q2 — 是否支持用户自建私有资产？**（用户自己上传自己的脸建私有 IP）
- A：MVP 不做，所有资产 admin 建
- B：MVP 就支持，schema 加 `scope: global|private` 和 owner 字段

---

## 10. 项目工期估算

| 模块 | 工时 | 依赖 |
|---|---|---|
| `ip_assets_db.json` schema + 初始化 | 0.5h | 无 |
| `src/routes/ipAssets.js` 角色 CRUD API | 3h | DB 完成 |
| 商品/场景 CRUD API | 2h | 角色 CRUD（复用） |
| 权限矩阵 API（grants + 可见性过滤） | 3h | 角色 API 完成 |
| 使用记录接口 + 配额校验 | 2h | 权限 API 完成 |
| 前端：Step1 "选已有 IP" Tab | 3h | 角色列表 API |
| 前端：Step2 关联商品 | 2h | 商品 API |
| admin 后台 IP 资产库面板（4 Tab） | 5h | 全部 API |
| 权限矩阵前端 Grid | 3h | grants API |
| 联调 + 边界 case 修复 | 3h | 以上全部 |
| **合计 P0+P1** | **~26h（3.25 人天）** | - |

- 乐观：2.5 天（无前端阻塞）
- 现实：**3.5 天**（前后端并行 + 联调）
- 悲观：5 天（发现数字人向导 Step1 状态机耦合严重）

---

## 11. 下一步流程

1. **你回答 Q1 + Q2** → 我把答案补进 PRD final 版（5 分钟）
2. **交给 project_manager agent** 拆任务清单（按 P0/P1 拆 ~15 个 issue + 依赖关系）
3. **开工**：后端工程师（backend_engineer）+ 前端工程师（frontend_engineer）并行
4. **MVP 上线后** ：把 IP 资产库 + AI 工作流串起来 → 真正实现"批量化短视频生产"
