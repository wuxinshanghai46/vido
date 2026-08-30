# 2026-08-28 晚至 2026-08-30 剧情广告系统性优化交接

> 交接时间：2026-08-30 23:50（Asia/Shanghai）
>
> 工作范围：2026-08-28 18:00 至 2026-08-30 交接时
>
> 当前开发分支：`codex/story-ad-systemic-remediation`
>
> 生产版本：`20260830-production-v318`
> 重点核对任务：`b83fa67c-244a-4869-b3cc-df282fad5c59`

## 1. 本轮目标与用户最终决策

这三天不是只修复一个家居广告样例，而是把“场景生成 → 场景验收 → 流向线稿 → 人物场景分镜 → 视频生成前门禁”按全行业通用合同重新收敛。用户连续确认的关键要求如下：

1. 页面点击后必须立即有状态和进度，不能动辄等待一分钟甚至更久才出现反馈。
2. 场景生成、失败修复、审核、局部重做和恢复必须使用统一入口，并保留真实任务状态；旧入口一旦废弃就不得再调用模型或参与发布门禁。
3. 场景导演状态必须使用真实场景背景，人物、动物、机位、路线和站位要可识别；机位使用摄影机图标，人物和动物按主体类型表达。
4. 场景与分镜顺序必须由剧情决定，不能由场景数组顺序、镜头覆盖规则或模型自由猜测决定。
5. “流向线稿”和“人物场景分镜”是不同业务产物；线稿用于确认镜头结构，不应产生图片费用，也不需要向用户暴露内部确认步骤。
6. 分镜图片必须铺满卡片、卡片高度和字体一致，剧情路径应利用完整可用宽度，操作按钮紧凑并靠右。
7. 单人镜头不能生成两个相同人物；该问题会影响后续视频首帧、身份连续性和人物消失/形变，因此错误图片必须被门禁阻止进入视频。
8. 重新生成前必须能看到本镜引用了哪些人物、场景、机位和其他资产，并允许用户编辑真实提示词。
9. 增加类似竞品的大尺寸提示词编辑器和“AI 帮写”；AI 帮写必须重新读取剧本、前后镜头和引用资产，只返回草稿，不自动保存、不自动生成。
10. 单镜与批量生成必须异步启动、显示总进度和逐镜进度，并使用任务锁避免重复点击导致重复提交和重复付费。
11. 通用能力必须覆盖室内、户外、车辆、道路、动物群体、工业、空中、水域、舞台、桌面、抽象和虚拟空间，禁止为当前家居任务叠加关键词特例。
12. 交接同步只以 Gitee（`origin`/`gitee`）为权威 Git 远端；GitHub 镜像不纳入一致性验收。

## 2. 周五晚以来的更新总览

起点提交为 `84be1d805e8b69b2347555302c864639e4ec51be` 之后，至应用构建提交 `19e68a43bf7e9257a7c3b2a3e7c109df5691c61f`：

| 日期 | 提交数 | 主要内容 |
|---|---:|---|
| 2026-08-28 晚 | 25 | 场景失败恢复、QA 状态分流、页面加载截止时间、统一批处理入口、持久化进度 |
| 2026-08-29 | 101 | 媒体模型选择、场景并发与逐卡进度、真实空间布局、审核自动闭环、旧链路禁用、流向线稿与分镜拆分、声音链路 |
| 2026-08-30 | 101 | 分镜断点恢复、性能优化、多场景权威、导演空间、空间规划、全行业主体合同、提示词编辑、AI 帮写、异步生成、剧情顺序 |
| 合计 | 227 | 271 个文件，新增约 14,334 行、删除约 2,505 行 |

详细提交可在公司电脑执行：

```powershell
git log 84be1d805e8b69b2347555302c864639e4ec51be..HEAD --date=iso-local --stat
git diff --name-status 84be1d805e8b69b2347555302c864639e4ec51be..HEAD
```

