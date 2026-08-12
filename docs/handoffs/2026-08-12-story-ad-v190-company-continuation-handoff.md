# VIDO 剧情广告 v190 公司电脑续接交接

> 生成时间：2026-08-12（Asia/Shanghai）
> 目标分支：`codex/story-ad-v3-upgrade`
> 生产主机：`43.98.167.151`
> 目标任务：`3f14e285-67d7-4656-9bec-6bff7af7ec84`（星月神话故事）

## 1. 当日目标与用户决策

本轮目标是解决剧情广告视觉资产恢复中的三个通用问题，并为公司电脑继续验收留出可核对入口：

1. 同一恢复操作只做一次计费风险确认，不再逐单元连续弹出多个确认框。
2. 区分“图片模型没有配置”与“供应商超时/5XX 后断路器临时冷却”，避免把冷却误报成永久没有通道。
3. 保留已经成功的人物与场景资产；计费未知单元不自动重复付费提交。

家庭电脑 `LAPTOP-LDFOL0GT` 按用户决定只执行本功能模块的静态、定向、相邻失败/恢复及发布健康检查，不运行全平台回归。

## 2. 修改前后的完整数据流

### 修改前

用户点击继续缺失项 → 前端先显示一次总风险确认 → 后端逐 checkpoint 返回需授权 → 前端再次逐项弹出确认 → 图片供应商超时/5XX → 唯一允许的 `deyunai/gpt-image-2` 进入冷却 → 页面统一显示“没有可用通道” → 用户无法判断是配置缺失还是临时冷却。

### v190 修改后

用户点击继续缺失项 → 前端收集本次操作的全部计费未知 checkpoint → 只显示一次汇总确认（单元数、最多重复费用次数、前三项摘要）→ 用户确认后，后台仍逐 checkpoint 写入精确的一次性授权 → 成功 checkpoint 继续复用 → 仅处理缺失单元。

图片候选选择变为：读取已配置 `gpt-image-2` → 检查供应商/模型断路器 → 若在冷却则返回 `IMAGE_CIRCUIT_OPEN`、剩余等待时间并明确“本次未发起图片调用” → 若确实没有可执行配置才返回 `NEW_STORY_AD_IMAGE2_UNAVAILABLE`。未知计费单元仍不自动重投。

持久化与展示路径：供应商调用 → `model_calls` 与人物/场景 checkpoint → 任务 generation progress → 项目 bundle/API → 资产中心失败摘要与恢复入口。

## 3. 代码和文件变更

生产运行代码提交：`41c26770163c51d30d90f511d83583b78ec92f28`。

主要文件：

- `public/story-ad/views/assetCenterBillingReviewDialog.js`：新增按需加载的单次汇总确认弹窗。
- `public/story-ad/views/assetCenterBillingRetry.js`：移除逐单元弹窗循环，保留逐 checkpoint 一次性授权。
- `public/story-ad/views/assetCenterView.js`：人物、场景与合并恢复入口统一使用单次确认。
- `src/services/newStoryAd/mediaAdapter.js`：区分断路器冷却与真实配置缺失，返回冷却时间和零调用事实。
- 相关定向回归脚本：视觉同步、失败恢复、空间生成顺序、工作区 UI 与不可变发布边界。

本交接文件提交后，远端最新 HEAD 会比生产运行提交多一个纯文档提交；运行代码仍以 `41c26770…` 对应的发布清单为准。

## 4. 生产运行身份与三方核对

### Git

- 分支：`codex/story-ad-v3-upgrade`
- 交接前本地 HEAD：`41c26770163c51d30d90f511d83583b78ec92f28`
- 本地与 `origin`：`ahead/behind = 0/0`
- 本地与 `gitee`：`ahead/behind = 0/0`
- `origin`、`gitee` 远端分支均为 `41c26770163c51d30d90f511d83583b78ec92f28`
- GitHub 镜像：本次网络连接被重置，无法核对；不得把 GitHub 镜像写成已一致。
- 工作树跟踪文件相对 HEAD 无差异；5个历史未跟踪文档继续保留，未纳入本次交接。

### 生产不可变发布

