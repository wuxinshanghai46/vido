# VIDO 生产资产与全景能力交接（2026-08-24）

## 1. 当日目标与用户决策

- 目标任务：`d3fb261b-d930-4aae-9434-f65a3535b513`（佛山智造 · 不锈钢品牌广告）。
- 用户授权本轮生产验证费用上限提高到 12.38 元，要求人物、服装配饰、动作表情、场景、多机位、360 全景和统一制作图谱真实进入生成链路，不能只显示文本。
- 用户要求修改后旧路径不再影响新链路，并在生产实跑后核对本地、Git、生产三方一致。
- 结论：人物和普通场景资产已真实生成并保存；真 360 全景及其下游统一图谱尚未完成，原因是当前模型调用管理没有任何模型满足完整全景能力合同。不得把普通宽图裁切或拉伸后冒充完成。

## 2. 修改前后的数据流

修改前：用户确认统一生成 → 人物/场景并行生成 → 每次读取场景合同时重写验证时间 → 全景费用计划指纹瞬时变化 → 修复指纹后仍把全景强制路由到 `gpt-image-2` → 供应商返回 1536×1024 普通图 → 本地 2:1 硬门禁拒绝 → 任务失败。

修改后：用户确认统一生成 → 权威人物输入与已完成图片断点复用 → 人物/场景原子提交 → 场景合同只读归一化保持原验证回执 → 全景计划按语义稳定指纹 → 模型调用管理检查完整全景能力 → 没有合格模型时以 0 个付费调用 fail-closed；只有显式配置并验证合格模型后才允许提交 → 真实 2:1、接缝和视觉 QA 均通过后才发布全景并继续分镜/关键帧合同。

## 3. 已完成的生产资产

- 人物 2/2：林岚、陈先生。
- 每个人物：20 个原子资产、4 个身体视图、4 个身份视图、6 个表情、6 个基础动作，`quality_status=native_masters_ready`。
- 场景 3/3：高档社区大堂、私人会所休息区、材料展厅；每个场景保存 5 个机位图。
- 人物与场景代表图片已通过公网 HEAD 核对，均为 HTTP 200。
- 生产任务当前保持 `failed / production_assets_failed`，错误为全景部分未完成；已完成资产未删除、未覆盖。

## 4. 全景失败证据与费用边界

- 全景场景 1、2：供应商 `smscrw/gpt-image-2` 返回 1536×1024（3:2），模型调用记录为 success/confirmed，但候选被 `PANORAMA_PROVIDER_ASPECT_RATIO_INVALID` 拒绝，没有发布为权威全景。
- 全景场景 3：供应商 HTTP 400，`submission_rejected / not_billed`。
- 实际供应商扣费金额接口未返回，不能把计划金额伪装为实际金额；本轮只确认两次调用的计费状态为 confirmed，一次为 not_billed。
- V201ae 已把 3 个场景的最新计划变为 `model_capability_required`，`paid_call_count=0`；不要在未接入合格模型前继续点击重试。
- 历史隔离 unknown billing 共 68 条，活动 unknown billing 为 0；本轮未改写历史审计记录。

## 5. 代码与提交记录

- 分支：`codex/story-ad-systemic-remediation`
- 当前提交：`120734a7d1a1737afec8119954e7ba4f29b1f0e8`
- 关键提交：
  - `61fc5db0`：稳定全景费用计划权威指纹。
  - `af9a8726`：不支持全景能力的模型零付费阻断。
  - `120734a7`：构建 V201ae 不可变发布。
- 主要文件：
  - `src/services/newStoryAd/sceneSpaceContractService.js`
  - `src/services/newStoryAd/scenePanoramaService.js`
  - `src/services/pipelineModelService.js`
  - `src/services/newStoryAd/subjectAssetBundleService.js`
  - `scripts/test-new-story-ad-panorama.js`
  - `scripts/test-pipeline-capability-audit.js`

## 6. 本地、Git、生产三方一致性

