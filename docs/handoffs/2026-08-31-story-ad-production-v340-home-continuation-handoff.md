# 2026-08-31 剧情广告 V340 回家续接交接

> 交接时间：2026-08-31 18:10（Asia/Shanghai）
>
> 当前分支：`codex/story-ad-systemic-remediation`
>
> 应用封装提交：`d5318cd45d51fa7d384e4931594629af5024f386`
>
> 应用源码提交：`608f2fc1a858ef1f095e32e7ea37dd5a96a7c4e7`
>
> 生产版本：`20260831-production-v340`
>
> 生产制品：`844d165ec0be6c8979f93b565cfd19e43d899477093bc0c7bc76e38ea3fff7c3`

## 1. 当日目标与用户最终决策

今天从 V318 基线继续处理生产问题，最终确认的产品合同如下：

1. 供应商排行与模型质量是两层策略：先按供应商顺序降级，每个供应商内部再按具体环节选择最合适的模型，禁止把一个理解能力较弱的模型固定覆盖所有阶段。
2. 当前剧情广告供应商顺序为 `SZ → 微众（Webang MaaS）→ 漫路（DeyunAI）→ DeepSeek（AIAPI）`；ApiSmile 停用。
3. SZ 总开关开启时，其目录内启用模型才允许参与路由；供应商关闭时，该供应商所有模型都必须在提交前被阻断。
4. 模型调用管理是当前 40 个文本/VLM 阶段路由的唯一管理入口；监控页必须同时读取剧情广告权威调用账本，调用记录默认每页 20 条并支持真实分页。
5. 分镜场景顺序必须服从剧本/剧情流合同，不能因数组顺序、局部关键词或历史缓存再次出现“客厅/家居展示厅与商业展台”倒序。
6. 已有 7/7 分镜图片时允许用户确认进入下一步；需要复核的旧血缘/QA 状态只提示逐镜调整，真实缺图才阻断。
7. 提示词编辑要全宽、长文本可读，刷新页面后不得恢复拥挤布局；保存不能等待整页刷新。
8. 总进度与单镜进度必须同源；确认分镜后必须读取服务器最新导航状态并直接进入下一步。
9. 超管和被授予剧情广告 `view_errors` 权限的角色可以看到具体错误；普通用户仍只看脱敏提示。
10. 声音页由系统逐镜默认选择声音类型和搜索词，用户只需试听、选择其他声音或上传自己的素材；试听不自动导入、不产生绑定。
11. 关键帧模型真实名称显示为 `Image-2`，默认 `Image-2 · SZ`；内部执行路由为 `smscrw/gpt-image-2`。
12. 当前电脑发布只运行任务影响域内门禁，不因剧情广告局部改动默认运行全平台完整回归。

## 2. 今天完成的更新

### 2.1 模型监控、调用分页与剧情顺序（V319–V326）

- 新剧情广告权威调用账本已合并到模型监控，不再只读取旧 `token_usage.json`。
- 调用记录默认每页 20 条，支持上一页/下一页和日期、厂商、模型、Agent、状态筛选；当时生产 38 条记录验证为 20/18 两页。
- 剧情场景顺序增加单向动态规划和合同硬门禁，禁止局部关键词把已确认顺序重新解释为反向或重复回访。
- 对目标项目执行零模型、零费用的受控顺序修复，使家居展示厅镜头在前、商业展台镜头在后，并同步镜头图索引和关键帧合同。
- 首屏和按需模块进一步拆分，发布夹具迁移到当前新合同。

### 2.2 供应商优先级与环节模型质量策略（V327–V333）

- 40 个剧情广告文本/VLM 阶段按四种能力档分配模型：
  - 创作推理：SZ Claude Opus 4.8 优先，随后微众 GPT-5.6 Sol、漫路 Claude Opus 4.7、DeepSeek。
  - 结构推理：SZ Claude Opus 4.8 优先，随后微众 GPT-5.6 Terra、漫路 Claude Opus 4.7、DeepSeek。
  - 快速语言：SZ Gemini 2.5 Flash 优先，随后微众 GPT-5.6 Luna、漫路 Claude Sonnet 4.6、DeepSeek。
  - 视觉质量：SZ Claude Opus 4.8 优先，随后微众 Gemini 2.5 Pro、漫路 Claude Opus 4.7。
