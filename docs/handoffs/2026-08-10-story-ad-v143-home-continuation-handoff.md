# VIDO 剧情广告平台 v143 回家续接交接

> 生成时间：2026-08-10（Asia/Shanghai）
> 目标分支：`codex/story-ad-v3-upgrade`
> 生产权威：`43.98.167.151` / `/opt/vido/current` / PM2 `vido`
> 代码基线提交：`2d8b667699a8ebc36e9ff4d610f434d119d24853`

## 1. 当日目标与用户决策

- 以生产服务器实际运行版本为最终权威，使本地、主 Git（`origin`，Gitee）和生产运行代码保持一致，避免继续开发时混用旧代码。
- 优先闭环线上错误，再吸收本地下载的 5 份人物、动作和打斗材料；知识进入平台时只提炼通用结构，不复制长提示词，不为某个题材或行业写死分支。
- 人物年龄必须支持确定年龄与年龄区间，并按用户填写的值贯穿人物档案、图片和后续镜头。
- 世界/时代、画面媒介、剧本格式、多造型显示和保存交互必须是项目级通用能力。
- 所有线上修改必须完成根因、回归、发布和生产核对；用户最后执行完整业务验收。

## 2. 今日完成的关键修改与数据流

### 2.1 世界、人物、动作与剧本结构

修改前：

```text
内容目标
→ 各阶段分别猜测时代、地域和视觉媒介
→ 人物年龄可能只存在于外貌自然语言
→ 多套造型文本、根人物字段和旧视觉档案可能不同步
→ AI 帮写混入人物、场景、镜头等所有模式规则
```

修改后：

```text
用户内容 + 项目级世界/时代设定 + 写实严格度 + 画面媒介
→ 明确输入优先；留空项从剧本与已确认参考分析
→ 人物确定年龄/年龄区间结构化保存
→ 人物身份 + 多套 look_profiles + 场景/镜头绑定
→ 人物、场景、分镜、关键帧共享同一项目快照
→ AI 帮写只生成标准剧本结构，不提前混入镜头提示词
```

- 年龄支持 `18岁`、`18~25岁`、`18～25岁`、`18-25岁`、`18至25岁` 等写法，保存时规范化，并保留用户语义。
- 修复后端无条件删除年龄及 `100岁/1000岁` 被截断的问题；人物保存后只刷新 `summary,assets` 并重挂当前视图，不加载整个项目包。
- 新增项目级世界/时代、国家/地区、具体时期、写实严格度和画面媒介。画面媒介支持自动识别、真人实拍、电影级 3D、二维动漫、动态漫画、混合媒介和自定义。
- 多造型继续采用“一人一张身份卡、多套独立造型档案”；列表、人物详情、分镜和镜头设计显示/选择造型，未知造型不再静默回退首套。
- 本地 5 份材料提炼为世界观严格度、表演动作力学、战斗节拍与机位三类结构化知识；未重复导入现有人物资产卡和运镜知识。
- AI 帮写统一输出原始要求、详细剧情梗概、出场人物、场景清单、分段剧情/场次正文和结尾落点；广告额外保留品牌/商品/服务证据与行动引导。

### 2.2 线上保存与场景规划问题

- 新场景规划在当前 release、内容修订和快照门禁内重绑当前 bundle；旧版本检查点不能绕过新合同继续运行。
- 人物保存把空年龄与 `match_brief` 视为同一自动分析语义，修复服务端已保存但前端误报“回读不一致”的问题。
- 世界/时代 UI 重新分组，补齐说明文案、响应式布局和底部操作区可见性。

### 2.3 AI 帮写模型失败

生产证据显示并非欠费：Deyun Gemini 返回请求拒绝，Apismile Gemini 返回业务语义无效；没有 401、402、余额不足或额度耗尽证据。

修改前：

```text
brief_goal 携带所有人物/场景/镜头模式规则
→ prompt-only 400 被误标为 structured-output 请求错误
→ 失败健康度不累计，坏候选可被反复选中
→ assist 语义无效后不继续剩余候选
```

修改后：

```text
brief_goal 专用短提示（只保留剧情事实与标准剧本结构）
→ prompt 请求和 structured-output 请求分别诊断
→ 请求拒绝正确累计失败与冷却
→ assist 语义无效进入受控候选恢复
→ 保留人物、关系、时代、地点、动作、冲突和结尾事实
```

