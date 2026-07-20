# 2026-07-21 剧情广告夜间优化交接

> 用途：明天到公司后从 Git 拉取今晚的剧情广告 V3 修复，继续做真实任务验收和后续优化。
>
> 分支：`codex/story-ad-v3-upgrade`
>
> 今晚最终业务代码提交：`c024ceac8b34eb6100064e37f12ff7fc44f47d5d`
>
> 本文不包含服务器密码、数据库密码、API Key、Token 或供应商密钥。

## 1. 明天到公司后的拉取步骤

```bash
git fetch origin
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
git status --short
git log --oneline -6
```

正常情况下，日志中应包含以下四个业务提交；本交接文档本身会位于它们之后的文档提交中：

```text
c024cea fix(story-ad): recover legacy keyframe errors
abf88b1 fix(story-ad): reconcile keyframe contracts and failures
9a921c8 fix(story-ad): restore progress and unify video workflow
457b3b1 fix: enforce story-driven dialogue quality
```

启动本地开发服务：

```powershell
node src/server.js
```

访问：`http://localhost:3007`。

拉取后建议先执行零成本验证：

```bash
npm run story-ad:v3:test
node scripts/test-new-story-ad-keyframe-parallel.js
node scripts/test-new-story-ad-compose-gate-autosave.js
```

不要提交 `.env`、`outputs/`、服务器或数据库凭据，也不要把本机历史未跟踪文档误加入提交。

## 2. 三方代码一致性（2026-07-21 夜间核验）

| 位置 | 提交 / 状态 |
|---|---|
| 本地分支 | `codex/story-ad-v3-upgrade` |
| 本地 HEAD | `c024ceac8b34eb6100064e37f12ff7fc44f47d5d` |
| Gitee 分支 HEAD | `c024ceac8b34eb6100064e37f12ff7fc44f47d5d` |
| 本地 / Gitee Git Tree | `1cfbef39fa9ead87fb53e94c1b2541a4192263bb` |
| 生产服务器 HEAD | `c024ceac8b34eb6100064e37f12ff7fc44f47d5d` |
| 生产工作树 | 已跟踪修改 0，未跟踪文件 0 |
| 生产进程 | PM2 `vido` online |
| 本地健康接口 | HTTP 200 |
| 生产公网健康接口 | HTTP 200 |

结论：交接文档生成前，本地、远端 Git 和生产服务器三方业务代码完全一致。本文提交后应再次把文档提交同步到生产，使三方最终仍保持同一提交。

## 3. 今晚四批核心优化

### 3.1 台词由“短反应”升级为故事职责合同

问题不是表格显示得短，而是上游剧本没有为每镜规定台词承担什么叙事职责；旧质量门只检查非空和禁词，下游分镜还可能再次压缩已确认台词。

今晚完成：

- 建立“目标/阻力 → 发现/证据 → 决定/结果”的听觉故事弧。
- 为镜头分配稳定台词职责和时长密度，口播密度控制在可听范围。
- 增加泛化惊叹、重复句式、省略号滥用和故事职责缺失检测。
- 分镜阶段逐字继承已确认剧本台词，禁止再次压薄或改写成单薄感叹句。
- 当前六镜 30 秒任务已从约 46 个有效字提升到 110 个有效字，约 3.67 字/秒；修改过程未增加模型调用。

主要文件：

- `src/services/newStoryAd/blueprintService.js`
- `src/services/newStoryAd/blueprintQualityService.js`
- `src/services/newStoryAd/storyboardTableService.js`
- `src/services/newStoryAd/qualityReviewService.js`

### 3.2 修复分镜前误拦截、进度缺失和按钮状态

根因是人物参考素材描述中的产品词被错误识别为产品素材，真实图片调用前就被产品一致性校验拦截；页面因此只停留在“准备中”，没有服务端镜头进度。同时分镜、场景等阶段没有统一绑定后台生成 ID，按钮忙碌态也缺少清晰的选中反馈。

今晚完成：

- 产品合同只信任明确素材类型，人物、角色、场景和环境素材不会因自由描述含产品词被误分类。
- 场景、剧本、分镜、真实画面、视频和合成统一使用后台任务与真实里程碑。
- 进度显示当前第几镜、完成量、成功/失败数量和百分比；新批次从 0% 开始，不复用旧终态。
- 点击中的主按钮使用高对比渐变、轮廓、勾选标识和 `aria-pressed`，悬停与真正选中状态分离。
- 第 4 步移除逐镜视频重生成入口，只保留“生成整条广告视频”主入口。
- 内部兼容按连续场景段组织视频生成并自动合成，但不会在页面要求用户逐镜提交视频。

