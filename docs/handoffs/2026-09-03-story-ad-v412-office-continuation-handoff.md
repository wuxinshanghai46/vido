# 2026-09-03 剧情广告 V412 家庭到公司续接交接

> 最后核对时间：2026-09-03（Asia/Shanghai）
>
> 当前分支：`codex/story-ad-systemic-remediation`
>
> 交接前 Git 提交：`12f346b675b8eea6a6e816a6ad66872d3ef81d8a`
>
> 生产源码提交：`ded152cba8e4e60849ef55dedb3d8bd4caa5ba23`
>
> 生产版本：`20260903-production-v412`
>
> 生产制品：`fbc6d0742b97785a66e80f7eabb26b53bd6a15f9322a4a5ef865474f980dd1e3`
>
> 目标任务：`b83fa67c-244a-4869-b3cc-df282fad5c59`

## 1. 本轮目标与用户决策

本交接汇总 2026-09-02 至 2026-09-03 的生产修复和优化，供公司电脑拉取后继续真实效果验证。

必须继续遵守的用户决策：

1. 修复必须作用于所有新旧任务的统一合同，不得只修当前任务或依赖任务特例。
2. 文本生成在同一次用户授权内按独立供应商 A → B → C 轮换；人物、商品、场景、分镜图片和视频仍由用户选择模型。
3. 失败历史保留审计，但用户主动重新生成不再重复确认费用；系统不得自动重试、自动生成图片或自动生成视频。
4. 人物多视图未通过不得成为可用资产；已通过的人物不因标点或页面投影差异被误判为需要重生。
5. 人物卡默认显示完整头像到腰部的半身预览；完整多视图按需打开，图片不得拉伸变形。
6. 分镜必须按已确认剧情节拍、镜头顺序、场景和转场理由生成；旧错位分镜不得继续成为当前权威。
7. 后续图片、视频和最终合成由用户本人在页面触发，本轮核对和交接不代替用户调用模型。

## 2. 2026-09-02 至 2026-09-03 已完成内容

### 2.1 声音试听与背景音乐

- 配音与背景音乐改为实时双轨试听，拖动两条音量滑杆只调整增益，不停止播放、不删除音源、不重新生成。
- 整体试听状态统一为“试听 / 暂停 / 播放结束”；配音结束时背景音乐同步停止，不再无限循环。
- 配音增益上限提高到 150%，背景音乐上限为 100%。
- 音乐卡点击后立即切换选中框，失败才回滚；不再把默认第一首误显示为当前音乐。
- 当前使用音乐缓存到生产数据盘 `/data/vido/story-ad-audio-cache`，切换和试听复用缓存。
- 声音确认后先刷新服务端导航权威再进入下一步，解决已确认却被旧路由守卫拦回的问题。

### 2.2 供应商轮换、失败恢复和管理权限

- 文本模型在一个候选失败或计费未知后，仍可继续尝试尚未调用的独立供应商；每次调用继续保留独立审计。
- OpenAI 兼容的 Claude 新模型不再发送已弃用的 `temperature` 参数。
- 用户主动重试剧本或分镜结构时，不再被历史 `billing_unknown` 永久锁死；自动重试和媒体自动重试仍禁止。
- 超管任务列表默认查看全量，只有显式 `mine=1` 才限制本人；普通用户始终只能查看自己的任务。

### 2.3 人物提示词、验证和视图

- 人物多轮规划由“旧值与新值追加拼接”改为用户字段原样保留、可替换字段整体替换、最终提示词重新编译，消除服装互相矛盾的最早污染源。
- 人物多视图一致性成为资产提交前硬门禁；拒绝或未验证候选不能覆盖当前权威人物资产。
- 新人物审核增加纯摄影棚背景检查，房间、走廊、电梯、街道、办公室、住宅或展厅等剧情场景不得混入人物标准资产。
- 人物封面在生成、持久化、接口和前端统一优先头像/人物正面标准图，合成档案只作历史末级回退。
- 修复“查看完整视图”调用已移除的 `generateScene` 变量；详情首屏可打开人物标准图。
- 人物卡预览改为 320px、顶部对齐、保持比例，默认展示头像到腰部；完整档案仍通过按钮展开。
- 人物状态比较加入空白和句末标点语义归一化，避免内容相同仅标点不同就提示重生。

### 2.4 历史内容恢复、分镜重建和后段门禁

- 确认用户此前内容没有物理删除；页面“内容消失”来自人物内容版本迁移后旧下游域不再属于当前权威投影。
- 新增历史制作域安全恢复：只有镜头 ID、旁白文本和 TTS 地址逐条一致才恢复；旧人物关键帧、旧视频和旧视觉引用固定失效。
- 历史分镜不再直接标为已确认；错位时只允许“重新生成镜头结构”，结构完成后才出现图片生成入口。
- 新结构成功后统一废弃旧图片、提示词、关键帧和视频；旁白逐条一致时才保留现有配音。
- 最终页面只有 7 张首帧全部生成并确认后才显示视频生成按钮，避免提前进入付费视频。
- 跨场景叠化缺省时长统一恢复为 0.45 秒，归一化产生的 0 不再覆盖推荐值。

