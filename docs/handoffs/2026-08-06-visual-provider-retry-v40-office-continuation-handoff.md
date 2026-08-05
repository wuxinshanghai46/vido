# VIDO v40 视觉资产失败恢复与公司续测交接

> 交接时间：2026-08-06 00:38（Asia/Shanghai）
>
> 目标分支：`codex/story-ad-v3-upgrade`
>
> 生产版本：`20260805-visual-retry-consent-v40 / reference-director-v4`
>
> 生产主机：`43.98.167.151`（`/opt/vido/app`，PM2 `vido`，端口 `4600`）

## 1. 当日目标与用户决策

本轮（8 月 5 日晚至 8 月 6 日凌晨）围绕“视觉资产生成失败后为什么反复出问题、能否安全重试”完成根因闭环、生产发布和一次用户明确授权的受控实测。

- 用户明确同意过一次“可能重复计费”的补缺重试；系统只消费了一次授权。
- 受控实测复用了已成功的 6 项人物资产，没有覆盖成功结果。
- 配饰生成再次收到图片供应商 HTTP 500，内部码 `image2O100IFR`；系统立即停止并重新锁定，没有自动第三次提交。
- 用户已确认明天到公司继续测试。继续付费图片测试前，必须先核对供应商账单和通道状态；不能直接再次点击旧任务的“接受费用风险并继续缺失项”。

## 2. 已确认事实、代码根因与外部推断

### 已确认事实

- 旧任务 `b7585e36-4e3a-4b0d-a9ef-f524c0359cc0` 当前为 `failed / visual_assets_failed`，活动 generation 为空。
- generation 支持编号为 `46ac8350-a77b-49f2-be81-548304ca6ecf`，开始于 `2026-08-05T16:07:40Z`，结束于 `2026-08-05T16:10:14Z`。
- 6/19 项资产已保留；人物/动物分支 6/8，场景分支 0/11。
- 本次授权只新增 1 次模型调用，任务模型调用总数由 8 变为 9；失败后没有继续调用。
- 图片供应商 `deyunai/gpt-image-2` 再次返回 HTTP 500、内部码 `image2O100IFR`，没有可用于确认计费的供应商任务 ID，当前 `billing_state=unknown`。
- 场景分支在调用图片模型前就因 `scene_prompt_1` 缺少 `materialLightText` 失败，因此该分支没有产生图片调用费用。

### 已修复的代码根因

1. 失败恢复原来没有把主体与场景分支的终态、检查点和计费状态完整隔离，容易把局部失败放大为整体重跑风险。
2. 一次性费用授权完成后，若供应商再次返回未分类 5xx，前端只看顶层状态时可能无法持续展示计费未知锁定。
3. 场景合同自动补齐器虽然存在，但严格解析在它之前就拒绝了缺字段合同，导致补齐路径不可达。
4. 首次 v38 发布候选触发了前端文件 600 行边界门禁；已通过职责拆分修复，而不是放宽门禁。

### 尚不能下结论的外部问题

- 两次相同 HTTP 500 足以确认当前图片供应通道不可靠，但仅凭平台响应不能判定是供应商内部服务故障、审核拦截还是账户/路由问题。
- 是否产生了供应商侧重复计费，必须查供应商账单或由供应商按支持编号/时间窗口确认；平台没有收到供应商任务 ID，不能代替账单结论。

## 3. 修改前后的完整数据流

### 修改前

`用户点击补生成` → `前端直接续跑缺失项` → `主体/场景并发生成` → `供应商 5xx 或场景合同缺字段` → `整体失败状态聚合` → `前端依据不完整的顶层错误显示入口`。

风险点：成功资产可能面临重复提交，费用未知授权缺少一次性消费语义；分支失败状态不够独立；场景补齐器在严格解析之后，实际无法到达。

### 修改后

`用户查看失败任务` → `API 读取任务、分支 checkpoint 与 billing_state` → `若计费未知则保持锁定` → `用户明确授权一次` → `服务端原子消费一次性授权` → `只恢复缺失项并复用成功资产` → `主体/场景分支分别记录终态` → `任何再次计费未知立即重新锁定` → `持久化 checkpoint/审计信息` → `API/UI 显示可核对状态`。

场景生成的专用路径为：`读取 scene_spec` → `生成服务显式允许不完整输入进入补齐器` → `补齐缺字段` → `再次通过完整场景合同严格门禁` → `才允许调用图片供应商`。常规解析路径仍保持严格，不会把不完整合同静默放行。

## 4. 主要优化与文件变更

### 视觉失败隔离与恢复

