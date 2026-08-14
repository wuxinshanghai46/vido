# VIDO 剧情广告 V51 回家续接交接

> 日期：2026-08-14
> 当前权威分支：`codex/story-ad-systemic-remediation`
> 当前生产版本：`20260814-reference-world-recognition-v51`
> 用途：家庭电脑拉取后继续优化剧情广告全流程

## 1. 当日目标与用户决策

今天围绕生产真实任务“科技广告”完成以下闭环：

1. 人物方案与场景方案必须分开提示、分开更新，不能由一个入口同时重做并破坏人物站位绑定。
2. 参考视频/链接识别必须提高一次完成率；破损 JSON、漏帧和批次失败需要在同一次任务内恢复，已成功批次不得重复读取。
3. 项目中心增加任务名称、任务类型和当前阶段查询条件；任务类型独立显示，“项目内容”改为“项目名称”。
4. 参考人物自动补齐名称、年龄和可可靠判断的外貌/地域设计；路人、人流和环境人物不得成为人物资产。
5. “AI 可识别”不能只是文案，世界/时代和画面形态必须根据已完成参考分析真正回填并持久化。
6. 图片和视频生成继续由用户亲自执行；开发、恢复、部署和核对不得替用户触发生成或产生重复费用。
7. 回归范围按改动模块和影响面决定：公共层变更运行跨平台相关回归，模块内修复不被无关全平台套件拖慢。

## 2. 修改前后的完整数据流

### 2.1 人物与场景方案

修改前：

`人物页合并按钮 → scene-config 全量重规划 → 人物/场景/道具/故事共同替换 → Active Plan 整体重发 → 旧 character_id + world_id + look_id 站位绑定可能失配`

修改后：

`人物更新 → person-plan 候选 → 稳定人物/造型/绑定检查 → 仅人物域发布`

`场景更新 → scene-plan 候选 → 稳定场景/站位/绑定检查 → 仅场景域发布`

两个域分别记录有效状态；任何候选会让人物、场景、造型或站位绑定孤立时，发布前直接拒绝。

### 2.2 参考视频与链接识别

修改前：

`多帧批次 → 普通文本 JSON → 模型返回截断/漏帧 → 整批失败 → 下一次手工重试才可能拆批 → 已成功批次存在重复读取风险`

修改后：

`多帧批次 → 结构化返回 → 语法修复 → 完整性校验 → 失败批次同次拆为单帧恢复 → 成功缓存合并 → 多候选语义兜底 → 完成前重新读取权威 checkpoint`

生产目标任务已由 `failed/87%` 确定性恢复为 `completed/100%`，8/8 已缓存批次和源视频哈希保持不变，恢复过程模型调用 0。

### 2.3 参考人物资产投影

修改前：

`参考人物证据 → 每个画面人物直接成为资产 → 出镜人物 1/2... → 年龄/名称/族裔字段缺失 → 场景路人膨胀人物资产数量`

修改后：

`参考人物证据 → 持续叙事身份筛选 → 重复身份合并 → 原创名称/年龄/可确认外貌字段补齐 → 主要人物进入资产 → 路人/人流进入 ambient_entities`

“科技广告”当前为 2 个主要人物：林澜、陈序，年龄均为 `25~35岁`；6 个背景人物只保留为场景氛围。

### 2.4 AI 世界设定识别

修改前：

`参考分析完成 → 前端仅把 auto 选项显示为“待识别” → era_family/visual_medium 仍为 auto → “AI 可识别”与真实数据不一致`

修改后：

`参考分析完成且质量通过 → 收集 brief/故事/场景/人物可见证据 → 确定性推断时代和画面形态 → 保存 world_setting 及逐字段来源 → 上下文和人物视觉约束共用`

AI 推断来源为 `reference_analysis`，显示“AI 已识别”；自动判断不会冒充用户已确认，用户手动值始终优先。

## 3. 代码和文件变更清单

### 人物/场景分域

