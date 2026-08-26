# 2026-08-27 剧情广告场景生成与公司电脑续接交接

> 生成时间：2026-08-27（Asia/Shanghai）  
> 续接分支：`codex/story-ad-systemic-remediation`  
> 目标任务：`b83fa67c-244a-4869-b3cc-df282fad5c59`（佛山智造 · 不锈钢品牌广告）

## 1. 当日目标与用户最终决策

1. 人物和场景提示词均不再要求显式“保存/确认”；编辑后自动保存，主操作直接生成。
2. 人物已有图或正在生成时默认显示人物图；场景已有图或开始生成后默认显示场景图，提示词通过标签手动查看和编辑。
3. 场景必须支持“一次生成全部缺失场景”；一个场景运行不能锁住其他场景，同一场景重复提交必须保持幂等。
4. 六个制作阶段不能因强制刷新、轻量投影或缓存覆盖而消失。
5. 新合同启用后，旧提示词确认入口只能返回不可重试 410；不得调用模型、写入数据、产生费用或参与发布判定。
6. 人物与场景图片均使用同一集中模型路由顺序：SMSCRW → 微众 MaaS → 漫路 DeyunAI 的 GPT Image 2 路线；不得回落到旧正常链路。
7. 本轮最后必须核对本地、Git、生产三方并生成公司电脑可继续使用的交接文件。

本节是最新权威合同，取代 2026-08-26 早些时候“逐场景显式确认提示词”的旧决定。

## 2. 修改前后的完整数据流

### 修改前

`场景提示词 + 执行快照/发布身份混成一个内容版本 → 点击生成后提示词自我过期 → 项目级全局锁阻止第二个场景 → 刷新后旧轻量响应或版本漂移把已有场景卡隐藏 → 用户只能看到重新生成面板`

发布迁移还存在第二个结构性缺陷：

`Active Plan 更新到新 bundle → task.required_bundle_id 仍停留在旧 bundle → 分区恢复与前端读取到两个版本身份 → 已持久化的 2 个场景被判为不可用`

### 修改后

`提示词编辑 → 700 ms 防抖自动保存/失焦冲刷 → 服务端生成新的业务提示词版本 → 批量按钮一次确认费用 → 按 scene ID 并行排队全部缺失场景 → 每个场景独立幂等锁 → 成功结果基于最新持久化列表合并 → 已有/生成中图片默认显示`

发布迁移现在为：

`兼容性与计费审计 → 同一 SQLite 原子事务内更新候选方案、Active Plan、执行权威、迁移凭据和 task.required_bundle_id → 任一写入失败整体回滚 → 受保护生成只在版本完全一致后签发许可`

旧入口：

`旧确认请求 → 410 不可重试拒绝壳 → 模型调用 0 / 媒体调用 0 / 业务写入 0`

## 3. 代码与功能变更

- `public/story-ad/views/sceneWorldPage.js`
  - 已持久化场景在临时 release eligibility 漂移时仍显示，不再被“重新生成场景提示词”面板替换。
  - 场景已有或生成中图片默认显示；提示词可手动切换。
- 场景提示词、卡片与任务前端模块
  - 编辑自动保存；删除正常流程中的确认按钮和旧确认字段。
  - 增加“生成全部缺失场景”，逐场景状态与锁隔离。
- `src/services/newStoryAd/generationPermitService.js`
  - 受保护生成在许可签发前执行零模型兼容迁移并重新核验。
- `src/services/newStoryAd/assetPlanPublicationService.js`
  - scene-plan 自有 generation 可完成自己的 authority promotion；无关活动 generation 和未知计费仍阻塞。
  - 兼容迁移把 `task.required_bundle_id` 纳入同一原子事务，消除任务与 Active Plan 版本分裂。
- 场景资产持久化
  - 并发完成按最新持久化列表合并，避免不同场景互相覆盖。
- 导航与项目存储
  - 六阶段常驻；请求序列、任务身份、内容修订与分区缓存失效共同防止旧响应覆盖新状态。