- build：`20260811-ui-v190`
- artifact / current release：`d51781d19f1912a95758405d2a50465d4adf8dbb0e2bfcee66952be9f8de359e`
- source snapshot：`543df5f7ef953bf117a755487801cfbd922bf86fff571ddd426351b5b1823656`
- lockfile：`550c8c8d9faa2afcb3c5771eed70fadd7fe5d1a992348f2c7d0b0ebb12f91197`
- `config/story-ad-release.json` SHA-256：`cc8769a5c57992af80d3654cd0dceea9c991b91df11b1f390d26cf8f7c6effe4`
- runtime manifest SHA-256：`20f357f2340518e1c12ae3290a22ccb183ffbe811f86b98f9d27a78e03c5aaca`
- public manifest SHA-256：`8276d45c5b7a5559b5299b9f33af775efa761f558faa7b6b4501cc486326a2b3`
- 本地与生产 runtime manifest 声明的 649 个运行文件均为 `0 missing / 0 mismatch`。

| 核对对象 | 结论 | 依据 |
|---|---|---|
| 本地 ↔ origin/Gitee | 一致 | 交接前 HEAD 相同，ahead/behind `0/0` |
| 本地运行代码 ↔ 生产 | 一致 | 三份元数据哈希一致；649/649 逐文件校验通过 |
| Git 最新 HEAD ↔ 生产 | 交接推送后仅差纯文档提交 | 生产运行代码仍对应 `41c26770…`，无需为 MD 重新部署 |
| GitHub 镜像 | 未确认 | 网络连接重置/无法连接 443 |

## 5. 生产任务最终快照

交接核对期间用户刚触发的视觉资产批次已等待到终态后才封存：

- generation/support ID：`e84ea197-e604-4091-96ae-07020a51fc1e`
- 最终状态：`failed / visual_assets_failed`
- 活动 generation：空；全局活动任务：`0`
- 目标任务模型调用：从核对前 `187` 增至最终 `197`
- 本轮新增调用共 10 次：
  - 文本/辅助调用 3 次成功（场景规划补齐、故事事实、assist）。
  - 人物分类图 4 次成功。
  - 人物完整主图 2 次成功。
  - 人物配饰 1 次在约 149 秒后返回 `500/image2O100IFR`，状态为 `submitted_unknown / billing unknown`，系统停止自动付费重试。
- 场景 lane：投影结果 12/12，当前提示 `SCENE_REVERIFY_ONLY`，只需再次验证，不应付费重生成。
- 人物 lane：4个人物目标，内部工作单元完成 6/21；因人物配饰 500 停止，成功子资产已保留。
- 全局历史未知计费：`57`；活动任务中的未知计费：`0`。
- Active Plan 已绑定当前 v190 bundle，但仍有 `active_plan_input_fingerprint_mismatch`；明天不得绕过该合同直接启动新的付费生成。
- 最新进度还记录 `SCENE_SPACE_MISSING / space_count=0`，需与输入指纹不一致一起先做只读根因核对。

## 6. 实际执行的验证

### v190 修改与发布验证

- 修改文件 `node --check`：通过。
- `test-story-ad-visual-assets-sync-v21`：通过。
- `test-new-story-ad-visual-asset-failure-recovery`：通过。
- `test-new-story-ad-spatial-generation-order`：通过，图片并发峰值为 1。
- `test-story-ad-workspace-v6-ui-regressions`：通过。
- workspace boundary：通过，核心 JS `337293` bytes，未超 330 KiB 预算；新增弹窗模块按需加载。
- `npm run story-ad:release:test`：通过。
- 重复构建：制品哈希稳定。
- 未执行全平台、v2、v3、v6 完整回归：这是家庭电脑范围规则，不是遗漏。

### 交接只读生产验证

- PM2 `vido`：`online`，restart `0`，Node `v20.20.2`，cwd/script 指向当前 artifact release。
- 内网 `http://127.0.0.1:4600/api/health`：HTTP 200 / `status=ok`。
- 公网 `https://vido.smsend.cn/api/health`：HTTP 200 / `status=ok`。
- SQLite `PRAGMA quick_check`：`ok`。
- 本地与生产 649 个 manifest 文件：双方均 `0 missing / 0 mismatch`。
- 任务等待到终态；最终活动任务 `0`，模型调用固定在 `197` 后再生成本文档。
- 交接核对本身没有触发模型、媒体或付费调用。

## 7. 未执行项、剩余风险与费用边界