- `src/services/newStoryAd/assetPlanPublicationService.js`
- `src/services/newStoryAd/assetPlanService.js`
- `src/services/newStoryAd/storyAdService.js`
- `src/routes/newStoryAd.js`
- `public/story-ad/views/assetCenterPlanningDetailsStatus.js`
- `public/story-ad/views/assetCenterView.js`
- `public/story-ad/views/sceneWorldPage.js`
- `public/story-ad/store/projectStore.js`
- `scripts/test-story-ad-scoped-plan-update-v23.js`

### 参考识别恢复和项目查询

- `src/services/newStoryAd/referenceVideoAnalysisService.js`
- `src/services/newStoryAd/referenceUnderstandingService.js`
- `src/services/newStoryAd/modelGateway.js`
- 项目列表筛选和任务类型相关前端模块
- 参考视频、参考链接、语义恢复和项目列表定向测试

### 参考人物自动补齐

- `src/services/newStoryAd/assetPlanService.js`
- `src/services/newStoryAd/assetPlanSectionRecoveryContractService.js`
- `src/services/storyAdWorkspace/personLookProjectionService.js`
- 人物详情、编辑、历史步骤只读和导航相关前端模块
- `scripts/test-story-ad-reference-asset-autofill-v41.js`
- `scripts/test-story-ad-asset-plan-section-recovery-platform.js`

### AI 世界设定识别

- `src/services/newStoryAd/worldSettingContractService.js`
- `src/services/newStoryAd/contextBuilder.js`
- `src/services/newStoryAd/assetPlanService.js`
- `public/story-ad/views/briefWorldSettings.js`
- `scripts/test-story-ad-semantic-contracts-v132.js`

## 4. Git、发布提交和家庭电脑续接

### 当前 Git 身份

- 远端 `origin`：`https://gitee.com/fu-xing46/newvido.git`
- 分支：`codex/story-ad-systemic-remediation`
- V51 源码提交：`47d02b01fb51941478f759a2a8e640aad4f69872`
- V51 源码树：`fe68cfa81a7ea69053ed5b7e590b7469f5d0e8a7`
- V51 构建提交：`d96db37ea00a5bedcde21234a59bb8209713aa01`

源码提交到构建提交之间仅包含 V51 生成发布文件：`config/story-ad-runtime-manifest.json` 和 `public/story-ad/` 发布版本引用/清单。

### 家庭电脑拉取命令

```powershell
cd D:\VIDO
git status --short
git fetch --all --prune
git switch codex/story-ad-systemic-remediation
git pull --ff-only origin codex/story-ad-systemic-remediation
npm install
node src/server.js
```

访问：<http://localhost:3007>

如果家庭电脑存在未提交文件，先核对是否与远端修改重叠；禁止使用 `git reset --hard` 覆盖本地工作。

## 5. 本地、Git、生产三方一致性

| 核对项 | 本地 | Gitee / origin | 生产 | 结论 |
|---|---|---|---|---|
| 分支/来源 | `codex/story-ad-systemic-remediation` | 同分支 | manifest 记录同分支 | 一致 |
| 构建提交 | `d96db37e...` | `d96db37e...` | 发布清单由该构建提交生成 | 一致 |
| 源码提交 | `47d02b01...` | 对象存在且已推送 | `47d02b01...` | 一致 |
| 源码树 | `fe68cfa8...` | `fe68cfa8...` | `fe68cfa8...` | 一致 |
| build | V51 | V51 发布文件 | V51 | 一致 |
| artifact | `67148a0b...` | 清单相同 | `67148a0b...` | 一致 |
| runtime hash | `227bb9ed...` | 清单相同 | `227bb9ed...` | 一致 |
| release bundle | `129da005...` | 清单相同 | `129da005...` | 一致 |
| runtime manifest SHA-256 | `91fe68c0...` | Git 文件相同 | `91fe68c0...` | 一致 |
| 发布闭包 | 715 项 | 715 项 | 714 个清单文件 + 清单自身，差异 0 | 一致 |

生产目录：`/opt/vido/releases/67148a0b5d4595dae58e4de5766930b1f7cbdbf27b06377d06dd88ca5fe4ed4d`

本机工作树不是全空：存在用户此前遗留的 `.gitattributes` 换行物化、历史交接删除、旧日志修改、未跟踪研究/交接文件和 `.codex-tmp/`。这些文件未纳入本轮提交，也不影响上述运行代码闭包一致性。

