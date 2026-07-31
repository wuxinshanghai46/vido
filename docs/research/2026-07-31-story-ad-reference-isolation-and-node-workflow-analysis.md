# 剧情广告参考视频隔离故障与精细化节点工作流分析

> 日期：2026-07-31
> 状态：根因分析已完成；P0 修复与验证结果见同日会话、变更和部署记录。
> 目标任务：`42daab0d-136b-4e37-be54-6feb4e8d8a8d`

## 1. 结论摘要

本次线上问题不是单一的“模型识别失败”，而是两个串联缺陷：

1. 新建剧情广告会话没有把“任务状态、DOM 表单、参考分析模块、自动保存与异步请求世代”作为一个原子会话共同清空。新任务在新视频上传前就把旧参考样例的 brief 写入了数据库。
2. 新视频的视觉批次已经识别出银色保时捷跑车，但文本综合模型丢失了广告主体。代码虽然先生成了可用的确定性证据结果，却在真实模型路径中完全丢弃该结果，只返回模型 JSON；因此模型遗漏产品后直接以 `source_product_missing` 失败。

更严重的是：失败的参考分析没有绑定到任务 context，也没有使旧 brief 失效。页面最终同时展示“新文件 + 新分析失败 + 旧任务内容”，用户无法判断三者的真实血缘。

当前必须停止重复分析和后续生成。在完成会话隔离、来源绑定、失败失效和回归验证前，不得声明可以测试。

## 2. 生产证据与完整时间线

### 2.1 已确认事实

目标任务：

- 任务 ID：`42daab0d-136b-4e37-be54-6feb4e8d8a8d`
- 创建时间：2026-07-31 09:39:16（北京时间）
- 状态：`working / scene_config_done`
- 内容修订：1
- 客户端编辑序号：4
- 活动生成任务：无

任务在创建时写入的 brief 已经是旧内容：

- 广告主体：白色跑车模型
- 场景：住宅客厅、木地板、红色沙发
- 人物：无人出镜

该旧内容同时存在于：

- `new_story_ad_tasks`
- `new_story_ad_snapshots`
- `new_story_ad_artifacts`
- `new_story_ad_outputs:context`

因此旧内容不是新分析失败后才回填，而是在新任务第一次持久化时就已进入服务器。

新参考视频：

- 分析 ID：`ref_video_85e0a90d-d5f1-4680-9eeb-75ba5d545d4e`
- 文件名：`保时捷718.mp4`
- 上传时间：2026-07-31 09:46:22
- 大小：82,809,251 字节
- 时长：44.513 秒
- 分辨率：2560×1440
- 视频 SHA-256：`78536460e933d326fb66b44f6689ea801efc238a99b44fc3e39d71ffa177d6db`
- 分析开始：09:46:34
- 分析失败：09:53:00
- 错误：`REFERENCE_VIDEO_ANALYSIS_SEMANTIC_INVALID / source_product_missing`
- 已完成视觉批次：2
- 下游生成：0

任务创建比新视频上传早约 7 分钟，证明“新视频分析成了旧样例”不是事实。真实情况是：任务先保存了旧 brief，随后才上传并分析新视频。

### 2.2 视觉证据并没有遗漏产品

第二批视觉证据在 24.84 秒和后续时间点明确识别到：

- 银色跑车
- 保时捷 Porsche
- 918 Spyder 外观特征
- 湿润山路、森林、山脉
- 金属车身、湿沥青、阴天自然光

所以：

- 已确认事实：视觉模型看到了保时捷跑车。
- 代码根因：综合阶段丢失产品字段，且没有用确定性结果补回。
- 外部系统推断：综合文本模型为什么遗漏字段尚无原始响应留档，不能把具体模型行为写成确定结论。

## 3. 第一个代码根因：新建会话没有原子清空

### 3.1 当前调用路径

从工作台进入新任务时：

`/digital-human?tab=new-story-ad&nsa_intent=create`

随后：

1. `bootstrap.js` 动态加载工作台模块。
2. `new-story-ad-legacy-ui.js::mount()` 调用 `consumeCreateIntent()`。
3. `task-session.js::consumeCreateIntent()` 只做：
   - 增加 `taskSessionEpoch`
   - 清除已记忆任务 ID
   - 删除 URL 中的 `nsa_intent / nsa_task_id / nsa_step`
