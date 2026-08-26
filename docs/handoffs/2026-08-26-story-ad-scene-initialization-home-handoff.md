# 2026-08-26 剧情广告场景初始化与失败任务续接交接

> 生成时间：2026-08-26 18:43（Asia/Shanghai）  
> 续接分支：`codex/story-ad-systemic-remediation`  
> 目标任务：`b83fa67c-244a-4869-b3cc-df282fad5c59`（佛山智造 · 不锈钢品牌广告）

## 1. 当日目标与用户确认的新合同

1. 进入“场景世界”时立即显示预计场景总数；每个场景必须有独立提示词卡片，可切换“提示词 / 场景画面”。
2. 首次进入时先生成场景文字方案；用户确认提示词后才单独生成场景图片，场景图片齐全并确认后才能进入线稿与分镜。
3. 没有独立商品素材、且广告主体按场景呈现时，不得继续阻塞在商品资产；人物已有档案和图片必须保留。
4. 排查并修复生产截图任务的场景生成失败；不能用末端吞错代替根因修复。

## 2. 已确认事实、代码根因与外部边界

### 2.1 第一个生产失败（已修复并上线）

- 生产错误：`ASSET_PLAN_SCOPED_SOURCE_REQUIRED`，提示“当前完整资产方案不存在，不能执行分域更新”。
- 事实：目标任务的权威资产方案只有 `cast_profiles`、`prop_plan`；缺失 `scene_plan`、`story_seed`，场景数为 0，但已有 7 个已确认剧情节拍。
- 根因：人物独立规划允许先发布人物/道具部分方案；旧“生成场景”入口却无条件走只适用于完整方案的 `replanScope('scene')`，因此在模型调用前失败。
- 修复：新增 `initializeScenePlan`。当且仅当人物/道具有效且只缺场景/故事种子时，只恢复 `scene_plan` 与 `story_seed`；发布前对人物、叙事人物、宠物、道具、广告主体做结构哈希隔离检查。

### 2.2 第二个生产失败（代码已修、尚未发布）

- 在 V230t 上尝试恢复目标任务时返回：`ASSET_PLAN_CHECKPOINT_CAS_FAILED:task_bundle_mismatch`。
- 事实：失败发生在文字模型调用前；没有新增场景图片/媒体调用，任务原有人物资产未被覆盖。
- 根因：任务通过 `/tasks/:id/scene-plan` 排队时 stage 是 `scene_plan`，但 `queuedPlanningTaskPatch` 只对 `scene_config` 写入当前 `required_bundle_id`。历史任务仍绑定旧 release bundle，首次 checkpoint CAS 因此被拒绝。
- 修复提交：`3bc1eb88` 将 `scene_plan` 与 `scene_config` 同时纳入排队前 bundle rebase，并新增回归断言。
- 状态：提交已推送 Gitee，但尚未生成 V230u、尚未再次发布；因此目标任务当前仍不可测试。

## 3. 修改前后数据流

### 修改前

`人物独立规划（部分 active plan） → 进入场景页显示 0 → 用户点击生成 → replanScope 要求完整 plan → 模型调用前 409 失败`

历史任务即使进入新首次初始化：

`scene_plan 排队 → required_bundle_id 仍是旧 bundle → 保存恢复 checkpoint → CAS task_bundle_mismatch → 模型调用前失败`

### 修改后（V230t 已上线部分）

`已确认 blueprint beats → 工作台投影预计场景数/逐场景提示词预览 → 首次进入自动提交 scene_plan 文字任务 → initializeScenePlan 仅补 scene_plan/story_seed → 保存完整 plan/scene_config → 用户逐场景确认提示词并单独生成画面 → 全部画面确认后进入线稿`

### 待发布补丁后的完整路径

`scene_plan 排队 → 队列在任何 checkpoint 前把 required_bundle_id 绑定当前 release → checkpoint CAS 通过 → 仅调用两个缺失文字区段 → 人物/道具哈希不变 → 场景提示词落库；图片调用仍为 0`

## 4. 已完成代码与文件

- `src/services/newStoryAd/assetPlanService.js`
  - 新增首次场景初始化判定、隔离校验和缺失区段恢复。
- `src/services/storyAdWorkspace/sceneWorkflowProjectionService.js`
  - 从 blueprint beats 投影 `estimated_count`、`preview_scenes`、`initialization_required`。
- `public/story-ad/views/sceneWorldPage.js`
  - 场景总数、实际场景卡、确认后进入线稿；首次进入自动触发文字规划。
