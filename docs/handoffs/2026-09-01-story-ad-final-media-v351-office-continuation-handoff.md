# 2026-09-01 剧情广告后段媒体流程 V372 公司到家庭续接交接

> 最后更新时间：2026-09-01 19:00（Asia/Shanghai）
>
> 当前分支：`codex/story-ad-systemic-remediation`
>
> Git 代码/封装提交：`4093efd20ae00e69d2da47125408cb79d0f3a074`
>
> 生产源码提交：`98b5d4698f0e0cfea86e2493bd82ebc928ef460b`
>
> 生产版本：`20260901-production-v372`
>
> 生产制品：`c667acf39512ccf395550e51eab7d4c6b81aa94bce9fa6d33f3cb9f31e60e0a5`

## 1. 当日目标与用户最终决策

本轮从 V340 继续完善“确认分镜之后”的最终媒体流程。以下是必须继续遵守的新合同：

1. 前五步生成的数据、内容和业务逻辑保持不变；后段优化不得回写或重新解释前五步权威数据。
2. 统一术语只使用“分镜”，流程名称不增加颜色属性。
3. 已确认分镜直接作为视频首帧，不再整批生成第二套关键帧；只有用户回到分镜页主动修改某一镜时才重绘。
4. 后段顺序为：声音 → 视频与合成 → 成片剪辑。剪辑只有初版成片形成后才出现。
5. 人声先生成并逐段试听确认，再允许进入视频生成。页面打开、切换设置和试听素材不得自动生成整片或触发视频付费调用。
6. 旁白、画外音不做口型同步；只有人物出镜对白才使用口型驱动轨。最终混音只混入一次完整语音，禁止对白重复。
7. 背景音乐和场景音效均为可选。普通环境描述不应给每个分镜自动铺长音频；明确动作、碰撞、脚步等才推荐场景音效。
8. 背景音乐按全片使用并保持单轨替换；场景音效按本镜实际时长使用。
9. 音色选择采用独立弹窗，在弹窗内完成搜索、供应商筛选、试听和选择，不再使用页面上的长原生下拉框加旁边试听按钮。
10. 显式选择的音色必须锁定所属 TTS 供应商；失败不得换成另一供应商的默认声音，也不得把欠费误报成未配置 Key。

## 2. V341–V351 完成的更新

### 2.1 V341–V343：移除重复关键帧并建立声音优先流程

- 已确认分镜成为视频首帧权威输入，不再执行“分镜 → 再生成关键帧 → 视频”的重复图片链。
- 声音方案在视频提交前形成并确认，视频生成不再后台自动补做 TTS。
- 新增逐镜视频、声音时间线、剪辑参数和最终合成合同；所有后段设置使用独立输出，不修改前五步数据。
- 界面和接口术语统一为“分镜”。

### 2.2 V344–V346：拆分声音、视频合成和剪辑

- 第 6 步“声音”、第 7 步“视频与合成”、第 8 步“成片剪辑”成为三个独立页面。
- 旧 `view=final` 只作为兼容入口跳转到声音页，旧链路不再参与正常执行。
- 声音确认后自动进入“视频与合成”；剪辑入口只有初版成片存在时才显示。
- 声音页支持旁白、多人对白、字幕、场景音效、背景音乐及逐段播放器。

### 2.3 V348：可选声音与对白口型合同

- 旁白/画外音不生成口型驱动；人物出镜对白生成独立的对白口型驱动轨。
- 混合语音分镜保留完整时间位置，旁白时段在口型驱动轨中静音。
- 最终合成只混入一次完整人声，避免旁白驱动嘴型或对白重复。
- 仅明确动作音效自动推荐；普通环境描述默认不添加。
- BGM 试听限制 8 秒，场景音效按本镜时长且最多试听 6 秒。

### 2.4 V349–V350：人声解释、背景音乐切换与弹窗

