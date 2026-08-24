# 2026-08-24 当前上下文驱动生成与 V202a 生产交接

> 交接时间：2026-08-24 18:15（Asia/Shanghai）  
> 目标：家庭电脑从 Gitee 拉取后，继续优化剧情广告的人物、场景与模型接入。  
> 权威远端：仅 Gitee `origin`；不使用、不推送、不核对 GitHub。  
> 当前分支：`codex/story-ad-systemic-remediation`

## 1. 当日目标与用户决策

1. 新合同是唯一执行权威。旧人物、场景、视觉资产和独立全景写入口只允许明确返回 `409 LEGACY_PRODUCTION_PATH_BLOCKED`，不得再执行、重试或作为新版本发布门禁。
2. 当前先使用人物资产与场景五视图流程；真 360 全景模型以后单独解决，不阻塞当前人物、场景、分镜和成片主流程。
3. 删除单个任务必须按任务索引立即逻辑删除，不能同步遍历整库大 JSON；任务自有生成文件后台清理，上传素材和素材库共享引用保留。
4. 人物与场景生成彻底分离：
   - 人物：完整人物、穿搭配饰、随身物、动作表情。
   - 场景：场景母图、固定视图、人物站位和移动轨迹。
5. 人物确认提示固定精简为：`本次会生成完整人物、穿搭配饰、随身物、动作表情。` 不显示固定费用上限，不把供应商折扣变成用户生成门禁。
6. 第一阶段对话与人物规划必须适用于广告、剧情、所有行业、时代、场景和主体类型；不能写死古代、现代机器人或任何固定业务模板。当前项目内容是唯一权威。
7. 模型先识别当前主体类型，再使用对应字段：人类使用外貌、体态、穿搭和发型妆造；机器人使用尺寸、壳体、材质、关节、传感器、面板、指示灯和挂载件，不强迫填写族裔、皮肤或人类妆造。
8. 微众 MaaS 必须严格按供应商 PDF 的端点、字段、媒体类型和响应路径接入；访问凭证不写入代码、Git、MD 或日志。

## 2. 修改前后的完整数据流

### 2.1 对话立项

修改前：

```text
用户当前创意
  -> 固定恢复问题库
  -> 可能继承古代权贵、秘宝、穿越等旧模板
  -> 达到问题上限后“帮我完善”可能被静默吞掉
```

修改后：

```text
用户当前创意
  -> 提取当前题材、时代、行业、主体、关系和目标
  -> 只询问会影响生成结果的最少缺口
  -> 用户要求“帮我完善”时必须给出当前上下文建议
  -> 现代、古代、机器人、跨时代分别按本次证据处理
  -> 禁止读取旧任务模板补写当前项目
```

### 2.2 人物资产

修改前：

```text
点击生成人物资产
  -> 前端用族裔、外貌、发型/妆造等人类字段写死拦截
  -> 或直接进入人物图片阶段
  -> 机器人也可能被要求补人类字段
```

修改后：

```text
点击生成人物资产
  -> 只校验项目事实和精确主体数量
  -> person-plan 独立规划任务
  -> 按当前项目逐主体识别 subject_kind
  -> 人类/机器人使用各自结构化规格
  -> 时代与当前内容一致性检查
  -> 规划通过后才签发图片调用许可
  -> 生成并提交人物资产
  -> 场景资产仍由场景模块独立生成
```

这保证“少提问”不是漏字段：平台先用真实当前上下文自动规划，只在存在不可推断且会改变结果的事实时询问用户。

### 2.3 单任务删除

修改前：

```text
删除请求
  -> 同步读取并遍历整库大 JSON
  -> 逐个检查文件引用
  -> 数据量增大后超过前端 30 秒
```

修改后：

```text
删除请求
  -> 按任务索引定位
  -> 立即完成逻辑删除并响应
  -> 后台清理任务自有生成文件
  -> 上传素材/素材库引用继续保留
```

### 2.4 微众 MaaS

```text
模型登记（默认禁用未验证项）
  -> 文本：GPT-5.6 Sol/Terra/Luna、Claude Opus 5、Gemini 3.5 Flash
  -> 图片：GPT Image 2、Nano Banana/NB2 Lite
  -> 视频：Seedance 2.0
  -> GPT-5.6 使用 max_completion_tokens，禁止 max_tokens
  -> GPT Image 2 文生图使用 JSON /images/generations
  -> GPT Image 2 编辑使用 multipart /images/edits + image[]，最多 6 张
  -> 响应按供应商规定路径提取
```