## 3. 按时间说明实际更新

### 3.1 2026-08-28 晚：场景失败恢复与统一入口

- 修复历史场景资产状态、浏览器缓存和服务端实际文件状态不一致的问题。正式资产引用进入保护集合，缺失文件不再冒充成功。
- 场景失败恢复改为展示真实失败原因、计费状态和下一步动作；未知计费请求不得直接重复提交。
- 场景 QA 提示与付费修复拆开：诊断不可用不再把整个卡片撑高，也不再伪装成必须付费重做。
- 页面加载增加截止时间和失败反馈，避免工作台长时间无响应。
- 多个场景由统一按钮启动服务端批处理；每个场景拥有独立进度 lane，任务级进度只做聚合，避免并发场景相互覆盖。
- 路由和批处理服务拆分，收敛文件边界和发布影响域。

主要生产节点：V246、V251、V252、V254、V256。

### 3.2 2026-08-29：媒体模型、场景生成、审核与流程合同

#### 媒体模型选择和路由

- 图片/视频生成模型改为用户显式选择，后台识别、审核和辅助模型继续按服务端配置路由，二者不混用。
- 前端公开目录只展示产品级名称和供应商缩写，不暴露内部路由细节。
- 模型选择写入改为原子预校验，避免只保存一部分配置。

#### 场景批量生成与真实进度

- 场景卡立即显示排队、提交、生成、审核、修复和完成状态；进度来自服务端持久化，不再依赖浏览器假计时。
- 人物和场景使用独立并发通道；不同场景可并行，同一目标不会重复许可。
- checkpoint 投影只接受有效成功图片，失败旧图不会被重新带回权威集合。
- 修复 `repair checkpoint` 删除真实布局图后触发假空间兜底的问题；场景世界统一使用真实 master/layout/reverse/interaction/detail 资产。

#### 场景 QA 和旧链路禁用

- QA 结果支持部分成功，系统自动诊断、局部修复和复核，不再因为一个检查失败丢弃整份结果。
- 用户可明确接受当前场景继续；不可用的视觉审核不会无限阻塞分镜。
- 旧单场景修复、旧审核按钮和旧路由变为无条件拒绝壳，不得调用模型、写业务数据或影响新合同测试。

#### 流向线稿、分镜与声音

- 场景接受状态与后续入口打通，接受后可以进入线稿/分镜流程。
- 先将六步流程拆成七步，明确“流向线稿”和“人物场景分镜”是不同产物；随后按用户决定隐藏用户可见的剧情流向确认，恢复为六步界面，但系统内部仍自动完成人物/场景绑定。
- 流向线稿为零费用结构产物，不能触发图片供应商；人物场景分镜才生成实际图片。
- 声音设计不再只是 UI 占位：建立环境声、动作声、对白、配乐与最终合成的真实 lineage。

主要生产节点：V257b、V258、V259、V260d、V261、V265、V270、V272、V273c、V276e、V277、V278b、V279b/V279c/V279d、V280a、V281c。

### 3.3 2026-08-30：分镜系统性修复与最终 V318

#### 断点恢复、并发和性能

- 统一镜头结构生成与图片生成状态，页面进入后立即投影已经完成的镜头，不再等待整批完成后一次出现。
- 分镜图片按受限并发处理，失败后只重试失败镜头；已成功镜头保留，不再整批重做。
- 分离进度、主体、场景和恢复投影模块，按需加载场景世界与导演组件，降低初次进入工作台的阻塞。
- 单镜同步生成原来受 Tengine 300 秒超时影响：页面收到 504 后，后端仍可能继续调用供应商。新链路统一使用 `async_start + target_indexes`，POST 快速接受，GET 轮询持久化进度。
- 增加活动批次锁和目标镜头锁；重复点击返回已有任务，不再重复提交同一镜头。

#### 多场景权威和剧情顺序