- `src/services/newStoryAd/visualAssetOrchestrationService.js`：主体与场景分支独立编排、独立终态，保留成功资产并限制失败扩散。
- `src/services/newStoryAd/visualAssetProgressService.js`：统一分支进度、失败阶段和计费状态聚合。
- `src/services/newStoryAd/assetGenerationCheckpointService.js`：补齐生成检查点与恢复边界，避免同一成功单元重复提交。
- `src/services/newStoryAd/subjectAssetBundleService.js`、`dossierCompositeService.js`：人物资产失败隔离与部分成功复用。
- `src/services/newStoryAd/mediaAdapter.js`：识别供应商未分类 5xx 为 `PROVIDER_5XX_AMBIGUOUS`，不再自动付费重试。

### 一次性费用风险授权

- `src/services/newStoryAd/visualAssetBillingAuthorizationService.js`：新增一次性授权、原子消费、generation 绑定与审计语义。
- `src/routes/newStoryAd.js`：增加授权 API，并在服务端强制校验任务/代次/费用状态，不能只靠前端按钮。
- `public/story-ad/views/assetCenterBillingRetry.js`：独立费用风险 UI 模块；再次 5xx 后同时读取整体和主体分支的 `billing_state=unknown` 并重新锁定。
- `public/story-ad/views/assetCenterView.js`：只负责资产中心编排；拆分后重新满足 600 行边界门禁。

### 场景合同补齐路径

- `src/services/newStoryAd/sceneBindingService.js`：常规解析保持严格；仅显式生成预检允许缺字段进入补齐阶段。
- `src/services/newStoryAd/sceneAssetService.js`：执行自动补齐，完整合同复验通过后才调用图片。
- `scripts/test-new-story-ad-generation-spec-completion.js`：覆盖严格默认、显式补齐入口、补齐后再验证。

### 回归与发布

- `scripts/test-new-story-ad-visual-asset-failure-recovery.js`：覆盖分支隔离、成功资产复用、计费未知、一次性授权、再次锁定和并发恢复边界。
- `scripts/test-story-ad-visual-assets-sync-v21.js`：覆盖前端授权入口和再次锁定显示。
- `scripts/check-new-story-ad-dossier-boundaries.js`：继续执行文件职责/行数门禁。
- `config/story-ad-release.json`、`public/story-ad/release-manifest.json`：发布升级到 v40，运行发布清单共 144 个文件。

## 5. 提交记录与公司电脑续接命令

本轮关键提交（从旧到新）：

- `d954649f` `fix: isolate visual asset provider failures`
- `f3cde416` `fix(story-ad): authorize one-time billing-unknown retry`
- `5ab48a85` `fix(story-ad): split billing retry UI boundary`
- `cf4ef33c` `fix(story-ad): keep billing lock and reach scene completion`
- `c6b9d00d` `docs(logs): record visual retry v40 deployment`
- 本交接文档提交：以公司电脑拉取后的分支最新 HEAD 为准；其父代码基线为 `c6b9d00d`。

公司电脑先检查工作树，不能用 `git reset --hard` 覆盖未提交文件：

```powershell
git status --short
git fetch --all --prune
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
git status --short
npm install
npm run platform:upgrade:test
node src/server.js
```

本地访问地址：`http://localhost:3007`。

如需核对生产 SSH，使用公司电脑自己的密钥：

```powershell
ssh -o BatchMode=yes vido-prod
```

## 6. 本地、Git、生产三方一致性

| 核对项 | 本地 | Git 远端 | 生产 | 结论 |
|---|---|---|---|---|
| 分支/代码基线 | `codex/story-ad-v3-upgrade`，交接前 HEAD `c6b9d00d` | `origin`、`gitee`、`github` 均为 `c6b9d00d`，ahead/behind `0/0` | 生产采用文件级原子发布，不以 detached Git HEAD 为准 | 本地与三远端一致 |
| 运行版本 | `20260805-visual-retry-consent-v40 / reference-director-v4` | v40 发布文件已提交 | 同版本 | 一致 |
| 运行文件 | 本地发布清单 144 个文件 | 发布清单已入库 | 144/144 SHA-256 核对，差异 0 | 一致 |
| 服务状态 | `http://127.0.0.1:3007/api/health` 为 `ok` | 不适用 | PM2 `vido` online；内网/公网 health 均 `ok` | 正常 |
| 数据库 | 开发环境数据库禁用（预期） | 不适用 | 数据库 `ok`；SQLite `PRAGMA quick_check` 为 `ok` | 正常 |
| 活动生成任务 | 本轮未触发 | 不适用 | `active_count=0` | 无后台续跑 |
| 交接文档提交 | 本文件已提交 | `origin/gitee` 已同步最新 HEAD；GitHub 443 当前不可达 | 不属于生产运行清单 | 主远端已同步，GitHub 文档镜像待补 |