- `public/story-ad/views/scenePromptPreview.js`
  - 新拆出的提示词预览/自动提交模块，控制懒加载体积。
- `public/story-ad/views/scenePlanStatus.js`
  - 首次规划、失败重试及“不修改人物资产”的用户文案。
- `src/services/newStoryAd/assetPlanCheckpointLineageService.js`
  - **待发布补丁**：`scene_plan` 排队时同步 rebase 当前 bundle。
- `scripts/test-story-ad-initial-scene-plan-v230s.js`
  - 复现部分 active plan，验证只补两个区段、人物不变、模型桩调用 2 次。
- `scripts/test-story-ad-scene-config-release-rebase-v130.js`
  - 验证 `scene_plan` 历史 bundle 在 checkpoint CAS 前迁移。
- `scripts/test-story-ad-scene-card-v66.js`、`scripts/test-story-ad-workspace-v6-ui-regressions.js`
  - 迁移到新的场景页模块合同。

## 5. 提交记录

- `ad2ff05b` `fix(story-ad): initialize scene prompts from partial plans`
- `b304f7ee` `build(story-ad): publish v230s manifest`
- `525d0e3a` `perf(story-ad): keep scene workspace within lazy budget`
- `701fef11` `build(story-ad): publish v230t manifest`
- `da358d4b` `test(story-ad): follow scene prompt module split`
- `60d5d92f` `build(story-ad): refresh v230t source identity`
- `3bc1eb88` `fix(story-ad): rebase independent scene planning jobs`（已推送、未发布）

## 6. 本地、Git、生产三方状态

| 位置 | 当前权威状态 | 结论 |
|---|---|---|
| 办公电脑本地 | 分支 `codex/story-ad-systemic-remediation`，HEAD `3bc1eb88099ec0ebd4118f84bc390a571ac62ace` | 本轮代码已提交；工作树仍有用户原有无关改动，未纳入提交 |
| Gitee 目标分支 | HEAD `3bc1eb88099ec0ebd4118f84bc390a571ac62ace`，本地 ahead/behind `0/0` | 与本轮本地提交一致 |
| 生产 | V230t；artifact `80334eface5934981966aea0e5ea05dccfaa2ba677ccb945ebca2788b07ba4f6`；source `da358d4bee42ad553a21f5ff1fb25eb42a5f11b8` | 与 V230t 清单一致，但**不含**提交 `3bc1eb88`，这是明确的待发布差异 |

生产运行详情：

- release：`/opt/vido/releases/80334eface5934981966aea0e5ea05dccfaa2ba677ccb945ebca2788b07ba4f6`
- release bundle：`89aca4736f5ed189023b47c6e90f09b19baf5cdaff03e39b8756d4f38cc977af`
- runtime hash：`458ffc93b632b2f8133e32ae3fd84ef8180aeac3fd0f85639dfde56b6ba227da`
- PM2：`vido` online，PID `22661`，restart `0`
- 内网/公网健康：均 `ok`
- SQLite：`quick_check=ok`
- 活动生成任务：`0`
- 活动未知计费：`0`（历史隔离未知计费记录 62 条，不阻塞当前发布）
- 目标任务修复前备份：`/opt/vido/backups/scene-plan-repair-20260826103955/vido.sqlite.before-scene-plan-repair`

## 7. 已执行验证

### V230t 最终发布门禁

- 系统性门禁：通过。
- 完整平台/跨版本门禁：通过，耗时 `1,056,644 ms`。
- 发布核心、黄金合同和三方权威证明：通过。
- 固定种子属性样本 10,000、变形对 400、并发任务 50、重复许可 0、门禁真实付费调用 0。
- 不可变制品 851 个文件哈希核对通过；复用 785、上传 66。
- 候选启动、原子切换、内外网健康、SQLite、活动任务与活动未知计费门禁全部通过。

### 最新未发布补丁的定向验证

- `node scripts/test-story-ad-scene-config-job-ownership-v60.js`：8 项通过，模型/媒体调用均 0。
- `node scripts/test-story-ad-initial-scene-plan-v230s.js`：恢复 `scene_plan`/`story_seed`，人物保持不变，模拟文字调用 2。
- `node scripts/test-story-ad-scene-config-release-rebase-v130.js`：通过，确认 `scene_plan` queue rebase 清除 `task_bundle_mismatch`。
- `node scripts/test-story-ad-scene-card-v66.js`：场景卡、提示词归属与本地导出通过，模型调用 0。
- `node scripts/test-story-ad-workspace-v6-ui-regressions.js`：通过。
- `node scripts/check-story-ad-workspace-v6-boundaries.js`：通过；scene world lazy `49,886 bytes`，gzip `14,694 bytes`。