- 旧分镜会把场景数组顺序、覆盖镜头和模型返回混为一体，形成跨场景错配、首场景缺失、区域 ID 污染和错误回访。
- 新增剧情流合同和规划服务，从 `story_seed`/剧本中提取真实地点访问顺序，再绑定人物、场景、镜头与转场。
- 校验器阻止颠倒顺序、遗漏必要场景和无剧情依据的回访。
- 最终又发现“家居与展台”等应用范围泛词会被模糊匹配为第三次回访；V318 删除泛词推断，只接受规范化后的完整场景名称。
- 目标任务最终权威顺序是：`现代高端家居展示厅 → 高端商业展台`。旧历史合同仍记录“展台 → 家居 → 展台”，但已经被 freshness gate 阻止复用。

#### 导演空间、路径、机位和卡片布局

- 导演状态使用真实场景图作为空间背景，人物/商品/机位使用明确图标和颜色语义；机位轨迹、人物路线与站位进入同一空间坐标。
- 3D 旋转、选中反馈和操作提示补齐；场景切换时不再携带上一个场景的区域 ID。
- 分镜路径节点依据真实剧情节拍铺满可用宽度，不再集中在左侧留下大块空白。
- 分镜图片使用统一媒体区域和 `cover` 铺满；卡片高度、字体、底部操作区和右对齐按钮收敛。
- 家居 SH05/SH06 从极端材质特写修正为人物路线互动镜和完整空间建立镜，目的、视觉字段和转场依据同步清理，防止迁移时重复拼接旧目标。

#### 全行业空间与主体合同

- 新增通用场景域合同，按环境类型、主体类型、主体数量、运动方式、空间拓扑、决定性单帧和机位连续性编译。
- 覆盖室内、户外、道路、车辆、动物群体、工业、轨道、空中、水域、舞台、桌面、抽象和虚拟空间；不是按行业关键词建立例外表。
- 分镜图片提示不再同时附加完整多阶段动作，只执行一个决定性瞬间，避免模型把同一人物复制到多个时间位置。
- 主体 QA 升级为两遍实例枚举，检查画面中的真实人物/动物数量和同身份复制；旧 QA 策略生成的图片自动失效。

#### 提示词编辑、引用资产和 AI 帮写

- 每张分镜卡展开后显示本镜实际引用的场景、人物、机位视图、商品、道具和上一镜等资产，标明必需/辅助引用。
- 用户可编辑并保存真实分镜提示词；保存只让当前镜头失效，不自动调用模型、不自动生成图片。
- 新增大尺寸编辑弹层，完整展示引用资产和提示词，适合长文本修改。
- “AI 帮写”重新读取项目 brief、剧本、剧情流、当前镜头、前后镜头、场景规划、全行业合同和引用资产，只返回建议草稿；用户确认保存与生成仍是两个独立动作。
- 每张卡和页面顶部均显示生成进度、完成数和耗时；生成、上传和保存按钮紧凑靠右。

主要代码锚点：

| 提交 | 内容 |
|---|---|
| `bc5386f0` | 分镜部分完成后的断点恢复 |
| `c48e31ad` | 一次任务内生成目标分镜图片 |
| `3a771607` | 简化分镜主流程 |
| `0bcbe0d7` | 场景与分镜方向统一 |
| `4bb8bd7f` | 历史分镜场景恢复闭环 |
| `1525ce51` | 多场景有效覆盖 |
| `dca695c0` | 分镜性能和场景方向恢复 |
| `2f50715a` | 空间规划与图片 lineage |
| `0e121b23` | 全行业主体/场景合同 |
| `4623edf0` | 引用资产与可编辑提示词 |
| `a0ea4cde` | 大编辑器、AI 帮写、异步进度 |
| `56541ee6` | 剧情地点访问顺序成为硬权威 |
| `a43f3468` | 删除非地点泛词造成的虚假回访 |
| `19e68a43` | V318 不可变构建封装 |