4. 它没有清空 DOM 中的广告需求，也没有调用完整的 `resetForNewSession()`。
5. 后续自动保存或“生成人物与场景设置”读取 `#dhNsaAdText`，创建新任务。
6. 旧 DOM 文本因此作为新任务第一个版本写入服务器。

### 3.2 为什么已有 reset 没挡住

`resetForNewSession()` 的确会清除任务、人物、场景、参考视频、表单和生成状态，但它只在部分入口被调用，例如同页导航使用 `defaultView=true` 时。

`nsa_intent=create` 的首次挂载路径只消费新建意图，没有执行同等级清理。

这形成了两个不同的“新建任务”语义：

- 同页侧栏进入：可能执行完整 reset。
- 工作台链接/新建意图进入：只清任务 ID，不保证清 DOM 和模块状态。

### 3.3 测试为什么漏掉

现有测试只验证：

- `reset({ explicit: true })` 后旧参考分析不再复用；
- dashboard URL 含 `nsa_intent=create`；
- `consumeCreateIntent()` 会删除路由参数。

测试没有执行完整生产链路：

`旧 DOM brief → nsa_intent=create → mount → consumeCreateIntent → ensureTask → createTask`

也没有验证新任务第一份 snapshot 中不存在旧任务文本。

## 4. 第二个代码根因：确定性证据结果被丢弃

`synthesizeAnalysisFromEvidence()` 当前先执行：

`deterministic = compileAnalysisFromEvidence(record, visualEvidence, transcript)`

该确定性编译器会：

- 从各批次提取产品候选；
- 使用批次位置、产品词、环境词和可见文字打分；
- 合并环境、材质、颜色、布局和光线；
- 形成剧情、场景、机位和动作结构。

但在真实模型路径中，代码随后：

1. 调用 `new_story_ad.reference_video_synthesis`；
2. 解析/修复模型 JSON；
3. 对模型 JSON 单独做 `validateAnalysisResult(parsed)`；
4. 直接 `return parsed`。

`deterministic` 没有参与字段合并、冲突裁决或最低事实兜底。

本次第二批证据有明确的保时捷跑车，因此确定性编译本应保住产品主体；综合模型遗漏后，系统却把已有事实一起丢弃。

## 5. 第三个系统缺口：来源没有强绑定

当前失败分析不会进入 `taskPayload()`，因为它只接受 `status === completed`。

同时 `taskPayloadOrSaved(saved)` 在没有有效当前分析时可能回退到保存值。虽然显式 reset 可以阻止回退，但本次任务 context 从一开始就没有新的分析 ID。

目前缺少以下不可变绑定：

- `task_session_id`
- `draft_id`
- `source_asset_id`
- `source_sha256`
- `analysis_id`
- `analysis_source_sha256`
- `analysis_status`
- `brief_source_analysis_id`
- `brief_source_fingerprint`

结果是页面可以同时出现：

- 新视频文件
- 新分析失败
- 旧 brief
- 空的任务内存/分析内存

而系统没有一条门禁明确声明这四者不属于同一血缘。

## 6. Liblib 竞品工作流的实际结构

本轮通过用户授权的登录态只读检查了：

`https://www.liblib.tv/detail/8c03565abdf047c39d189a601c87838d`

没有复制项目、没有运行节点、没有触发生成。

### 6.1 可观察事实

“保时捷718”项目包含：

- 14 个节点分组；
- 分组标注合计 109 个节点；
- 独立角色脸部三视图；
- 人物全身、服装、头盔、局部细节等分支资产；
- 车辆多角度参考资产；
- 山谷、冰原、森林、海下等独立环境资产组；
- 图片生成、候选图片、裁剪、版本副本；
- 视频节点；
- 节点间显式连线；
- 单独的故事板资产视图，图片和视频分栏展示。

### 6.2 图片节点不是简单提示词

代表性汽车图片节点包含：

- 总体产品：银色保时捷跑车；
- 环境：阴天、山谷盘山公路、湿沥青、冷雾；
- 统一色调：高级灰、暗青；
- 9 个独立分镜；
- 每个分镜的景别、机位、运动方式、主体状态和环境反馈；
- 航拍、正面跟随、局部特写、贴地仰拍、侧面摇摄、轮毂特写、驾驶舱 POV、后方追拍、远景离去；
- 禁止旁白与对白；
- 16:9、写实、电影级商业摄影等视觉合同。