### 失败但已安全回滚的发布尝试

- V230s：场景懒加载模块 52,913 bytes 超 50 KiB，门禁失败并回滚；随后拆分模块。
- V230t 第一次：旧测试只扫描拆分前文件，门禁失败并回滚；迁移测试后第二次完整通过并上线。

## 8. 回家续接步骤（按顺序）

```powershell
cd D:\VIDO
git status --short
git fetch --all --prune
git switch codex/story-ad-systemic-remediation
git pull --ff-only origin codex/story-ad-systemic-remediation
git rev-parse HEAD
```

应得到 HEAD `3bc1eb88099ec0ebd4118f84bc390a571ac62ace`。若家里工作树有未提交内容，先保留并检查，不要执行 `reset --hard`。

### A. 先重跑定向回归

```powershell
node scripts/test-story-ad-scene-config-job-ownership-v60.js
node scripts/test-story-ad-initial-scene-plan-v230s.js
node scripts/test-story-ad-scene-config-release-rebase-v130.js
node scripts/test-story-ad-scene-card-v66.js
node scripts/test-story-ad-workspace-v6-ui-regressions.js
node scripts/check-story-ad-workspace-v6-boundaries.js
```

### B. 生成新构建（不要复用已上线 V230t）

1. 将 `config/story-ad-release.json` 的 build ID 改为新的唯一编号（建议 `20260826-production-v230u`；若已跨日，按当天编号）。
2. 提交并推送 build ID 修改。
3. 执行：

```powershell
npm run story-ad:release:build
git add -- config/story-ad-runtime-manifest.json public/story-ad
git commit -m "build(story-ad): publish v230u manifest"
git push
```

构建脚本会统一刷新静态资源版本参数；不要手工逐文件替换。

### C. 完整发布

```powershell
$env:VIDO_IMMUTABLE_UPLOAD_CONCURRENCY='1'
node scripts/deploy-story-ad-immutable-release.js
```

要求：三组门禁全部通过；任何失败均停止，不放宽测试。确认输出 `IMMUTABLE_RELEASE` 后再继续。

### D. 恢复目标任务

优先通过已登录页面重新进入该任务的场景页，让 `/tasks/:id/scene-plan` 走真实队列；进入页面应先看到预计场景数量及逐场景提示词预览。队列完成后核对：

1. task `status=done`、`stage=scene_config_done`，错误码清空；
2. `scene_config.spaces.length > 0`，每个场景有独立提示词；
3. 人物相关计划/档案/图片哈希或数量不变；
4. 新增模型调用只属于缺失文字区段，新增图片/媒体调用为 0；
5. 未自动生成任何场景图片，用户仍需逐个确认后手动生成。

不要再次使用本轮临时的“服务直调”方式；真实 queue 路径才能验证 `scene_plan` bundle rebase 修复。

## 9. 未执行项与剩余风险

- 提交 `3bc1eb88` 尚未纳入新 build、未跑完整平台门禁、未发布生产。
- 目标任务尚未成功补齐场景文字方案；当前不可测试。
- V230t 上的失败补齐发生在模型调用前，但任务状态可能仍显示本次 CAS 错误；新版本真实 queue 成功后应清空。
- 未生成任何场景图片，也未执行付费图片供应商调用。
- 家庭电脑若主机名为 `LAPTOP-LDFOL0GT`，按项目规则只跑上述定向检查，不运行全平台完整回归；交接中必须如实记录。若不是该主机且要发布，保持完整不可变发布门禁。
- 用户原有工作树变更未被本轮提交：`.gitattributes`、旧 handoff 删除、8 月 3–5 日旧日志修改、`.codex-tmp/` 及若干未跟踪研究/交接文件；续接时继续隔离，禁止误提交。

## 10. 下一次优化入口

1. 拉取并确认 `3bc1eb88`。
2. 定向回归。
3. 新 build + 完整门禁 + 不可变发布。
4. 用真实 `scene_plan` 队列恢复目标任务。
5. 做人物资产哈希、场景提示词数、模型调用类型和图片调用数的前后对比。
6. 最后再核对本地、Gitee、生产清单，并更新本交接文件的完成状态。