## 4. 修改前后的完整数据流

### 4.1 修改前

```text
剧本/资产
→ 多个页面各自拼接场景和镜头数据
→ 场景生成与修复共用任务级进度
→ QA 失败、未知计费和缺图状态互相覆盖
→ 场景数组顺序被当成剧情顺序
→ 分镜结构与分镜图片混成一个长同步请求
→ 页面 300 秒超时但后端继续生成
→ 用户无法查看真实引用和提示词
→ 错误人物数量/错误场景图片仍可能进入视频
```

### 4.2 修改后

```text
项目 brief / 剧本 / story_seed
→ 剧情地点访问顺序提取（完整场景名）
→ 人物、场景、商品、道具权威资产
→ 场景批处理（目标 lane、并发、断点、计费隔离）
→ 场景 QA / 自动局部修复 / 用户接受
→ 零费用流向线稿与系统自动绑定
→ story_flow_contract（顺序、场景、镜头、转场）
→ storyboard_table（决定性瞬间、主体数量、空间和机位合同）
→ 引用资产投影 / 用户编辑 / AI 帮写草稿
→ async_start + target_indexes 异步提交
→ 总进度和逐镜持久化进度
→ 主体数量、同身份复制、场景与 lineage QA
→ 分镜确认门禁
→ 关键帧 / 视频 / 声音 / 最终合成
```

任何上游权威、提示词、主体合同或 QA 策略变化，只使相关镜头失效；旧结果保留为历史证据，但不能静默进入下游。

## 5. 关键文件与模块

### 5.1 后端场景和分镜权威

- `src/services/newStoryAd/sceneBatchOrchestrationService.js`：场景批处理、并发和状态编排。
- `src/services/newStoryAd/sceneCurrentAuthorityService.js`：当前可用场景权威。
- `src/services/newStoryAd/sceneVisualAcceptanceService.js`：场景 QA 与接受状态。
- `src/services/newStoryAd/scenePlanningAuthorityService.js`：场景空间规划权威。
- `src/services/newStoryAd/sceneDomainContractService.js`：全行业场景域合同。
- `src/services/newStoryAd/scenePerformanceCoverageContractService.js`：人物互动与空间建立覆盖。
- `src/services/newStoryAd/storyboardCheckpointRecoveryService.js`：历史分镜断点恢复。
- `src/services/newStoryAd/storyboardImageLineageService.js`：图片来源、合同和提示词 lineage。
- `src/services/newStoryAd/storyboardSubjectQaService.js`：主体数量和重复身份 QA。
- `src/services/storyAdWorkspace/storyFlowContractService.js`：剧情场景顺序、镜头和转场合同。
- `src/services/storyAdWorkspace/storyFlowPlanningService.js`：剧本地点访问序列规划。
- `src/services/storyAdWorkspace/storyboardSketchService.js`：分镜图片生成编排。
- `src/services/storyAdWorkspace/storyboardSketchTargetService.js`：明确目标镜头选择。
- `src/services/storyAdWorkspace/storyboardSketchProgressService.js`：分镜持久化进度。
- `src/services/storyAdWorkspace/storyboardAsyncLaunchService.js`：异步接受和启动边界。
- `src/services/storyAdWorkspace/storyboardPromptOverrideService.js`：用户提示词权威覆盖。
- `src/services/storyAdWorkspace/storyboardPromptAssistService.js`：AI 帮写上下文和草稿。
- `src/services/storyAdWorkspace/storyboardImageConfirmationGateService.js`：视频前图片确认门禁。

### 5.2 路由和前端