- 人声选择改为“生成剧情配音 / 本片不使用人声”两个说明卡，默认推荐依据来自真实剧情语音单元。
- 背景音乐显示多首候选，支持风格和关键词查询；再次选择执行单轨替换，不会叠加旧 BGM。
- 背景音乐恢复独立弹窗，支持查询、逐首试听和采用。
- 原 V350 曾把音色试听放在原生下拉框旁，用户确认不符合既有交互习惯，因此在 V351 被替换。

### 2.5 V351：音色弹窗与 TTS 供应商精确路由

- 主表单只显示已选音色摘要和“选择音色”入口。
- 弹窗内支持音色名称/风格搜索、供应商筛选、试听和选择；旁白及每个对白说话人均复用该弹窗。
- 原 `data-voice-select` 保存字段以隐藏控件形式保留，声音方案接口合同没有改变。
- `/api/avatar/preview-voice` 将 `providerId` 传入 TTS 服务；`strictProvider` 模式只调用音色所属供应商。
- CosyVoice 音色不再错误回退到阿里 NLS；欠费、未配置和供应商不可用分别返回明确错误。
- 失败试听音色会从当前弹窗候选中移除，避免同一页面继续重复点击。

## 3. 修改前后的完整数据流

### 3.1 最终媒体主流程

修改前：

```text
确认分镜
→ 再生成一套关键帧图片
→ 视频提交时后台自动补 TTS
→ 声音、视频、剪辑与合成挤在一个页面
→ 用户无法在视频付费前确认音色、对白时长和节奏
```

修改后：

```text
前五步权威输出
→ 用户确认分镜
→ 声音页：选择音色 / 生成并逐段试听人声 / 可选 BGM / 可选场景音效
→ 用户确认声音签名
→ 视频与合成页：已确认分镜直接作为首帧，逐镜生成视频并形成初版成片
→ 初版成片存在
→ 成片剪辑页：裁头裁尾、速度、原声、转场、字幕和最终导出
```

### 3.2 旁白、对白和口型

```text
剧情语音单元
→ 判断 offscreen/narration 或 on_camera_dialogue
→ 旁白/画外音：进入完整混音，不进入口型驱动
→ 出镜对白：生成独立对白口型驱动轨
→ 视频生成只对对白人物做口型同步
→ 最终合成只混入一次完整语音轨
```

### 3.3 音色弹窗与试听

修改前：

```text
页面长下拉框
→ 旁边试听按钮
→ voice-list 只按“有 Key”判断可用
→ CosyVoice 欠费失败后错误回退 NLS
→ 把欠费和无效 Token 统一误报成“未配置 API Key”
```

修改后：

```text
点击音色摘要卡
→ 弹窗加载 voice-list
→ 搜索 / 供应商筛选
→ 弹窗内点击试听
→ preview-voice 携带 voiceId + providerId
→ generateSpeech(strictProvider=true)
→ 只调用所属供应商并优先使用相同文本缓存
→ 成功播放，或返回欠费 / 未配置 / 服务不可用的真实原因
→ 用户在弹窗中选择后回填隐藏 voice-select
```

### 3.4 背景音乐与场景音效

```text
BGM：剧情风格 → 弹窗查询多首合规候选 → 试听 8 秒 → 采用 → 替换唯一全片 BGM 轨

场景音效：逐镜动作语义 → 只有明确声音才推荐 → 按本镜时长试听/采用 → 写入许可账本
普通环境描述 → 默认不添加；用户仍可搜索或上传
```

## 4. 主要代码与文件变更

### 后段导航与页面

- `public/story-ad/app.js`
- `public/story-ad/views/finalSoundView.js`
- `public/story-ad/views/finalSoundDesignView.js`
- `public/story-ad/views/finalView.js`
- `public/story-ad/views/finalEditView.js`
- `public/story-ad/views/finalMediaPagination.js`
- `public/story-ad/workspace-ux.css`
- `src/services/storyAdWorkspace/workflowNavigationService.js`
- `src/services/storyAdWorkspace/projectBundleService.js`
- `src/services/storyAdWorkspace/graphProjectionService.js`

