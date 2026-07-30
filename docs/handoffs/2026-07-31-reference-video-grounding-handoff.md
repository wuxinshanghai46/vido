# 2026-07-31 参考视频分析与人物场景档案修复交接

> 次日公司电脑续接用。本文不含服务器密码、API Key、Token 或 SSH 私钥。

## 1. 当日目标与用户决策

- 解决参考视频分析结果与原片明显不符、环境被写成产品、人物描述泛化、场景只有文字却让人误以为已生成图片、补齐后保存不确定等问题。
- 修复后核对本地、Git、生产运行文件和现有生产任务。
- 今晚不触发新的真实模型、人物图片、场景图片或视频生成，避免在文字档案尚未确认时重复付费；明天确认文字后再显式生成资产。

## 2. 已确认根因

1. 逐帧视觉分析使用 `frames.slice(0, 8)`，参考视频共有 10 个证据帧，最后的产品型号和品牌落版帧被遗漏。
2. 多批视觉结果直接合并并优先采用首个候选，“现代住宅”这类环境描述因此被当作广告产品；旧结构校验只检查字段非空，没有检查产品/环境语义冲突。
3. 参考分析的“原创、可信、自然外观”等方向文字直接写入人物最终档案，非空门禁又将其误判为完整；旧全局人物设定还可能覆盖补齐后的详细字段。
4. 参考分析把大段逐帧结果追加到广告需求，人物和场景数据没有只进入各自的结构化档案。
5. 人物/场景补齐按钮在自动保存真正得到服务器确认前就显示成功，失败或延迟时造成“已完成”错觉。
6. “AI 补齐场景文字”和“调用图片模型生成场景图片”没有清楚分开。生产任务实际上只有 `context / asset_plan / scene_config / prop_assets`，从未存在 `scene_assets`，因此场景图片并没有生成。

## 3. 修改前后数据流

### 修改前

`视频 10 帧 → 只取前 8 帧 → 多批视觉结果直接拼接 → 首候选当产品 → 大段分析写入广告需求 → 泛化人物/重复场景写入档案 → 前端先显示成功、保存后到 → 无 scene_assets 却容易被理解为已生成场景`

### 修改后

`视频证据 → 最多 8 帧均匀抽样并强制包含尾帧/落版 → 视觉批次 → 独立文本综合 → 产品/环境/人物/空间语义门禁 → 紧凑广告需求 + 详细人物档案 + 独立场景计划 → 服务端确认保存后显示成功 → 文字补齐与付费图片生成分别标识`

若产品与环境仍冲突、空间重复、动作没有证据或结果被截断，分析会失败并要求重新识别，不再静默接纳。

## 4. 主要代码变更

- `src/services/newStoryAd/referenceVideoAnalysisService.js`
  - 均匀选择证据帧并保留尾帧。
  - 新增参考视频文本综合阶段和语义校验。
  - 生成紧凑 `generated_brief`，详细内容保留在人物/场景结构中。
- `src/services/newStoryAd/referenceEvidenceTextService.js`
  - 从可见文字和尾帧证据中选择真实产品，识别并拒绝“环境当产品”。
- `src/services/newStoryAd/assistScenePlanService.js`
  - 参考自动投影场景不再被误判为用户手填，后续辅助仍执行参考证据一致性校验。
- `public/js/new-story-ad/reference-video-analysis.js`
  - 人物、场景分别投影；参考场景记录来源和分析 ID；广告需求不再追加完整逐帧报告。
- `public/js/new-story-ad/subject-assets-ui.js`
  - 详细档案优先于旧全局人物方向。
- `public/js/new-story-ad/subject-profile-assist.js`
  - 人物补齐等待服务端保存确认。
- `public/js/new-story-ad-legacy-ui.js` 与新增 `public/js/new-story-ad/auto-save-confirmation.js`
  - 场景/人物补齐共用保存确认控制器。
- `public/js/new-story-ad/scene-assets.js`、`public/digital-human.html`
  - 显式区分“补齐空间文字”和“生成场景图片”。
- `src/services/newStoryAd/modelGateway.js`、`src/services/pipelineModelService.js`
  - 注册 `new_story_ad.reference_video_synthesis` 阶段。
- `scripts/deploy-new-story-ad-assist-isolation.js`
  - 发布清单扩展为 69 个完整剧情广告运行文件，避免历史局部部署漂移。
- 回归测试覆盖参考分析、人物档案、场景来源、保存并发、界面语义和平台阶段审计。

## 5. 现有生产任务状态

任务：`f8e40163-78b1-41b0-ac43-1f3881ceba49`

- 状态：`working / scene_config_done`
- 内容版本：`11 → 12`
- 客户端编辑序号：`91 → 92`
- 产品：`新标门窗大玻璃全景幕墙窗（天阔重型提升推拉窗）`
- 人物：林悦，一份完整原创档案，外貌、服装、发型妆造和禁止项均已填写。
- 场景：
  - `现代住宅外景`
  - `全景窗现代客厅`
- 输出：`asset_plan / context / scene_config`
- 已删除：把广告主体误当可携带道具生成的 `prop_assets`
- 场景图片：`0`
- 可恢复场景图片检查点：无
- 模型调用：`12 → 12`，本次修复未新增调用
- 活动生成任务：`0`