- 未执行 GitHub 镜像核对：当前网络无法连接 GitHub；公司网络恢复后再 `git ls-remote github`。
- 未运行家庭电脑禁止的全平台回归；已完成本功能模块定向门禁。
- 未再次点击“继续缺失图片”“再次生成”或任何付费入口。
- 最新人物配饰 500 没有可用 provider request/task ID，无法自动核账；在供应商提供可查询 ID、确认未计费或幂等重放合同前，不得盲目重投该单元。
- 供应商通道当前可以重新被识别，但未来仍可能再次超时/5XX；“可识别”不等于供应商稳定。
- Active Plan 输入指纹不一致与 `space_count=0` 尚未闭环，属于明天继续调查的首要阻塞。
- 5个历史未跟踪文档属于既有工作区内容，未清理、未覆盖、未提交。

## 8. 公司电脑续接命令

先确认公司电脑没有未提交工作：

```powershell
cd D:\VIDO
git status --short
git fetch --all --prune
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
npm install
node src/server.js
```

本地服务：`http://localhost:3007`

生产只读连接：

```powershell
ssh -o BatchMode=yes vido-prod
```

如果公司电脑 SSH 公钥尚未授权，按 `docs/handoffs/HANDOFF_PROTOCOL.md` 生成独立 ed25519 密钥并由已授权电脑添加公钥；禁止通过 Git 复制私钥。

## 9. 明天继续的明确顺序

1. 拉取后核对 `git status`、分支、HEAD 与 origin ahead/behind。
2. 只读核对生产活动任务仍为 0、目标模型调用仍为 197；如果数值变化，先查明是否有人继续操作。
3. 复现并追踪 `active_plan_input_fingerprint_mismatch` 的完整数据流：当前任务输入指纹 → Active Plan 发布指纹 → generation preflight 指纹，不要只改末端提示。
4. 同时核对 `SCENE_SPACE_MISSING / space_count=0` 最早产生位置，以及为什么最新进度只投影 12 个场景。
5. 核对最新人物 checkpoint，确认4张分类图和2张完整主图均复用；将失败配饰保持为未知计费冻结状态。
6. 仅运行涉及 Active Plan、场景空间、人像 checkpoint 和失败恢复的定向测试；验证通过并完成生产只读核对前，不让用户继续付费生成。
7. 合同恢复后，场景先使用“再次验证”路径，禁止对12个已有场景付费重生成；人物只处理明确缺失且非未知计费的单元。

## 10. 拉取后的快速验收标准

- origin/Gitee 与本地 HEAD 一致，工作树没有意外改动。
- 生产 build 仍为 `20260811-ui-v190`，三份 manifest SHA 与本文一致。
- PM2、内外网健康、SQLite 均正常。
- 活动任务为 0；没有未经用户操作产生的新模型调用。
- 不把已成功的人物/场景图片重新提交，不对 `submitted_unknown` 单元自动重复付费。

## 11. 2026-08-12 公司电脑追加修复（v192，尚未部署生产）

### 本轮根因与修改
- 用户端失败横幅不再显示支持编号、供应商原始错误、模型名和内部错误码；360确认弹窗删除计费配置、零调用计数和3DoF/6DoF内部边界说明。
- Brief 的持久内容上限为5000字，但项目包刷新投影曾二次截为3000字，导致重新进入后内容在句中断裂；现已统一为5000字。AI帮写正文不再重复拼入“原始创作需求”，原输入仍由 `original_brief` 独立保留。
- 依据《国内GPT Image 2内容审核规则及规避指南》，Image 2 请求改为最小必要字段 `prompt/n/output_format/size`；编辑请求仅追加 `images/input_fidelity`，参考图最多6张，不再固定发送 `stream/partial_images/background/quality`。
- Image 2 提交前增加明确成年人、非血腥、原创通用视觉、无名人肖像/IP/Logo/水印/验证码的正向审核约束，并改写高风险的模糊年龄与血腥视觉词。
- 供应商 500 没有公开错误定义或可查询 request/task ID，因此不能只凭 500 断言为内容审核；“参数不符合”是供应商反馈支持的高概率根因，本次已按指南收紧。