注意：交接 MD 是文档，不属于生产 144 个运行文件。交接文档提交推送后，Git HEAD 会比生产历史仓库提交多一个纯文档提交，但本地与生产的运行代码仍以 144/144 哈希一致为准。

## 7. 实际执行的验证

### 静态与定向回归

- JS 语法/发布文件校验已通过。
- 视觉资产失败恢复定向回归通过：覆盖部分成功保留、供应商失败隔离、一次性费用授权、幂等消费、再次 5xx 重新锁定。
- 场景合同补齐定向回归通过：覆盖严格默认、显式补齐、补齐后完整合同门禁。
- 前端视觉资产同步回归通过；`assetCenterView.js` 拆分后恢复 600 行边界门禁。

### 完整回归与部署

- 本地 `npm run platform:upgrade:test`：退出码 0，用时约 297.7 秒，真实模型调用 0。
- 服务器 `npm run platform:upgrade:test`：退出码 0，真实模型调用 0。
- v40 已原子发布；生产备份为 `/opt/vido/backups/story-ad-20260805-visual-retry-consent-v40-20260805161958`。
- 发布后 144/144 文件哈希一致，PM2、内外网健康、数据库和 SQLite 均正常，活动任务 0。

### 交接前再次只读核对（2026-08-06 00:38）

- `git fetch --all --prune` 后，本地与 `origin/gitee/github` 的 `c6b9d00d` 均为 ahead/behind `0/0`。
- 生产 144 个运行文件 SHA-256 差异为 0。
- PM2 `vido` 为 online；内网和公网 `/api/health` 均为 `ok`；数据库为 `ok`；SQLite quick check 为 `ok`。
- 活动生成任务为 0；本次核对触发模型/媒体调用 0，业务写入 0。
- 旧任务仍为 failed，无活动 generation，成功的 6 项资产仍保留。
- 交接提交后再次 fetch：本地、`origin`、`gitee` 均为最新 HEAD，ahead/behind `0/0`。GitHub 连续三次因连接重置/443 不可达而无法推送；其最后可核对跟踪引用仍停在 `c6b9d00d`，仅缺本交接纯文档提交，不缺 v40 运行代码。

## 8. 未执行项、剩余风险与费用边界

### 未执行项

- 未再次调用 `deyunai/gpt-image-2`：当前通道已经连续出现相同 500，且计费状态未知，再次调用有可预见的重复付费风险。
- 未取得供应商内部日志和账单：平台没有权限代查，必须在供应商后台或由供应商支持确认。
- 未在公司电脑执行拉取和全量回归：需明天在公司电脑实际执行本文件命令。
- GitHub 镜像未同步本交接纯文档提交：本机到 `github.com:443` 当前不可达；主远端 `origin/gitee` 已同步，明天网络恢复后补推即可。

### 剩余风险

- 代码修复已阻止自动重复调用，但不能修复外部供应商的 500 服务故障。
- 旧任务的配饰失败处于 `billing_state=unknown`；在账单未确认前不要再次授权。
- 场景补齐代码已部署并通过无真实模型回归，但真实图片生成仍依赖供应商通道；需通道恢复后用单场景低成本验证。
- 工作树中有 5 个用户原有未跟踪文档，本轮未纳入提交、未修改、未删除。

## 9. 明天继续的明确入口和顺序

1. 在公司电脑执行第 5 节续接命令，确认分支最新、全量回归退出 0、本地 health 为 `ok`。
2. 登录图片供应商后台，按 `2026-08-05 22:26` 与 `2026-08-06 00:10`（北京时间）附近记录核对账单、失败请求和通道状态；必要时向供应商提供平台支持编号，但不要传 API Key。
3. 若供应商无法确认稳定，先配置并验证另一条图片供应通道；只做健康探测/最小样例，不直接重跑 19 项联合任务。
4. 通道与费用确认后，新建受控测试任务，先单独生成 1 个低成本人物/配饰单元，核对模型调用数、checkpoint 和账单。
5. 再通过“查看 / 单独生成场景”只生成 1 个场景，确认 `scene_spec 补齐 → 完整门禁 → 图片调用` 数据流。
6. 单项成功且账单一致后，才扩大到剩余缺失项；每一步先确认旧成功资产未被覆盖、活动 generation 已清零。

当前结论：**本地、主 Git 远端与生产运行代码已一致；GitHub 仅待补一个交接文档镜像。付费图片生成仍不可直接继续，必须先解决或替换供应商通道，再进行单项受控测试。**
