# VIDO 剧情广告统一档案与性能升级交接

> 日期：2026-07-30
> 分支：`codex/story-ad-v3-upgrade`
> 当前状态：代码、本地回归、15 次真实供应商矩阵、生产部署及发布文件三方一致性均已完成；道具状态图提示词根因已修复并部署，但新的真实状态图尚未复验
> 完成声明：当前仍不得声明“完整链路可以测试”；唯一硬门禁是新增 1 次道具状态图真实调用并通过人工视觉验收

## 1. 当日目标与用户决策

本轮严格落实《剧情广告：人物、道具、场景、参考识别与剧本链路统一优化方案》：

- 普通 AI 人物与授权真人共用 4 类图集编译器，并拆分为 17 项人物原子素材。
- 人物默认只显示一张封面，点击后查看组合大图和 4+4+6+3 的完整明细。
- 道具升级为独立一等资产，具备类型、外观、状态、归属、接触合同和逐镜时间线。
- 场景的故事状态、互动锚点、路线和道具位置必须进入图片提示与视觉 QA。
- 参考视频两批视觉证据安全并发，成功批次持久化，失败只补失败批次。
- 人物、道具、场景统一使用持久化检查点、有限并发和计费未知阻断。
- 冻结旧大文件，新增能力拆入独立模块，禁止继续形成旧剧情广告式代码冗余。

## 2. 修改前后的数据流

修改前：

```text
普通人物四视图 / 授权真人17次串行生成
→ 多套人物结构
→ 页面平铺多图
→ 场景和道具文本分散
→ 超时或刷新后可能重复提交
```

修改后：

```text
需求或参考视频
→ 统一资产计划（输入指纹复用）
→ 人物 / 道具 / 不同空间按依赖有限并发
→ 每个付费单元立即写检查点
→ 4类人物图集拆成17项原子素材
→ 本地组合大图
→ 人物 / 道具 / 场景合同
→ 蓝图
→ 导演故事板
→ 按镜头最多选择4张权威参考
→ 关键帧 / 视频
```

人物持久化的关键闭环：

```text
生成结果
→ 演员库持久化
→ 恢复 cover / dossier / 4 atlases / 17 atomic assets / contract
→ context 规范化继续保留完整档案
→ 页面默认单封面
→ 点击后才插入17项明细
```

## 3. 主要代码变更

### 3.1 检查点、并发和统一资产计划

- `src/services/newStoryAd/assetGenerationCheckpointService.js`
- `src/services/newStoryAd/generationConcurrencyService.js`
- `src/services/newStoryAd/assetPlanService.js`

实现单元级状态、计费未知阻断、有限并发、输入指纹复用和调用统计。

### 3.2 统一人物档案

- `src/services/newStoryAd/personDossierCompiler.js`
- `src/services/newStoryAd/dossierCompositeService.js`
- `src/services/newStoryAd/subjectAssetBundleService.js`
- `src/services/newStoryAd/personDossierService.js`
- `src/routes/newStoryAd/subjectAssetPersistence.js`

普通 AI 人物和授权真人共用 4 类图集编译器；输出全身 4、身份 4、表情 6、基础动作 3，共 17 项。组合大图由本地 Sharp 排版，不增加模型调用。

### 3.3 道具档案

- `src/services/newStoryAd/propAssetService.js`
- `src/services/newStoryAd/propIdentityContractService.js`
- `src/services/newStoryAd/propTimelineService.js`
- `src/services/newStoryAd/propReferenceService.js`
- `src/routes/newStoryAd/propRoutes.js`
- `public/js/new-story-ad/prop-assets.js`

静态道具正常路径 1 次图集调用；有状态变化的道具增加 1 次状态图集调用；固定场景物件归入场景锚点，不重复建立道具资产。

### 3.4 场景结构合同

- `src/services/newStoryAd/sceneStructuredContractService.js`
- `src/services/newStoryAd/sceneAssetService.js`
- `src/services/newStoryAd/sceneSpaceContractService.js`
- `src/services/newStoryAd/contextBuilder.js`

场景保持“空间图集 → 本地拆分 → 俯视布局”的正确依赖顺序；不同空间可以有限并发。同一空间的故事状态、互动锚点、路线和道具位置进入生成摘要及 QA，基础场景继续禁止人物。

### 3.5 参考视频、视觉 QA 和引用选择