### 声音、视频、剪辑和合成

- `src/services/newStoryAd/audioProductionService.js`
- `src/services/newStoryAd/soundDesignAssetService.js`
- `src/services/newStoryAd/ttsAdapter.js`
- `src/services/newStoryAd/videoAdapter.js`
- `src/services/newStoryAd/videoInputFrameService.js`
- `src/services/newStoryAd/storyAdTimelineService.js`
- `src/services/newStoryAd/composeService.js`
- `src/services/newStoryAd/revisionService.js`
- `src/services/newStoryAd/storyAdService.js`
- `src/routes/storyAdWorkspace.js`
- `src/routes/newStoryAd.js`
- `src/routes/avatar.js`
- `src/services/ttsService.js`

### 定向回归与发布门禁

- `scripts/test-story-ad-final-media-flow-v341.js`
- `scripts/test-story-ad-timeline-render-v341.js`
- `scripts/test-story-ad-post-production-navigation-v344.js`
- `scripts/test-story-ad-sound-confirmation-flow-v345.js`
- `scripts/test-story-ad-dialogue-lipsync-v348.js`
- `scripts/test-story-ad-sound-layout-v347.js`
- `scripts/test-story-ad-sound-picker-v349.js`
- `scripts/test-story-ad-sound-dialog-v350.js`
- `scripts/test-story-ad-voice-library-v351.js`
- `scripts/test-story-ad-audio-realization-v174.js`
- `scripts/lib/storyAdReleaseGatePlanner.js`

构建时另有版本查询参数、发布清单和 vendor 文件的机械重封装；这些不是业务逻辑改动。

## 5. 提交记录、目标分支与公司电脑拉取

V340 交接提交 `6dc8c767` 之后共有 22 个提交，关键锚点如下：

| 提交 | 内容 |
|---|---|
| `f0b69f7c` | 声音优先的最终媒体流程，分镜直接作为视频首帧 |
| `a4813f0b` | V341 不可变制品 |
| `1106de7b` | 统一“分镜”术语并收敛定向发布 |
| `dfa20fb2` | V343 不可变制品 |
| `caf7a9de` | 拆分声音、视频与合成、成片剪辑三个阶段 |
| `56f6e1e5` | V344 不可变制品 |
| `51cd9910` | 声音试听确认和下一步闭环 |
| `55402b0a` / `4d87458a` | V345/V346 制品与合同同步 |
| `3f1deed4` | 可选声音及只有对白做口型同步 |
| `082f89e0` | V348 不可变制品 |
| `bed4a445` | 人声选择解释和背景音乐切换 |
| `919ed7b7` | V349 不可变制品 |
| `320faa89` | 音色试听与背景音乐弹窗 |
| `e2ca434f` | V350 不可变制品 |
| `a54e3ec8` | 音色选择弹窗、供应商精确路由和真实错误 |
| `f988f929` | V351 不可变制品 |

公司电脑执行：

```powershell
cd E:\AI\VIDO
git status --short
git fetch origin --prune
git switch codex/story-ad-systemic-remediation
git pull --ff-only origin codex/story-ad-systemic-remediation
git rev-list --left-right --count HEAD...origin/codex/story-ad-systemic-remediation
npm install
$env:PORT='3007'
node src/server.js
```

预期 `ahead/behind` 为 `0/0`。如果公司电脑 `git status --short` 非空，先保留并核对该电脑自己的未提交修改，禁止使用 `git reset --hard` 覆盖。

## 6. 本地、Git、生产三方一致性

