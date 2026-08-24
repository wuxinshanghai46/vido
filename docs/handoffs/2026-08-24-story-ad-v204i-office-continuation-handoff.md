# 2026-08-24 剧情广告 V204i 公司续接交接

> 交接时间：2026-08-24 23:07（Asia/Shanghai）
>
> 目标：公司电脑从 Gitee 拉取今天全部优化，继续完善剧情广告对话、模型路由和参考视频读取。
>
> 权威远端：Gitee `origin` / `gitee`；当前分支：`codex/story-ad-systemic-remediation`。

## 1. 当日目标与用户决策

今天在早先 V202a 当前上下文/主体规划基础上继续完成以下用户决策：

1. 普通图片候选顺序固定为 SMSCRW Image Service → 微众 MaaS → 漫路 DeyunAI，三者均使用 `gpt-image-2`；360 全景仍使用独立能力门禁，普通图片模型不能冒充真全景。
2. 用户侧不再显示“旧入口停用”提示，当前人物、场景、商品和道具动作直接走现行入口。
3. 时长选项覆盖 15 秒、30 秒、45 秒、1 分钟、1 分30秒、2/3/4/5/6/8/10 分钟；总时长按合同精确覆盖，单镜头不再固定限制为 6 秒，而是在当前供应商能力范围内按剧情、动作和对白节奏规划。
4. 导演助理必须结合用户当前设想和后续反馈判断，不得要求用户套固定模板，不得换一种说法重复询问已经提供的信息。
5. 用户提供详细设想后，助理先回答预计如何呈现场景；信息齐全时明确告诉用户“可以生成剧情/广告脚本”。
6. 导演回复按 Unicode 单字符流式出现；达到旧问题数量、自由补充内容或进入规格阶段时都不能静默不回复。
7. 上传视频或粘贴视频链接后，读取状态留在当前对话下方，不能跳回第一条对话。
8. Liblib 等大于 200 MiB 的链接视频要有完整解决路径，不能只隐藏错误；导入失败与分析失败必须分开恢复，导入成功前不得调用视觉模型。
9. 人物每套造型的“6”是 4 张联系表加 2 张高分辨率原生主图的核心付费生成单元，不是最终只输出 6 张素材；服装/配饰细节独立处理，失败时只恢复对应细节，避免已成功人物资产重复付费。

此前 V202a 和生产资产/全景事实继续分别以以下文档为历史依据：

- `docs/handoffs/2026-08-24-context-driven-generation-v202a-handoff.md`
- `docs/handoffs/2026-08-24-production-asset-validation-handoff.md`

## 2. 修改前后的完整数据流

### 2.1 普通图片模型路由

修改前：

```text
图片阶段 -> SMSCRW gpt-image-2 -> 漫路 gpt-image-2
```

修改后：

```text
图片阶段
  -> SMSCRW/gpt-image-2
  -> 失败且计费状态允许继续时，微众 MaaS/gpt-image-2
  -> 再失败且计费状态允许继续时，漫路 DeyunAI/gpt-image-2
  -> 结果不确定时停止自动重提，保留计费审计
```

人物、人物档案、场景、商品、道具和关键帧的生产只读配置均已核对为该顺序。

### 2.2 对话、设想理解与剧情准备

修改前：

```text
用户长设想/自由反馈
  -> 固定问题槽位和旧问题数量上限
  -> 可能重复询问已提供内容
  -> 达到阈值或切换阶段时可能静默结束/删除回复
  -> 回复一次性整段显示
```

修改后：

```text
用户当前设想和每轮反馈
  -> 从原文证据提取场景、主体、出镜意图、时长和已覆盖主题
  -> 先说明预计开场、推进、重点画面和收尾
  -> 只问真正改变生成结果的唯一缺口，禁止重复主题
  -> 每轮内容继续进入语义分析，不受旧问题数量硬截断
  -> 回复按 Unicode 单字符流式显示
  -> 信息齐全时明确告知可以生成剧情/广告脚本
```

背景人物、无人出镜、单人、双人和多人均按用户自然语言识别，不再强制套用“设计师/客户”固定角色。

### 2.3 长时长剧情与镜头节奏

修改前：

```text
总时长 -> 单镜头固定不超过 6 秒 -> 长片容易被机械切碎
```

修改后：

```text
15 秒至 10 分钟总时长合同
  -> 按剧情节拍、动作完成度、对白长度和转场需要分配镜头
  -> 当前生成合同内单镜头 2–15 秒
  -> 汇总和校正后精确对齐用户目标总时长
```