- 旧合同
  - 提示词确认路由仅保留 410 拒绝测试；旧字段、旧按钮和旧正常测试夹具均不再参与执行。

## 4. 本轮提交记录

- `aef8e33a` `fix(story-ad): preserve scenes across release migration`
- `0236ddce` `build(story-ad): generate immutable v233c release`
- `6ece3fb2` `fix(story-ad): migrate task release atomically`
- `1bcda0f4` `build(story-ad): reserve immutable v233d release`
- `e8cdd0c3` `build(story-ad): generate immutable v233d release`

本交接文件会在上述提交之后单独提交并推送。生产运行清单的源码身份为 `1bcda0f405363147a9edf40d717e332bd9006b5e`；`e8cdd0c3` 是由该干净源码生成的清单提交，后续交接提交只包含文档。

## 5. 目标任务最终状态

- task：`done / scene_config_done`
- Active Plan：`3db1d718-56ed-4ddd-8dac-6172432f68dd`，active revision `6`
- task required bundle 与 Active Plan bundle：均为 `20f05a4a663f835cfefd97dc52c69b49a85cfacecc4c6f6dc2ebdf0c5407d80f`
- 场景：2 个
  - `space_01_showroom`，现代高端家居展示厅，权威提示词长度 746
  - `space_02_exhibition`，高端商业展台，权威提示词长度 693
- 场景图片：0；页面显示“0/2 已生成”和“生成全部缺失场景（2）”
- 人物资产：1，未被本轮迁移或状态修复覆盖
- 模型调用：59 → 59，迁移与状态修复增量 0
- 活动 generation：0
- 最近失败 scene-plan unit 继续保留审计：供应商未提交、计费未提交、无 provider task ID

## 6. 本地、Git、生产三方一致性

| 位置 | 权威状态 | 结论 |
|---|---|---|
| 家庭电脑本地 | 分支 `codex/story-ad-systemic-remediation`；交接前代码/制品 HEAD `e8cdd0c3`；本轮相关 tracked 文件已提交 | 与目标 Git 代码一致；5 个用户原有未跟踪文档未纳入提交 |
| Gitee `origin` / `gitee` | 交接前均为 `e8cdd0c3`，ahead/behind 均 `0/0` | 与本地已提交代码和制品一致 |
| 生产 | build `20260827-production-v233d`；artifact `8638d708447533fc535cea749fb1d8808a05676f09aa1fa7b67ac5e042957369` | 857 个运行文件按不可变清单校验通过 |

三项关键清单 SHA-256 本地与生产完全相同：

- `config/story-ad-runtime-manifest.json`：`b2195bac6fb86e51e8b4595512295750455d1d3dfc64ed442e48da37c256d73f`
- `config/story-ad-release.json`：`bd5ac20203ab6ae60c731091e20f8397979c4cc158172e11ce9ad5d87855c46f`
- `public/story-ad/release-manifest.json`：`e8d0a955a2cf33262a6f2a9ef8347e6cbbf34d3980a81ff47eff935bce547f2f`

生产详情：

- release 目录：`/opt/vido/releases/8638d708447533fc535cea749fb1d8808a05676f09aa1fa7b67ac5e042957369`
- release bundle：`20f05a4a663f835cfefd97dc52c69b49a85cfacecc4c6f6dc2ebdf0c5407d80f`
- runtime hash：`ee346091c44f9e25c8f6c24b75b127252ded44902ce7fccd49286c7ec0e6baac`
- PM2 `vido`：online，PID `4089`，restart `0`
- 内网健康：ok；公网健康：HTTP 200
- SQLite：`quick_check=ok`
- 活动任务：0；活动未知计费：0
- 历史隔离未知计费：62，发布前后未增加，不参与自动重试
- 目标迁移前备份：`/opt/vido/backups/v233d-target-release-migration-20260827-003021.sqlite`

## 7. 实际执行的验证

### 根因与定向回归