### 2.5 V412 通用根因修复

2026-09-02 晚间用户主动生成了 7/7 个新镜头，但在 80% 连续性校验处停止。最早错误源不是供应商，也不是页面默认旧错误：

```text
已确认剧情流包含 scene_id + transition_from + transition_reason
→ 分镜对齐层只覆盖 scene_id
→ 模型结果中的空转场字段进入持久化候选
→ 连续性硬门禁发现跨场景但没有理由
→ 7/7 文本已生成，任务仍在 80% 停止
```

V412 修改后：

```text
已确认剧情流权威
→ 分镜生成结果先继承 scene_id + transition_from + transition_reason
→ 同一剧情节点拆成多镜时仅首镜携带场景边界
→ 场景绑定
→ 本地连续性审核
→ 原子发布 storyboard_table + keyframe_contracts
```

完整检查点随后按新合同做了零模型恢复，没有重复调用已经成功的 7 次文本生成。

## 3. 主要代码与测试文件

### 声音和音乐

- `public/story-ad/controllers/liveAudioPreviewController.js`
- `public/story-ad/views/soundDesignFeature.js`
- `public/story-ad/views/soundDesignVoiceCatalog.js`
- `src/services/newStoryAd/audioMixPreviewService.js`
- `src/services/newStoryAd/soundDesignAssetService.js`
- `scripts/test-story-ad-audio-picker-playback-v380.js`

### 人物、模型轮换和任务权限

- `src/services/newStoryAd/modelGateway.js`
- `src/services/newStoryAd/providerAdapterRegistry.js`
- `src/services/newStoryAd/taskListAccessService.js`
- `src/services/newStoryAd/personAssetLifecycleService.js`
- `src/services/newStoryAd/personIdentityContractService.js`
- `src/services/newStoryAd/independentPersonPlanService.js`
- `src/services/newStoryAd/assetPlanService.js`
- `src/services/newStoryAd/blueprintCharacterProjectionService.js`
- `src/services/newStoryAd/subjectAssetBundleService.js`
- `src/routes/newStoryAd/subjectAssetPersistence.js`
- `public/story-ad/views/assetCenterView.js`
- `public/story-ad/views/assetCenterPersonSources.js`
- `public/story-ad/views/personDossierShowcase.js`
- `public/story-ad/workspace.css`
- `scripts/test-story-ad-production-issues-v387.js`
- `scripts/test-story-ad-systemic-new-task-v391.js`
- `scripts/test-story-ad-person-view-contract-v398.js`

### 分镜恢复和顺序权威

- `src/services/newStoryAd/historicalDomainRecoveryService.js`
- `src/services/newStoryAd/storyboardReplacementLifecycleService.js`
- `src/services/newStoryAd/storyboardFlowConsistencyService.js`
- `src/services/newStoryAd/storyboardTableService.js`
- `src/services/newStoryAd/storyboardCheckpointRecoveryService.js`
- `src/services/newStoryAd/continuityService.js`
- `src/services/newStoryAd/storyAdService.js`
- `src/routes/newStoryAd.js`
- `public/story-ad/views/storyboardView.js`
- `public/story-ad/views/finalView.js`
- `scripts/recover-story-ad-historical-domains-v399.js`
- `scripts/test-story-ad-historical-domain-recovery-v399.js`
- `scripts/test-story-ad-storyboard-structure-replacement-v408.js`

## 4. 当前目标任务的真实状态

生产只读核对结果：

- 任务状态：`done`
- 分镜阶段：`checkpoint_recovered`，7/7，100%
- 分镜结构：7 条
- 关键帧合同：7 条
- 人物场景分镜图：0/7
- 关键帧 / 分镜视频：0
- 场景资产：2 个
- 活动生成 ID：空
- 当前图片门禁：`STORYBOARD_IMAGES_REQUIRED`，这是下一步尚未生成图片的正常状态，不是错误。
- 模型调用总数：307；生成单元总数：63。
- 本次 V412 检查点恢复前后均为 307 / 63，新增文本、图片、视频调用均为 0。

已核对的场景顺序：

```text
SH01 现代高端家居展示厅
SH02 高端商业展台（带剧情转场理由）
SH03 高端商业展台
SH04 高端商业展台
SH05 现代高端家居展示厅（带剧情转场理由）
SH06 高端商业展台（带剧情转场理由）
SH07 现代高端家居展示厅（带剧情转场理由）
```

## 5. 本地、Git、生产三方一致性

| 核对项 | 本地 | Git 远端 | 生产 | 结论 |
|---|---|---|---|---|
| 分支 | `codex/story-ad-systemic-remediation` | `origin/codex/story-ad-systemic-remediation` | 清单记录同一 source ref | 一致 |
| 交接前 HEAD | `12f346b6` | `12f346b6` | 发布封装提交不直接作为运行源码 | ahead/behind `0/0` |
| 运行源码 | 清单记录 `ded152cb` | 该提交已在目标分支 | `ded152cb` | 一致 |
| 源码树 | `990e9276...` | 目标分支包含 | `990e9276...` | 一致 |
| 运行清单 SHA-256 | `ecd64c2a...` | 由发布提交跟踪 | `ecd64c2a...` | 一致 |
| 发布制品 | `fbc6d074...` | 发布清单已提交 | 当前软链指向同 ID release | 一致 |
| 清单文件 | 972/972 | 发布提交包含 | 972/972 | 0 个差异 |