- 生产模型调用管理 40/40 阶段读回差异为 0；发布器每次幂等同步完整路由，旧 assist 单点迁移不能再覆盖全局策略。
- SZ、微众、漫路、DeepSeek 总开关启用；ApiSmile 关闭并从当前剧情广告候选中移除。
- 分镜卡“放大编辑”改为小图标，操作按钮平铺；7/7 已完成图片允许确认进入下一步。
- 发布影响域规划器把剧情广告局部 UI、内容、资产和系统安全分开，未知共享平台改动仍保留完整平台回退。

### 2.3 提示词编辑、保存和进度（V334–V338）

- 放大编辑弹窗由左右拥挤分栏改为引用资产横向置顶、提示词全宽置下；卡片内提示词同步增加高度、间距和行距。
- 布局选择器覆盖全部分镜卡和弹窗，刷新页面仍加载相同版本化 CSS，不再恢复旧 300px 左栏。
- 保存成功后只做后台定向刷新，不再让用户等待整页工作台重新加载。
- 批次总进度和单镜进度统一使用服务端 `completed_indexes`，旧图片不再被误算成本轮完成。
- AI 帮写升级为“诊断并改写”：使用当前未保存草稿、用户要求、前后镜头和引用资产，返回冲突、修改点与下一步；默认建议只重生成当前镜头。
- “确认分镜，进入视频生成”移动到“全部重新生成”旁；移除没有具体操作价值的黄色复核提示和旧底部确认条。

### 2.4 确认后导航（V339）

- 根因是确认保存使用 `skipRefresh`，路由立即读取了旧 `navigation.final.enabled=false`。
- 现在确认动作保存后重新读取服务器 `summary/navigation`，确认下一步已解锁再跳转；不再依赖刷新页面。

### 2.5 错误详情、声音默认推荐和 Image-2（V340）

- 新增统一错误权限服务；项目 bundle 和任务诊断接口不再硬编码只有角色名 `admin` 可见。
- 超管或具有 `enterprise:luxury_ad_pipeline_debug:view_errors` 权限的角色可查看错误码、原始错误、失败阶段、阶段状态和支持编号。
- 顶部生成失败进度和人物方案失败区域都增加“查看具体错误”；普通用户投影继续脱敏。
- 声音设计服务逐镜生成 `recommended_track_type` 与 `recommended_query`；前端默认带出类型和搜索词。
- 用户点击“试听推荐”只搜索和播放，不下载、不绑定；点击“使用这个声音”后才核验许可并写入镜头声音时间线。上传自己的素材仍作为替代入口。
- 关键帧公开名称由 `Image` 统一修正为 `Image-2`；页面默认显示 `Image-2 · SZ` 并增加明确操作说明。
- 最终页面步骤说明与当前六步导航统一，不再把最后阶段写成第 7 步。

### 2.6 今日 SZ 失败调用证据

今日生产 SZ 只有 1 次调用：成功 0、失败 1。

| 项目 | 阶段 | 模型 | 时间（北京时间） | 响应 | 计费 |
|---|---|---|---|---|---|
| 佛山智造 · 不锈钢品牌广告 | `new_story_ad.storyboard_image` | `smscrw/gpt-image-2` | 16:30:56 | HTTP 403，669ms | `not_billed`，0 美元 |

供应商错误为 `insufficient_user_quota`：组织额度不足（`balance=1089`、`credit=0`、`delta=-17237`）。这不是 600 秒超时；请求约 0.67 秒即被拒绝。供应商请求 ID 已保存在权威调用账本和后台错误详情中，本交接不重复写入外部凭证。

在 SZ 额度补充或供应商确认前，不要重复点击 `Image-2 · SZ` 生成关键帧。图片生成遵循用户显式选择的单路线合同，不会在一次付费提交失败后自动切换供应商。

## 3. 修改前后的完整数据流

### 3.1 模型调用策略

修改前：