### 6.3 视频节点是明确的素材装配节点

代表性视频节点：

- 时间范围：0–12 秒；
- 明确引用 4 张图片；
- 区分“场景氛围/画面质感参考”和“跑车多角度参考”；
- 单独定义连续镜头和运镜；
- 明确环境、产品、速度、车身状态、轮胎水雾、弯道 Apex、尾灯和离场动作；
- 可连接角色库；
- 输出分辨率独立记录。

### 6.4 真正值得借鉴的不是节点数量

竞品优势来自四个数据原则：

1. 角色、车辆、环境、镜头和视频都是独立资产。
2. 每个生成结果有明确输入边，能看出用了哪些参考。
3. 同一资产可以产生候选、裁剪和版本分支，而不是覆盖唯一结果。
4. 故事板是已生成资产的可视化汇总，不只是文本分镜列表。

不能简单复制“做更多步骤”或“增加一块大画布”。如果没有稳定 ID、版本、指纹、来源和验收状态，节点越多只会把旧内容污染扩散得更广。

## 7. VIDO 目标架构：导航与生产模型分离

现有六步可以保留为普通用户导航，但底层必须改为精细化生产图。

### 7.1 顶层工作区

1. 项目与参考源
2. 证据室
3. 人物/主体资产工作室
4. 场景与空间工作室
5. 剧情图与导演故事板
6. 画面/视频生产与审核

这些是视图，不是硬编码的流水线阶段。用户可以回到任一工作区修订，系统通过版本与血缘决定哪些下游节点失效。

### 7.2 核心节点类型

#### 来源层

- SourceVideo
- SourceImage
- ProductUpload
- UserBrief
- RightsDeclaration

#### 证据层

- ShotBoundary
- EvidenceFrame
- OCRText
- TranscriptSegment
- ProductEvidence
- CharacterEvidence
- EnvironmentEvidence
- ActionEvidence

#### 实体档案层

- ProductIdentity
- ProductView
- ProductMaterialDetail
- CharacterIdentity
- CharacterFaceView
- CharacterBodyView
- WardrobeVariant
- HairMakeupVariant
- PropIdentity
- PropState
- SceneIdentity
- SceneLayout
- SceneMaterialLight
- SceneTimeWeather

#### 剧情与导演层

- StoryPremise
- Beat
- CharacterState
- ProductState
- SceneState
- Shot
- CameraIntent
- PerformanceAction
- ContinuityConstraint
- BrandClosure

#### 生成与审核层

- KeyframeCandidate
- ImageCandidate
- CropVariant
- VideoCandidate
- VisionQA
- HumanApproval
- TimelineBlock
- AudioTrack
- FinalCompose

### 7.3 每个节点的最低合同

每个节点必须至少保存：

- `node_id`
- `node_type`
- `project_id`
- `task_session_id`
- `content_revision`
- `source_node_ids`
- `source_fingerprints`
- `input_fingerprint`
- `model_call_ids`
- `status`
- `qa_status`
- `human_approval`
- `created_at / updated_at`
- `supersedes_node_id`
- `invalidated_by_revision`

下游节点只能消费“来源仍有效且 QA 状态满足门禁”的上游版本。

## 8. 必须先完成的安全修复

### P0-A 新建会话原子隔离

- `consumeCreateIntent()` 不能只清任务 ID。
- 新建入口必须调用统一的 `beginNewTaskSession()`。
- 同一事务中清除：
  - 任务 ID 与路由；
  - DOM 输入；
  - state.context；
  - 参考分析状态；
  - 人物/场景/道具状态；
  - 自动保存队列；
  - 轮询定时器；
  - 异步请求控制器；
  - 恢复中的旧 bundle；
  - 浏览器表单恢复值。
- 清理完成前禁止 `ensureTask()` 和自动保存。

### P0-B 新视频立即使旧来源失效

一旦用户选择新文件，在上传请求前就应：

- 生成新的 `source_asset_id` 和本地临时 fingerprint；
- 清除旧 `analysis_id`；
- 将旧分析派生的 brief、人物、场景和道具标记为 stale；
- 禁止旧 saved analysis 回退；
- 在 UI 显示“等待当前视频分析”，而不是继续显示旧内容。

### P0-C 失败分析也必须绑定

失败分析仍需保存到当前 draft/task：

- 当前分析 ID；
- 当前文件指纹；
- 失败码；
- 已完成的证据批次；
- 不可继续的原因。

