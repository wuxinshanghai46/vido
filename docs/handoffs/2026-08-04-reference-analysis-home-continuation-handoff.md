# VIDO 2026-08-04 参考分析与导演画布回家续接交接

> 生成时间：2026-08-04 17:55（Asia/Shanghai）  
> 目标分支：`codex/story-ad-v3-upgrade`  
> Git 权威远端：`origin`（Gitee）  
> 生产运行版本：`20260804-reference-sync-idempotency-v16 / reference-director-v2`

## 1. 当日目标与用户决策

今天完成的主线不是单一界面调整，而是把“参考视频理解 → 项目输入 → 人物/场景/故事 → 导演画布 → 后续生成”的可靠性闭环补齐：

1. 参考视频和链接必须生成有证据约束的深度理解，覆盖故事/展示结构、人物关系、物理场景、商品与品牌、镜头运动、声音字幕等信息。
2. 浅层机械动作串联不能冒充故事；缺少语义的结果必须被质量门拦截，不能进入人物、场景、分镜和提示词生成。
3. 普通用户遇到不合格结果时必须能对当前视频执行“重新识别”，不能依赖人工刷新、换视频或后台修数据。
4. 点击重新识别必须立即反馈，服务端后台执行；网络中断要冻结虚假耗时并自动重连，成功、失败、取消都由服务端同步权威终态。
5. 不允许为了修复状态而重复调用付费模型、覆盖用户手工目标或破坏已有项目。
6. 存储迁移和磁盘清理必须不影响平台运行；运行输出不做在线危险切换。

## 2. 修改前后的完整数据流

### 修改前

```text
用户点击重新识别
  → 浏览器等待 POST 返回后才改变界面
  → 接口同步读取/修改项目并逐项清除下游结果
  → SQLite 与约 45MB JSON 镜像双写
  → 后台分析开始，页面轮询状态
  → completed 轮询仍执行项目同步
  → 广告目标的换行与空格被误判为内容变化
  → 每轮再次增加 revision、失效 16 个下游产物并重写 JSON
  → Node 事件循环拥堵，页面出现 4~5 秒无反馈、55% 同步中断或旧进度重放
```

此外，旧质量门只检查字段和证据编号是否存在，允许机械时间线、空人物语义和重复物理场景被标记为“深度理解完成”。

### 修改后

```text
用户点击“重新识别”
  → 客户端立即显示 queued / 1% / 请求已提交
  → POST 仅返回 HTTP 202 受理结果
  → 后台按顺序撤下旧不合格投影、复用合格镜头证据并执行分析
  → SQLite 作为唯一权威存储；下游产物批量删除
  → 服务端主动同步 completed / failed / cancelled 终态
  → 浏览器只读轮询；网络中断冻结耗时并自动重连
  → 终态文本按空白归一化比较，稳定终态时间和投影指纹保证幂等
  → 已同步终态 GET 不再写项目，不再重复 revision、失效下游或调用模型
```

深度理解现在先合并逐帧证据，再校验叙事类型、故事语义、人物职责、物理场景分组、场景事件覆盖和品牌职责。展示型蒙太奇不会被强行编造成剧情因果。

## 3. 当日代码与文件变更

### 参考理解 V6 与导演画布

- `src/services/newStoryAd/referenceUnderstandingService.js`：深度理解合同、事实/推断/未知边界和语义质量门。
- `src/services/storyAdWorkspace/referenceUnderstandingConfirmationService.js`：内容版本绑定、确认门禁和零生成调用保证。
- `src/services/storyAdWorkspace/referenceUnderstandingProjectionService.js`：参考理解向项目的统一投影。
- `public/story-ad/views/referenceUnderstandingView.js`：七类深度报告和证据定位界面。
- `public/story-ad/views/workflowDirectorNodes.js`、`graphProjectionService.js`、`directorSceneService.js`：通用导演画布、同一 DirectorScene 和陈旧引用阻断。

### 重新识别、自助恢复和模型路由

