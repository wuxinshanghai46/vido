# 2026-08-28 剧情广告场景资产持久化、并发进度与布局修复交接

> 日期：2026-08-28  
> 生产主机：`43.98.167.151`  
> 生产版本：`20260828-production-v246`  
> 目标任务：`b83fa67c-244a-4869-b3cc-df282fad5c59`

## 1. 当日目标与用户决策

- 修复旧场景资产被误删、页面仍显示浏览器缓存图而服务端文件已经不存在的问题。
- 修复多个场景并行修复时共用一份进度，导致 0/1、1/1、完成/失败互相覆盖的问题。
- 修复双场景卡片窄宽度下说明文字被挤成单字竖排、控件错位的问题。
- 保留场景空间、人物站位与机位能力；机位继续在当前窗口直接切换，不另开图片窗口。
- 完成 Git、本地、生产三方核对，并把本轮变更发布生产后形成交接文件。
- 不替用户自动重新生成已丢失图片：重新生成会产生新的图片模型调用和费用，必须由用户在页面明确触发。

## 2. 根因与修改前后的完整数据流

### 2.1 旧资产持久化

修改前：

1. 场景图片生成时使用带 `_candidate_` 的文件名。
2. 场景正式发布后，数据库中的 `scene_assets` 已引用这些文件，但文件名仍保留 candidate 标记。
3. 后续 checkpoint 清理只按文件名判断临时候选，未读取正式资产引用，误删了已经发布的图片。
4. 浏览器缓存仍可能显示旧图，服务端实际访问已经是 404；空间/机位界面因此表现为时有时无。

修改后：

1. 清理 checkpoint 前，从正式 `scene_assets` 和 `context` 收集所有已发布文件名。
2. 已被正式数据引用的文件进入保护集合，即使文件名含 `_candidate_` 也禁止删除。
3. 工作台投影时检查本地文件真实存在性；文件不存在就不再投影为成功资产，而是进入 `missing_file_view_keys` 和真实修复计划。
4. 已存在的旧资产继续展示；已丢失的旧资产明确显示为待补齐，避免浏览器缓存制造假成功。

### 2.2 并发进度隔离

修改前：

1. 所有场景共写任务级 `generation_progress`。
2. 两个场景并发时，后写入者覆盖前一个场景的进度、失败详情和完成状态。
3. 页面可能出现总进度 100% 但成功 0、失败 1，或一个场景完成让另一个仍运行的场景提前显示完成。

修改后：

1. 每个场景按 `scene_asset:<sceneId>` 写入独立的 `target_generation_progress` lane。
2. 任务级进度只做聚合；任一 lane 仍运行时，全局不会提前完成。
3. 直接调用场景维护/修复服务时，也会继承唯一场景 lane，不丢失 `scene_id`、验证阶段和断点信息。
4. 前端 store 同时保留任务聚合进度与各场景独立进度，旧单场景读取保持兼容。

### 2.3 场景卡响应式布局与空间/机位

修改前：场景卡双列时底部说明、画质、分辨率和修复按钮挤在同一行，说明列宽被压到单个汉字，形成竖排错位。

修改后：底部操作区改为可换行的一列网格，说明文字允许正常折行，控件组独立换行；窄卡和窄屏不会再产生单字竖排。场景世界仍使用场景实拍图作为空间背景，人物站位和机位缩略图继续存在，机位点击在当前窗口切换。

## 3. 代码和文件变更

- `src/services/newStoryAd/sceneAssetFileIntegrityService.js`：新增正式资产文件存在性和保护集合服务。
- `src/services/newStoryAd/targetGenerationProgressService.js`：新增按场景隔离的目标进度 lane 与聚合逻辑。
- `src/services/storyAdWorkspace/sceneAssetAvailabilityProjectionService.js`：新增场景资产可用性投影，404 文件不再冒充成功。
- `src/services/newStoryAd/sceneGenerationCheckpointService.js`：清理临时候选时保护正式发布文件。
- `src/services/newStoryAd/sceneAssetService.js`：缺失文件进入真实修复计划；直接场景调用保持进度上下文。
- `src/services/newStoryAd/jobService.js`：初始化、更新、结束独立场景进度 lane。
- `src/services/newStoryAd/taskProgressProjectionService.js`：进度投影升级并兼容单场景详情。
- `src/services/storyAdWorkspace/projectBundleService.js`：工作台使用真实文件可用性投影。
- `public/story-ad/store/projectStore.js`：前端接收目标进度映射。
- `public/story-ad/workspace-ux.css`：场景卡底部响应式布局修复。
- `scripts/test-story-ad-scene-persistence-progress-layout-v244.js`：新增资产保护、丢失转修复、并发隔离、直接任务调用和布局回归。
- `scripts/test-visual-asset-recovery-v50.js`：迁移旧夹具，使用可达外部资源验证远程资产语义。
- `package.json`：纳入新定向回归。
- `config/story-ad-release.json` 及发布清单：生产版本封装为 V246。

## 4. 提交记录与拉取方式

目标远端分支：`origin/codex/story-ad-systemic-remediation`

- `6d36b8df` `fix(story-ad): preserve scene assets and isolate progress`
- `84be1d80` `build(story-ad): seal production v244`
- `5ebe3815` `refactor(story-ad): keep workspace projections within boundary`
- `d4874deb` `build(story-ad): seal production v245`
- `2ac22224` `fix(story-ad): preserve direct scene progress context`
- `4369c0ac` `build(story-ad): seal production v246`
- 本交接文件提交：见远端最新提交。

另一台电脑续接：

```powershell
git status --short
git fetch --all --prune
git switch codex/story-ad-systemic-remediation
git pull --ff-only origin codex/story-ad-systemic-remediation
npm install
node src/server.js
```