主要文件：

- `src/services/newStoryAd/productIdentityContractService.js`
- `src/services/newStoryAd/stageProgressService.js`
- `src/services/newStoryAd/sceneBlockService.js`
- `public/js/new-story-ad/progress.js`
- `public/js/new-story-ad/button-state.js`
- `public/js/new-story-ad/generation-flow.js`
- `public/js/new-story-ad-legacy-ui.js`
- `public/css/digital-human-wizard.css`

### 3.3 分镜场景合同冲突改为生成前统一编译

生产失败证据：

- 第 2、5 镜由唯一允许的图片模型返回相同的供应商 500，未产生候选图片。
- 第 4 镜首张图片生成成功，但将场景合同中的连续无缝主墙画成带横竖边界的矩形拼板墙，场景一致性 QA 正确拒绝；纠偏重生成随后被供应商内容审核拒绝。
- 最早偏离点不是 QA，而是镜头描述要求“不同质感拼接”，场景合同同时要求“一整面连续无缝表面”，两份合同在进入图片模型前没有统一。

今晚完成：

- 在关键帧合同阶段编译镜头描述与绑定场景的表面拓扑，生成端只读取一份有效合同。
- 环境镜头以场景空间合同为权威；冲突的“拼接、多材质组合”解释为同一连续表面上的颜色、反射或微纹理变化。
- 明确禁止面板、瓷砖、样品块、网格、边框、沟槽、缝隙和可见接缝。
- 独立产品/样品对比镜头保留自己的分区能力，不会被连续环境墙面的规则误伤。
- 纠偏提示和首次生成使用同一份编译合同，避免第一次和重试采用不同语义。

主要文件：

- `src/services/newStoryAd/shotDesignService.js`
- `src/services/newStoryAd/keyframeContractService.js`
- `src/services/newStoryAd/storyAdService.js`

### 3.4 失败信息、支持编号和历史任务恢复闭环

旧链路的问题：关键帧批次先保存 `KEYFRAME_GENERATION_FAILED`，随后抛出的异常没有携带错误码；后台最终化再次分类为 `UNKNOWN` 并覆盖已保存状态。异步失败也没有同步请求的 `request_id`，页面却提示用户“提供请求编号”。

今晚完成：

- 批次失败改为 `KEYFRAME_BATCH_PARTIAL_FAILURE`，携带失败镜头、标题、错误码、最终状态和候选图是否存在。
- 每个失败镜头的 `latest_attempt` 必须进入 `failed`、`rejected`、`qa_unavailable` 或 `blocked` 终态，不能继续停在 `generating`。
- 后台生成 ID 作为稳定支持编号，同时写入任务、阶段和进度诊断。
- 安全留存供应商状态、原因码、请求号和错误码；不保存凭据或完整敏感响应。
- 供应商审核和不明确的 5xx 仍停止自动付费重试，不用重试掩盖根因或扩大成本。
- 历史 `UNKNOWN` 任务通过只读摘要兼容恢复准确错误，不修改生产数据库。
- 主服务新增逻辑拆入 `keyframeFailureService.js`，继续满足 3800 行架构门禁，没有放宽限制。

主要文件：

- `src/services/newStoryAd/keyframeFailureService.js`
- `src/services/newStoryAd/jobService.js`
- `src/services/newStoryAd/mediaAdapter.js`
- `src/services/newStoryAd/storageService.js`
- `src/services/newStoryAd/storyAdService.js`

## 4. 当前线上目标任务状态

- 任务 ID：`fd30ac4c-d54b-44c2-bab7-268fc622b5e5`
- 状态：`failed / keyframes_failed`
- 新错误码：`KEYFRAME_BATCH_PARTIAL_FAILURE`
- 支持编号：`164d3c60-833e-439d-b5ee-2598083570f5`
- 已通过并保留：第 1、3、6 镜
- 需要补齐或修复：第 2、4、5 镜
- 页面应显示：`第 2、4、5 镜未生成可用分镜图；已保留成功镜头，可仅补齐失败镜头。`
- 今晚代码修复、测试和部署没有自动重试这三镜，没有改写生产任务数据，也没有产生新的图片或视频模型调用。

## 5. 测试和部署证据

已通过：

```bash
npm run story-ad:v3:test
node scripts/test-new-story-ad-keyframe-parallel.js
node scripts/test-new-story-ad-compose-gate-autosave.js
```

