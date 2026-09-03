# 2026-09-03 剧情广告 V426 公司到家庭续接交接

> 核对日期：2026-09-03，Asia/Shanghai；公司电脑：RD-fuxing，项目目录：D:\VIDO。
>
> 本文接续 `2026-09-03-story-ad-v412-office-continuation-handoff.md`，汇总今天 V412 之后的修复、生产任务处理和最新声音流程。旧交接保留历史，涉及前置声音确认的旧说明已被本文的新合同替代。
>
> 当前分支：`codex/story-ad-systemic-remediation`；实际远端：`origin`（Gitee）。不要照旧协议示例切换到其他分支。
>
> 生产版本：`20260903-production-v426`。运行代码三方一致；真实人物口型正例和 Seedance 成片效果尚未完成验收。

## 1. 最新用户决策

1. 共用链路必须适用于后续新任务，不能仅修当前任务数据。人物、场景、分镜必须依据已确认剧情；一致性问题尽可能在分镜阶段发现。
2. 用户选择支持的视频模型后单击生成；不再要求费用、复杂度二次弹窗确认。未知价格保留为未知，不伪造 0 元。
3. 页面持续显示生成中、成功、失败、停止或部分完成。普通用户看到简短结果；授权超管可以查看具体原因。
4. 当前流程为：**确认分镜 → 生成带原生声音的分镜视频 → 合成初版 → 成片剪辑中可选修改旁白、对白、背景音乐**。独立配音不再是视频生成的前置门禁。
5. 旁白和对白必须与剧情一致，在本镜内完整说完；人物出镜对话、人物介绍还必须核对说话人物、轮次和口型同步。
6. 后期替换声音要重新核验；失败保留原成片。不能以删除或遮蔽错误代替修复，也不能自动重复付费重试。
7. 本次交接只核对、记录和同步文档，不重新生成用户素材、不修改任务业务数据。

## 2. 今天完成的修改与根因

### 2.1 分镜处理 7/7，但只有 2 张通过；场景与剧情错位（V418）

已确认根因：单人物兜底把纯产品镜头也绑定为有人出镜；模糊地点匹配使第二镜提前进入展厅；完整人物/场景视觉验收位于过晚的下游。

修改后：明确剧情场景优先，删除无条件单人兜底；图片生成先保存候选并执行主体数量、场景、人物/商品视觉 QA，通过后才发布为可用分镜。进度分别展示已处理、通过和失败，失败处理数不再等于成功出图数。并发完成时复核当前权威，防止旧结果覆盖新设定。

相同镜头身份、相同台词的视觉修改保留既有音频；台词变化仍需要重新核验声音。本轮已将后续声音编辑迁移到成片阶段，不能恢复“分镜后强制 TTS”的旧测试或旧入口。

### 2.2 新任务生成场景却提示旧版人物（V418）

生产证据表明方案版本相同，真正错误是人物指纹计算规则不一致：视觉写回忽略嵌套时间字段，规划读取使用完整排序 JSON SHA256，导致生成元数据被当成用户新编辑。

新增统一人物规划指纹服务，规划读取、视觉写回和恢复使用相同规则。真实人物设定变更仍正常失效。修复器只允许在原人物内容指纹精确匹配、方案/内容版本一致且没有活动生成时事务修正；备份回执和历史未知计费隔离保留。

### 2.3 已确认 7 张分镜，视频页却显示 0 首帧（V419）

旧路径：确认分镜不改变 content_revision → 前端只刷新 summary → 旧 media.approved_frames=[] 继续缓存；迟到预加载还可能覆盖新状态。

新路径：确认状态变化同样失效相关分区；mutation 推进请求序号，迟到预加载被拒绝；视频页读取当前已确认首帧。完整但未确认时提示确认，不要求重画。

### 2.4 选模型直接生成，去掉未知价格阻断（V422）

旧路径：GET 预检 → 人工勾选费用/复杂度 → 未知价格阻断 HTTP 和 worker。

新路径：用户选择模型并提交 → 服务端校验当前素材、模型和范围并锁定指纹 → 队列执行前再次复核 → 调用所选模型。价格只用于后台估算，旧人工费用确认函数退出执行链路。防重复队列、未知计费隔离、失败停机和禁止自动付费重试继续保留。