执行 `git pull` 前必须先确认工作树没有需要保留的未提交改动；禁止使用 `git reset --hard` 覆盖本机工作。

## 5. 本地、Git、生产三方一致性

| 核对项 | 结论 |
|---|---|
| 本地与目标 Git | 发布前 `HEAD=4369c0ac1ee75a22e953e842bd4d0183df122834`，`ahead/behind=0/0`，工作树干净。交接文件提交后再次推送并复核。 |
| 生产来源 | 运行清单 `source_revision=2ac22224fd8eb2e8e031771fcbfa6838adde0c65`；`4369c0ac` 是同一源码树的不可变发布封装提交。 |
| 生产运行文件 | `artifact_id=d87688fd00740938ed185bc5e1b8acd2aa164703a1f05de10d579ffa1c05c745`，884 个文件逐项验证通过。 |
| 生产运行哈希 | `runtime_hash=9bd0278a25426cd341ad47b3002083c515d6ad89efc2b18f07cebe7cf034556e`，与 `/api/story-ad/version` 返回一致。 |
| 发布合同 | `release_bundle_id=e39e0f403186a4f360a4eb1f6fa63c270373fb3c7cff128a31138b172c52ff21`，release control 的 active/runtime bundle 一致。 |
| 三方结论 | 应用运行代码一致；交接 MD 属于发布后的文档提交，不进入生产运行包，不构成应用代码差异。 |

## 6. 实际执行的验证

### 6.1 根因与定向回归

- 新增回归 5 项全部通过：正式资产保护、缺失文件进入修复、2 个并发 lane、直接任务调用隔离、响应式布局；模拟模型调用 0。
- 场景修复、场景卡、场景世界、工作台 UX、进度、后端投影、图片交付和场景体验定向回归全部通过。
- 场景空间生成顺序回归通过：生成顺序 `master → layout → reverse → interaction → detail`，56 次模拟生成调用，断点续跑通过，并发图片调用峰值 1。
- 工作台边界通过：`projectStore.js` 维持 600 行门限，投影逻辑已抽为独立服务。

### 6.2 完整发布门禁

- `systemic` 门禁通过：真实队列、2 个并行场景、重复提交 0、模型/媒体调用 0。
- `platform_full` 门禁通过，耗时约 21.9 分钟；其中 V111 校验 8,884 个发布文件、10,000 个固定种子样本、400 对变形样本、50 个并发任务，重复许可 0、付费调用 0。
- `release_core` 门禁通过：发布完整性、来源身份、原子构建、传输、闭包、计费安全与黄金合同均通过。
- 前两次发布候选均在切换生产前安全回滚：V244 暴露工作台文件边界超限；V245 暴露直接场景修复的进度上下文兼容问题。两项均完成根因修复并补回归后才生成 V246。

### 6.3 生产验证

- 不可变发布成功：版本 `20260828-production-v246`，884 个文件校验通过；增量复用 805 个、上传 79 个。
- PM2 `vido`：`online`，重启 0，脚本路径指向当前 V246 不可变发布目录。
- 内网健康：HTTP 正常、`status=ok`；公网 `https://vido.smsend.cn/api/health`：`status=ok`。
- SQLite：`PRAGMA quick_check=ok`。
- 活动生成任务：发布前 0、发布后 0。
- 活动未知计费：发布前 0、发布后 0。数据库仍有 63 条历史 unknown 记录，但均不处于活动状态，本轮未改写历史计费证据。

### 6.4 目标旧任务只读核对

- 当前任务无活动生成：`active_generation_id` 为空，`active_target_generations={}`。
- `space_02_exhibition`：5/5 张文件在磁盘存在，工作台投影 5/5，公网逐张 HTTP 200；现有成功资产完整保留。
- `space_01_showroom`：历史正式记录有 4 张，但对应文件已在本轮修复前被旧清理逻辑删除，服务器全盘没有可恢复副本；公网逐张 HTTP 404。
- 新版本把展示厅缓存记录从可用投影中剔除，生成真实修复计划：`master/layout/reverse/interaction/detail` 共 5 张待补齐，`provider_image_call_count=0`。
- 本轮只读核对没有调用模型、没有提交图片任务、没有产生新费用、没有覆盖业务数据。

## 7. 未执行项、风险、费用与数据边界

- 未自动重建展示厅 5 张图：这是新的付费图片生成，必须由用户在页面明确点击修复后执行。
- 已丢失的展示厅旧文件无法从生产目录、历史发布目录或数据盘恢复；只能重新生成。浏览器里偶尔还能看到的图是客户端缓存，不是服务器可持久化文件。
- 旧任务仍保留历史失败状态和历史诊断，重新进入工作台后应以当前文件检查与修复计划为准；不会续用 404 图片作为成功资产。
- 商业展台不需要重新生成图片；当前动作是无图片调用的重新核验，只有取得逐图证据后才决定是否需要修复。
- 本轮完整发布门禁已真实执行；未执行项：没有由 Codex 触发任何真实付费生成，也没有替用户点击旧任务修复。
- 已知非阻塞基线：单独运行的旧 V100 UI 类名断言与当前组件命名不一致；本轮未修改该组件，正式 V6 UI、场景卡和发布门禁均通过。

## 8. 下一次操作顺序

1. 用户刷新剧情广告工作台并重新进入目标任务。
2. 先确认商业展台仍显示 5 个机位/视图，点击机位时在当前窗口切换。
3. 确认现代家居展示厅不再显示缓存假成功，并提示 5 张待补齐。
4. 若接受新的图片模型费用，再点击该场景的“修复未通过项”；观察该场景独立进度，另一场景不得被覆盖或提前结束。
5. 生成后核对 5 张文件均为 HTTP 200、空间/人物站位/机位入口恢复，并完成逐图 QA。

