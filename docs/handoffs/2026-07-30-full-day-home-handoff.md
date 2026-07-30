# VIDO 2026-07-30 全日升级与回家续接交接

> 日期：2026-07-30  
> 目标分支：`codex/story-ad-v3-upgrade`  
> 目标远端：`origin`（Gitee）  
> 交接前基线：`9ea8b837e58dfc96854fcca4a851a976953a80aa`  
> 功能运行基线：`7569282844d98261772d73c4fb22d13978e1e163`  
> 当前结论：今日代码、真实供应商验证、生产部署和测试门禁均已闭环，可以在家中拉取后新建任务测试。  
> 安全要求：本文不包含密码、API Key、Token 或 SSH 私钥。

## 1. 回家后直接执行

先进入家中电脑的 VIDO 项目目录，再执行：

```powershell
git status --short
git fetch --all --prune
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
git rev-list --left-right --count HEAD...origin/codex/story-ad-v3-upgrade
npm install
npm run story-ad:dossier:test
npm run platform:upgrade:test
$env:PORT='3007'
node src/server.js
```

预期结果：

- `ahead/behind` 为 `0 0`。
- 本地服务地址为 `http://localhost:3007`。
- `/api/health` 返回 `status=ok`。

如果第一条 `git status --short` 显示家中电脑有未提交修改，先停止拉取并检查差异；不要直接覆盖、清理或自动暂存。

## 2. 今天完成的完整升级

### 2.1 六步导演工作流

剧情广告主流程统一为：

1. 参考与需求；
2. 人物、道具与场景档案；
3. 剧情蓝图；
4. 导演故事板；
5. 关键帧与候选视频；
6. 成片审核。

用户默认看到人物、动作、场景、剧情、内容描述、逐镜行动和候选结果。机位、运镜、素材血缘和高级控制保留在系统内部或折叠区，避免让普通用户继续填写技术参数。

重型人物档案、演员库、真人形象和资产模块只在进入对应步骤时加载，不再阻塞第一页。

### 2.2 参考视频读取与内容反推

今天把参考视频链路从“读取失败后停在弹窗”修复为：

```text
上传本地视频或读取公开链接
→ 抽取证据帧
→ 两批视觉证据读取
→ 按源文件指纹缓存成功批次
→ 程序确定性编译人物、场景、剧情、提示词和镜头合同
→ 自动回填广告需求
→ 关闭参考视频弹窗
→ 用户确认后再手动进入人物、道具和场景生成
```

关键变化：

- 新增独立 `new_story_ad.reference_video_vision` 视觉阶段。
- 视觉候选只使用明确配置并通过可用性检查的模型，不再混入无关 OpenAI 候选。
- 漫路视觉能力恢复为有效首选，失败时保留脱敏诊断。
- 原 8 帧长合同调整为两组 4 帧真实读取，再确定性合并，避免超时和长响应截断。
- 成功证据按源视频指纹缓存；整理失败时不重复付费识图。
- 视觉失败不会创建人物、场景、剧本或其他下游付费生成任务。
- 回归测试关闭 SQLite 并隔离 `OUTPUT_DIR/DB_PATH`，不再覆盖生产供应商配置。

原 40.8 秒、1280×720 的参考视频已经完成真实分析：

- 进度 100%；
- 生成约 3709 字广告需求；
- 4 段剧情结构；
- 6 个剧情节拍；
- 3 个场景提示；
- 7 个镜头意图；
- 10 张证据帧；
- 未检测到人物，因此人物提示与人物动作保持为空；
- 未触发下游图片或视频生成。

### 2.3 统一人物档案

普通 AI 人物和授权真人现在共用同一档案编译器：

- 4 个全身/转身视图；
- 4 个身份视图；
- 6 个表情；
- 3 个基础动作；
- 共 17 项人物原子素材；
- 1 张 2400×1350 人物设定大图。

人物设定大图采用 `editorial_character_bible_v2`：

- 主形象；
- 四面转身；
- 基础动作；
- 表情研究；
- 8 个局部细节；
- 米白色编辑式排版。

局部细节全部从已经生成的高清人物成品素材本地裁切，`detail_crop_source=finished_atomic_assets`，不会为眼睛、头发、衣服、鞋子和配饰额外调用图片模型。