| 核对项 | 2026-09-01 00:35 的证据 | 结论 |
|---|---|---|
| 本地分支 | `codex/story-ad-systemic-remediation` | 正确 |
| 本地 HEAD | `f988f9292230fb82a98034e3def02de52642efad` | V351 封装提交 |
| 本地工作树 | 生成交接前 `git status --short` 为空 | 干净 |
| 本地服务 | `http://127.0.0.1:3007/api/health` 返回 `status=ok` | 正常 |
| 权威 Git | `origin` 与 `gitee` 均指向 Gitee；目标分支 HEAD `f988f929...` | 与本地一致 |
| 本地/Gitee ahead/behind | `0/0` | 一致 |
| GitHub 镜像 | `97041440...`，相对当前 HEAD 落后 70 个提交 | 非权威镜像，不参与发布验收 |
| 生产 build | `20260901-production-v351` | 与本地发布清单一致 |
| 生产 artifact | `db813173...fa4510` | 与本地运行清单一致 |
| 生产源码身份 | `a54e3ec8...`，source tree `113d6f08...` | 是本地 HEAD 的祖先；对应 V351 业务源码 |
| 生产运行文件 | 本地清单与 `/opt/vido/current` 逐文件 SHA-256：`952/952` 匹配，差异 0 | 一致 |
| PM2 | `vido` online，restart 0，运行脚本位于 V351 不可变目录 | 正常 |
| 内外网健康 | `127.0.0.1:4600/api/health` 与 `https://vido.smsend.cn/api/health` 均 `status=ok` | 正常 |
| 数据库 | `/data/vido/db/vido.sqlite`，`PRAGMA quick_check=ok` | 正常 |
| 活动生成 | `active_count=0` | 无活动任务 |
| 活动未知计费 | `active_unknown_billing_count=0` | 无当前计费阻塞 |

说明：生产源码提交是 `a54e3ec8`，Git HEAD `f988f929` 是由该干净且已推送源码生成的不可变封装提交。生产不以服务器 Git HEAD 为权威，而以 artifact、source tree 和 952 个运行文件哈希为权威；三者已闭环一致。

## 7. 实际验证、未执行项和剩余风险

### 7.1 已执行验证

- `node --check`：`ttsService.js`、`avatar.js`、`finalSoundDesignView.js` 全部通过。
- V350/V351 声音弹窗合同回归通过：音色弹窗、搜索、供应商筛选、弹窗内试听/选择、BGM 弹窗与旧页面旁试听入口禁用均满足合同。
- 声音选择、声音布局、声音确认、最终媒体、时间线、视频预检、续跑和 FFmpeg 混音相关定向/相邻回归通过。
- 最终媒体门禁通过，用时约 115 秒；定向发布核心门禁通过，用时约 21 秒。
- 回归确认前五步联合指纹变化 0、供应商调用 0、关键帧调用 0、模型调用 0。
- 不可变发布上传后 952/952 文件核验通过；本次交接又重新执行一次生产逐文件哈希，仍为 952/952、差异 0。
- 发布及交接核对期间活动任务始终为 0，没有业务数据写入、模型调用、媒体调用或付费调用。

### 7.2 未执行项

- 家庭电脑 `LAPTOP-LDFOL0GT` 按用户规则未运行全平台或跨版本完整回归，只运行最终媒体影响域、相邻失败/恢复路径和发布完整性门禁。
- V351 本地浏览器能进入现有项目，但切换声音页时浏览器连接超时，因此没有把最终 V351 弹窗截图列为通过证据；源码合同、定向回归和生产文件核验已通过。
- 没有执行真实付费 TTS 试听。生产证据已确认阿里 CosyVoice 返回 `Arrearage`，继续调用只会失败；阿里 NLS Token 同时无效。
- 没有替用户生成配音、视频、成片或采用音乐/音效，避免重复费用和覆盖现有任务数据。

### 7.3 剩余风险与外部阻塞