- `src/services/newStoryAd/referenceVideoAnalysisService.js`
- `src/services/newStoryAd/referenceSelectionService.js`
- `src/services/newStoryAd/localVisionReferenceService.js`
- `src/services/newStoryAd/modelGateway.js`
- `src/services/pipelineModelService.js`

两批视觉证据并发、批次持久化、部分成功保留；本地图片转为受控 JPEG data URL 交给视觉模型，不再把本地路径伪装成公网地址；下游按镜头选择最多 4 张参考。

### 3.6 前端、懒加载和旧文件冻结

- `public/js/new-story-ad/asset-ui-contract.js`
- `public/js/new-story-ad/person-dossier-ui.js`
- `public/js/new-story-ad/subject-assets-ui.js`
- `public/js/new-story-ad/bootstrap-asset-loader.js`
- `public/css/digital-human-wizard.css`

人物卡默认只展示封面。完整档案弹窗按需展示组合大图与 17 项原子素材。重型资产模块只在进入资产步骤时加载。

冻结门禁当前结果：

- `storyAdService.js`：3756 行
- `sceneAssetService.js`：1816 行
- `newStoryAd.js`：1632 行
- `new-story-ad-legacy-ui.js`：6399 行
- `bootstrap.js`：180 行
- 权威人物路径：1
- 权威道具路径：1
- 权威引用选择器：1
- 第一步重型资产模块：0

## 4. 根因闭环

### 4.1 人物生成后再次点击会重复付费

已确认事实：真实任务第一次生成 4 个图集后，持久化写回了视图、合同和资源元数据；第二次请求的检查点指纹因此变化，又提交了 4 个图片调用。

代码根因：`checkpointKind` 曾对完整 `person_spec` 和已富化的 `cast_profiles` 做哈希，把生成结果元数据错误当成生成输入。

修复：

- 指纹版本升级为 2，只保留姓名、剧情身份、年龄、外貌、服装、妆造、禁止项、主体数量、目标和模型等生成相关字段。
- 自动忽略视图 URL、17 项素材、组合图、合同、资产 ID 等生成后元数据。
- 对旧指纹的完整检查点做语义兼容迁移；命中后不再提交供应商。
- 真正修改服装或外貌仍会产生新检查点。

回归结果：富化前后检查点相同；旧指纹迁移后供应商提交次数保持 4；服装发生实质变化时检查点会变化。

### 4.2 视觉 QA 缓慢且连续尝试无效候选

已确认事实：本地人物图片被拼成生产公网 URL 交给外部视觉模型，候选模型无法读取，导致多候选连续失败。

修复：本地安全资产先缩放为 1024 像素 JPEG data URL；人物一致性阶段只使用明确的视觉候选，单次最多 3 个候选，默认 1 次 QA 尝试。

真实复核：修复后首个 `deyunai/gpt-4o` 候选即完成视觉 QA，不再连续尝试 10 个无效候选。

### 4.3 页面 45 秒后消失但后台仍在生成

代码根因：人物 4 类图集使用通用 POST 默认 45 秒超时，真实生成长于 45 秒时页面结束等待，而后台检查点继续推进。

修复：人物/宠物资产请求显式使用 45 分钟长任务等待；刷新后继续从服务端检查点恢复，不创建新的付费请求。

### 4.4 17 项人物档案写回后被截断

代码根因：演员库持久化沿用旧四视图结构，完整档案字段没有回写；后续 context 规范化也没有保留分类图集和 17 项数组。

修复：独立持久化模块恢复封面、组合图、4 类图集、17 项素材、分类数组、生成摘要、人物合同和主体档案；context 层同时保留。

### 4.5 历史任务显示 `[object Object]`

代码根因：导演工作台把结构化 `appearance` / `wardrobe` 对象直接做字符串拼接。

修复：统一读取字符串、`userPrompt`、`description` 等兼容字段，历史结构不再显示对象占位文本。

## 5. 实际验证

### 5.1 已执行

- `npm run story-ad:dossier:test`：通过。
  - 检查点命中 1，计费未知重复提交 0，并发峰值 2。
  - 静态道具 1 次、有状态道具 2 次、恢复重复调用 0。
  - 人物 17 项、4 类图集、正常路径 4 次图片调用。
  - 参考视频 102 项检查通过，两批证据、场景映射和隐私边界通过。
  - 单场景 2 次、双场景 4 次、布局失败不重做空间图集。