- `src/routes/newStoryAd/sceneBatchRoutes.js`：新场景批量入口。
- `src/routes/storyAdWorkspace.js`：流向、提示词、AI 帮写和分镜 API。
- `public/story-ad/views/sceneWorldLayoutViewer.js`：真实场景空间和机位视图。
- `public/story-ad/views/storyFlowSketchView.js`：紧凑流向线稿。
- `public/story-ad/views/storyboardView.js`：分镜卡、引用、保存、生成和进度。
- `public/story-ad/views/storyboardPromptEditorDialog.js`：大尺寸提示词编辑弹层。
- `public/story-ad/storyboard-simple.css`：分镜铺满、弹层、进度和操作布局。
- `public/story-ad/store/storyboardLiveRefresh.js`：分镜轮询与实时刷新。
- `public/story-ad/views/generationModelPicker.js`：公开媒体模型选择。
- `public/story-ad/views/finalSoundDesignView.js`：声音设计结果。

### 5.3 定向修复与回归

- `scripts/test-story-ad-scene-batch-orchestration-v255.js`
- `scripts/test-story-ad-scene-acceptance-and-progress-v276.js`
- `scripts/test-story-ad-storyboard-flow-v278.js`
- `scripts/test-story-ad-zero-cost-flow-contract-v280.js`
- `scripts/test-story-ad-storyboard-progress-concurrency-v284.js`
- `scripts/test-story-ad-direct-storyboard-images-v285.js`
- `scripts/test-story-ad-storyboard-scene-recovery-v291.js`
- `scripts/test-story-ad-spatial-storyboard-contract-v302.js`
- `scripts/test-story-ad-universal-scene-domain-v311.js`
- `scripts/test-story-ad-storyboard-prompt-assist-v313.js`
- `scripts/test-story-ad-storyboard-prompt-editor-ui-v314.js`
- `scripts/test-story-ad-narrative-scene-sequence-v314.js`
- `scripts/repair-story-ad-spatial-storyboard-v302.js`
- `scripts/repair-story-ad-storyboard-domain-contract-v311.js`

## 6. Git、本地和生产三方一致性

### 6.1 应用代码基线

| 核对项 | 当前证据 | 结论 |
|---|---|---|
| 本地应用构建 HEAD | `19e68a43bf7e9257a7c3b2a3e7c109df5691c61f` | V318 构建提交 |
| 本地工作树 | 生成交接文件前为空；随后仅新增本交接文件 | 无夹带代码修改；提交推送后必须再次确认干净 |
| 本地运行服务 | `20260830-production-v318`，health=ok，release allowed=true | 已从旧 V313 进程重启到当前磁盘版本 |
| Node 运行环境 | 本地 `v24.13.1`；生产/清单 `v20.20.2` | 应用构建一致，但 Node 环境不完全相同；公司电脑优先使用 Node 20.20.2 |
| origin/Gitee | `19e68a43...`，`ahead/behind=0/0` | 与本地一致 |
| gitee 别名 | `19e68a43...`，`ahead/behind=0/0` | 与本地一致；与 origin 指向同一 Gitee 仓库 |
| 生产 build | `20260830-production-v318` | 与本地清单一致 |
| 生产 source revision | `a43f3468265c17d6e43dbe3a9343bf1f701cfe09` | V318 源码提交；`19e68a43` 是其构建封装 |
| 生产 artifact | `99fcd5049e11196fde863cde74726a3dcf6daf1acf964297d4e69f1c108865ac` | 当前 `/opt/vido/current` 指向该不可变目录 |
| 运行清单 SHA-256 | `0b5bdf896b963c8cdf817a29514df6d61fb94d64e4a0fef64ecc5daffdf68182` | 本地与生产完全相同 |
| 制品逐文件核对 | 937/937 | missing=0，mismatch=0 |

交接 MD 提交只增加 `docs/handoffs/` 文档，不改变应用运行文件，因此生产不会因为文档提交重新发布。公司电脑拉取后的最终分支 SHA 以 `origin/codex/story-ad-systemic-remediation` 为准；应用构建基线仍为 `19e68a43...`。

### 6.2 生产运行状态