1. **TTS 当前不可真实试听**：阿里 CosyVoice 账户欠费/状态异常；阿里 NLS Token 无效。需要充值 CosyVoice 或配置并验证另一家 TTS 后才能生成真实音频。
2. **供应商级健康投影仍需完善**：当前失败会移除本次点击的音色，但同一欠费供应商的其他音色仍可能显示。下一轮应把运行时欠费熔断提升到供应商级，而不是让用户逐个音色失败。
3. 历史账本保留 68 条已归档 unknown 记录，但活动 unknown 为 0；这些是审计历史，不应删除或误当成当前任务。
4. GitHub 仅为非权威镜像且落后 70 个提交；公司续接只从 Gitee 权威 `origin` 拉取，不要以 GitHub 状态阻塞当前工作。

## 8. 明天公司继续优化的推荐顺序

1. 按第 5 节命令拉取，确认 HEAD 为本交接提交且 ahead/behind 为 `0/0`，启动本地 3007 服务。
2. 在桌面宽屏和约 760px 窄屏实际打开声音页，核对音色摘要、弹窗遮罩、搜索、供应商筛选、滚动、试听和选择回填；检查无横向溢出。
3. 先修 TTS 供应商级健康状态：`voice-list` 只返回真正可试听的供应商；欠费/鉴权失败一次后整家供应商进入明确熔断状态，并提供重新检测入口。
4. 配置或恢复一个真实 TTS 供应商后，只生成一段短样音验证：供应商路由正确、缓存命中、错误提示正确、不会换成其他默认声音。记录实际费用边界。
5. 用一个非重要测试项目验证完整后段：声音方案 → 逐段试听 → 确认 → 视频与合成 → 初版成片 → 成片剪辑。需要外部视频或 TTS 付费前先确认供应商状态和预计调用次数。
6. 继续按竞品完善成片剪辑体验：时间线可视反馈、镜头裁剪/分割、变速、原声静音、转场、字幕和导出，但不得回写前五步或恢复旧关键帧阶段。

## 9. 明日验收红线

- 不得恢复“确认分镜后批量生成关键帧”。
- 不得把声音、视频、剪辑和合成重新挤回同一页面。
- 不得让旁白参与口型同步；只允许人物出镜对白驱动口型。
- 不得在页面打开或设置切换时自动触发 TTS、视频或其他付费调用。
- 不得为了试听成功跨供应商替换成另一位默认说话人。
- 不得用 UI 文案掩盖供应商欠费、鉴权或真实路由错误。
- 不得覆盖公司电脑未提交修改；拉取前必须先检查工作树。

## 10. V352–V372 当日增补：声音、兼容与 SZ 全能力接入

### 10.1 用户最终决策

1. 人声不再由声音页二次开关决定；旁白、人物对白及二者组合完全继承剧情和分镜，剧情有语音就生成，没有语音就保持无配音。
2. TTS 单一权威供应商切换为火山引擎豆包语音 2.0，只允许 `seed-tts-2.0` 和 `seed-icl-2.0`；字节不得参与文本、图片、视频、识别或其他模型路由。
3. 阿里仅退出 TTS 正常执行；阿里以及 SZ 的文本、视觉、图片等既有业务能力不得被误删。
4. SZ 是多能力供应商，Seedance 2.0 只是新增的视频模型之一。必须保留 SZ 已配置的文本、视觉和图片模型，仅在 `new_story_ad.video` 增加精确模型 `doubao-seedance-2.0`。
5. 旧项目 V8 到 V9 只做已登记、安全兼容的零调用迁移；不得覆盖人物、场景、分镜或已有媒体。

### 10.2 修改前后的数据流