生产真实文本烟测已验证古今双时空、竹海伏击/打斗、保护受伤、离别和现代重逢均被保留。烟测共发生 2 次成功的 GPT-5.5 文本调用：第一次模型成功后本地校验脚本因中文正则编码失败，第二次使用无编码歧义校验完成；没有图片或视频调用。

## 3. 代码与提交记录

v126 后的主要提交：

```text
ad7aed0  chore: align repository with production v126 artifact
592aacf  fix: harden story ad assist model routing
4e184da  fix(release): allow same-contract immutable upgrades
6880a9e  feat(story-ad): add world action and multi-look contracts
196d5d5  refactor(story-ad): split person and world UI helpers
7f0b509  test(story-ad): enforce new world-setting prompt authority
9122bb1  test(story-ad): follow split person state module
7eb4507  feat(story-ad): lock age medium and screenplay structure
27c509f  test(story-ad): cover age and visual medium contracts
4922d8b  fix(story-ad): regroup brief settings UI
5cb82b5  fix(story-ad): align auto age save readback
2d8b667  fix(story-ad): harden assist model fallback
```

v143 直接涉及：

- `src/services/newStoryAd/providerAdapterRegistry.js`：区分普通 provider 请求与 structured-output 请求诊断。
- `src/services/newStoryAd/modelGateway.js`：`new_story_ad.assist` 纳入受控语义恢复候选。
- `src/services/newStoryAd/briefGoalPromptService.js`：新增 brief_goal 专用剧本提示合同。
- `src/services/newStoryAd/storyAdService.js`：brief_goal 使用专用提示，其它模式保留各自规则。
- `scripts/test-new-story-ad-structured-output.js`：覆盖 prompt-only 400 冷却和第三候选恢复。
- `scripts/test-new-story-ad-display-format-authority.js`：覆盖提示隔离、剧本结构以及打斗/冲突事实保留。
- `config/story-ad-release.json`、两份发布清单：升级为 `20260810-assist-v143`。

## 4. 本地、Git、生产三方一致性

交接 MD 创建前完成的代码核对：

| 核对项 | 本地 | origin/Gitee | 生产 | 结论 |
|---|---|---|---|---|
| 代码基线 | `2d8b667699a8ebc36e9ff4d610f434d119d24853` | 同 SHA，ahead/behind `0/0` | v143 不可变 artifact | 一致 |
| Build | `20260810-assist-v143` | 发布配置已提交 | 同值 | 一致 |
| Artifact | `56ec1895b2be63738963c4b964e774d89d2e944b54edc6bd7be7d09de037a491` | 清单已提交 | `/opt/vido/releases/56ec...a491` | 一致 |
| Source snapshot | `7e7091e0cb46e4543d5458a611d76e532eb1fc9e929bc65fa8692ec367cc2d2f` | 清单已提交 | 同一 artifact 清单 | 一致 |
| Release bundle | `29b5ee77d60da381eadda2c35209d13cc41d43152e9b54ea0512416b60a5ba5d` | 由已提交清单确定 | 响应头同值 | 一致 |
| Runtime hash | `30cb7e7cedf452fd758d55177c2829d044f7d82504cdc091bab2a27dace208e4` | 由已提交清单确定 | 响应头同值 | 一致 |
| Runtime 清单文件哈希 | `30fc0be2...816d8` | 文件已提交 | 同值 | 一致 |
| Public 清单文件哈希 | `64aee4b2...0c30` | 文件已提交 | 同值 | 一致 |
| 逐文件校验 | Runtime 651 / Public 47，差异 0 | 清单已提交 | Runtime 651 / Public 47，差异 0 | 一致 |

生产以 `/opt/vido/current` 指向的不可变 release 和逐文件 SHA-256 为权威，不以 `/opt/vido/app` 旧工作目录的 Git 状态判断运行代码。

生成本交接文件后会新增一个“仅文档”的 Git 提交。因此回家拉取后的分支 HEAD 会比生产代码基线多 1 个交接文档提交；运行代码与 v143 不发生任何变化，这不属于代码不一致。

## 5. 当前生产状态

- `/opt/vido/current`：`/opt/vido/releases/56ec1895b2be63738963c4b964e774d89d2e944b54edc6bd7be7d09de037a491`
- PM2：`vido` online，PID `4358`，restart `0`，工作目录为上述不可变 release。
- 内网健康：`status=ok`，database `ok`。
- 公网健康：`status=ok`，database `ok`。
- SQLite：`PRAGMA quick_check = ok`。
- 活动生成任务：`0`。
- 未知计费任务：`0`。
- Release epoch：`26`。

