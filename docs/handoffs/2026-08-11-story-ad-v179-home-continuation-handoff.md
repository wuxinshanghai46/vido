# VIDO 剧情广告 v179 · 回家续接交接

> 日期：2026-08-11（Asia/Shanghai）
> 分支：`codex/story-ad-v3-upgrade`
> 运行代码基线：`6fcb6479e2cb9cc6d87d409cdd54cb4b16d3a6b1`
> 生产：`43.98.167.151` / PM2 `vido` / 端口 `4600`
> 交接文档提交：以本文件所在远端最新 HEAD 为准。

## 1. 当日目标与用户决策

- 视觉资产失败后的操作必须给用户唯一、明确的下一步，运行中的入口不能保持选中样式或继续点击。
- 古代、现代视觉身份必须彻底拆卡；转世是新身份并使用不同姓名，只有本人穿越、共同穿越或本人长生延续才保持姓名。
- 剧情人物身份数量、分时代场景身份数量和视觉资产卡数量必须分别建模，不能继续复用一个 `expected_people`。
- 授权音色包可进入平台供用户搜索、试听和选择；真实克隆必须逐条确认授权及费用，多角色对白按角色分别 TTS。
- 剧情对白需要补足逐角色台词、逐角色音色和音频驱动口型；多人物同框优先拆成正反打或逐说话人镜头。
- 图片供应商发生 5XX 且计费状态不明确时禁止自动付费重试，成功资产继续保留。

## 2. 修改前后的完整数据流

### 人物与规划

修改前：剧情人物数与跨时代视觉卡数共用 `expected_people` → 2 个剧情人物拆成 4 张时代卡后，缺失区段模型仍返回 2 人，却被 4 人校验器拒绝 → 场景规划反复失败。

修改后：原始需求进入 `contextBuilder` → `personCountContractService` 分别维护剧情身份和视觉资产计数 → 统一规划及缺失区段恢复按剧情身份计数 → `personLookProfileService` 按本人延续或转世生成独立时代身份 → 持久化继续输出 4 张视觉卡。目标任务当前为 3 个剧情身份、4 张视觉卡：沈砚辞（古代/现代）、云知月（古代）、林知月（现代）。

### 视觉资产生成与 5XX

修改前：供应商失败、规划合同失效和人物资料缺失会同时呈现多个含义不清的入口；部分旧恢复检查点会与新事务发生 CAS 冲突。

修改后：显式“更新场景规划”事务可在实时 bundle/content revision/generation 校验后原子替换不兼容旧检查点；运行中所有生成入口禁用。资产生成以单元检查点保存成功图，供应商 5XX 且账单终态未知时停止后续调用。

本次真实生成中，`scene_007` 的 master、layout 成功；reverse 在约 149 秒后由漫路（DeyunAI）`gpt-image-2` 返回 `500 / image2O100IFR / Internal Server Error`，interaction、detail 未提交。人物“沈砚辞（现代）”同时存在服装字段补齐不完整，这是独立的数据合同问题。

### 音色、对白与口型

修改前：项目只有单一 `voice_id`，多角色对白会串成同一声音；剧情视频先生成无声视频再混入 TTS，没有音频驱动口型或对齐 QA。

修改后：授权音色包先进入只读试听库 → 用户逐角色选择音色 → `voicePlanService` 保存旁白与角色映射 → `ttsAdapter` 逐角色逐句生成并按台词顺序拼接。生产已同步 1103 条样音，527 条达到当前克隆时长门槛；未批量触发付费克隆。

尚未完成：剧情对白的逐说话人镜头合同、`ad_avatar.lip_sync` 接入、音素/口型对齐 QA 和失败降级策略。

## 3. 代码与文件变更清单

- UI 恢复引导与运行态禁用：`public/story-ad/views/assetCenterView.js` 及相关 UI 回归。
- 跨时代/转世身份：`briefAuthorityService.js`、`assetPlanService.js`、`personLookProfileService.js`、`subjectCheckpointProjectionService.js`。
- 人物双计数合同：`personCountContractService.js`、`contextBuilder.js`、规划及缺失区段恢复服务。
- 旧任务安全迁移：`migrate-story-ad-era-identities-v170.js`、`migrate-story-ad-person-count-contract-v174.js`。
- 音色库与多角色 TTS：`voicePackService.js`、`import-authorized-voice-pack.js`、`voicePlanService.js`、`ttsAdapter.js`、`mediaPipelineService.js` 及角色音色 UI。
- 发布闭包：v179 将人物计数迁移脚本纳入 649 项不可变制品。
- 本交接：`docs/handoffs/2026-08-11-story-ad-v179-home-continuation-handoff.md`。

## 4. 提交记录与家庭电脑拉取

- `89b610e`：视觉失败引导、运行态按钮与跨时代人物拆分。
- `7fa8fac`：授权音色库及多角色 TTS。
- `a572aea`、`22a6144`、`3e69a4c`：转世独立身份、关系词作用域及谱系投影。
- `43adc6a`：显式重新规划安全替换旧检查点。
- `634755a`：剧情身份与视觉资产计数解耦。
- `6fcb647`：人物计数迁移脚本进入不可变发布闭包，是当前生产运行代码基线。

家庭电脑执行：

```powershell
cd D:\VIDO
git status --short
git fetch --all --prune
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
git log -5 --oneline
npm install
node src/server.js
```