页面默认只显示一张人物封面/设定板；点击后才按需加载组合大图和完整 17 项，避免首屏加载全部图片。

### 2.4 独立道具档案

道具已经从人物动作或场景文本中的附属字段升级为独立一等资产，保存：

- 类型、名称、外观、材质、尺寸和数量；
- 所属人物和所属场景；
- 身份图集；
- 状态图集；
- 手部接触；
- 静置位置；
- 逐镜状态时间线；
- 下游镜头引用。

固定场景物件继续进入场景锚点，不重复生成独立道具档案。

今天发现旧状态提示词同时要求 `held` 又禁止 `hand`，导致“手持”仍生成静物。已从提示词最早产生位置修复：

- `held` 必须显示物理可信的最小必要手部接触；
- `resting` 必须显示声明的承托面；
- 禁止完整人物、无关场景、文字、标志和水印；
- 只允许手部和承托面发生必要变化，道具身份保持不变。

新增 `regeneratePropStates`，可以只重生状态单元，不重生道具身份图。状态版本使用独立检查点，同版本重复执行为 0 次新增调用。

### 2.5 场景档案与空间一致性

场景继续使用“空间图集 + 俯视布局”的依赖顺序：

```text
每个独立空间生成 2×2 图集
→ 本地拆出主视角、反打、互动和细节
→ 复用同一空间参考生成近垂直俯视布局
→ 保存故事状态、互动锚点、路线和道具位置
→ 视觉 QA
```

不同空间可以有限并行；同一空间的俯视布局必须等待该空间图集完成，不能错误并行。

场景提示和视觉 QA 现在直接读取结构化合同：

- `story_states`
- `interaction_anchors`
- `routes`
- `prop_placements`
- `surface_topology`

避免这些信息只停留在前端文本或汇总字符串中。

### 2.6 性能、恢复与防重复付费

统一人物、道具、场景和参考视频的生成规则：

- 每个付费单元立即写检查点；
- 供应商返回后先持久化 `provider_result`，再执行本地拆图；
- 本地后处理失败时复用已付费结果，不再次提交供应商；
- 有限并发而不是无界并发；
- `Promise.allSettled` 等待所有在途任务结算；
- `billing_unknown` 时停止排队任务；
- 刷新页面后继续读取服务端检查点；
- 人物长任务不再使用 45 秒通用 POST 超时；
- 本地安全图片使用受控 JPEG data URL 做视觉 QA，不再伪装成生产公网路径；
- 下游镜头最多选择 4 张权威参考，不把整张 17 格拼图作为唯一模型参考。

冻结旧剧情广告大文件：

- 新功能进入独立服务和前端模块；
- 架构测试检查人物、道具和引用选择的唯一权威路径；
- 检查重型模块没有回到第一步；
- 防止再次出现旧广告代码持续堆积、加载和生成越来越慢的问题。

## 3. 今天关闭的主要根因

| 问题 | 最早错误状态/代码根因 | 处理结果 |
|---|---|---|
| 参考视频读取失败 | 视觉阶段混入无效候选，生产凭证状态不可用 | 独立视觉路由、可用性预检、漫路恢复 |
| 漫路配置反复失效 | 生产回归继承绝对 `DB_PATH`，测试覆盖 SQLite 设置 | 回归强制隔离数据库与输出目录 |
| 8 帧分析超时或字段不完整 | 单次长视觉合同响应过长 | 两组 4 帧读取，程序确定性编译 |
| 人物完成后再次点击重复付费 | 检查点把生成后的 URL、档案和合同当成输入 | 指纹只保留生成相关字段，兼容旧检查点迁移 |
| 本地人物视觉 QA 连续失败 | 本地文件被拼成外部模型不可访问的公网 URL | 安全 JPEG data URL |
| 页面 45 秒后结束但后台继续 | 人物生成使用通用短超时 | 长任务等待和刷新恢复 |
| 四类人物图集本地拆图损坏 | 最长任务 ID 截断文件名，类别尾部丢失并发同名覆盖 | 类别前置、短哈希唯一文件名 |
| 供应商成功但本地拆图失败后可能重付 | 供应商结果和本地后处理共用一个完成点 | 分段检查点和付费结果复用 |
| 道具手持状态仍是静物 | `held` 与“No person, hand”提示冲突 | 状态提示重写并完成真实版本 2 |
| 生产回归污染真实输出 | 固定 mock ID 写入正式 `OUTPUT_DIR` | 部署预检使用隔离输出和数据库 |
| 并行部署可能交叉回滚 | 多个本地部署进程同时操作生产目录 | 服务器原子部署锁、令牌归属与安全释放 |