- JS 语法检查、`git diff --check`：通过。
- Active Plan release 迁移：2 个生产形状夹具、5 个不兼容用例、自有 scene generation、无关 generation 阻断、懒许可迁移、CLI dry/apply 全通过；迁移模型调用 0。
- 自动保存：输入法合成、700 ms 防抖、导航竞态保护通过。
- 初始场景计划：仅补 `scene_plan/story_seed`，人物保持；无关 generation 继续阻塞。
- 旧确认入口：410；4 条过期直接操作在服务调用前阻断；模型、媒体、业务写入均 0。
- 生成单元：两个场景可并行，重复场景提交 0；自动付费重试仍禁用。
- 场景视觉 checkpoint：25 个成功单元保留，仅恢复 4 个失败单元，规划模型调用 0。
- 人物独立计划与相邻恢复回归：通过。
- 叙事发布边界：固定种子 10,000、变形对 400、并发任务 50、重复许可 0、真实付费调用 0。

### 不可变发布门禁

- 影响范围 profile：systemic。
- `systemic`、`asset_plan`、`workspace_ui`、`release_core` 四组门禁全部通过。
- 857 个文件远端哈希核对通过；复用 790、上传 67。
- 候选启动、原子切换、PM2、内外网健康、SQLite、活动任务与活动未知计费核对均通过。

### 生产页面只读验收

- 实际打开目标任务场景页，看到 2 个场景卡。
- 两个提示词均为可编辑 textbox，状态为“已自动保存”。
- 页面存在“生成全部缺失场景（2）”及两个“生成该场景”按钮。
- 页面没有重新生成提示词面板；浏览器控制台错误 0。
- 未点击任何生成按钮，因此没有触发图片模型调用或费用。

### 当前电脑测试范围

- 主机为 `LAPTOP-LDFOL0GT`，按既定规则执行本任务定向回归和发布器影响范围门禁。
- 未执行 `platform:upgrade:test`、`story-ad:v2:test`、`story-ad:v3:test`、`story-ad:v6:test` 等跨平台完整回归。

## 8. 公司电脑续接步骤

```powershell
cd D:\VIDO
git status --short
git fetch --all --prune
git switch codex/story-ad-systemic-remediation
git pull --ff-only origin codex/story-ad-systemic-remediation
git log -6 --oneline
node src/server.js
```

注意：

1. `git pull` 前必须先检查公司电脑的未提交改动；若有下午未提交内容，先提交到独立分支或妥善暂存，不能使用 `git reset --hard`。
2. `git pull --ff-only` 不会静默覆盖冲突文件；若公司改动与今晚更新重叠，Git 会停止，需要先保留并人工合并。
3. 拉取后应能看到 V233d 代码、制品和本交接文件；今晚已推送的内容不会因明天正常 fast-forward 拉取而丢失。
4. 本地服务地址：`http://localhost:3007`。

## 9. 未执行项、剩余风险与费用边界

- 未执行真实场景图片生成：这是刻意保留给用户的付费操作；因此当前只能确认排队、版本、并发、持久化和 UI 合同，不能声称外部图片供应商本次真实出图成功。
- 场景图片当前仍为 0；用户首次点击批量生成时会产生真实供应商调用和可能费用。
- 历史隔离未知计费 62 条保持不变，活动未知计费为 0；系统不得自动重试历史记录。
- GitHub 仅为非权威镜像；本轮权威远端为同源的 `origin` 与 `gitee`。公司续接以 `origin` 分支为准。
- 5 个用户原有未跟踪文档仍留在家庭电脑工作树，未提交、未删除、未发布。

## 10. 下一次优化入口

1. 公司电脑按第 8 节 fast-forward 拉取并确认分支。
2. 强制刷新目标任务场景页，确认仍显示 2 个场景卡、自动保存状态和批量生成按钮。
3. 若用户决定做真实生成，先记录模型调用数与场景资产数，再点击一次“生成全部缺失场景（2）”。
4. 观察两个 scene ID 是否独立排队、是否均默认切到图片视图；禁止重复点击同一场景。
5. 完成后核对两个供应商任务、费用状态、场景资产合并结果和模型调用增量；任何异常先保存生产证据再修改。