供应商接口说明见 `docs/integrations/weizhong-maas.md`。Claude Opus 5 未签约、Gemini 3.5 Flash 未通过 `/v1/models` 探针，因此保持禁用；本轮没有保存或使用用户发送的密钥。

## 3. 代码和文件变更清单

### 当前上下文与主体规划

- `public/story-ad/views/assetCenterView.js`
  - 移除写死的人类字段前端门禁。
  - 人物按钮改为先运行 `person-plan`。
  - 保留用户指定的简短确认提示。
- `src/services/newStoryAd/storyAdService.js`
  - 当前项目与目标主体是唯一提示上下文。
  - 人类、机器人采用不同字段语义。
- `src/services/newStoryAd/assistSubjectProfileService.js`
  - 增加 `subject_kind` 和时代隔离质量检查。
- `src/services/newStoryAd/subjectProfileTextService.js`
  - 增加人类/机器人分类与机器人专用完整性合同。
- `src/services/newStoryAd/independentPersonPlanService.js`
  - 逐主体传递并持久化 `subject_kind`。
- `src/services/newStoryAd/subjectAssetBundleService.js`
  - 机器人图片提示改用结构、材质、关节、传感器和机械动作语义。
- `src/services/newStoryAd/generationSpecCompletionService.js`
  - 机器人跳过人类服装知识和鞋履强制补齐。
- `src/services/newStoryAd/assetPlanService.js`
  - 机器人族裔字段标记为不适用。

### 微众模型接入

- `src/services/settingsService.js`：登记微众 MaaS 模型与图片适配能力。
- `src/services/pipelineModelService.js`：登记新剧情广告候选，未验证模型默认禁用。
- `src/services/newStoryAd/mediaAdapter.js`：按 PDF 实现 GPT Image 2 JSON/multipart 两种合同。
- `docs/integrations/weizhong-maas.md`：供应商模型、端点、字段、响应、折扣和启用状态说明。
- `scripts/test-story-ad-context-subject-webang-contract-v202.js`：主体、时代、调用顺序与微众字段合同回归。

### 同日其它关键优化

- 单任务删除改为索引逻辑删除和后台清理。
- 人物、场景入口和数据所有权分离。
- 第一阶段对话移除古代题材硬编码并修复“帮我完善”静默结束。
- 人物按钮未声明恢复变量导致的 `ReferenceError` 已修复。
- 默认空间合同为五视图；真 360 只在以后有合格模型时显式启用。
- `storyAdService.js` 保持 3800 行冻结边界；新增业务继续拆入独立模块，未提高门禁上限。

当天早期 V201i-V201ae 的生产资产、检查点、发布与全景模型审计细节见：

- `docs/handoffs/2026-08-24-production-asset-validation-handoff.md`

## 4. 提交记录、分支与家庭电脑续接

本轮最终运行版本相关提交：

```text
b604d565 fix(story-ad): plan typed subjects before generation
f04f75ff build(story-ad): freeze V202 release
135c7185 fix(story-ad): keep orchestration boundary within freeze
3ce9d6ab build(story-ad): freeze V202a release
```

交接文件提交会位于以上提交之后。家庭电脑执行：

```powershell
cd D:\VIDO
git status --short
git fetch origin --prune
git switch codex/story-ad-systemic-remediation
git pull --ff-only origin codex/story-ad-systemic-remediation
npm install
node src/server.js
```

如果家庭电脑已有未提交修改，先检查是否与远端变更重叠；不要使用 `git reset --hard`。本地服务地址：`http://localhost:3007`。

## 5. 本地、Gitee、生产三方一致性

| 核对面 | 结果 | 证据 |
|---|---|---|
| 本地 Git | 一致 | 交接前 `HEAD=3ce9d6ab...`，与上游 ahead/behind `0/0` |
| Gitee `origin` | 一致 | `origin/codex/story-ad-systemic-remediation=3ce9d6ab...`；交接 MD 提交后再次推送并复核 `0/0` |
| 本地运行制品 | 一致 | 836 个清单内运行文件验证通过，`runtime_hash=1581e766...d0501` |
| 生产运行制品 | 一致 | PM2 实际目录的 836 个清单文件验证通过；加运行清单共 837 项 |
| 制品身份 | 一致 | `build_id=20260824-production-v202a`，`artifact_id=c262e757...a3fb1`，本地与生产完全相同 |
| 生产来源 | 一致 | `source_revision=135c7185...`，`remote_sync_verified=true`；生成制品提交为 `3ce9d6ab...` |