- `referenceVideoAnalysisService.js`：同视频重新识别、后台调度、终态主动同步、失败/取消恢复和语义质量校验。
- `referenceDetachService.js`、`src/routes/newStoryAd.js`：撤下旧不合格投影，接口立即返回 202，轮询保持只读。
- `modelGateway.js`：近期成功模型优先，无正文 HTTP 400 分类与单模型冷却。
- `public/story-ad/store/projectStore.js`、`referenceReplacementState.js`、`briefView.js`：立即受理态、自动重连、冻结虚假计时和“重新识别”入口。

### v16 幂等同步与存储性能修复

- `referenceAnalysisTaskSyncService.js`：稳定终态字段、空白归一化、投影指纹和并发幂等。
- `contentRecordRepository.js`、`storageService.js`、`revisionService.js`、`storyAdService.js`：SQLite 批量删除下游结果，避免逐项重写旧 JSON 镜像。
- `config/story-ad-release.json`：`20260804-reference-sync-idempotency-v16`。
- `scripts/test-reference-analysis-task-sync.js`：27 项终态同步回归。
- `scripts/test-new-story-ad-storage-batch-delete.js`：14 项 SQLite/JSON 批量删除与任务隔离回归。
- `scripts/deploy-story-ad-release.js`：90 文件原子发布与服务器完整回归清单。

### 存储和服务器治理

- 历史发布备份、旧应用/输出副本和 BridgeLLM 历史备份已迁移至数据盘并校验。
- 已清理可确认无用的 Docker 镜像/构建缓存和过期系统日志；系统盘由 90% 降至 25%。
- 运行中的 `/opt/vido/app/outputs` 未做在线切换。
- 生产持久配置和 PM2 环境均为：`DB_READ_PRIMARY=true`、`DB_DUAL_WRITE=false`、`DB_JSON_FALLBACK=false`。
- 旧 JSON 镜像保留，没有删除业务数据；SQLite `/data/vido/db/vido.sqlite` 为当前权威数据库。

## 4. 当日关键提交与拉取目标

主要功能提交按时间顺序：

- `cebcd70`：参考理解 V6 与统一导演画布。
- `76905b9`：完成态服务端回写和历史进度修复。
- `56ea5bb`：拒绝浅层/机械参考理解。
- `5653896`、`8284ce0`：同视频重新识别和发布依赖闭环。
- `f6309bb`、`1bb090a`：异步受理、终态同步、轮询恢复与回归。
- `df9a8f3`：可靠语义模型候选排序与冷却。
- `5806c0b`：按钮文案简化为“重新识别”。
- `2857c6b`：终态幂等、立即受理态和批量存储删除。
- `2e25d3d`：v16 交接与验证记录。

本交接文件提交后，以回家拉取时 `git rev-parse HEAD` 的结果为准；最终交接提交号同时记录在本次交付消息中。

### 回家电脑拉取命令

先检查回家电脑是否有未提交内容：

```powershell
cd E:\AI\VIDO
git status --short
```

确认不会覆盖需要保留的改动后执行：

```powershell
git fetch --all --prune
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
npm install
npm run story-ad:release:build
npm run platform:upgrade:test
node src/server.js
```

禁止使用 `git reset --hard` 覆盖另一台电脑的未提交内容。

## 5. 本地、Git、生产三方一致性

| 核对对象 | 权威标识 | 结果 |
|---|---|---|
| 本地已提交代码 | 分支 `codex/story-ad-v3-upgrade`，核对时 HEAD `2e25d3d` | 与 origin/Gitee 一致，ahead/behind `0/0` |
| origin/Gitee | `origin/codex/story-ad-v3-upgrade` | 与本地 HEAD 一致 |
| 生产运行代码 | `20260804-reference-sync-idempotency-v16 / reference-director-v2` | 90/90 发布文件 SHA-256 一致，缺失 0、差异 0 |
| 本地开发服务 | `http://localhost:3007` | health ok，运行 v16 |
| 生产服务 | PM2 `vido`，端口 4600 | online，PID 8855 |

说明：生产采用历史 detached HEAD 加文件级原子发布，生产一致性以 90 个发布文件哈希为准，不以生产仓库 Git 元数据判断。文档提交不会部署到生产。