## 4. 真实供应商调用账本

今天的真实图片调用必须分三段记录，不能合并成模糊数字：

### 4.1 早期普通人物样本

- 原计划：4 个图集。
- 首轮成功：4 次。
- 因旧检查点指纹问题误触发第二批：4 次。
- 合计成功：8 次。
- 该问题已经修复并增加回归；早期样本不作为最终人物验收样本。

### 4.2 完整真实档案矩阵

- 审计运行：`real-dossier-matrix-20260730071135`
- 授权上限：15 次提交。
- 实际提交：15 次。
- 成功：14 次。
- 外部供应商事故：1 次。
- 事故为厨房布局图 `500/UNKXXXO004IFR`，状态 `billing_unknown/submitted_unknown`。
- 该事故没有自动重试，成功空间图集拆出的 4 张本地视图继续保留。

矩阵产物：

- 人物：2 个候选、4 类图集、17 项原子素材和人物设定板；
- 道具：身份图集与旧状态图集；
- 场景：两个独立空间，阳台完成主图、4 张本地视图和俯视布局；
- 人物 QA 和阳台布局预检通过。

### 4.3 最终道具状态复验

- 审计运行：`prop-state-revalidation-real-dossier-matrix-20260730071135-v2`
- 用户追加授权：1 次。
- 实际提交：1 次。
- 成功：1 次。
- 再次只读复核新增调用：0 次。
- 只生成 `states_v2`，没有重生人物、道具身份或场景。
- 4 张身份视图保持不变；
- 新状态视图 2 张；
- 检查点：`completed`；
- 计费状态：`confirmed`。

人工五项视觉检查全部通过：

- 静置承托面可见；
- 手持接触可见；
- 道具身份一致；
- 无完整人物；
- 无文字、标志或水印。

生产图片：

`https://vido.smsend.cn/api/new-story-ad/assets/prop_silver_entry_key_states_v2_r1.png`

## 5. 主要新增或修改模块

### 5.1 参考视频

- `src/services/newStoryAd/referenceVideoAnalysisService.js`
- `src/services/newStoryAd/modelGateway.js`
- `src/services/newStoryAd/localVisionReferenceService.js`
- `src/services/pipelineModelService.js`
- `src/services/settingsService.js`
- `scripts/audit-new-story-ad-reference-video-model-calls.js`
- `scripts/check-new-story-ad-reference-video-runtime.js`
- `scripts/restore-production-deyunai-provider.js`

### 5.2 人物、道具、场景统一档案

- `src/services/newStoryAd/personDossierCompiler.js`
- `src/services/newStoryAd/personDossierService.js`
- `src/services/newStoryAd/dossierCompositeService.js`
- `src/services/newStoryAd/propAssetService.js`
- `src/services/newStoryAd/propIdentityContractService.js`
- `src/services/newStoryAd/propTimelineService.js`
- `src/services/newStoryAd/sceneStructuredContractService.js`
- `src/services/newStoryAd/sceneSpaceContractService.js`
- `src/services/newStoryAd/referenceSelectionService.js`

### 5.3 检查点、并发和持久化

- `src/services/newStoryAd/assetGenerationCheckpointService.js`
- `src/services/newStoryAd/generationConcurrencyService.js`
- `src/services/newStoryAd/assetPlanService.js`
- `src/routes/newStoryAd/subjectAssetPersistence.js`
- `src/services/newStoryAd/subjectAssetBundleService.js`

### 5.4 前端和懒加载

- `public/js/new-story-ad/person-dossier-ui.js`
- `public/js/new-story-ad/prop-assets.js`
- `public/js/new-story-ad/subject-assets-ui.js`
- `public/js/new-story-ad/bootstrap-asset-loader.js`
- `public/js/new-story-ad/asset-ui-contract.js`
- `public/css/digital-human-wizard.css`