| 项目 | 结果 |
|---|---|
| 主机 | `43.98.167.151` |
| 当前运行目录 | `/opt/vido/releases/99fcd5049e11196fde863cde74726a3dcf6daf1acf964297d4e69f1c108865ac` |
| PM2 | `vido` online，PID 2063，restart 0 |
| Node | `20.20.2` |
| 内网健康 | `status=ok`，database.status=ok |
| 公网健康 | `https://vido.smsend.cn/api/health` 返回 `status=ok` |
| SQLite | `PRAGMA quick_check=ok` |
| release control | active bundle 与 runtime bundle 均为 `d622ebd19895b2ee2d608067f04d3a0d4f0ab0985613f756657485e4f8ac075e` |
| 活动生成 | 0 |
| 活动未知计费 | 0 |
| 历史未知计费 | 68，均为非活动证据，不得自动重试或核销 |

### 6.3 目标任务当前状态

- 任务状态：`done`；`active_generation_id` 为空；模型调用记录总数 277。
- 正确剧情声明序列：`space_01_showroom → space_02_exhibition`。
- 历史存储合同仍是：`space_02_exhibition → space_01_showroom → space_02_exhibition`。
- story flow gate 为 false，明确要求重新绑定；图片门禁有效 0/7，7 张旧图均因 `SUBJECT_COUNT_QA_POLICY_OUTDATED` 失效。
- 目标任务包含 6 条历史 unknown 计费证据，其中包含分镜图片、分镜表/重写和场景扩展调用；当前活动 unknown 为 0。不得把“非活动”理解为“可以自动重试”。
- 本轮交接核对没有调用模型、没有生成图片/视频/声音、没有写业务数据。

## 7. 实际执行的验证

### 7.1 V318 发布前门禁

- `story_content`：通过，34.442 秒。
- `workspace_ui`：通过，33.885 秒。
- `release_core`：通过，119.322 秒。
- 全行业场景合同：42 项通过，覆盖室内、户外、道路、动物、抽象、工业、空中和水域等场景，真实提供商调用 0。
- 分镜异步进度与并发：28 项通过，明确目标镜头、失败镜头恢复和重复许可均通过，付费调用 0。
- 提示词编辑弹层：24 项通过，模型调用 0、付费调用 0。
- AI 帮写、剧情地点顺序、空间规划、零费用流向和历史恢复定向回归均通过。

### 7.2 生产和交接核对

- `git fetch --all --prune`：origin 和 gitee 获取成功。按用户最终决定，GitHub 镜像不纳入本次一致性验收。
- origin、gitee 与本地应用构建提交核对：`0/0`。
- 本地与生产 `story-ad-runtime-manifest.json` SHA-256 相同。
- 生产清单 937 个文件逐项核对：缺失 0、哈希不符 0。
- PM2、内网健康、公网健康、SQLite quick check 和版本接口均通过。
- `check-new-story-ad-active-tasks.js`：活动生成 0、历史 unknown 68、活动 unknown 0。
- 批量 `readDb()` 审计脚本因结果过大触发 Python sqlite bridge `ENOBUFS`；没有用失败结果冒充通过，改用清单逐文件校验、专用活动任务脚本和 SQLite quick check 分项完成同等只读核对。
- 本地开发服务已重启并核对：`http://localhost:3007/api/health` 为 `ok`，版本为 V318，artifact/source revision 与生产一致。

## 8. 未执行项、剩余风险和费用边界

