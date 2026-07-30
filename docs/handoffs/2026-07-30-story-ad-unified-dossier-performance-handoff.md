# VIDO 剧情广告统一档案与性能升级交接

> 日期：2026-07-30
> 分支：`codex/story-ad-v3-upgrade`
> 当前状态：代码与本地验证完成；真实供应商全矩阵、生产部署及三方最终一致性尚未执行
> 完成声明：当前不得声明“完整链路可以测试”

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
- 真实普通人物样本：
  - 计划图集调用 4。
  - 首次实际成功 4。
  - 因旧指纹缺陷误触发第二批成功 4；修复后已增加防重复回归。
  - 当前总图片图集成功调用 8。
  - 当前样本 QA 如实为 `rejected`：第四视角背景比例和鞋子颜色/款式存在差异；页面保留结果并阻止进入后续步骤。
  - 修复本地视觉输入后，QA 由连续失败候选降为首个 `deyunai/gpt-4o` 候选完成。

### 5.2 未执行

- 授权真人真实供应商完整样本：预计 2 个换装候选 + 4 类图集，共最多 6 次图片调用。
- 静态道具真实样本：预计 1 次图片调用。
- 有状态道具真实样本：预计 2 次图片调用。
- 单场景真实样本：预计 2 次图片调用。
- 双场景真实样本：预计 4 次图片调用。
- 生产部署、生产回归、PM2、数据库、活动任务及发布文件哈希。
- 本地、Git、生产服务器最终三方一致性。

未执行原因：此前已向用户声明真实图片调用最多 10 次；重复指纹缺陷使当前样本已产生 8 次成功图片调用。完成剩余真实矩阵最多还需 15 次图片调用，属于超出已声明付费边界的新增授权，必须先取得用户确认。

## 6. 当前限制和风险

- 当前真实普通人物样本的业务 QA 未通过，因此不能作为生产可用演员。
- 重复提交根因已修复并有回归，但尚未用新的真实付费调用再次验证“点击后 0 新提交”。
- 道具、单场景、双场景和授权真人目前只有定向回归，没有完成方案要求的真实供应商全矩阵。
- 未部署生产，生产仍运行上一提交的代码。
- 在上述项目完成前，不得说“可以开始完整测试”或“本地/Git/服务器一致”。

## 7. 下一步顺序

1. 用户确认最多 15 次额外真实图片调用的付费边界。
2. 依次执行授权真人、静态道具、有状态道具、单场景、双场景真实样本，并记录计划/实际/成功/失败/重试/检查点命中/计费未知/耗时。
3. 对真实视觉结果做人工与模型双重 QA；失败则只修复失败类别，不重做成功类别。
4. 更新本交接文件的真实样本章节。
5. 提交并推送授权范围内文件。
6. 部署生产前核对活动任务为 0，备份运行文件和数据库。
7. 原子部署、PM2 重启、生产完整回归和只读数据核对。
8. 核对本地提交、远端分支和生产发布清单 SHA-256；全部一致后才更新完成声明。

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