### 2.5 视频失败后页面没有明确结果（V426）

生产失败记录已经存在，但进度归属仍指向旧 final 路由，实际页面是 compose；页面只看 clips.length，因此失败时仍显示空白引导。

新路径：HTTP 提交失败记录 video_submission；worker 失败记录任务和进度；接口按权限投影；compose 页面订阅持久结果状态，显示实际通过数量。历史失败不冒充新尝试的结果，生成期间禁用重复提交。

最终实现位于懒加载的 `finalView.js`；早期独立 `components/videoGenerationFeedback.js` 已移除，不要按中间日志重新创建全局导入。

### 2.6 原生声音、完整台词和口型验收（V426）

旧路径：前置 TTS 确认 → 视频原生音效另查 sound_generation 模型配置 → 可能改换口型模型 → 叠加独立 TTS → 合成再混音。SZ 虽能用于视频，却因不在独立声音阶段而提前失败。

当前路径：

```text
已确认剧情、分镜和视觉 QA
→ 规划本镜台词与时长、检查所选视频模型和质检能力
→ 所选模型生成原生音视频（保持模型选择）
→ 提取实际音轨；出镜对白另提取连续口型画面
→ 实际转写与剧情台词、时间边界、说话人物及口型核对
→ 视觉及音频 QA 都通过
→ 原生音轨合成初版
→ 用户在成片剪辑中选择声音修改
→ 新声音时长/裁剪/转场检查和成片音视频复核
→ 成功才发布新成片，失败保留原成片
```

- `nativeAudioWorkflowService` 统一台词、原生声音需求、提示词和镜头时长。当前实现单镜最大 15 秒；过长台词提前拒绝，不能靠截断或赶读通过。
- 提示词要求按剧情原词与顺序说完，区分出镜对白和画外旁白，预留结尾余量。人物介绍归入出镜对白。
- `nativeAudioQaService` 读取实际音频，出镜对白附 12fps 连续画面；检测模型在转写时不获得期望台词，之后由本地逻辑比对。缺音轨、漏词、多说、句尾截断、轮次不符、口型证据不足都不能通过。
- 当前判定阈值包含转写置信度至少 0.9、句尾距镜头结束至少 0.35 秒；对白还要求检测报告口型验证通过、置信度至少 0.9、估计偏移不超过 120ms。
- 这些是当前软件判定门槛，**多模态模型对口型偏移的估计不等于经过独立测量的精确同步保证**。真实人物正例尚未实测，是后续优先验收项。
- QA 证据绑定视频文件 SHA256、台词和策略版本；合成前复查，手工视觉放行不能绕过声音验收。同证据并发去重；失败记录缓存，不自动重复付费检测。
- 视频阶段不再自动生成或叠加历史 TTS/BGM；场景块虚拟镜头也传递原生声音需求；不通过强制目标总时长重定时来压缩台词。
- 最终剪辑按需加载声音功能；保存声音/时间线草稿不会删除原成片。修复异步按钮执行后无法恢复的问题，失败后可正常操作。
- `audioTimelineIntegrityService` 检查剪裁、静音、速度、转场和替换配音时长，避免截断话语或在转场中遮蔽正在说话的嘴。
- 原生声音目前是混合音轨，没有实现可靠的独立人声/音乐分轨提取。当前替换使用整条声音重建；不应声称可以无损单独替换原生 BGM。
- 修改人物对白后若口型不匹配，当前实现拒绝发布并保留旧片；未实现自动口型重绘/自动视频重生。

## 3. 两个生产任务的准确续接状态

### 旧广告：佛山智造 · 不锈钢品牌广告