1. 家庭电脑 `LAPTOP-LDFOL0GT` 未运行 `platform:upgrade:test`、`story-ad:v2/v3/v6:test` 等跨版本全平台回归；按用户决定只执行任务影响范围门禁。公司电脑是否执行完整回归，应根据公司电脑规则和下一项改动风险决定。
2. 本轮没有点击“AI 帮写”“重新生成分镜”“继续生成视频”等真实模型入口；这类操作可能产生费用。
3. 68 条历史 unknown 计费记录必须保留证据；后续只能按供应商可核对结果逐条处理，禁止批量自动重试。
4. 目标任务旧 7 张分镜图和旧场景顺序不能继续进入视频；重新绑定和重新生成会产生新的实际模型调用。
5. 不要恢复已经禁用的旧场景审核、旧单场景修复、旧分镜同步接口，也不要为了让旧夹具通过而重新启用旧能力。
6. 不要使用 `/opt/vido/app` 的历史文件判断当前运行版本；生产权威入口是 `/opt/vido/current` 和 `/api/story-ad/version`。
7. 不要把 SSH 私钥、Token、API Key、数据库密码写入 Git、交接 MD、日志或命令示例。

## 9. 公司电脑拉取与启动

先保护公司电脑本地改动：

```powershell
cd E:\AI\VIDO
git status --short --branch
git diff
git remote -v
```

如果存在未提交改动，不要执行 `git reset --hard`。先提交到独立分支，或明确使用 `git stash push` 保存。

安全拉取：

```powershell
git fetch origin --prune
# 已有本地分支：
git switch codex/story-ad-systemic-remediation
# 如果公司电脑没有该本地分支，改用：
# git switch --track -c codex/story-ad-systemic-remediation origin/codex/story-ad-systemic-remediation
git pull --ff-only origin codex/story-ad-systemic-remediation
git status --short --branch
git log -1 --oneline
git rev-parse HEAD
git rev-list --left-right --count HEAD...origin/codex/story-ad-systemic-remediation

node --version
npm ci
node src/server.js
```

访问：`http://localhost:3007`

生产只读核对：

```powershell
ssh -o BatchMode=yes vido-prod
```

```bash
readlink -f /opt/vido/current
pm2 show vido
curl -fsS http://127.0.0.1:4600/api/health
curl -fsS http://127.0.0.1:4600/api/story-ad/version
python3 -c 'import sqlite3; c=sqlite3.connect("file:/data/vido/db/vido.sqlite?mode=ro",uri=True); print(c.execute("PRAGMA quick_check").fetchone()[0]); c.close()'
```

如果公司电脑尚未授权 SSH，请在公司电脑生成独立密钥并仅提交公钥给服务器管理员；禁止从家庭电脑复制私钥。

## 10. 明天继续优化的建议顺序

1. 拉取后先核对分支、最新交接文件、本地健康和生产 V318，不立即触发生成。
2. 使用目标任务只读检查剧情声明序列仍为“家居展示厅 → 商业展台”，旧 7 张图仍被门禁阻止。
3. 先验证无费用交互：展开卡片、大弹层、引用资产、提示词编辑、保存前确认、按钮布局和进度宿主。
4. 若需要测试 AI 帮写，明确它会调用文本模型；先选一镜，确认返回的是草稿且不会自动保存/生图。
5. 若决定重新生成分镜，先确认历史 unknown 证据不处于活动状态，再只对明确目标镜头提交；观察总进度、逐镜进度、任务锁和失败恢复。
6. 生成后重点检查：场景顺序、单人镜头人物数量、动物/车辆/户外等非家居样例、场景背景与机位一致性、图片 lineage 和视频前门禁。
7. 新问题继续遵守“输入 → 解析/生成 → 中间状态 → 持久化 → 接口 → 前端”的根因闭环，不在截图位置追加关键词补丁。

## 11. 交接结论

- 应用代码、本地 V318 构建清单、origin/Gitee 和生产不可变制品已经逐层核对一致。
- 生产服务健康、数据库健康、无活动生成、无活动未知计费。
- 交接文件提交后，Git 分支会比生产应用多一个纯文档提交；这不构成应用代码差异。
- 明天公司电脑应从 `origin/codex/story-ad-systemic-remediation` 使用 fast-forward 拉取，禁止用历史协议中的 `codex/story-ad-v3-upgrade` 覆盖当前工作。
