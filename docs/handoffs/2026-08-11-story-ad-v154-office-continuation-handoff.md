# VIDO 剧情广告 v154 公司续接交接

> 交接日期：2026-08-11
> 目标分支：`codex/story-ad-v3-upgrade`
> 权威远端：`origin` / Gitee
> 生产主机：`43.98.167.151`
> 当前生产：`20260810-a-v154`

## 一、当日目标与用户决策

本轮完成资产生成进度、人物多造型、供应商 500 安全恢复和场景缺失视图状态的修复、发布与交接。

用户新增明确决定：

1. 家庭电脑 `LAPTOP-LDFOL0GT` 以后只运行本次任务及直接相关模块的静态检查、定向回归、相邻失败/恢复测试和健康检查。
2. 该电脑不再默认运行 `npm run platform:upgrade:test` 或剧情广告跨版本全量回归。
3. 公司电脑是否执行完整回归按公司电脑上的任务和用户决定处理，不自动继承家庭电脑限制。
4. 供应商 500 不能盲目自动重试；必须先有供应商任务查询、账单核对或明确幂等重放合同，防止重复扣费。

规则已写入：

- `AGENTS.md`
- `docs/handoffs/HANDOFF_PROTOCOL.md`

## 二、修改前后的完整数据流

### 1. 视觉资产进度

修改前：

```text
场景内部视图进度 1/5
→ updateSceneUnit 折算为 0.2 个场景
→ 聚合进度 completed=0.2
→ 页面显示 0.2/10
```

修改后：

```text
场景内部视图进度 1/5
→ 只写 current_view_progress={completed:1,total:5}
→ 业务 completed 只按完整人物/完整场景递增
→ 页面兼容历史小数并按整数显示 0/10、1/10…
```

### 2. 供应商 500

当前生产真实流程：

```text
漫路 gpt-image-2 长连接提交
→ HTTP 500 且无 provider_task_id
→ submitted_unknown / billing unknown
→ 计费熔断停止后续提交
→ 保留成功资产与检查点
→ 人工“核对并继续”缺失项
```

尚未上线完整自动核账。原因是漫路当前没有已确认的“按 X-Request-ID 查询结果/账单”接口，也没有证明相同请求 ID 重放不会重复扣费。后续应优先取得供应商正式合同，再实现后台 reconciliation；不能直接在 500 后重新 POST。

### 3. 人物与场景资产

- 人物身份连续性保持一个主体；古代、现代等造型拆成独立造型子卡，不再挤在同一张图中表达。
- 资产进度分母使用业务目标数，不再被人物档案内部工作单元覆盖。
- 场景视图区分：明确失败、已提交待核对、未提交待继续；成功视图继续复用，只补缺失项。

## 三、代码和文件变更

主要运行代码提交：

- `2084943a`：稳定资产目标计数、人物造型展示和安全恢复流程。
- `7e605e07`：视觉资产完成数强制为整数，兼容历史 `0.2` 状态。

关键文件：

- `src/services/newStoryAd/visualAssetProgressService.js`
- `src/services/newStoryAd/visualAssetOrchestrationService.js`
- `public/story-ad/components/ui.js`
- `public/story-ad/views/assetCenterPersonLooks.js`
- `public/story-ad/views/sceneDossierCard.js`
- `scripts/test-new-story-ad-visual-asset-failure-recovery.js`
- `scripts/test-story-ad-workspace-v6-ui-regressions.js`

本次交接新增规则及文档，不改变 v154 生产运行清单。

## 四、提交、分支与公司电脑拉取

权威分支：`codex/story-ad-v3-upgrade`。

公司电脑执行：

```powershell
git status --short
git fetch --all --prune
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
git log -5 --oneline
npm install
node src/server.js
```

本地访问：<http://localhost:3007>

禁止使用 `git reset --hard` 覆盖公司电脑可能存在的未提交工作。若 `git status --short` 非空，先保存、提交或单独确认差异。

## 五、本地、Git、生产三方一致性