```text
阶段固定首选 SZ/Claude Sonnet 4.6
→ 供应商排行被误当成模型质量
→ GPT-5.6、Claude Opus 4.7/4.8、Gemini 无法按能力进入不同环节
→ 新剧情广告调用只写权威账本
→ 模型监控只读旧 token JSON，页面显示 0
```

修改后：

```text
当前业务阶段
→ 识别能力档（创作 / 结构 / 快速语言 / 视觉）
→ 按 SZ → 微众 → 漫路 → DeepSeek 的供应商顺序
→ 每家供应商选择该能力档最适合的一个启用模型
→ 厂商总开关、模型开关、API 配置和熔断状态预检
→ 调用并写入剧情广告权威账本
→ 统一投影到模型监控与分页调用记录
```

### 3.2 分镜顺序、提示词和确认

修改前：

```text
剧本 / 历史 story flow / 场景数组
→ 局部关键词或旧缓存可重新颠倒场景顺序
→ 提示词弹窗左右挤压
→ 保存等待整页刷新
→ 单镜进度与批次进度来源不同
→ 确认后立即读取旧导航状态，错误提示未完成
```

修改后：

```text
剧本地点访问顺序
→ story_flow_contract 顺序、节点、场景和指纹硬校验
→ storyboard_table 与图片 lineage
→ 全宽提示词编辑 / AI 诊断草稿 / 用户保存
→ async_start + target_indexes
→ 服务端 completed_indexes 同步总进度与单镜进度
→ 7/7 图片允许确认，真实缺图才阻断
→ 保存后读取最新 summary/navigation
→ 直接进入声音、视频与合成
```

### 3.3 最终媒体与错误详情

```text
已确认黑白分镜
→ 默认 Image-2 · SZ（smscrw/gpt-image-2）
→ 用户点击生成关键帧
→ 关键帧完成后选择视频模型并进入视频生成

逐镜声音描述
→ 系统默认声音类型和搜索词
→ 用户试听推荐或搜索其他声音
→ 用户明确点击“使用这个声音”
→ 服务端核验 CC0 / PDM / CC BY、下载、哈希和署名
→ 绑定 shot_id / scene_id 声音时间线

生成失败
→ 服务器保存完整诊断
→ 普通用户安全脱敏
→ 超管或 view_errors 授权角色读取原始错误、阶段和支持编号
```

## 4. 主要代码与文件变更

### 模型管理与监控

- `src/services/modelUsageLedgerService.js`
- `src/services/tokenTracker.js`
- `src/services/newStoryAd/modelRoutingPolicyService.js`
- `src/services/newStoryAd/modelGateway.js`
- `src/services/pipelineModelService.js`
- `src/routes/admin.js`
- `public/js/admin-vue-content-monitor.js`

### 剧情顺序、分镜和提示词

- `src/services/storyAdWorkspace/storyFlowContractService.js`
- `src/services/storyAdWorkspace/storyboardImageConfirmationGateService.js`
- `src/services/storyAdWorkspace/storyboardPromptAssistService.js`
- `public/story-ad/views/storyboardView.js`
- `public/story-ad/views/storyboardPromptEditorDialog.js`
- `public/story-ad/storyboard-simple.css`

### 错误权限、声音和最终媒体

- `src/services/newStoryAd/storyAdErrorPermissionService.js`
- `src/services/storyAdWorkspace/projectBundleService.js`
- `src/routes/newStoryAd.js`
- `public/story-ad/components/ui.js`
- `public/story-ad/views/assetCenterTechnicalDetails.js`
- `src/services/newStoryAd/soundDesignAssetService.js`
- `public/story-ad/views/finalSoundDesignView.js`
- `src/services/newStoryAd/mediaGenerationModelSelectionService.js`
- `public/story-ad/views/generationModelPicker.js`
- `public/story-ad/views/finalView.js`
- `public/story-ad/workspace-ux.css`

### 发布与定向回归

- `scripts/lib/storyAdReleaseGatePlanner.js`
- `scripts/check-story-ad-workspace-v6-boundaries.js`
- `scripts/test-story-ad-quality-supplier-routing-v327.js`
- `scripts/test-story-ad-role-safe-diagnostics-v193.js`
- `scripts/test-story-ad-workflow-scene-sound-v197.js`
- `scripts/test-story-ad-public-media-model-catalog-v262.js`
- `scripts/test-story-ad-user-selected-media-model-v257.js`
- `scripts/test-story-ad-storyboard-prompt-editor-ui-v314.js`