- `npm run story-ad:v3:test`：199.4 秒，退出码 0。
- `npm run platform:upgrade:test`：232.1 秒，退出码 0。
- JavaScript 语法检查：57/57 通过。
- 本地服务：最新代码重启后 `/api/health` HTTP 200，PID 32764。
- 登录态浏览器：
  - 默认弹窗数量 0，17 项明细元素 0。
  - “查看完整人物档案 17项”按钮数量 1。
  - 点击后组合大图 1；分类标题 4；明细链接 17。
  - 分类数量为全身 4、身份 4、表情 6、基础动作 3。
- 早期真实普通人物样本（历史证据，已被第 9 节最终矩阵替代）：
  - 计划图集调用 4。
  - 首次实际成功 4。
  - 因旧指纹缺陷误触发第二批成功 4；修复后已增加防重复回归。
  - 当前总图片图集成功调用 8。
  - 当前样本 QA 如实为 `rejected`：第四视角背景比例和鞋子颜色/款式存在差异；页面保留结果并阻止进入后续步骤。
  - 修复本地视觉输入后，QA 由连续失败候选降为首个 `deyunai/gpt-4o` 候选完成。

### 5.2 未执行

- 修复后新的道具状态图真实生成：15 次授权已用尽，需另行授权 1 次只生成 `state` 单元。
- 两篇微信公众号资料：应用内浏览器安全策略阻止访问，需用户提供正文、PDF 或完整截图。

## 6. 当前限制和风险

- 真实矩阵已完成，人物、道具身份图、阳台场景和本地角色设定板通过人工视觉检查。
- 厨房布局图存在 1 次外部供应商 `billing_unknown` 事故；成功的空间图集和 4 张本地视图已保留，事故不得自动重试。
- 原道具状态图没有表现真实的手持接触和静置承托面。提示词矛盾已从最早产生位置修复并部署，但新的真实状态图尚未生成。
- 本地、Git 远端和生产发布清单已经一致；该一致性不等于道具状态图视觉验收完成。
- 新的道具状态图通过人工验收前，不得说“可以开始完整测试”。

## 7. 下一步顺序

1. 用户若同意，额外授权 1 次图片供应商调用。
2. 仅失效并生成道具 `state` 单元；不得重做人物、道具身份或场景。
3. 人工核对手持状态是否有可信手部接触、静置状态是否有正确承托面，且道具身份和材质不漂移。
4. 定向回归、完整回归和生产只读核对再次通过后，才移除完整链路测试门禁。
5. 用户提供两篇公众号文章的正文、PDF 或完整截图后，再追加学习资料与平台差距分析。

## 8. 另一台电脑的续接入口

完成本轮提交和推送后使用：

```powershell
git fetch --all --prune
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
npm install
npm run story-ad:dossier:test
npm run platform:upgrade:test
$env:PORT='3007'
node src/server.js
```

执行 `git pull` 前先检查 `git status --short`，不得覆盖另一台电脑的未提交工作。

## 9. 真实供应商全矩阵与根因闭环

### 9.1 调用账本

- 审计运行：`real-dossier-matrix-20260730071135`
- 授权上限：15 次图片供应商提交。
- 实际提交：15 次；成功 14 次；外部供应商计费未知事故 1 次；未超过授权。
- 人物：2 个候选、4 类图集、17 项原子素材；人物图集和人物设定板完整。
- 道具：身份图集 1 次、状态图集 1 次；身份图集视觉合格，原状态图集未通过人工视觉验收。
- 场景：厨房空间首张布局图发生供应商 `500/UNKXXXO004IFR`，保留为 `billing_unknown/submitted_unknown`，没有自动重试；已复用同一成功图集拆出的 4 张本地视图。阳台空间完成主图集、4 张本地视图和俯视布局图。

### 9.2 最早错误状态与修复

首轮第 1—5 次供应商结果均成功，失败发生在本地 Sharp 拆图。最早错误状态不是图片格式，而是最长任务 ID 经 `safeFilename` 截断后，人物 `body / identity / expression / action` 的类别差异位于文件名尾部并被截掉，导致并发图集、拆图前缀同名覆盖。

修复后的路径：