- ID：`b83fa67c-244a-4869-b3cc-df282fad5c59`。
- 页面：<https://vido.smsend.cn/story-ad/projects/b83fa67c-244a-4869-b3cc-df282fad5c59?view=compose>。
- 今天按用户授权修复为：SH01–02 客厅，SH03–07 展厅；出镜人数 `1/1/0/0/0/0/1`。场景切换与产品特写明确采用合适的剪辑边界，不强求跨场景逐帧继承。
- 7 张分镜通过当前视觉 QA 并已确认。今天修复使用 3 张新图（1/2/7）和 4 张重新核验旧图（3/4/5/6）；第5镜的一次 Image-2 内容审核拒绝保留，未换供应商绕过，后用合格旧产品特写恢复。
- 当天该次修复模型调用 `321→349`，其中 24 次 QA、4 次图片请求（3 成功、1 审核拒绝）。之后代码发布及本次交接均未增加该任务调用；当前仍为 **349**。
- 当前 **7 张已确认首帧、0 条视频、7 条历史配音**。音频哈希：`5976c85e9303707ed5b21a8efa16f48e646a3443101387dccbb564a91f6b9f2e`。
- 保留 15:49 的历史 `video_failed / SOUND_GENERATION_MODEL_NOT_ALIGNED` 记录。它不表示 V426 新执行失败；本次没有把旧失败改成成功，也没有代用户重试。
- V426 上 SZ 模型只读预检 `ready`、`blockers=[]`，7 个生成单元。台词规划后的时长为 `11/10/9/9/8/8/10` 秒；只读预检没有改写分镜表、任务或音频，没有模型调用。
- 这 7 镜目前均为 **画外旁白**，不能用此任务证明人物出镜口型正例已验收。

### 新任务

- ID：`b05000a1-a10d-4d2d-bbe9-659bcdd00343`。
- 已修复人物指纹误报，人物与场景方案可用性曾完成生产只读核对；当前任务状态 done，最近阶段 scene_config_done，模型调用仍为 **12**，无活动生成。
- 历史生成单元 `gu_2907898f02daf4007b9ae72d52a86395` 保留 `billing_unknown`，`automatic_retry_allowed=false`。其隔离记录不能被删除或改成成功；本次没有核账或重试。
- 后续续接先重新只读检查当前资产/场景完成情况，不能从“代码已更新”推断所有下游素材都已生成。

## 4. 关键代码和测试入口

以下路径相对仓库根目录；本机绝对根目录为 `D:\VIDO`，回家以实际克隆目录为准。

| 范围 | 文件 |
| --- | --- |
| 剧情人物/场景绑定 | `src/services/storyAdWorkspace/storyFlowContractService.js`、`src/services/newStoryAd/storyboardFlowConsistencyService.js`、`storyboardTableService.js` |
| 分镜候选和提前视觉 QA | `src/services/newStoryAd/storyboardCandidateService.js`、`storyboardVisualQaService.js`、`storyboardAuthorityRepairService.js`；`scripts/repair-story-ad-authority-v413.js` |
| 新任务人物指纹 | `src/services/newStoryAd/assetPlanCastLineageService.js`、`assetPlanCastLineageRepairService.js`、`assetPlanService.js`、`personAssetLifecycleService.js` |
| 确认与缓存竞态 | `public/story-ad/store/projectStore.js`、`projectBundleStore.js`；`src/services/storyAdWorkspace/storyboardImageConfirmationGateService.js` |
| 一键提交和费用解耦 | `src/services/newStoryAd/videoSubmissionAuthorizationService.js`、`videoSubmissionGateService.js`、`paidVideoExecutionPolicyService.js`；`src/services/videoGenerationCore/costGuard.js` |
| 结果和权限投影 | `src/routes/newStoryAd.js`、`src/services/newStoryAd/publicFailureProjectionService.js`、`taskProgressProjectionService.js`、`storageService.js`；`src/services/storyAdWorkspace/projectBundleService.js` |
| 原生音频/口型/时间线 | `src/services/newStoryAd/nativeAudioWorkflowService.js`、`nativeAudioQaService.js`、`audioTimelineIntegrityService.js` |
| 视频与合成执行 | `src/services/newStoryAd/storyAdService.js`、`mediaPipelineService.js`、`videoAdapter.js`、`videoAdapterMediaRuntime.js`、`videoLineageService.js`、`composeService.js`、`providerAdapterRegistry.js` |
| 后期声音与流程 UI | `audioProductionService.js`、`soundDesignAssetService.js`、`storyAdTimelineService.js`（均在 `src/services/newStoryAd/`）；`public/story-ad/app.js`、`views/finalView.js`、`finalEditView.js`、`finalSoundView.js`、`soundDesignFeature.js`、`storyboardView.js`、`shotDesignerView.js` |
| 新增定向回归 | `scripts/test-story-ad-authority-early-qa-v413.js`、`test-story-ad-new-task-cast-lineage-v417.js`、`test-story-ad-confirmed-frame-cache-v419.js`、`test-story-ad-direct-video-submit-v420.js`、`test-story-ad-video-feedback-v423.js`、`test-story-ad-native-audio-v424.js`、`test-story-ad-audio-editor-v424.js` |
| 发布身份 | `config/story-ad-release.json`、`config/story-ad-runtime-manifest.json`、`public/story-ad/release-manifest.json`、`public/story-ad/release.js` |