## 5. 提交记录与回家拉取

从上一份 V318 交接的应用提交到 V340 封装提交共有 48 个提交。关键锚点如下：

| 提交 | 内容 |
|---|---|
| `ca52586f` | 模型监控统一账本、分页与剧情顺序修复 |
| `f5e61491` | V319 封装 |
| `98970441` | 工作台首屏体积优化 |
| `f61b3e09` | V326 封装 |
| `ee0aa1f1` | 供应商排行与环节模型择优 |
| `c13a1937` | 环节感知供应商降级与运行时合同 |
| `17358a9d` | SZ 第一优先、完成分镜允许确认 |
| `91252be0` | V333 封装 |
| `dbda803a` | 分镜提示词全宽布局 |
| `7410c433` | V335 封装 |
| `8d458fe9` | 提示词快速保存、进度和 AI 诊断 |
| `fa4c4692` | V338 封装 |
| `4a4d066a` | 确认后读取最新导航并跳转 |
| `f429d098` | V339 封装 |
| `608f2fc1` | 错误权限、声音推荐和 Image-2 命名 |
| `d5318cd4` | V340 不可变封装 |

回家电脑执行：

```powershell
cd D:\VIDO
git status --short
git fetch origin --prune
git switch codex/story-ad-systemic-remediation
git pull --ff-only origin codex/story-ad-systemic-remediation
git rev-list --left-right --count HEAD...origin/codex/story-ad-systemic-remediation
npm install
$env:PORT='3007'
node src/server.js
```

预期 `ahead/behind` 为 `0/0`。执行 `git pull` 前若 `git status --short` 非空，先保留并核对回家电脑自己的未提交修改，禁止使用 `git reset --hard` 覆盖。

## 6. 本地、Git、生产三方一致性

| 核对项 | 证据 | 结论 |
|---|---|---|
| 本地分支 | `codex/story-ad-systemic-remediation` | 正确 |
| 本地/Gitee HEAD | `d5318cd45d51fa7d384e4931594629af5024f386` | 交接文件提交前一致；ahead/behind `0/0` |
| 本地工作树 | 交接前干净；随后仅新增本交接文件 | 提交推送后再次核对 |
| 本地运行版本 | V340，artifact `844d165e...fff7c3`，runtime hash `b7b50cc9...86a0c` | health=ok，release allowed=true |
| 生产运行版本 | V340，同一 artifact、runtime hash、bundle ID | 与本地构建一致 |
| 生产源码身份 | `608f2fc1...`，source tree `84e15484...` | 与 V340 清单一致 |
| 生产文件哈希 | 946/946 逐文件重算，mismatch 0 | 一致 |
| PM2 | `vido` online，PID 20661，restart 0 | 正常 |
| 内网健康 | `127.0.0.1:4600/api/health` → ok | 正常 |
| 公网健康 | `https://vido.smsend.cn/api/health` → ok | 正常 |
| SQLite | `/data/vido/db/vido.sqlite` quick_check=ok | 正常 |
| 活动生成 | 0 | 无运行中生成 |
| 历史 unknown 计费 | 68，活动 unknown=0 | 保持隔离，未激活 |
| V340 上线后模型调用 | 0；成功 0、失败 0、成本 0 | 无模型/图片/视频调用 |

生产在 V340 上线后发生 1 次工作流画布布局保存，并产生对应 output、artifact、manifest 三条权威记录；这是零模型的布局坐标持久化，不是剧情、图片或视频生成。模型调用、图片数量、视频秒数和费用均为 0。

本地 Node 为 v24.13.1，生产固定 Node 为 v20.20.2；运行制品、代码与合同一致，但回家电脑建议使用 Node 20.20.2 以匹配生产。

## 7. 实际验证、未执行项与风险

### V340 实际执行