重要：`/opt/vido/app` 目前是旧兼容目录，不是 PM2 当前执行目录。生产权威必须看 PM2 `exec cwd` 和不可变发布清单；当前真实目录为：

```text
/opt/vido/releases/c262e757700e52048399a80492ee5094e869a3e7461d6d8e40e2ada07c7a3fb1
```

## 6. 实际验证过程

### 定向与静态检查

- 新增 V202 当前上下文/主体/微众合同回归：通过。
- 人物规划统一生成回归：17 项通过，模型与媒体付费调用 0。
- 独立人物规划并发回归：2 个模型桩调用、峰值并发 2、只重试缺失 1、付费调用 0。
- 人物资产、视觉资产同步、工作区 UI、人物来源入口回归：全部通过。
- 所有本轮修改 JS 的 `node --check`：通过。
- `git diff --check` 与凭证泄漏检查：通过。

### 完整发布门禁

- systemic：通过。
- platform full / 跨版本：通过，约 1029 秒。
- release core / 黄金合同：通过。
- 3 个拓扑场景、6 个剧情节拍、10,000 固定样本、400 组变形、50 并发：通过。
- 重复许可 0，真实付费调用 0。
- 通用、消费品、本地服务、科技行业，以及广告、剧情、漫画形态共用通用服务；行业硬编码检测为 0。

### 生产只读核对

- PM2 `vido`：`online`，restart 0，Node `v20.20.2`。
- 内网健康：`ok`。
- 公网健康：`ok`。
- 数据库健康与 SQLite `quick_check`：`ok`。
- 活动生成任务：0。
- 历史隔离 unknown billing：69；活动 unknown billing：0。
- 生产 Chrome 实点“生成人物资产”：出现指定简短确认；取消后控制台错误 0，未触发模型或媒体调用。

## 7. 未执行项、剩余风险与费用边界

1. 未执行微众 MaaS 真实 `/v1/models` 探针和付费生成。原因：凭证没有写入仓库或日志，且本轮验收保持零付费。
2. Claude Opus 5 尚未签约；保持禁用。
3. Gemini 3.5 Flash 是供应商后续口头更新，PDF 中没有该型号；必须以真实 `/v1/models` 返回为准后才能启用。
4. 真 360 模型仍未接入；五视图流程可用，但不能把五视图描述成真正 2:1 等距柱状无缝全景。
5. 历史隔离 unknown billing 69 条只读保留，不能自动重试或改写；当前活动相关数量为 0。
6. 用户原有工作树修改、旧 handoff 删除和研究文件未纳入本轮提交，家庭电脑拉取时也不会覆盖它们。

## 8. 下次继续优化的入口和顺序

1. 家庭电脑先按第 4 节命令拉取并启动 3007。
2. 新建一个与历史完全不同的测试项目，例如现代服务广告、古代剧情、科技机器人项目各一个；验证追问与人物规格不会串题材。
3. 每个项目只走到人物确认与规划结果，先检查：
   - 问题数量是否足够少；
   - 当前时代、行业和主体类型是否正确；
   - 不同人物是否各自拥有独立规格；
   - 人物规划中是否混入场景图片内容。
4. 再执行一次受控人物资产生成，记录真实提示、模型路由、图片调用数、费用证据和生成质量。
5. 微众访问凭证应在受保护设置中重新录入或轮换，先运行只读 `/v1/models`，确认真实模型 ID 后再启用单个候选；不要一次启用全部模型。
6. 真 360 保持独立研究，不修改当前五视图默认流程。

## 9. 安全边界

- 本文不包含服务器密码、API Key、Token 或 SSH 私钥。
- Git 仅使用 Gitee `origin`。
- 回家电脑使用独立 SSH 密钥；不要通过 Git、MD 或聊天复制私钥。
- 所有真实图片/视频调用都必须经过当前生成许可和费用审计，未知计费状态禁止自动重试。