这里的 15 秒是当前视频适配器已验证能力边界，不是新的剧情硬编码；以后供应商能力扩大时应从能力合同调整，不能再散落写死。

### 2.4 参考视频链接与超大输入

修改前：

```text
上传/粘贴链接
  -> 创建或绑定分析记录
  -> 前端整页 navigate/refreshShell
  -> 工作台重挂载，滚动回第一条对话

Liblib 261,665,678-byte 视频
  -> 响应头发现超过 200 MiB
  -> 立即 VIDEO_TOO_LARGE
  -> 失败卡错误进入 reanalyze
  -> 本地源不存在，SOURCE_MISSING
```

修改后：

```text
上传/粘贴链接
  -> ensureProject 只更新路由，不重挂工作台
  -> 当前对话始终保留 reference-progress-host
  -> 状态订阅原位更新进度卡

公开视频链接
  -> URL/SSRF 校验和 DNS 固定
  -> 200 MiB 内直接进入分析文件
  -> 超过 200 MiB 或缺少 Content-Length：在 1 GiB 接入硬上限内落临时源文件
  -> 本地 ffmpeg 生成不超过 720p、180 秒、200 MiB 的分析代理
  -> 持久化原始大小、代理大小和血缘
  -> 清理临时源文件
  -> 导入成功后才允许启动视觉分析

导入失败 -> 同一 analysis_id 调用 reimport
分析失败 -> 同一 analysis_id 调用 reanalyze
```

真实 Liblib 输入验证：原始 `261,665,678` bytes，生成分析代理 `12,840,824` bytes、`122.137` 秒、`1280×720`，临时原文件已清理，模型调用 0。

### 2.5 人物核心资产与细节恢复

现有生产结构保持不变：每套造型的 6 个核心生成单元是 4 张联系表和 2 张高分辨率原生主图；联系表还会拆分为更多原子素材。服装、可穿戴配饰和局部细节由对应细节服务负责，供应商结果不确定时只隔离该细节，不让已成功人物、宠物或配饰整体作废。本日参考视频修复没有修改人物生成数量、人物提示词或人物业务链。

## 3. 代码和文件变更清单

### V203a：图片候选、入口和长时长选项

- `src/services/pipelineModelService.js`、`scripts/configure-story-ad-image-routing-v203.js`：普通图片候选改为 SMSCRW → 微众 MaaS → 漫路。
- 对话与专业设置的公共时长合同增加 45 秒、3/5/8/10 分钟等完整选项。
- 用户界面隐藏旧入口停用的技术提示，直接使用当前功能入口。
- 导演助理在收到详细设想后先给出预计呈现方式。

### V204b：内容驱动镜头与语义去重

- `productionLimitsService`、`storyBeatShotCoverageService`、`storyboardTableService`：取消 6 秒硬上限，按内容节奏规划 2–15 秒镜头并精确覆盖总时长。
- `briefDialogueAssistService`、`briefDialoguePanel.js`：新增场景理解响应和原文证据 `covered_topics`，禁止首次输入与后续提问语义重复。
- `pipelineModelService`、`configure-story-ad-webang-content-routing-v204.js`：微众 Terra/Luna/Gemini 接入文本、实时对话和参考视频视觉候选。

### V204d：逐字回复、反馈语义与完成提示

- `briefDialoguePanel.js`：按 Unicode 单字符追加回复；去掉前端问题数量静默返回、恢复项目冒充设想完成及阶段切换删除回复。
- `briefDialogueAssistService.js`：去掉服务端达到旧问题数量后绕过内容模型的硬截断。
- 对话语义新增 `cast_intent`，从原文识别无人、背景人物、单人、双人和多人；信息齐全时明确提示可生成剧情或广告脚本。

### V204i：参考视频原位读取、大文件代理与恢复

- `public/story-ad/app.js`、`briefView.js`、`briefDialoguePanel.js`：静默更新项目路由，不整页重挂；当前对话始终保留进度挂载点。
- `src/services/newStoryAd/referenceVideoLinkService.js`：增加 1 GiB 接入上限、临时源文件、ffmpeg 分析代理和完整清理。
- `src/services/newStoryAd/referenceVideoAnalysisService.js`、`src/routes/newStoryAd.js`：持久化代理血缘，增加同一分析 ID 的 `reimport`。
- `public/story-ad/store/referenceRetryStore.js`：把重新分析/重新导入从 `projectStore.js` 拆出，主 Store 从 621 行降到 581 行。
- `scripts/lib/storyAdReleaseGatePlanner.js`：将视觉失败恢复测试精确归入 `upload_media`；未知文件仍保持 full 回退。
- `scripts/test-new-story-ad-visual-asset-failure-recovery.js`：在现有真实服装细节入口验证未知计费恢复，没有修改人物生产服务。