当前本地工作树不是完全空白，但没有未提交的运行代码、配置或测试修改。保留项包括：

- 2 个既有交接文件删除状态；
- `docs/logs/` 下 2026-08-03/04 的追加修改；
- 2 个未跟踪中文交接文档和 5 个未跟踪研究文档。

这些内容未被本次交接提交覆盖或擅自纳入。当前电脑只配置了 origin/Gitee，没有独立 GitHub remote，因此本轮未单独复核 GitHub 镜像。

## 6. 实际验证过程

### 已执行

- 本地完整 `npm run platform:upgrade:test`：退出码 0，约 202.6 秒。
- 服务器隔离完整回归：退出码 0，约 218.6 秒；真实模型调用 0。
- 参考分析同步回归：27 项通过，并发同步 12 路，模型调用 0。
- 批量存储删除回归：14 项通过，SQLite Python 驱动和 JSON 兼容镜像覆盖通过。
- 项目参考摄取回归：158 项通过；参考视频主链 197 项通过；UI 回归通过。
- 发布完整性：90/90 文件哈希一致，缺失 0、差异 0。
- PM2：`vido` online，PID 8855；核对时 uptime 约 40 分钟。
- 内网健康：HTTP 200，约 69ms；公网健康：HTTP 200，数据库状态 ok。
- 数据库：`/data/vido/db/vido.sqlite`，`SELECT 1` 健康 ok，`PRAGMA quick_check=ok`。
- 活动生成任务：0。
- 目标分析：`completed / 100% / task_sync=synced`，8/8 证据批次完成。
- 目标分析最后一次模型调用：2026-08-04 16:43:11（北京时间）；完成时间 16:43:12，完成后没有新增模型调用。
- 本轮三方只读核对触发的模型调用、媒体调用和业务写入：0。

### 未执行

- 没有为了交接再次点击真实“重新识别”，避免重复付费和覆盖现有合格结果。
- 没有重新执行人物、场景、图片或视频的真实付费生成。
- 没有独立核对 GitHub 镜像，因为本机未配置该 remote。

## 7. 剩余风险、费用和数据边界

1. 应用代码链路当前没有已知阻塞项；外部模型提供商仍可能出现令牌、限流或模型响应结构波动，这属于外部可用性风险。
2. 重新识别会调用语义模型，真实点击可能产生费用；不要为了确认按钮视觉反馈而反复点击。
3. 现有目标分析已经合格完成，不需要换视频或再次重新识别。
4. 旧 JSON 镜像只作为历史兼容数据保留，不应重新开启双写后长期运行；SQLite 是权威源。
5. 本地保留的未提交文档和删除状态属于用户既有工作。回家电脑拉取前也必须先检查自己的工作树，不能硬重置。

## 8. 回家后继续优化的建议顺序

1. 拉取后先核对版本接口：本地应为 `20260804-reference-sync-idempotency-v16 / reference-director-v2`。
2. 只读打开当前家具参考任务，确认页面直接显示 completed/100%、深度报告和自动广告目标，不重新播放进度。
3. 用 mock/测试任务测量“点击 → queued/1%”的浏览器首帧反馈，目标是同步可见，不发起真实付费识别。
4. 检查深度报告的人物、物理场景、品牌职责、镜头和提示词投影质量；优先修证据到语义的映射，不做末端文案兜底。
5. 再优化导演画布中 ReferenceUnderstanding → 人物/场景 → DirectorScene → ShotReferencePack 的可视追踪和陈旧引用提示。
6. 最后再决定是否进行一条受控、低成本的真实新视频识别；执行前记录任务 revision 和模型调用计数，避免重复计费。

## 9. 最小续接核对

```powershell
git status --short
git rev-parse HEAD
git rev-list --left-right --count HEAD...origin/codex/story-ad-v3-upgrade
Invoke-RestMethod http://localhost:3007/api/story-ad/version
Invoke-RestMethod https://vido.smsend.cn/api/story-ad/version
```

预期：Git `0 0`；本地与生产均为 `20260804-reference-sync-idempotency-v16 / reference-director-v2`。