完整文件差异可复查：

```powershell
git diff --name-status e4ab72c19 bded9a1c9 -- src public scripts config package.json package-lock.json
```

## 5. 提交记录与三方一致性

交接创建前的本地及 Gitee HEAD：`bded9a1c9c82154857c908e09884470156d3267f`。交接文件会以独立文档提交推进 HEAD，不改变 V426 运行源码或清单，不为文档重新部署。

| 提交 | 内容 |
| --- | --- |
| `140f23105`、`5747cd77c` | 剧情人物/场景权威与提前视觉 QA、模块边界 |
| `3ae320e04`、`a21db8486`、`7221d7e30` | 新任务人物指纹、隔离记录安全恢复、V418 制品 |
| `2da0a584d`、`07a47ef99` | 分镜确认缓存竞态与 V419 |
| `be78b261e`、`7714216d4`、`17cbd2d33` | 直接提交、退出旧费用门禁、V422 制品 |
| `fb4418788` | 视频结果持久反馈 |
| `caae6dccb`、`b13c29117` | 原生音频、口型与剪辑完整性，新流程路由 |
| `f3bebb456d23e11605f52d6fa8601ec75822a264` | V426 封存源码；旧导航回归迁移 |
| `bded9a1c9c82154857c908e09884470156d3267f` | V426 不可变构建产物 |

18:11–18:13 的本轮只读核对结果：

| 核对项 | 本地 / Git / 生产结论 |
| --- | --- |
| 分支与远端 | 本地 `codex/story-ad-systemic-remediation` 对 `origin/codex/story-ad-systemic-remediation`，fetch 后 ahead/behind `0/0`；创建本文前工作树干净 |
| 实际 Git 远端 | 仅 `origin=https://gitee.com/fu-xing46/newvido.git`；未配置 GitHub remote，未独立核验 GitHub，不声称 GitHub 镜像一致 |
| 运行版本 | 本地 3007、生产和公网均为 `20260903-production-v426` |
| 发布源码 | `f3bebb456d23e11605f52d6fa8601ec75822a264`，与本地/Git 构建清单一致 |
| 运行文件 | 本地 993 个、生产 993 个逐文件 SHA256 验证通过，差异 0；本地前端清单 141 个文件验证通过 |
| 运行清单文件 SHA256 | 两端均为 `be06ebab8f80f074262bd2e040004cdef7568467851cbe1df9ae8786fd07fe47` |
| 前端清单文件 SHA256 | 两端均为 `c178669cc671de5a20ea91c2c41f232f9141ad2bc93941fbee16bf44430bbb6e` |
| artifact_id | `44fb484daf65445ac394395e8c62decfbfbfae53da1f70f93fd1e2889ceb3069` |
| release_bundle_id | 本地/生产/公网均为 `2327b03b6d29f33be25ead156b66a9a1a1f4f415cddb6a3f3ca232f4933264c5` |
| runtime_hash | `e43215dc053044dee2e6cdd8e8e42612878325bce01e2f394fcaedfedea82a4f` |
| 运行进程 | PM2 `vido` online，PID 17705，restart 0；PM2 cwd/入口均位于当前不可变制品目录 |
| 健康 | 本地与公网 HTTP 200；生产内网 HTTP 200；SQLite `quick_check=ok` |
| 业务状态 | 两任务调用数 349/12，无活动生成；7 张已确认分镜和 7 条历史配音保留 |
| 历史计费 | unknown 调用记录 70，保持历史值；受保护的新任务生成单元未重试 |