目标任务 `3f14e285-67d7-4656-9bec-6bff7af7ec84` 当前只读状态：

- `status=working`
- `stage=scene_config_failed`
- `active_stage` 为空
- `active_generation_id` 为空
- 支持编号：`0c939a31-cfc0-4ab2-9080-c4f55774a7ff`
- 没有自动续跑或后台付费调用。

## 6. 已执行验证

- `git fetch --all --prune`：成功；交接前本地与 `origin/codex/story-ad-v3-upgrade` 为 `0/0`。
- 本地开发服务：`http://localhost:3007/api/health` 返回 `status=ok`。
- v143 定向回归：story setup、structured output、display format authority、V3 boundaries 全部通过。
- `npm run platform:upgrade:test`：退出码 0，用时 355.6 秒，完整平台回归通过。
- 发布门禁：首次被参考视频测试的偶发状态断言拦截；该测试单独复跑 198 项通过，第二次完整发布门禁通过后才切换生产。
- 本地发布完整性：Runtime 651 项、Public 47 项，差异 0。
- 生产发布完整性：Runtime 651 项、Public 47 项，差异 0；runtime hash 与本地相同。
- 生产 PM2、内外网健康、SQLite、活动任务和未知计费只读核对全部通过。
- v143 生产真实文本烟测：2 次 GPT-5.5 成功，无图片/视频生成；第二次完整校验得到 2 位人物、3 个场景、4 段剧情，并保留打斗冲突。

## 7. 未执行项、风险与数据边界

未执行项：

- 未替用户点击目标任务的 AI 帮写或场景规划；避免覆盖用户输入和产生额外文本费用。
- 未执行真实图片、人物档案图片、全景、视频或 6DoF 付费端到端生成。
- 未执行用户最终业务验收；应在回家拉取后由用户进行。
- GitHub 镜像未配置为本机远端，本次只核对并推送权威 `origin`（Gitee）。

剩余风险：

- 外部模型仍可能超时、拒绝请求或返回语义无效结果；v143 会正确冷却并尝试受控候选，但不能保证所有外部供应商始终可用。
- 如果新的打斗要求只输入在上次临时弹窗、没有写入内容目标，重试前需要把该段补回；不需要重写整篇故事。
- 目标任务仍保留旧的 `scene_config_failed` 展示。AI 帮写成功并保存最新内容后，再由用户显式重跑场景规划；不要自动续用旧失败状态。
- 本公司电脑工作树保留了一批早于本次工作的用户文档/日志变动和未跟踪研究文件，本次交接不会提交或删除它们。它们不属于 v143 运行代码；回家电脑不会通过 Git 拉到这些未提交文件。

## 8. 回家续接命令

先确认家庭电脑没有未提交修改：

```powershell
cd <VIDO项目目录>
git status --short
git fetch --all --prune
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
git log -3 --oneline
npm install
node src/server.js
```

不要执行 `git reset --hard`。如果家庭电脑存在未提交修改，先单独提交或安全保存，再执行 `pull --ff-only`。

启动后访问：`http://localhost:3007/story-ad/`。

## 9. 回家后的建议验收顺序

1. 确认 `git log -3 --oneline` 同时包含 v143 代码提交和本交接文档提交。
2. 强制刷新生产或本地新版页面，确认 build 为 `20260810-assist-v143`。
3. 在目标任务中检查年龄 `20~25岁` 的保存、刷新和人物档案继承。
4. 检查世界/时代、国家/地区、具体时期、写实严格度和画面媒介的提示、响应式布局与保存。
5. 检查一人两套造型的列表徽标、详情、分镜绑定和镜头选择；不要先生成付费图片。
6. 如新打斗要求未持久化，只补回该段，然后重试一次 AI 帮写；确认输出为标准剧本结构且保留打斗冲突。
7. AI 帮写保存成功后，再显式重跑场景规划，确认竹海不再被机械复制为所有场景。
8. 最后再决定是否授权低成本人物/场景图片验收；视频、全景和 6DoF 另行确认费用。

## 10. SSH 与凭证安全

家庭电脑必须使用自己的 SSH 私钥；不能从 Git、交接文档或公司电脑复制私钥。如果尚未授权，生成独立公钥并由已授权设备追加到服务器。

```powershell
ssh -o BatchMode=yes vido-prod
```

本交接文件不包含服务器密码、数据库密码、API Key、Token 或 SSH 私钥。