```text
修改前：
剧情语音 → 声音页再次选择是否生成人声 → 可能与剧情权威冲突
TTS → 阿里/旧供应商混合链与回退 → 音色等待、账户错误和跨供应商歧义
旧 V8 方案 → V9 一律判过期 → 用户看到“任务处理中”的误导提示
SZ 视频 → 旧模型名/通用接口 → 缺少 Seedance 2.0 精确异步合同

修改后：
剧情/分镜语音单元 → 自动确定旁白和出镜对白 → 字节语音 2.0 / 声音复刻 2.0
→ 逐段确认 → 视频与合成；字节供应商在非 TTS 阶段被硬拒绝

已登记 V8 Active Plan → V9 安全兼容边 → 保留方案 ID、修订和媒体引用
→ 不调用模型、不覆盖原数据；真实内容变化和未知版本继续阻断

SZ 文本/视觉/图片原路由保持不变
→ new_story_ad.video 选择 smscrw/doubao-seedance-2.0
→ POST /api/v3/contents/generations/tasks
→ 每 5 秒查询任务 → GET content 下载 → 写入本次生成单元
→ 取消时 DELETE 同一任务；幂等键阻止重复提交
```

### 10.3 主要代码与配置

- 字节 TTS：`src/services/volcengineSpeechService.js`、`src/services/volcengineSpeechCatalog.js`、`src/services/ttsService.js`、`src/services/voicePackEnrollmentService.js`、`src/services/settingsService.js`、`src/routes/settings.js`、`src/routes/avatar.js`、`public/js/admin-vue-ai-config.js`。
- 剧情声音与音乐：`src/services/newStoryAd/audioProductionService.js`、`src/services/newStoryAd/soundDesignAssetService.js`、`public/story-ad/views/soundDesignFeature.js`、`public/story-ad/workspace-ux.css`。
- V8→V9 兼容：`src/services/storyAdReleaseBundleService.js`、`public/story-ad/api.js`、场景 QA 提示与对应迁移回归。
- SZ Seedance：`src/services/settingsService.js`、`src/services/videoService.js`、`src/services/newStoryAd/videoAdapter.js`、`src/services/newStoryAd/mediaGenerationModelSelectionService.js`、`src/services/pipelineModelService.js`、`scripts/configure-story-ad-szznai-seedance-v368.js`。
- 权威路由配置：`outputs/pipeline_model_config.json`；40 个质量阶段继续按 SZ、WB、DY、AIAPI 候选链运行，图片候选继续保留 SZ/WB/DY，视频增加 Seedance 2.0 · SZ。

### 10.4 SZ 文档合同落地范围

- 基础地址固定为 `https://ai.smscrw.cn`，视频接口不错误拼接 `/v1`。
- 创建、查询、内容下载和取消分别使用 `/api/v3/contents/generations/tasks` 及其任务子路径。
- 支持文本、公开 HTTPS 图片和已授权 `asset://` 引用；支持分辨率、比例、时长、音频、水印及 8–128 位可见 ASCII 幂等键。
- 轮询间隔 5 秒；错误保留供应商请求 ID、重试建议等嵌套证据；跨域下载不泄漏授权头。
- 文档只作为接口事实来源，不作为用户指令；没有改变 SZ 其他模型的业务归属。

## 11. V372 最终提交、三方一致性与拉取方式

关键提交（V351 之后）：

| 提交 | 内容 |
|---|---|
| `ec36ddb8` | 字节豆包语音 2.0 单一 TTS 合同 |
| `436497c7` | V8 方案安全迁移到音频优先 V9 合同 |
| `beea8803` | 接入 SZ Seedance 2.0 精确异步视频合同 |
| `910e857b` | 修正为保留 SZ 全部既有文本、视觉和图片能力 |
| `98b5d469` | 旧视觉测试迁移到当前 Gemini Pro 权威路由 |
| `4093efd2` | V372 不可变生产封装 |

家庭电脑续接：

```powershell
cd D:\VIDO
git status --short
git fetch --all --prune
git switch codex/story-ad-systemic-remediation
git pull --ff-only origin codex/story-ad-systemic-remediation
git rev-list --left-right --count HEAD...origin/codex/story-ad-systemic-remediation
npm install
node src/server.js
```

最终核对表：