失败不能等价于“没有分析”，否则系统会回退旧值。

### P0-D 确定性事实与模型结果合并

综合阶段改为：

`确定性证据编译 → 模型结构化整理 → 字段级证据仲裁 → 语义验证`

规则：

- 模型可以补充结构和表达；
- 模型不能删除证据中高置信度产品、品牌、型号、空间和时间线；
- 模型与确定性结果冲突时，保留证据并标记冲突；
- 证据明确但模型缺字段时自动补回，不应整单失败；
- 只有证据本身也无法确认产品时才返回 `source_product_missing`。

## 9. 后续精细化重构顺序

### 第一阶段：安全边界

- 会话原子隔离
- 来源指纹
- 分析/任务强绑定
- 旧内容失效
- 确定性与模型合并
- 付费生成前血缘门禁

### 第二阶段：证据室

- 镜头边界检测
- 均匀采样 + 尾帧/落版强制采样
- OCR 与品牌型号证据
- 时间线证据浏览
- 产品/环境/人物/动作冲突可视化

### 第三阶段：实体资产工作室

- 人物身份、服装、妆造、动作状态分离
- 产品身份、多视图、材质细节分离
- 场景空间、布局、材质光线、天气时间分离
- 道具身份与状态分离
- 每个资产支持候选、版本和人工批准

### 第四阶段：剧情图与导演板

- 剧情节拍不再直接等于镜头
- 每个镜头引用实体状态与场景状态
- 明确起始状态、动作、结束状态和下一镜依赖
- 关键帧与视频节点显示真实输入边
- 失败只重做受影响节点，不重跑整条链

### 第五阶段：故事板与生产审计

- 图片、视频、音频、字幕分轨
- 候选与批准状态
- 单元费用、模型调用与重试次数
- 版本差异和失效传播
- 最终成片可追溯到所有源节点

## 10. 强制回归矩阵

### 新建与会话

- 旧任务 DOM 有 3,800 字 brief，新建意图后必须为空。
- 旧分析 completed/failed/running 三种状态，新建后都不能复用。
- 同页侧栏、dashboard 链接、任务中心新建、浏览器后退四个入口语义一致。
- 两个浏览器标签并发新建，任务会话不得串写。
- 新建时旧自动保存正在飞行，响应返回后不得写入新任务。

### 文件与来源

- 同文件名、不同 SHA-256 必须视为新来源。
- 不同文件名、相同 SHA-256 可识别为同源但不得静默继承旧任务内容。
- 最大文件、分片上传、断点续传、取消、重传。
- 新文件上传成功但分析失败，旧 brief 必须保持 stale/不可用。
- 分析失败后刷新页面，仍能看到当前文件和失败分析 ID，不回退旧分析。

### 证据综合

- 后一批识别产品、前一批只有环境，产品必须保留。
- 模型综合漏掉产品，但确定性证据存在，必须补回。
- 模型把环境写成产品，必须拒绝并保留正确候选。
- 尾帧品牌/型号与前帧泛化类别冲突时，尾帧高权重。
- 多空间、多人物、无人物、纯产品、服务类广告。

### 缓存与并发

- 同一分析并发 start 只允许一次真实调用。
- 不同源指纹绝不能共用视觉证据缓存。
- 缓存 key 必须包含源 SHA-256、采样策略版本和模型策略版本。
- 成功批次恢复不得跨 analysis_id 或 task_session_id。

### 付费安全

- 来源不一致、分析失败、证据冲突、旧派生内容未确认时，图片和视频调用均为 0。
- 失败恢复只调用缺失节点。
- 每个真实调用必须关联节点 ID、输入 fingerprint 和费用记录。

## 11. 当前未执行项与风险

未执行：

- 没有修改代码。
- 没有修复生产任务数据。
- 没有重新分析参考视频。
- 没有触发人物、场景、图片或视频生成。
- 没有复制或运行 Liblib 项目。
- 没有执行修复后的回归，因为修复尚未实施。

剩余风险：

- 当前任务仍保存旧 brief，刷新或继续操作可能继续使用错误内容。
- 当前失败分析没有绑定进任务 context。
- 若直接点击“生成人物与场景设置”，可能以旧 brief 继续污染下游。
- 在 P0 修复、定向回归、完整回归、生产部署和任务只读核对完成前，当前功能不可测试。