生产主机 `43.98.167.151`，SSH root/2222，别名 `vido-prod`，服务端口 4600。应用固定入口目录 `/opt/vido/app`；**当前真实执行目录**为 `/opt/vido/releases/44fb484daf65445ac394395e8c62decfbfbfae53da1f70f93fd1e2889ceb3069`，`/opt/vido/current` 指向它。不要用旧目录的 Git HEAD 代替发布清单核验。

## 6. 实际验证过程

### 当日开发与发布阶段已执行

- 根因回归先取得生产等价证据，覆盖剧情场景/人数、人物指纹、确认缓存、迟到并发响应、长任务 ID、队列去重和失败恢复。
- V419 缓存回归、V420 直接提交 13 类检查、V423 反馈 19 项及浏览器 6 类状态切换通过。
- 原生声音 V424：10 组合同回归、真实 ffmpeg 测试媒体、3 路并发去重通过；模型为注入夹具，真实模型调用 0。
- 声音编辑浏览器回归：按需加载仅 1 次、显式应用、普通错误脱敏、失败保留原片通过；修复按钮失败后无法恢复的实际交互问题。
- 工作台参考接入新流程回归 158 项通过；相邻声音、首帧、视频预检、视频编排、转场、最终 QA 和草稿保留检查通过。静态/语法及 git diff 检查通过。
- V426 在公司电脑 RD-fuxing 完整执行正式门禁，3/3 通过且缓存数 0：systemic 19,510ms，platform_full 1,121,310ms，release_core 56,059ms。未降低门禁或恢复废弃流程。
- 不可变发布核验 994 个发布文件（含运行清单），切换后 993 个运行文件再查零差异；健康、数据库和目标任务核对通过。
- 生产 Chrome 页面实查：无前置声音步骤，显示“视频生成失败 / 视频成功 0/7”和“已确认分镜 7/7”；未点生成。
- 2 次独立质检接口探测：测试音频原文转写准确；相同音频加 36 张无口型黑帧时返回口型验证失败。第二次耗时 8,005ms、9,910 tokens。探测可能产生供应商费用；没有使用用户任务生成图片/音频/视频。这两次探测不等于人物口型正例或完整 Seedance 生成验收。

中间候选曾在门禁停止：前端体积、换行字节和旧流程测试断言；最终已按当前合同修正并重新构建 V426，通过正式完整门禁。未将中间候选结果当作生产通过。

### 本次交接操作实际执行

- 读取当天会话/变更/部署日志及上一份 V412 交接，核对当前文件和提交历史。
- `git fetch --all --prune`、分支/HEAD/工作树和 ahead/behind 检查。
- 本地前端及运行清单逐文件验证，SSH 生产运行文件验证，比较两端发布清单文件 SHA256、发布身份及 PM2 执行目录。
- 本地/生产公网版本与健康、生产内网健康、SQLite 只读健康检查、活动任务/历史计费/两个目标任务只读核对。
- 本轮没有调用模型、生成媒体、改写任务数据或重新部署运行代码。交接文档独立提交推送，完成后再次核对远端同步与生产身份。

## 7. 未执行项和已知限制

1. **真实人物出镜口型正例、多人轮流对白、中文长台词、真实 Seedance 视频及完整成片尚未付费实测。**不能据软件回归和黑帧负例声称口型已百分之百准确。
2. 尚无独立口型测量器对当前多模态检测结论进行标定；遮挡、远景、快速切换和低可见嘴部可能无法可靠判断，当前规则要求证据不足不通过。
3. 未实现混合音轨的可靠独立分轨、自动对白口型修复或自动重做对应镜头；更换对白可能需要用户明确选择后续处理。
4. 历史未知计费保留隔离，未核账、未重试。70 条 unknown 是历史审计，不等于 70 个当前运行任务。
5. 本次纯交接不重复全平台回归、不重装依赖、不生成收费素材；引用的完整门禁是今天 V426 发布时的真实结果。本轮仅新增文档与日志。
6. 只有 Gitee origin 可核对；GitHub 未配置、未核验。Git 同步不包含生产数据库、用户媒体、机器本地日志或任何凭证。
7. 旧任务已有失败记录保留，V426 的只读预检通过不代表已经生成成功。不得让下一位助手误把“0 视频”当成素材丢失并重画全部分镜。