## 6. 实际执行的验证

### 定向与发布验证

- 世界设定语义合同：通过；覆盖未来/真人实拍识别、上下文传播、用户覆盖保护和 AI 不冒充用户确认。
- 参考人物自动补齐：通过；2 个主要人物、5 个测试背景实体，背景人物不进入人物资产。
- 工作区后端投影：57 项通过。
- 工作区 UI 回归：通过。
- 剧情场景覆盖：9 个节拍、8 个生产场景；真实模型调用 0。
- 发布完整性：11 项通过。
- 发布源码身份：通过。
- 发布闭包：715 项通过。
- 前端边界：通过；未放宽体积门禁。

### 生产核对

- build：`20260814-reference-world-recognition-v51`
- PM2：`online`，restart `0`
- 内网健康：HTTP 200 / `ok`
- 公网域名健康：HTTP 200 / `ok`
- 公网 IP 健康：HTTP 200 / `ok`
- SQLite：`ok`，部署时 `quick_check=ok`
- 生产任务：31
- lineage：31/31
- 活动生成：0
- 活动未知计费：0
- 历史未知计费：60，均不处于活动提交状态，继续保留人工核对边界
- 孤立 output：0
- V51 发布文件：逐项哈希差异 0

### 目标任务只读核对

- 任务：`f8b36b3f-dea6-4cc3-b014-1724eea563b4`（科技广告）
- 参考识别：`completed/100%`，8/8 批保留
- 世界/时代：未来，显示“AI 已识别”
- 画面形态：真人 / 实拍，显示“AI 已识别”
- 内容修订号：8，回填前后不变
- 人物、场景、资产方案、分镜、关键帧、视频和参考分析哈希：前后不变
- 本轮模型调用：0
- 本轮付费调用：0
- 图片/视频生成：未执行

## 7. 未执行项、剩余风险和边界

- 未执行与本次人物、参考识别、世界设定和工作区无关的全平台功能套件；测试范围按实际改动模块确定。
- 未执行新的完整广告/剧情成片生成；用户明确要求生成由本人操作，不能由开发流程代跑。
- “具体时期”和“国家/地区”在当前科技广告任务中仍为空：参考内容没有可靠年份或国家证据，系统按规则不臆造。
- 线上参考理解报告的“系统推断”部分存在对象被渲染成 `[object Object]` 的可见问题；不影响本次世界设定字段，但建议作为回家后的第一个 UI 数据投影问题处理。
- 历史未知计费共有 60 条，但活动未知计费为 0；不得在未核对供应商状态前自动重提这些单元。
- 本机未提交的历史文件改动不在 Git 中，家庭电脑拉取不会获得这些内容；本次交接只保证已提交运行代码和本交接文件可拉取。

## 8. 回家继续优化的建议顺序

1. 拉取本交接提交，确认 `git status --short`，启动 3007 本地服务并核对 `/api/story-ad/version` 为 V51。
2. 修复参考理解报告 `[object Object]`：追踪数据 schema、API 投影和前端渲染，增加对象/字符串混合回归，不只做末端 `String()` 掩盖。
3. 用“科技广告”任务只读复核世界设定、人物字段、背景实体隔离和历史步骤只读；不要触发生成。
4. 检查参考链接与视频的同一恢复合同是否完整共享，重点覆盖最大批次、破损 JSON、漏帧、并发和缓存幂等。
5. 再检查人物/场景分域更新后的稳定 ID、造型和站位绑定；只运行对应模块及其公共依赖回归。
6. 用户确认需要真实生成时，再由用户在页面操作；开发侧只监控状态、费用和数据覆盖边界。

## 9. 家庭电脑三方复核命令

```powershell
git status --short
git fetch --all --prune
git rev-list --left-right --count HEAD...origin/codex/story-ad-systemic-remediation
node scripts/test-story-ad-release-closure.js
node scripts/test-story-ad-release-integrity.js
Invoke-RestMethod http://127.0.0.1:3007/api/story-ad/version
ssh -o BatchMode=yes vido-prod
```

期望：本地与 origin ahead/behind 为 `0/0`；本地版本为 V51；生产仍为 V51、PM2 online、restart 0、数据库 ok、活动生成 0。