- 错误权限/脱敏回归：31 项通过；超管、授权角色和普通用户三种投影均覆盖。
- 声音建议、试听不绑定、显式绑定和 Image-2 操作说明回归：通过。
- 媒体模型公开目录：8 个图片阶段、6 个图片选择、3 个视频选择通过；默认 `Image-2 · SZ`，实际路由 `smscrw/gpt-image-2`。
- 用户显式媒体模型选择回归：通过；自动模型切换 0。
- 工作台体积门禁：通过；核心 gzip 105232 bytes，低于 105 KiB 上限；声音设计单独进入按需模块门禁，没有提高核心上限。
- 影响域发布门禁：`systemic`、`asset_plan`、`workspace_ui`、`release_core` 全部通过。
- 生产候选 947 个文件上传/复用并完成切换；上线后再次重算运行清单 946 个文件，缺失/哈希差异 0。
- 生产 health、public health、SQLite、PM2、活动任务和调用账本只读核对通过。

### 今天早些时候执行

- V326 曾执行完整 V6、系统级、全平台跨版本、发布核心和黄金合同；10,000 固定种子、400 组变形和 50 并发通过，真实/付费模型调用 0。
- V332 生产 40 个模型调用管理阶段读回差异 0。
- V333、V335、V338、V339 均通过各自影响域门禁和发布后健康核对。

### V340 未执行项

- 未重新运行无关的 `platform:upgrade:test`、`story-ad:v2:test`、`story-ad:v3:test`、`story-ad:v6:test` 完整回归；原因是当前电脑按用户决定只执行本次错误权限、声音、模型目录和相邻资产/工作台影响域门禁。
- 没有为了验证错误详情而人为制造生产失败；权限逻辑、脱敏投影和生产静态代码读回已验证，但超管浏览器端仍可用今天已有的 SZ 失败记录做一次零费用查看确认。
- 没有再次提交 `Image-2 · SZ` 关键帧；SZ 当前额度不足，重复提交可预见会再次 403。

### 剩余风险

1. SZ 组织额度未补充前，用户显式选择 `Image-2 · SZ` 会快速返回 403；当前证据显示不计费，但不要无意义重复提交。
2. 68 条历史 unknown 计费继续隔离且均非活动；未经人工对账不要批量清除或自动重试。
3. Openverse 是外部搜索源；搜索或试听失败时应允许用户修改关键词或上传自己的素材，不能自动导入来源不明音频。
4. “重置布局”的实际作用仍是清除工作流画布保存坐标/缩放并恢复自动布局；文案和按钮是否需要更直白尚未修改。
5. 工作流画布仍会展示所有权威资产图片；“导演动画”实际表示人物/相机运动轨迹计划，零轨迹场景可能显示空占位。该命名和展示密度仅完成根因核对，尚未优化。

## 8. 回家后继续优化的建议顺序

1. 先按第 5 节命令拉取，确认 HEAD 为远端最新交接提交、工作树干净、本地 V340 health=ok。
2. 在后台检查 SZ 额度；额度未恢复时不要测试 `Image-2 · SZ`，如必须继续则由用户明确选择其他图片供应商。
3. 用超管或授予 `view_errors` 的测试角色打开今天 SZ 失败项目，确认顶部“查看具体错误”能读到 HTTP 403、阶段和支持编号；不要制造新失败。
4. 继续优化工作流画布：把“重置布局”改为更明确的“恢复自动布局”，把“导演动画”改为“人物与机位运动计划”，并对零轨迹节点隐藏空占位。
5. 根据用户反馈继续收敛声音页：验证每个镜头默认类型/关键词是否合理、试听播放器在不同屏幕宽度下是否清晰；不自动绑定。
6. SZ 额度恢复后，再由用户明确点击生成关键帧；先做单镜验证，核对模型、费用预检、错误详情和关键帧输出，再决定是否批量生成。

## 9. 安全边界

- 本交接没有包含服务器密码、API Key、Token、SSH 私钥或数据库凭证。
- 回家电脑必须使用自己的 SSH 私钥授权，不能通过 Git 复制公司电脑私钥。
- 本轮三方核对和交接生成均为只读生产检查；除一次工作流布局保存外，V340 上线后没有模型、媒体或付费调用。