## 4. 提交记录、目标分支和公司电脑拉取

今天 V202a 后的关键源码提交：

```text
51bfb929 fix(story-ad): align image routing and intake UX
472747c5 fix(story-ad): make pacing and intake context-driven
a585c02e fix(story-ad): stream every reply and prevent silent dialogue exit
727f533d fix(story-ad): derive dialogue decisions from user feedback
f02115b3 fix(story-ad): recover oversized reference imports
be5d9860 fix(story-ad): preserve inline reference progress host
fee2c0ec test(story-ad): align detail billing recovery gate
f3363865 fix(story-ad): classify visual recovery release gate
8fe3ebe4 refactor(story-ad): isolate reference retry store
4e4bab89 build(story-ad): publish v204i manifest
```

生产运行源码身份为 `8fe3ebe455f3b57b19fe05529511dce58239d01b`；`4e4bab89` 是对应 V204i 不可变清单提交。本文提交位于其后，仅包含交接文档和日志，不改变生产运行代码。

公司电脑执行：

```powershell
cd E:\AI\VIDO
git status --short
git fetch --all --prune
git switch codex/story-ad-systemic-remediation
git pull --ff-only origin codex/story-ad-systemic-remediation
npm install
node src/server.js
```

启动后访问 `http://localhost:3007`。如果公司电脑已有未提交修改，先确认是否与远端重叠；禁止使用 `git reset --hard` 覆盖本地工作。

## 5. 本地、Gitee、生产三方一致性

交接文档提交前的只读核对：

| 核对面 | 结果 | 证据 |
|---|---|---|
| 本地 Git | 一致 | 分支 `codex/story-ad-systemic-remediation`，`HEAD=4e4bab89...`，跟踪文件干净 |
| Gitee `origin` | 一致 | `origin/codex/story-ad-systemic-remediation=4e4bab89...`，ahead/behind `0/0` |
| Gitee `gitee` | 一致 | `gitee/codex/story-ad-systemic-remediation=4e4bab89...`，ahead/behind `0/0` |
| 本地运行版本 | 一致 | `build_id=20260824-production-v204i`，runtime hash、artifact、bundle 与生产相同 |
| 生产运行文件 | 一致 | 清单内 839 个运行文件逐项 SHA-256，mismatch `0`；不可变发布共 840 个文件 |
| 生产制品 | 一致 | `artifact_id=834ab6ed...a46a7`，`release_bundle_id=3083affc...12bda` |
| 生产来源 | 一致 | `source_revision=8fe3ebe4...d01b`，`source_tree=1090255f...cd12`，`remote_sync_verified=true` |
| PM2 | 正常 | `vido` online，restart `0`，PID `22194`，cwd/exec 均指向上述不可变制品 |
| 健康/数据库 | 正常 | 内网、公网 health `ok`，SQLite `quick_check=ok` |
| 运行任务 | 安全 | 活动生成 `0`，活动未知计费 `0`；62 条历史未知计费继续隔离 |

本地保留 5 个此前已存在、与本任务无关的未跟踪文档，未覆盖、未提交。它们不属于运行清单，不影响三方运行代码一致性。

## 6. 实际执行的验证

### V203/V204 功能验证

- 时长选项、内容驱动镜头、总时长精确覆盖、设想先回应和语义去重定向回归：通过。
- Unicode 单字符流式回复、旧问题数量已满仍回应、背景人物语义、阶段切换保留回复和“可以生成剧情”提示：通过。
- 普通图片路由生产只读审计：人物、人物档案、场景、商品、道具和关键帧均为 SMSCRW → 微众 MaaS → 漫路；三家供应商、凭证和 `gpt-image-2` 均显示 ready。本次只读审计未调用模型。
- 微众内容路由生产只读审计：`brief_dialogue` 含 Luna，剧情/场景/QA 多个文本阶段含 Terra，参考视频视觉含 Gemini。

### V204i 参考视频验证