## 8. 家庭电脑拉取和启动

先进入家庭电脑实际 VIDO 仓库目录，并确认没有未提交工作。存在本地改动或分支分叉时，先核对再处理，禁止 `reset --hard` 或覆盖用户文件。

```powershell
git status --short
git fetch --all --prune
git switch codex/story-ad-systemic-remediation
git pull --ff-only origin codex/story-ad-systemic-remediation
git rev-list --left-right --count HEAD...origin/codex/story-ad-systemic-remediation
git log -1 --format="%h %s" -- docs/handoffs/2026-09-03-story-ad-v426-home-continuation-handoff.md
```

ahead/behind 应为 `0/0`。生产源码提交、构建提交与文档提交用途不同，不要求运行源码 SHA 等于文档提交 HEAD。

依赖不存在或 lockfile 发生变化时再执行 `npm ci`。已有 3007 服务则不重复启动；否则：

```powershell
$env:PORT = '3007'
node src/server.js
```

本地入口 <http://localhost:3007>；生产入口 <https://vido.smsend.cn>。本地不会因 Git 拉取自动获得生产任务数据，不要复制整份生产数据库来测试。

家庭机 `LAPTOP-LDFOL0GT` 只运行本次实际修改模块的静态、定向及相邻回归，不默认运行 `platform:upgrade:test` 或整套跨版本回归。后续若继续改声音/视频，优先从以下真实存在的定向测试中按改动选取：

```powershell
node scripts/test-story-ad-native-audio-v424.js
node scripts/test-story-ad-audio-editor-v424.js
node scripts/test-story-ad-video-feedback-v423.js
node scripts/test-story-ad-direct-video-submit-v420.js
node scripts/test-story-ad-confirmed-frame-cache-v419.js
```

SSH 使用家庭电脑自己的已授权私钥，不通过 Git 传递。已有别名时检查：

```powershell
ssh -o BatchMode=yes vido-prod
```

别名应指向 `43.98.167.151`、用户 root、端口 **2222**。未授权时只安排家庭机独立公钥授权，不把密码、Token、API Key 或私钥写入本文或仓库。

## 9. 下一次继续优化的顺序

1. 拉取后先读本文和当前 AGENTS.md，核对本地 V426 清单、生产实时版本、任务活动状态与计费保护，不直接点击生成或修复历史记录。
2. **优先补真实人物口型效果验收**：分别验证单人介绍、双人轮流对白、长台词、旁白、嘴部遮挡；建立正确/错位/截断样本，测误放行和误拒绝。真实模型调用需明确范围和费用授权，不能为验证自动重跑整个用户任务。
3. 沿 `nativeAudioQaService.review → evaluate → assertVerified → composeStage` 核验结果可靠性；如现有视觉+音频判定不足，先用证据确定专门同步检测方案，再修改实现及对应定向回归。不能仅放宽置信度阈值让视频通过。
4. 核验后期修改对白、旁白、BGM的真实成片效果，以及修改失败保留旧片的恢复流程；明确混合音轨替换与独立分轨的产品边界。
5. 旧广告当前是画外旁白项目；由用户明确发起下一次视频生成后，再逐镜检查台词是否说完、声音是否符合剧情、跨镜声音是否连贯。保留现有7张分镜及历史7条音频。
6. 新任务按当前阶段继续；历史计费问题使用独立审计/核账证据处理。不得因为换电脑或更新版本而清空隔离记录。
7. 实际改代码后按当前电脑允许的门禁进行 Git 同步与不可变发布，完成生产健康及目标任务核对；不要未经请求自动再生成交接文档。

当天详细开发日志位于公司电脑 `docs/logs/{sessions,changes,deployments}/2026-09-03.md`，日志不随 Git 分发；本文件已汇总换电脑续接所需的关键内容。历史 V412 交接仅供追溯，最新流程以本文和当前代码为准。