### 5.5 审计、回归和部署

- `scripts/run-new-story-ad-real-dossier-matrix.js`
- `scripts/revalidate-new-story-ad-prop-state.js`
- `scripts/check-new-story-ad-dossier-boundaries.js`
- `scripts/check-new-story-ad-active-tasks.js`
- `scripts/run-with-pm2-env.js`
- `scripts/deploy-new-story-ad-subject-scene-recovery.js`
- `scripts/test-new-story-ad-dossier-checkpoints.js`
- `scripts/test-new-story-ad-person-dossier.js`
- `scripts/test-new-story-ad-prop-assets.js`
- `scripts/test-new-story-ad-reference-video-analysis.js`
- `scripts/test-new-story-ad-scene-atlas-v7.js`

从当日同步基线到交接前 HEAD，共修改或新增 73 个受 Git 管理的文件。

## 6. 已执行验证

### 6.1 本地

- `npm run story-ad:dossier:test`：通过。
  - 检查点命中和防重复提交通过；
  - 本地拆图恢复只使用 1 次供应商结果；
  - 计费未知停止排队通过；
  - 道具状态独立重生 1 次、同版本重复 0 次；
  - 人物 17 项和 4 类图集通过；
  - 参考视频 102 项检查通过；
  - 单场景、双场景和恢复路径通过；
  - 冻结文件和唯一权威路径审计通过。
- `npm run story-ad:v3:test`：通过。
- `npm run platform:upgrade:test`：通过。
- JavaScript 语法检查：通过。
- `git diff --check`：通过。
- 本地 `http://localhost:3007/api/health`：`status=ok`。

### 6.2 生产

- 生产完整平台回归：通过。
- 生产发布文件哈希：`239/239` 一致，差异 0。
- PM2 `vido`：`online`。
- 内网健康：HTTP 200。
- 公网 `https://vido.smsend.cn/api/health`：HTTP 200。
- SQLite：`enabled=true`、`status=ok`。
- 活动剧情广告任务：0。
- 完整矩阵只读复核：15 次提交、14 次成功、1 次外部事故、复核新增调用 0。
- 道具状态完成态复核：1 次成功提交、状态版本 2、2 张状态图、4 张身份图保留、复核新增调用 0。

最终运行代码生产备份：

`/opt/vido/backups/new-story-ad-subject-scene-recovery-20260730093808`

## 7. 本地、Git 与生产一致性

交接前状态：

- 本地分支：`codex/story-ad-v3-upgrade`
- 本地与 `origin/codex/story-ad-v3-upgrade`：ahead/behind `0/0`
- 生产运行文件：发布清单 `239/239` SHA-256 一致
- 生产 PM2、数据库、内网和公网健康正常

生产目录仍保留历史 detached Git HEAD，这是现有文件级发布流程的正常状态。判断生产一致性必须使用发布清单 SHA-256，不能用生产 Git HEAD 代替文件核对。

用户原有工作区内容保持不变，没有纳入今日功能提交：

- 已删除但未提交：`docs/handoffs/2026-07-24-office-to-home-complete.md`
- 未跟踪：`docs/handoffs/[仓库交接文档].md`
- 未跟踪：`docs/research/2026-07-29-*.md`

回家拉取时不要删除或覆盖这些文件对应的家中版本。

## 8. 回家后的测试顺序

建议新建全新剧情广告任务，不要续用早期失败任务：

1. 上传参考视频或填写公开链接；
2. 执行智能分析；
3. 检查弹窗是否关闭；
4. 检查广告需求是否出现人物、场景、剧情、提示词和镜头回填；
5. 确认后进入人物、道具和场景档案；
6. 检查人物默认只显示一张设定板；
7. 点击人物档案，检查组合大图和 4+4+6+3 共 17 项；
8. 检查人物细节是否来自成品裁切；
9. 检查道具身份图、手持状态、静置状态和逐镜时间线；
10. 检查每个独立场景的主图、反打、互动、细节和俯视布局；
11. 继续生成剧情蓝图和导演故事板；
12. 核对刷新后是否从检查点恢复，没有重复生成成功单元。

当前没有已知未修复的功能测试阻塞项。