拉取前如有未提交修改，先单独提交或暂存；禁止使用 `git reset --hard`。服务器连接使用家庭电脑自己的 SSH 私钥，不能通过 Git 复制公司电脑私钥。

## 5. 本地、Git、生产三方一致性

| 核对项 | 本地 | 目标 Git | 生产 | 结论 |
|---|---|---|---|---|
| 运行代码基线 | `6fcb6479e2cb9cc6d87d409cdd54cb4b16d3a6b1` | origin 同 SHA，核对时 `0/0` | 以 v179 不可变清单为权威 | 一致 |
| Build | `20260811-ui-v179` | v179 配置已提交 | `20260811-ui-v179` | 一致 |
| Artifact | `7e08f48e82cec11921868bb7a88619d1a864f80102bdf422fcbfb83740b59df1` | runtime manifest 同值 | 当前 release 目录同值 | 一致 |
| Release bundle | `fe4402f5920941fcf4145fd1c6e732cb0dc75e7fcd5916134f2014e88b7241dd` | 本地清单计算同值 | 内外网 version 同值 | 一致 |
| Runtime | 648 项，hash `122be5b09b254d4ec569c7324b7b97cb412432ea589c8010f6456febb1348135` | runtime manifest 同值 | 648 项逐文件 0 缺失、0 差异 | 一致 |
| Story-ad Public | 47 项逐文件通过 | release manifest 同值 | 47 项逐文件 0 缺失、0 差异 | 一致 |

本轮开始前已存在的旧交接文档删除、旧日志修改和未跟踪研究文档均保留在工作树，没有覆盖或纳入本交接提交。交接 MD 提交后远端 HEAD 会比运行代码基线多一个纯文档提交，不要求生产部署该文档。

## 6. 实际执行的验证

- Git：执行 `git fetch --all --prune`；提交交接前本地与 origin 为 `0/0`，SHA 均为 `6fcb647`。
- 本地发布完整性：运行范围相对 HEAD 无代码差异；build、artifact、bundle、runtime hash 与 v179 清单一致；本地 3007 health 为 `ok`。
- 生产不可变制品：`/opt/vido/current` 指向 artifact release；runtime 648 项、public 47 项逐文件校验均为 0 缺失、0 差异，传输闭包共 649 项。
- 生产运行：PM2 `vido` online，PID 20822，重启次数 0；内网和公网 health 均为 `ok`，内外网 version 完全一致。
- 数据库：生产数据库状态 `ok`，SQLite `PRAGMA quick_check` 返回 `ok`。
- 任务：真实 SQLite 中活动 generation 为 0；目标任务为 `visual_assets_failed / PROVIDER_5XX_AMBIGUOUS`，没有活动 generation。
- 目标失败调用：2 个成功单元为 `completed/confirmed`；reverse 为 `submitted_unknown/unknown`；后续 2 个单元为 `not_submitted/not_submitted`。
- 当日实现阶段已执行定向回归、完整 `platform:upgrade:test`、语法检查、发布闭包及生产发布后健康核对；v179 发布清单 649 项通过，真实迁移模型调用 0。
- 本轮交接核对仅执行只读检查，没有重启生产、写业务数据或触发模型/媒体调用。

## 7. 未执行项、剩余风险、费用与数据边界

- 本轮没有再次运行完整平台回归，因为运行代码未变，仅新增交接文档；采用当日 v179 发布前后已完成的完整回归结果。
- 未替用户重新点击视觉资产生成；reverse 请求账单终态仍未知，禁止盲目重放。
- 真实 SQLite 累计存在 41 条历史 `billing_state=unknown + submitted_unknown` 模型调用；当前官方 `check-new-story-ad-active-tasks.js` 只统计 submitted/accepted/polling/running，错误报告未知计费为 0。这是下一轮必须修复的审计口径缺口。
- `image2O100IFR` 没有供应商公开定义，失败记录没有供应商 request ID/task ID；目前只能确认漫路 `gpt-image-2` 企业通道间歇性内部 500，不能断言具体是审核、容量还是转发节点。
- 人物现代造型字段补齐、逐角色剧情对白、口型同步和对齐 QA 尚未完成。
- 生产音色库已同步样音，但没有批量付费克隆；继续开发时不得自动对 1103 条样音发起克隆。

## 8. 回家后继续优化的明确顺序

1. 拉取远端最新 HEAD，确认 v179 build、artifact、bundle、runtime hash 与本文件一致。
2. 先修 `check-new-story-ad-active-tasks.js` 和发布 readiness 对 `submitted_unknown` 的统计，增加历史/当前/已核销三种账单状态及回归；修复前不要发布或重试目标任务。
3. 保存供应商 client request ID、响应 header request ID、task ID 和原始错误分类；建立 `image2O100IFR` 核账/人工确认入口，再设计只重试缺失单元。
4. 修复人物方案提示词及本地校验，确保每套造型在付费前已有 garment、shoes、accessories、colour、material。
5. 补剧情双人对话合同：逐角色分句、角色音色、单一可见说话人、正反打/逐说话人镜头。
6. 将分段 TTS 音频接入 `ad_avatar.lip_sync`，增加音素—嘴型对齐 QA、失败降级和费用门禁；只用短样片做首次真实验证。
7. 完成定向、完整、静态和发布验证后，再决定是否让用户继续目标任务；不得在计费未知未核销时承诺可测试。