专项覆盖：

- 场景连续表面与镜头“拼接”冲突复现。
- 独立产品/样品对比镜头不被误改。
- 无旧图的生成失败必须写入 `latest_attempt` 终态。
- 多镜批次失败保留成功镜头并返回逐镜详情。
- 后台业务错误码不能再被覆盖成 `UNKNOWN`。
- 异步失败必须返回可用支持编号。
- 供应商状态、原因码和请求号安全持久化。
- 历史第 2、4、5 镜失败无需改库即可恢复准确摘要。
- 按钮选中态、镜头序号、百分比和整条视频单入口。

生产部署后：

- 服务器完整 V3 回归通过。
- 生产工作树干净。
- PM2 `vido` online。
- 本地和公网健康接口均为 HTTP 200。
- 当前历史任务的只读公开摘要已验证为第 2、4、5 镜失败，并返回真实支持编号。

## 6. 明天建议的验证顺序

### 先做零成本检查

1. 拉取分支并运行完整回归。
2. 打开目标任务并强制刷新。
3. 确认页面显示第 2、4、5 镜失败和支持编号，不再显示无编号的通用“操作失败”。
4. 确认第 1、3、6 镜图片仍然保留。
5. 查看第 4 镜最终生成提示词，确认包含连续单一平面、零可见接缝和冲突解释。
6. 确认按钮选中态清晰，生成进度仍显示当前镜头和百分比，第 4 步没有逐镜视频重生成按钮。

### 如需真实生成验收

只有在确认图片模型费用可接受后执行一次：

1. 记录操作前模型调用数。
2. 只点击一次“补齐或修复镜头（3）”。
3. 不重新生成剧本，不重做全部六镜，不连续重复点击。
4. 观察第 2、4、5 镜的逐镜状态、供应商原因和支持编号。
5. 记录操作后模型调用数与三张候选结果。
6. 三张全部通过 QA 后，再进入“生成整条广告视频”。

如果第 2、5 镜仍返回相同供应商 500，应按供应商故障处理，不要通过重复付费重试验证代码；如果第 4 镜仍生成拼板墙，应保存最终提示词、候选图和 QA 证据，再检查编译合同是否真实进入供应商调用。

## 7. 明天继续优化的优先级

### P0：真实任务的一次受控验收

- 用当前目标任务只补第 2、4、5 镜，验证代码修复是否在真实供应商链路生效。
- 对比生成前后调用数，确保一次操作只处理三个失败镜头。
- 验证成功镜头、人物资产、五视图场景和剧本不会被重新生成。

### P1：把供应商诊断做成管理员可见信息

- 管理员详情页按镜头展示平台错误码、供应商状态、供应商原因码、供应商请求号和支持编号。
- 普通用户只显示可执行的中文结论，避免暴露内部响应或无法理解的堆栈。
- 对相同供应商原因码增加聚合统计，区分内容审核、服务故障和网络异常。

### P1：继续验证故事台词质量

- 使用不同品类、人物数量和场景规模的剧本样例验证故事弧，不只验证当前艺术空间案例。
- 检查 2.4–4.8 字/秒门禁在短镜头、多人对话和无旁白广告中的边界。
- 保持“剧本确认后分镜逐字继承”，禁止下游为适配画面再次压薄故事信息。

### P2：减少旧 UI 和主服务继续膨胀

- 新能力继续拆到小型领域服务，不再向 `storyAdService.js` 和旧 UI 增加条件分支。
- 保持 3800 行主服务门禁、完整回归和零重复付费门禁。
- 页面只保留每一步的单一主动作，管理员诊断信息与普通创作流程分层展示。

## 8. 今晚 Git 变更范围

从 `444d04ab00f33b685316ef84e09a4b2b9cc60ce2` 到 `c024ceac8b34eb6100064e37f12ff7fc44f47d5d`：

- 4 个业务提交。
- 34 个文件发生变化。
- 约 1018 行新增、211 行删除。
- 无新增运行时依赖。
- 不包含生产数据库、输出媒体、环境变量或凭据。

## 9. 本地工作区提醒

今晚核验时，本地已跟踪文件是干净的；仍保留 5 个用户原有未跟踪历史文档，没有纳入业务提交。明天在公司拉取前，如果公司电脑存在同名本地文件，先备份或提交到独立分支，避免覆盖。

本次交接不涉及新的 UI/UX 设计或业务代码修改，只整理已经上线并验证过的优化内容。