| 位置 | 核对结果 |
|---|---|
| 家庭电脑本地 | HEAD `120734a7`；本轮运行代码均已提交，保留若干与本任务无关的历史未跟踪文档 |
| Gitee origin/gitee | `120734a7`，与本地 ahead/behind `0/0` |
| GitHub 镜像 | `120734a7`，已同步 |
| 生产运行 | V201ae；目录 `/opt/vido/releases/8a5d87317119c9c7fbcdc220ca5077598d7e64bd4aa76bab91d0f1db74af5b3c`；发布包 `fb2a4502...` |
| 运行状态 | PM2 `vido` online；公网健康 `ok`；数据库 `ok`；SQLite quick check `ok`；活动任务 0 |

生产采用不可变制品，生产运行身份以发布清单逐文件 SHA-256 和 artifact 为准，不以生产仓库 detached HEAD 判断。

## 7. 实际执行的验证

- 语法检查：`pipelineModelService.js`、`scenePanoramaService.js`、`sceneSpaceContractService.js`、全景回归脚本均通过。
- `scripts/test-new-story-ad-panorama.js`：通过；覆盖 2048×1024 真全景、3:2 假全景拒绝、接缝、投影、并发、断点和计费恢复。
- `scripts/test-pipeline-capability-audit.js`：通过，91/109 阶段被业务静态引用；全景阶段无合格模型时 fail-closed。
- `scripts/test-story-ad-production-graph-v201.js`：48 项通过，模型/媒体调用 0。
- `scripts/test-new-story-ad-contract-freshness.js`：通过。
- 发布门禁：systemic、workspace_ui、release_core 全部通过；836 个发布文件哈希通过。
- 生产核对：V201ae、公网/内网健康、数据库、SQLite、PM2 和活动任务均正常。
- 生产资产：2 个人物完整档案、3 个五机位场景；3 个代表资源公网 HTTP 200。
- 未执行：家庭电脑规则禁止的 `platform:upgrade:test`、跨版本 `story-ad:v2/v3/v6` 全平台完整回归。

## 8. 明天公司电脑继续顺序

1. 拉取本分支，先不要对目标任务重试全景：

   ```powershell
   git fetch --all --prune
   git status --short
   git switch codex/story-ad-systemic-remediation
   git pull --ff-only origin codex/story-ad-systemic-remediation
   npm install
   node src/server.js
   ```

2. 在“模型调用管理 → 场景360全景”接入或开发一个真实全景模型/服务。模型必须显式提供并实测以下能力：`image_generation`、`reference_preserving`、`panorama_outpaint`、`equirectangular_2to1`、`wraparound_consistency`、`source_view_preserving`。
3. 用一张不计入目标任务的测试场景做单次能力探针：输出必须真实 2:1，左右边界连续，并通过本地投影与视觉 QA；不要仅因模型支持 21:9 或普通宽图就标记合格。
4. 在模型调用管理登记经验证的供应商/模型、单价和能力；重新读取批量计划，确认 3 个场景不再是 `model_capability_required`，且计划总额不超过用户剩余授权边界后再显式续跑。
5. 全景 3/3 发布后继续统一制作图谱，优先核对当前图谱剩余绑定问题：人物生成资产 ID 与剧情角色 `character_1/character_2` 的绑定、场景 master 视图投影、正式 blueprint/shots。只有图谱 `validation.status=ready` 才进入关键帧与视频。
6. 完成后重新验证人物、场景、全景、分镜、对白/声音、口型同步配置均来自同一制作图谱，再做生产只读验收和费用审计。

## 9. 当前限制与不可声称事项

- 当前不能声称“全部制作资产已完成”或“可以测试完整生成”：真 360 全景、正式分镜/镜头合同和下游视频尚未完成。
- 当前可以查看和核对已经保存的人物、动作表情、服装配饰档案与三个五机位场景；不要触发全景重试。
- 不能将供应商返回的 1536×1024 图片裁切、拉伸或填充成 2:1 后标记为全景。
- 声音、对白和口型同步链路本次没有实际生成视频验证，不能用模型配置存在替代成片证据。