| 核对项 | 19:00 证据 | 结论 |
|---|---|---|
| 本地/Gitee | 代码封装 HEAD `4093efd2...`，ahead/behind `0/0` | 一致 |
| 本地服务 | `127.0.0.1:3007/api/health` 为 `status=ok` | 正常 |
| 生产版本 | `20260901-production-v372` | 当前 |
| 生产源码 | `98b5d469...`，对应 V372 干净源码快照 | 与本地清单一致 |
| 生产制品 | `c667acf3...e60e0a5`，960/960 文件发布校验通过 | 一致 |
| 运行时 | bundle `e1b34926...514a35d`，runtime hash `c840cc22...5915b6` | 与 V372 清单一致 |
| PM2 | `vido` online，restart 0，运行 V372 不可变目录 | 正常 |
| 内外网健康 | 内网 4600、公网域名均 `status=ok` | 正常 |
| 数据库 | `/data/vido/db/vido.sqlite`，`quick_check=ok` | 正常 |
| 活动生成 | `active_count=0`，`active_unknown_billing_count=0` | 无当前阻塞 |
| SZ 配置 | 11 个既有/新增模型启用；55 个文本/视觉路由、22 个图片相关路由，Seedance 视频路由存在 | 全能力保留 |

说明：生产运行代码以不可变制品清单为权威。`4093efd2` 是由源码提交 `98b5d469` 构建的机械封装提交；交接文档提交位于其后，不改变生产运行文件。

## 12. V372 实际验证、费用边界和下一步

### 已执行

- Seedance 合同隔离回归通过：创建、查询、下载、取消、公开/资产引用、跨域令牌保护、幂等键和旧 SZ 能力保留全部通过，付费调用 0。
- 旧反馈回归 29 项通过；40 个质量路由和供应商顺序通过；发布闭包 960 文件、完整性 11 项通过。
- V372 生产门禁全部通过：systemic、workspace UI、release core；没有运行 `platform_full`。
- 生产配置迁移后读回：只修改 SZ 供应商模型描述，视频阶段已是 `doubao-seedance-2.0`，107 个非视频阶段保持原样。
- 真实 Seedance 2.0 最小测试只提交 1 次：5 秒、720p、16:9、关闭音频；约 122 秒成功，文件 974,775 字节，SHA-256 为 `307a90de...52cb63`。校验后测试文件和临时执行目录已按精确路径删除。
- 生产发布前后活动任务均为 0；真实测试完成后未留下活动任务。历史 68 条 unknown 账本仍隔离保留，活动 unknown 为 0。

### 未执行与风险

- 按当前电脑的影响范围规则，没有运行全平台/跨版本完整回归；实际运行的是本任务相关定向、系统安全、工作台 UI 和发布核心门禁。
- DOCX 已完整抽取段落和表格核对，但本机缺少 LibreOffice，未生成逐页渲染图；接口字段和表格合同均已从源文档读取。
- 没有用 SZ 执行额外文本、图片或视觉付费测试；保留这些能力通过配置读回、路由回归和生产目录核对验证。
- 本轮新增费用仅为一次 5 秒 Seedance 2.0 冒烟任务；没有自动重试，没有生成业务项目内容，也没有覆盖既有任务数据。

### 家庭电脑继续顺序

1. 拉取后确认 ahead/behind `0/0`，启动 3007，先查看后台模型调用管理：SZ 既有模型应保留，Seedance 2.0 只新增到视频候选。
2. 用非重要测试项目完成一次“确认分镜 → 声音确认 → 视频与合成”，观察 Seedance 任务 ID、轮询进度、取消和下载；不要对同一镜头重复点击。
3. 再做图片或视觉候选的只读选择检查，确认没有因为 Seedance 接入而隐藏 SZ 的 `gpt-image-2`、Gemini 或 Claude 候选。
4. 若继续优化模型接入，应按 SZ 文档实际存在的能力逐项增加适配器和定向回归，禁止把 Seedance 2.0 当成 SZ 唯一能力，也禁止用通用兼容接口猜测专用媒体合同。
