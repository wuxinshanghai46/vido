# VIDO 剧情广告 v224 公司续接交接

> 交接时间：2026-08-13（Asia/Shanghai）  
> 目标分支：`codex/story-ad-v3-upgrade`  
> 权威远端：`origin` / `gitee`  
> 生产：`43.98.167.151:4600`

## 1. 当日目标与用户决策

用户要求一次性修复以下同源问题，并在生产验证后生成公司续接交接：

- 项目删除等待时间长且只有按钮文字反馈；
- 普通用户看到“版本合同”“Active Plan”等内部术语；
- 后台统一规划人物、道具、场景和故事结构，却被页面误称为“场景规划”，造成“为什么人物之前先生成场景”的误解；
- 方案更新失败时，顶部横幅和资产中心给出相互冲突的恢复指令。

用户随后在生产“星月神话故事”点击了“重新更新人物与场景方案”。本轮交接等待该任务到终态后封存，避免记录运行中的过时状态。

## 2. 修改前后的数据流

### 2.1 项目删除

修改前：

`确认删除 → 按钮显示删除中 → 后端多次读取全库 → 逐条删除关联记录 → 再读全库判断共享文件 → 同步删除专属文件 → 前端重新加载项目列表 → 整行消失`

修改后：

`确认删除 → 整行立即进入 aria-busy 加载态并禁止重复操作 → 后端读取一份一致性快照 → JSON 一次写回或 SQLite 按集合批量删除 → 使用同一快照判断共享文件 → 清理专属文件 → 前端刷新列表；失败则恢复原行`

### 2.2 人物与场景方案

后台权威流程不变：

`内容输入 → 统一规划人物 / 道具 / 场景 / 故事种子 → 发布当前内容版本的活动方案 → 逐个人物确认图片生成 → 场景视觉 → 剧本与后续制作`

修改前页面将内部 `scene_config` 显示为“场景规划”，并暴露“版本合同未通过”。修改后：

- 统一显示为“人物与场景方案”；
- 区分“方案需要更新”和“方案更新失败”；
- 明确该步骤只更新文字方案、不生成图片；
- 明确已有成功人物与场景资产保留；
- 顶部失败横幅和资产中心使用同一恢复指令。

## 3. 代码和文件变更

核心修改：

- `src/services/newStoryAd/storageService.js`：单快照、批量删除。
- `src/services/newStoryAd/taskDeletionService.js`：复用删除前快照判断共享文件，移除第二次全库读取。
- `public/story-ad/app.js`、`public/story-ad/styles.css`：项目整行删除加载态和失败恢复。
- `public/story-ad/components/ui.js`：统一方案阶段名称和失败恢复说明。
- `public/story-ad/views/assetCenterView.js`：隐藏内部合同术语，接入统一方案状态。
- `public/story-ad/views/assetCenterPlanningDetailsStatus.js`：按需承载方案需要更新 / 更新失败状态，避免核心包体超限。
- `scripts/test-new-story-ad-task-deletion.js`：删除单快照、权限、共享文件、运行中任务和失败边界回归。
- `scripts/test-story-ad-workspace-v6-ui-regressions.js`：方案状态、内部术语、恢复指令和删除加载态回归。
- `config/story-ad-release.json` 及发布清单：生产 build `20260813-ui-v224`。

提交：

- `9c762492` `fix(story-ad): clarify asset planning and speed deletion`
- `ca8a0dfc` `fix(story-ad): keep planning UI within release budget`

## 4. 公司电脑拉取与启动

先检查公司电脑是否有未提交修改，禁止直接覆盖：

```powershell
cd D:\VIDO
git status --short
git fetch --all --prune
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
npm install
npm run story-ad:v221:test
node src/server.js
```

访问：<http://localhost:3007>

如果公司电脑项目不在 `D:\VIDO`，替换为真实目录。若公司电脑还没有生产 SSH 公钥授权，只在该电脑生成独立密钥并授权公钥，禁止通过 Git、MD 或聊天复制私钥。

## 5. 本地、Git、生产三方核对

| 对象 | 核对结果 | 证据 |
|---|---|---|
| 家庭电脑本地 | 业务代码为 `ca8a0dfc`；仅保留 5 个用户既有未跟踪文档，未纳入本轮提交 | `git status --short`、`git rev-parse HEAD` |
| 权威 Git origin | 与本地 `ca8a0dfc` 一致，ahead/behind `0/0` | `git fetch --all --prune` 后核对 |
| 权威 Git gitee | 与本地 `ca8a0dfc` 一致，ahead/behind `0/0` | 同上 |
| GitHub 镜像 | 非权威镜像，当前为 `e1bba3b5`，落后权威分支 26 个提交 | 不作为公司拉取来源 |
| 生产运行代码 | build `20260813-ui-v224`，artifact `4100f3ee...aee9`；本地运行清单 664 项与生产逐文件 SHA-256 全部一致 | mismatches `0` |
| 生产服务 | PM2 `vido` online，PID `24689`，restart `0` | PM2 只读核对 |
| 生产健康 | 内网与公网 `/api/health` 均 HTTP 200；SQLite status `ok` | 只读健康检查 |