- `test-new-story-ad-reference-video-link.js`：73 项通过，覆盖公开 URL、Liblib 解析、SSRF、取消、超大代理、失败导入重试和零下游生成。
- `test-story-ad-workspace-reference-intake.js`：158 项通过。
- `test-new-story-ad-reference-video-analysis.js`：203 项通过。
- `test-story-ad-dialogue-domain-reference-v127.js`：39 项通过。
- `test-story-ad-dialogue-intake-v100.js`：53 项通过。
- 工作台 UI、结构边界和 release core / 黄金合同均通过；`projectStore.js` 为 581 行。
- 真实 261,665,678-byte Liblib 视频成功转为 12,840,824-byte 分析代理；没有启动模型、没有绑定测试任务、临时文件已删除。

### 发布与交接前复核

- 家庭电脑按影响范围执行 `upload_media`、`reference`、`workspace_ui`、`release_core` 四道门禁，全部通过。
- 本地 `test-story-ad-release-integrity.js`：11 项通过；源码身份检查通过。
- 生产 839 个清单运行文件逐项 SHA-256：mismatch `0`。
- 生产内外网版本、健康、SQLite、PM2、活动任务和活动未知计费完成只读核对。
- 本轮交接核对和文档生成没有模型、图片、视频或业务数据写入。

## 7. 未执行项、剩余风险、费用与数据边界

1. 按 `LAPTOP-LDFOL0GT` 家庭电脑规则，本日 V203/V204 发布未运行 `platform:upgrade:test` 或 V2/V3/V6 跨版本完整回归；已运行本次影响范围的静态、定向、相邻失败/恢复和发布门禁。
2. 参考视频链接接入硬上限为 1 GiB；分析代理最多取前 180 秒、最高 1280×720、必须低于 200 MiB。超过边界或来源站完全拒绝服务时会明确失败，不会静默截断。
3. 大文件代理会消耗临时磁盘和 ffmpeg 时间；临时源文件在成功、失败和异常路径均清理，仍需明天用生产监控观察并发大文件时的磁盘水位。
4. 生产有 62 条历史未知计费，只读隔离；活动未知计费为 0。不得自动重试或改写历史结论。
5. 真 360 全景模型仍未接入合格能力合同；不能用普通宽图裁切、拉伸或填充冒充全景。
6. **新发现的配置风险**：V204i 发布时旧 `new-story-ad-assist-provider-resilience-v127` 迁移再次覆盖了 `new_story_ad.assist` 路由，当前该单一阶段没有微众 Terra；`brief_dialogue` 的微众 Luna、剧情/场景/QA 等阶段的 Terra、参考视觉 Gemini 仍然存在。三方运行代码和制品完全一致，但明天应优先收敛迁移顺序/幂等合同，不能只手工再写一次配置。
7. 本日开发、回归、交接核对均未触发真实文本、图片、视频或付费媒体调用；真实 Liblib 验证只进行了公开文件下载和本地转码。

## 8. 明天继续优化的明确入口和顺序

1. 按第 4 节命令拉取，核对 `git status --short` 后启动 3007；先确认 `/api/story-ad/version` 为 V204i 或后续仅文档提交所对应的同一运行制品。
2. 优先修复发布迁移覆盖 `new_story_ad.assist` 的根因：画清 V204 内容路由配置 → V127 发布迁移 → PM2 环境设置文件的写入顺序，增加能复现“发布后 Terra 丢失”的回归，再通过不可变发布验证；不要只手动重排生产配置。
3. 在零模型调用夹具中继续测试导演助理：长设想、自由反馈、背景人物、无人出镜、已回答主题和信息齐全提示，确认不会重复问或静默结束。
4. 用不含敏感内容的公开小视频验证原位进度、取消、失败重读；如果验证真实大视频并会自动进入视觉分析，先确认费用授权，避免下载完成后触发付费模型。
5. 对 45 秒、3/5/8/10 分钟各跑一次零费用剧情结构验证，检查总时长、镜头节奏、对白和场景推进；不要把所有镜头重新限制回 6 秒。
6. 人物生成继续保持“4 张联系表 + 2 张原生主图 + 独立细节”当前架构；如需调整数量或细节策略，必须先做费用、失败恢复和历史资产兼容评估。
7. 真 360 全景继续作为独立能力任务，只有供应商真实 2:1、接缝和投影 QA 全部通过后才允许进入生产候选。

## 9. 安全与操作边界

- 本文不包含服务器密码、数据库密码、API Key、Token 或 SSH 私钥。
- 公司电脑使用自己的 SSH 私钥；不得通过 Git、MD 或聊天复制私钥。
- 生产运行权威是不可变发布清单和逐文件 SHA-256，不以服务器仓库 detached HEAD 判断。
- 任何真实模型/媒体调用都必须经过当前生成许可和费用审计；结果未知时禁止自动付费重试。