## 9. 已知非阻塞事项

### 9.1 厨房布局外部事故

厨房布局存在一条供应商 `billing_unknown/submitted_unknown` 事故。必须继续保留审计证据，不得自动重试或删除；该事故不影响使用全新任务测试当前链路。

### 9.2 微信公众号学习资料

以下两篇资料尚未完成内容学习：

- `https://mp.weixin.qq.com/s/oAFrrrKCrmbZArqDDdZ2UA`
- `https://mp.weixin.qq.com/s/knk4E75WGQa9J3ylZ3_01w`

应用内浏览器安全策略明确阻止访问 `mp.weixin.qq.com`，不能绕过或切换替代浏览器。回家后如要继续，请提供正文、PDF 或完整截图，再做与当前平台的优化差距分析。

## 10. 生产连接与安全规则

生产连接：

```powershell
ssh vido-prod
```

家中电脑必须使用自己的 SSH 私钥，并由服务器单独授权对应公钥。不要从公司电脑复制私钥，不要把密码、API Key、Token 或私钥写入 Git、日志或交接文档。

只读核对常用命令：

```bash
cd /opt/vido/app
pm2 describe vido
curl -sS http://127.0.0.1:4600/api/health
node scripts/run-with-pm2-env.js vido node scripts/check-new-story-ad-active-tasks.js
```

未经新的付费授权，不要重新运行真实供应商生成脚本。完成态核对只能使用脚本的只读验证模式。

## 11. 关键审计位置

生产：

```text
/opt/vido/app/outputs/audits/real-dossier-matrix/real-dossier-matrix-20260730071135/audit.json
/opt/vido/app/outputs/audits/prop-state-revalidation/prop-state-revalidation-real-dossier-matrix-20260730071135-v2/audit.json
```

本地工作电脑下载副本：

```text
outputs/audits/real-dossier-matrix/real-dossier-matrix-20260730071135/
outputs/audits/prop-state-revalidation/prop-state-revalidation-real-dossier-matrix-20260730071135-v2/
```

`outputs/` 不作为 Git 交接内容；家中电脑拉取代码后，真实审计仍以生产服务器文件为准。

## 12. 今日提交记录

```text
9b4fe04 feat(story-ad): add director workspace and secure handoff protocol
a2bdb45 docs(handoff): record director upgrade production handoff
c980746 fix: harden reference video vision routing
cfc5e8c fix: stabilize reference video content analysis
1ff73ad feat(story-ad): unify asset dossiers and recovery
eef999b test(story-ad): audit real dossier supplier matrix
31dc138 fix: make dossier generation resumable and collision safe
775b969 fix: isolate production dossier preflight
7a08976 fix: preserve billed scene incident during matrix resume
7d4ee25 fix: make prop state interactions visually explicit
1e2000a docs: finalize story ad upgrade handoff
fa21c9b feat: revalidate prop states without regenerating identity
ef27e79 test: persist prop state visual approval evidence
7569282 test: verify completed prop state revalidation
9ea8b83 docs: close prop state validation gate
```

本交接文档提交后，以 `origin/codex/story-ad-v3-upgrade` 最新 HEAD 为最终拉取点。

## 13. 在家启动 Codex 后可直接发送

```text
先读取：
1. docs/handoffs/2026-07-30-full-day-home-handoff.md
2. docs/handoffs/2026-07-30-story-ad-unified-dossier-performance-handoff.md
3. docs/handoffs/HANDOFF_PROTOCOL.md
4. AGENTS.md

然后核对当前分支、HEAD、ahead/behind、本地3007健康和生产只读状态。
不要复用早期失败任务，不要重跑真实供应商矩阵，不要覆盖未提交文件。
从全新剧情广告任务开始，按参考视频→人物/道具/场景档案→剧情蓝图→导演故事板顺序做人工验收。
```

## 14. 关联文档

- `docs/handoffs/2026-07-30-story-ad-director-upgrade-handoff.md`
- `docs/handoffs/2026-07-30-story-ad-unified-dossier-performance-handoff.md`
- `docs/plans/2026-07-30-story-ad-unified-dossier-performance-plan.md`
- `docs/handoffs/HANDOFF_PROTOCOL.md`
- `AGENTS.md`