```text
类别前置 + 短哈希唯一文件名
→ 供应商成功结果立即写入 provider_result 检查点
→ 本地拆图和组合图后处理
→ 后处理失败只复用已付费结果，不再次提交供应商
→ allSettled 等待在途任务结算
→ billing_unknown 停止排队任务并保留事故记录
```

回归覆盖最长任务 ID、四类并发、本地拆图失败恢复、供应商结果复用、计费未知停止排队和恢复后零重复提交。

## 10. 参考效果与视觉验收

用户补充的角色设定板参考明确了最终结构：主形象、四面转身、基础动作、表情研究、局部细节应在一张可浏览的大图中完成确定性排版。

当前人物设定板采用 `editorial_character_bible_v2`：

- 2400×1350 米白色编辑式版面。
- 主形象、4 个转身视图、3 个基础动作、6 个表情和 8 个局部细节。
- 局部细节全部从已完成的高清人物原子素材做本地裁切，`detail_crop_source=finished_atomic_assets`。
- 标题、说明和版式由本地 Sharp 确定性生成，不让图片模型绘制文字，不新增供应商调用。
- 首轮发现副标题重叠和局部裁切焦点不佳后，已在本地重新组合；没有重新生成付费素材。

人工视觉结论：

- 人物：主形象、转身、表情与局部细节一致，符合“从成品素材截取细节并组合成设定板”的目标。
- 场景：阳台主图与近垂直俯视图空间关系一致；布局预检的边界、垂直度、占地和角色位置通过。
- 道具身份图：主视图、三分之四视图、侧视图和材质细节清晰。
- 道具状态图：未通过。原提示词同时要求 `held` 和“No person, hand”，导致手持状态仍生成成静物。现已改为手持状态必须出现物理可信的中性手部接触，静置状态必须出现声明的承托面；只允许最小必要手部/承托面，仍禁止完整人物、无关场景、文字、标志和水印。

道具状态提示词修复已有回归断言并部署，但达到 15 次授权上限后未再执行新的真实图片调用。因此代码根因已闭环，真实视觉结果尚未闭环。

## 11. 生产部署与三方一致性

- 最终代码提交：`7d4ee250f036088748d46209126381df229a4de2`（后续仅更新本交接文档时，以本分支最新提交为准）。
- 本地与 `origin/codex/story-ad-v3-upgrade` 在部署时 ahead/behind 为 `0/0`。
- 生产发布文件哈希审计：`238/238` 一致，缺失 0，差异 0。
- 生产备份：`/opt/vido/backups/new-story-ad-subject-scene-recovery-20260730085039`。
- PM2 `vido`：`online`。
- 生产内网健康：HTTP 200。
- 生产公网 `https://vido.smsend.cn/api/health`：HTTP 200，SQLite `status=ok`。
- 部署后活动剧情广告任务：0。
- 生产 Git 目录仍是历史 detached HEAD；本项目的既定文件级发布流程以发布清单 SHA-256 判定生产一致性，不用生产 Git HEAD 代替文件一致性。

## 12. 验证过程与剩余门禁

已实际执行：

- 档案定向回归：通过；覆盖检查点、并发、17 项人物素材、道具状态、场景多空间与恢复。
- 剧情广告 V3 完整回归：通过。
- 平台完整回归：本地通过，生产部署后通过。
- JavaScript 语法检查及 `git diff --check`：通过。
- 已完成审计只读复核：15 次提交、14 次成功、1 次外部事故，复核过程 0 次供应商调用。
- 生产发布文件哈希：238/238 一致。
- 生产 PM2、内外网健康、SQLite、活动任务：均通过。
- 人物、道具、场景真实产物人工视觉检查：人物和场景通过；道具身份图通过；旧道具状态图未通过并触发根因修复。

未执行：

- 修复后新的道具状态图真实生成：未执行，原因是用户授权的 15 次真实供应商提交已经用尽。续接时只允许生成 `state` 单元，预计 1 次，不得重做人物、道具身份或场景。
- 两篇微信公众号学习资料：应用内浏览器被安全策略明确阻止访问 `mp.weixin.qq.com`，不得绕过或切换替代浏览器。需用户提供正文、PDF 或完整截图后再做平台优化对照。

当前剩余风险：

- 外部供应商对厨房布局图的 `billing_unknown` 事故仍应保留，不得自动重试或删除审计证据。
- 在新的道具状态图通过“手持接触”和“静置承托面”人工验收前，完整链路保持不可测试状态。