结论：本地、origin/gitee 与生产 v224 的业务代码一致。提交本交接 MD 后，Git HEAD 会比生产运行制品多一份纯文档提交，这是预期差异，不代表生产业务代码不一致。

## 6. 实际验证过程

### 静态与定向测试

- 修改文件 `node --check`：通过。
- `npm run story-ad:v221:test`：通过。
- 永久删除回归：通过；确认删除只读取一次数据库快照。
- 工作区 UI 回归：通过。
- 平台叙事发布合同回归：通过。
- 固定种子属性样本：10,000 个通过。
- 变形测试：400 组通过。
- 活动方案状态矩阵：8 组通过。
- 并发任务：50 个通过，重复 permit `0`。
- 定向测试付费调用：`0`。

### 体积与浏览器验证

- 首次发布在上传前被 330 KiB 核心包体门禁拦截；未提高门禁，拆分状态模块后重新构建。
- 最终核心按需 JS：337,906 bytes，小于 337,920 bytes 上限；gzip 103,379 bytes，小于 105 KiB 上限。
- 本地真实浏览器创建零付费验收任务并删除：确认后整行“正在彻底删除”可见，任务随后消失。

### 生产发布与只读核对

- 不可变发布上传并验证 665 个制品文件，候选健康后原子切流。
- 发布前后活动任务 `0 → 0`，活动未知计费 `0 → 0`。
- 发布迁移模型调用 `0`，付费调用 `0`。
- 生产运行清单复核：664 项，SHA-256 mismatch `0`。
- PM2 online/restart `0`，内外网健康 HTTP 200，SQLite `ok`。

## 7. “星月神话故事”最终生产状态

任务 ID：`3f14e285-67d7-4656-9bec-6bff7af7ec84`

交接前用户提交了“重新更新人物与场景方案”。最终状态：

- `status = failed`
- `stage = scene_config_failed`
- 活动 generation ID 已清空；不是仍在后台运行。
- 内容版本仍为 8，旧活动方案仍为版本 7，未发布不完整的新方案。
- 7 个既有场景资产和 3 份人物 checkpoint 保留；未生成或覆盖图片。
- 本次方案更新共记录 8 次文字模型调用：
  - 1 次 `asset_plan_section_patch` 成功；
  - 其余因 `TIMEOUT_OR_NETWORK`、`PROVIDER_BILLING`、`RATE_LIMIT`、`PROVIDER_RESPONSE_INVALID` 失败。
- 本轮没有图片模型调用；但文字模型调用不是零。

明天公司续接时不要立即再次点击“重新更新人物与场景方案”。先只读核对文字模型路由、限流、供应商余额/计费状态和结构化返回合同；确认至少一个完整候选链路健康后，再决定是否允许重试，避免重复消耗文字调用。

## 8. 未执行项、剩余风险与费用边界

- 未执行家庭电脑禁止的全平台 / 跨版本完整回归；已执行本次删除、UI、统一规划及相邻发布合同定向回归。
- 未自动重跑“星月神话故事”，除用户已在页面提交的那次方案更新外，本次交接审计没有发起模型调用。
- 生产累计存在历史未知计费记录 59 条，但活动未知计费为 0；不得把历史累计数误解为当前仍在付费运行。
- `scene_config` 文字模型供应链当前仍不稳定，是明天继续测试的主要阻塞；不要连续点击重试。
- GitHub 镜像落后 26 个提交；公司电脑必须从 `origin` / Gitee 拉取。
- 本地 5 个用户既有未跟踪文档未提交、未删除、未覆盖。

## 9. 明天继续的建议顺序

1. 从 origin 拉取本交接提交，运行 `npm run story-ad:v221:test`。
2. 启动本地服务器，确认 v224 页面文字与删除 loading 正常。
3. SSH 只读核对生产 build、PM2、健康、SQLite、活动任务和活动未知计费。
4. 检查 `new_story_ad.story_facts`、`story_facts_compact_retry`、`asset_plan_section_patch` 当前候选路由：网络、限流、计费、结构化 JSON 合同。
5. 只有候选链路恢复且不会重复付费/覆盖数据时，才重试“星月神话故事”的人物与场景方案。
6. 方案成功后先确认内容版本 8 的 active plan 已发布，再逐个人物确认图片生成；不要直接重跑已有成功图片。