### Git 与发布状态
- 功能提交：`a449c30`。
- 发布门禁测试修正与最终 HEAD：`ce4455e`。
- 分支：`codex/story-ad-v3-upgrade`；本地与 origin ahead/behind：`0/0`。
- 本地不可变制品：`20260812-ui-v192`；artifact `7394726a904048d60065f2c7cda590ce311b8d6ee6667c7657362350c8fe7da8`；bundle `10a16f7b4471e54e91c53f3e0eaabc1ab74159c1519ea909b79145563793d100`。
- 标准生产发布前门禁已完整通过，但公司电脑缺少 `C:\Users\User\.ssh\id_ed25519`，发布器在连接生产前停止；生产没有发生上传、切换或业务写入。
- 公网生产仍为 `20260811-ui-v190`，artifact `d51781d19f1912a95758405d2a50465d4adf8dbb0e2bfcee66952be9f8de359e`，健康接口 HTTP 200。因此当前本地/Git一致，生产明确落后，不能声明三方一致。

### 实际验证
- 新增 v191/v192 目标契约：失败技术信息隐藏、360文案精简、Brief刷新上限5000、Image 2生成请求仅4个基础字段、参考图上限6、国内审核改写，全部通过。
- Brief authority、详细线稿批次、工作台 UI、场景修复、场景卡、发布完整性均通过。
- 标准不可变发布器的完整本地门禁通过；未执行生产 PM2、内网健康、SQLite quick_check、活动任务命令行核对，原因是 SSH 私钥缺失。
- 未执行真实 Image 2 生成：避免对未知计费单元重复付费。修复尚未上线，用户暂不可在生产重试。

## 12. 2026-08-12 公司电脑最终更新（v196，已部署生产）

### SSH 缺失提示的真实根因
- 本机并非缺少生产私钥；实际私钥为 `C:\Users\User\.ssh\id_ed25519_vido_prod`，旧统一认证代码只检查 `id_ed25519`，因此误报缺失。
- 生产 SSH 实际端口为 `2222`。22 端口会在密钥认证前主动关闭；同一把生产专用密钥在 2222 上认证成功。
- 不可变发布器内部还显式写死 `port: 22`，覆盖了统一认证模块的默认值。该覆盖已移除，并新增回归测试锁定 2222 与环境变量覆盖能力。

### 新 GPT Image 2 供应商
- 新增供应商标识 `smscrw`，API 基址 `https://ai.smscrw.cn/v1`，模型 `gpt-image-2`。API Key 仅保存在本地与生产受保护设置中，未写入 Git、日志或本交接文件。
- 用户提供的 chat completions 示例不适用于图片模型，真实探针返回“不支持该操作”。正确路由为：文生图 `/images/generations`，参考图编辑 `/images/edits`。
- 真实协议进一步确认：请求体必须带 `model: gpt-image-2`；该供应商不支持 `input_fidelity`，因此按供应商能力删除该字段；参考图最多 6 张。
- 18 个剧情广告图片阶段均设置为：第一候选 `smscrw/gpt-image-2`，第二候选 `deyunai/gpt-image-2`。生产只读候选解析已确认顺序正确。

### 最终 Git 与生产身份
- 功能/供应商提交：`b395a98`。
- SSH 端口与发布器修复提交：`0ee3034`、`2791071`。
- 交接文档提交前代码 HEAD：`2791071be1ae219ca3d6216cf124b069b6653c47`；本地与 origin ahead/behind 为 `0/0`。
- 最终 build：`20260812-ui-v196`。
- artifact：`d149807ce9f92acbdf0ce9f3ec71139895b2b79fba410d8cc0d4207603c7dbfc`。
- runtime hash：`0c882a22da41c7413a2e1eddf06077a9e4d90c758c4d8c4bf40756e99e888d14`。
- release bundle：`4fdedbd9660429981471d5b4df6de550067521fe9867989474433b75ee4eb6ca`。
- 本地与生产 build、runtime hash、release bundle 完全一致；发布器逐项校验 650 个文件，`0 mismatch`。

### 实际验证与剩余风险
- 文生图真实探针：HTTP 200，约 25 秒，返回 1 张 PNG base64。
- 参考图编辑真实探针：修正字段后 HTTP 200，约 29 秒，返回 1 张 PNG base64。
- 发布器完整门禁通过；生产 PM2 `vido` online、restart 0，内外网 health 均为 `ok`，SQLite `quick_check=ok`。
- 发布前后活动任务均为 0；历史 unknown billing 为 59，但 active unknown billing 为 0，本轮未续用任何旧失败单元。
- 未执行整批业务项目生成，避免额外付费和覆盖现有资产；仅执行上述两次单图协议探针。
- 用户在对话中直接粘贴过 API Key，应视为已暴露并尽快在供应商后台轮换；轮换后必须同步更新本地和生产受保护设置。