| 核对项 | 本地 | Git origin/Gitee | 生产 | 结论 |
|---|---|---|---|---|
| 运行代码基线 | `7e605e07` 对应 v154 运行文件 | `7e605e07`，当时 ahead/behind `0/0` | 不可变制品 v154 | 一致 |
| Build | `20260810-a-v154` | 清单同值 | `20260810-a-v154` | 一致 |
| Artifact | `6d01d9f538dd41dd36016eef6af53b43dc374bc21bec462433378fee8dcb1ecf` | 清单同值 | 同值 | 一致 |
| Runtime hash | `3230f2ab06b65e3e1fde2b28ded167070e1217b72129908eacfe665470f6906c` | 清单同值 | 同值 | 一致 |
| Runtime 文件 | 642 项，差异 0 | 642 项清单已跟踪 | 642 项，差异 0 | 一致 |
| Public 文件 | 47 项，差异 0 | 47 项清单已跟踪 | 47 项，差异 0 | 一致 |

生产运行目录：

```text
/opt/vido/releases/6d01d9f538dd41dd36016eef6af53b43dc374bc21bec462433378fee8dcb1ecf
```

说明：本交接文件与测试范围规则会作为后续文档提交进入 Git，但不属于生产 Runtime 642 项。生产运行代码与 Git 中 v154 运行文件仍完全一致。

非权威 GitHub 镜像当前停在 `c6b9d00d`，相对本地落后 57 个提交。公司电脑必须从 `origin` / Gitee 拉取，不能以 GitHub 镜像作为本轮权威。

## 六、实际验证

已执行：

- `git fetch --all --prune`；origin、gitee 与本地运行代码提交一致。
- 本地运行清单逐文件校验：Runtime 642/642、Public 47/47，差异 0。
- 生产运行清单逐文件校验：Runtime 642/642、Public 47/47，差异 0。
- PM2 `vido`：`online`，PID `10040`，重启 0，执行目录指向 v154 不可变 release。
- 内网和公网健康：均为 `ok`。
- 内网和公网版本接口：Build、Artifact、Runtime hash、Release bundle 一致。
- SQLite `PRAGMA quick_check`：`ok`。
- 活动生成任务：0；未知计费任务：0。
- v154 修复时已执行相关资产档案、UI、发布完整性定向测试，均通过；没有触发真实模型、图片或视频调用。

根据用户新决定，本次交接没有再次运行 `platform:upgrade:test`，也没有运行其他跨版本完整回归。

## 七、未执行项、风险与费用边界

未执行：

- 未再次运行全平台回归：家庭电脑测试范围已明确禁止。
- 未触发真实漫路 500：会产生不确定费用，不属于只读交接核对。
- 未自动处理历史 500 账单：供应商缺少可用的查询/幂等合同。

剩余风险：

- 历史 `submitted_unknown` 的 500 是否扣费，只能通过漫路账单或客服支持号核对。
- 在供应商能力补齐前，后台不能安全自动重投未知计费请求。
- 工作树中仍有 5 个既有未跟踪研究/报告文件，本轮未修改、未删除、未纳入交接提交。

费用与数据覆盖：

- 本轮交接审计模型调用 0、图片调用 0、视频调用 0、业务写入 0。
- 未修改生产任务、资产、检查点和账单状态。

## 八、公司电脑下一步建议

1. 从 `origin` 拉取最新分支并启动本地 3007。
2. 先读取本交接文件和 `2026-08-10-story-ad-v143-home-continuation-handoff.md`。
3. 若继续 500 自动恢复，先向漫路确认以下任一正式能力：按请求 ID 查询、返回可轮询任务 ID、幂等键保证、账单查询接口。
4. 取得供应商合同后实现 durable reconciliation：核对中 → 回收已有结果 / 确认未计费后仅重试一次 / 仍未知则停止。
5. 回归必须验证：进程重启后继续核账、并发视图不重复提交、成功资产调用数不增加、明确未计费后只补缺失项、重复计费为 0。
6. 后续可继续评估分镜动作拆解和 Agent 交付合同，但避免重复新增知识条目或另建一套 Agent 框架。