任务写入前备份：

`/opt/vido/backups/task-data-repairs/f8e40163-78b1-41b0-ac43-1f3881ceba49-20260730181306-before-reference-grounding.json`

## 6. Git 与提交记录

- 分支：`codex/story-ad-v3-upgrade`
- 修复提交：`319fcbce6bd3df7ba7d6d062bb37bb7e7b519784`
- 完整运行清单提交：`05b6a0e892eb293e364650ba2d8ea118d885d65b`
- 目标远端：`origin/codex/story-ad-v3-upgrade`

公司电脑续接前先检查本地工作树，不得覆盖未提交修改：

```powershell
git status --short
git fetch --all --prune
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
npm install
npm run platform:upgrade:test
node src/server.js
```

访问：<http://localhost:3007>

如需连接生产：

```powershell
ssh -o BatchMode=yes vido-prod
```

若公司电脑的 SSH 公钥尚未授权，不要复制家庭电脑私钥；应在公司电脑生成独立密钥并由已授权设备追加公钥。

## 7. 本地、Git、生产三方一致性

| 核对项 | 结论 | 证据 |
|---|---|---|
| 本地代码与 Git | 一致 | 授权范围代码已提交并推送；最终文档提交后再次核对 `ahead/behind=0/0` |
| Git 分支 | 一致 | `codex/story-ad-v3-upgrade`，修复与完整运行清单均在 `origin` |
| 生产发布文件 | 一致 | 完整发布清单 `69/69` SHA-256 一致，无 mismatch |
| 生产核心运行文件复核 | 一致 | `45/45` 哈希一致，远端 `42` 个 JavaScript 语法检查通过 |
| PM2 | 正常 | `vido` 为 `online` |
| 内网健康 | 正常 | `http://127.0.0.1:4600/api/health` 为 HTTP 200 |
| 公网健康 | 正常 | `https://vido.smsend.cn/api/health` 为 HTTP 200 |
| SQLite | 正常 | `PRAGMA quick_check` 返回 `ok` |
| 活动任务 | 安全 | 0 |

生产最终发布备份：

`/opt/vido/backups/new-story-ad-assist-isolation-20260730181505`

生产采用文件级原子发布，运行代码以本次 69 个文件的 SHA-256 清单为准，不以生产目录的历史 Git HEAD 作为判断依据。

## 8. 实际验证过程

- JavaScript 语法检查：所有本轮修改 JS 通过。
- `git diff --check`：通过。
- 参考视频分析定向回归：`117` 项通过，包含尾帧抽样和产品/环境混淆复现。
- 参考人物 UI 回归：`92` 项通过。
- `npm run story-ad:dossier:test`：退出码 0；档案边界通过，`new-story-ad-legacy-ui.js` 保持 6399 行。
- `npm run story-ad:v3:test`：退出码 0，约 123 秒，最终到 `new-story-ad reliability tests passed`。
- `npm run platform:upgrade:test`：退出码 0，约 125 秒。
- 本地健康：HTTP 200。
- 生产隔离完整 `story-ad:v3:test`：通过。
- 生产发布哈希：69/69 一致。
- 生产只读审计：45 个核心运行文件一致、42 个远端 JS 语法检查通过、内外网 HTTP 200、SQLite `quick_check=ok`、活动任务 0。
- 目标任务写后再读：版本 12；产品、详细人物档案和两个场景均存在；模型调用仍为 12；活动任务 0。
- 测试及任务修复触发的真实模型/媒体调用：0。

## 9. 未执行项与剩余风险

- 未执行新的真实参考视频模型分析；原因是会产生外部调用，今晚用可复现证据和回归测试验证代码。
- 未生成人物资产和场景图片；原因是用户尚未确认新文字档案，提前生成会产生可避免的重复费用。
- 本地浏览器完成了静态界面、缓存版本和按钮语义核对；浏览器控制环境未完成登录后的真实点击链路。功能链路由定向与全量回归覆盖。
- 当前任务没有任何旧场景图片检查点，所以不能“恢复”图片；明天必须首次显式生成。
- 新分析已能拒绝明显污染，但真实视觉模型输出质量仍需用一个授权样本做端到端验证；若被语义门禁拒绝，应检查证据，不应降低质量标准或增加关键词例外。

## 10. 明天继续优化的顺序

1. 拉取代码并完成 `platform:upgrade:test`，启动本地 3007。
2. 打开任务 `f8e40163-78b1-41b0-ac43-1f3881ceba49`，刷新后核对紧凑广告需求、林悦四个详细字段和两个场景文字。
3. 如文字需要调整，先手工调整并确认保存成功；不要先生成图片。
4. 确认人物档案后，显式生成/选择人物资产并完成验证。
5. 分别选择两个场景，点击“生成当前场景图片（调用图片模型）”；逐场景确认空间布局、窗体结构、材质、光线和人物路线。
6. 两个场景资产都通过检查点后，再进入剧情、分镜和后续生成。
7. 另建一个测试任务，用同一参考链接执行一次授权的真实参考分析，核对尾帧产品型号、人物原创设定和两个独立场景是否自动进入各自档案；记录模型调用次数和费用。