说明：`12f346b6` 是确定性发布清单封装提交，它的父提交 `ded152cb` 才是运行源码身份。交接 MD 推送后 Git HEAD 会新增一个“仅文档”提交，生产代码不需要也不应因交接文档重新发布；生产运行代码仍与 V412 清单完全一致。

## 6. 公司电脑续接命令

先确认公司电脑没有未提交修改：

```powershell
git status --short
git fetch --all --prune
git switch codex/story-ad-systemic-remediation
git pull --ff-only origin codex/story-ad-systemic-remediation
npm install
node src/server.js
```

禁止使用 `git reset --hard` 覆盖公司电脑可能存在的未提交工作。

## 7. 明天继续检测的入口和顺序

1. 打开目标任务并强制刷新页面，进入“人物场景分镜”。
2. 先核对 7 个镜头标题及场景顺序是否与本文件第 4 节一致。
3. 在图片生成入口选择 Image-2 对应模型，再由用户本人生成 7 张人物场景分镜图。
4. 逐张检查人物、产品、场景、镜头顺序和构图；不合格只重生对应镜头，不要整批重复调用。
5. 7 张分镜图全部确认后进入“视频与合成”，选择视频模型生成 7 个分镜视频。
6. 全部分镜视频完成后再生成初版成片，最后进入成片剪辑。

当前人物已通过多视图验证，不需要先重新生成人物。当前阻塞只是 0/7 张分镜图尚未由用户生成。

## 8. 本轮实际验证

### 当前交接核对实际执行

- `git fetch --all --prune`：成功；交接前本地与 upstream 为 `12f346b6`，ahead/behind `0/0`。
- `git status --porcelain`、`git diff --check`：工作树干净，无空白错误。
- 本地开发服务：端口 3007 正常监听，`/api/health` 返回 `status=ok`。
- 本地 V412 清单：972/972 文件 SHA-256 通过，清单 SHA-256 为 `ecd64c2a...`。
- 生产 V412 清单：972/972 文件 SHA-256 通过，0 个差异；当前软链指向制品目录 `fbc6d074...`。
- PM2：`vido` online，PID 10927，restart 0。
- 生产健康：`http://43.98.167.151:4600/api/health` HTTP 200；`https://vido.smsend.cn/api/health` HTTP 200；均为 `status=ok`。
- SQLite：`PRAGMA quick_check` 返回 `ok`。
- 活动任务：0；活动未知计费：0。库内 70 条历史未知计费记录仅保留审计，不处于活动状态。
- 目标任务只读审计：7 个分镜、7 个关键帧合同、0 张图片、0 个活动生成；307 次模型调用保持不变。
- JavaScript 静态检查：4 个本轮关键服务/路由文件全部通过 `node --check`。
- V408 分镜结构替换回归：通过。
- V289 分镜流程/检查点恢复回归：29 项通过，恢复供应商调用数 0。
- 发布完整性回归：11 项通过；发布闭包：973 个发布文件、3 个运行目录、73 个测试文件通过。

### 发布时已执行并由部署记录复核

- V412 的 `story_content`、`workspace_ui`、`release_core` 三组影响范围门禁全部通过。
- V412 不可变发布共校验 973/973 个发布对象；其中运行清单列出 972 个文件，另 1 个为运行时清单自身。

### 未执行项

- 未运行 `platform:upgrade:test`、`story-ad:v2:test`、`story-ad:v3:test`、`story-ad:v6:test` 等全平台/跨版本完整回归：当前家庭电脑 `LAPTOP-LDFOL0GT` 的既定规则禁止默认执行，只执行本任务影响范围门禁和定向回归。
- 未在本轮真实点击图片、视频或最终合成：这是用户明确保留给明天本人操作的付费/媒体动作。
- 广域全库审计脚本一次因 Python SQLite 桥一次性读取过大触发 `ENOBUFS`；已用有界活动任务查询、SQLite `quick_check`、目标任务专项审计和逐文件哈希替代完成当前交接核对。

## 9. 剩余风险与费用、数据覆盖边界

- 代码和目标任务状态当前没有已知阻塞；但 7 张图片与视频的真实供应商生成效果尚未发生，人物/场景视觉一致性仍需明天逐张验收。
- 历史 70 条未知计费记录不能删除，它们用于供应商审计；当前没有任何活动未知计费，也不会自动触发重试。
- 明天点击 Image-2 图片生成会产生新的真实媒体调用；请先确认模型选择和 7 个镜头顺序，再提交。
- 本轮只读核对、测试与交接没有调用模型、没有生成媒体、没有覆盖目标任务数据，也没有部署新的生产代码。
