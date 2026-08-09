# VIDO 剧情广告平台 v126 公司续接交接

> 生成时间：2026-08-10（Asia/Shanghai）
> 交接范围：2026-08-07 至 2026-08-10
> 生产权威：`43.98.167.151` / `/opt/vido/current` / PM2 `vido`

## 1. 当日目标与用户决策

- 所有修复必须是平台级、全题材通用修复，禁止针对“星月神话”或单一任务写关键词、行业模板和场景数量特例。
- 旧代码、旧 Active Plan、旧 checkpoint、旧 bundle 和旧浏览器客户端不能混入新链路。
- 所有新增模型调用阶段必须进入模型调用管理；未登记阶段在供应商调用前失败关闭。
- 商业广告与纯剧情保持独立合同：纯剧情显式空道具合法；独立商品、视觉锁或显式产品资产要求下空道具不合法；服务、应用、材质类允许空道具，但商业主体不可缺失。
- 后续严格控制修改范围，只处理用户确认的问题，不自行扩展功能。
- 用户只负责最终业务验收；工程验证、迁移、发布和费用门禁必须先由项目侧完成。

## 2. 修改前后的完整数据流

修改前：

```text
输入
→ 模型同时生成故事与生产拓扑
→ 自然语言逐字比较、硬场景数量校验
→ 整包缺失区段恢复
→ 部分成功结果可能丢失
→ 弱身份旧 checkpoint 可能被续用
→ 旧计划可能错误开放图片付费入口
→ 可变 live 目录发布，存在新代码未实际运行风险
```

修改后：

```text
输入 + 内容模式
→ Story Facts Candidate
→ 语义归一化
→ 确定性 Topology Compiler
→ cast / prop / story_seed / scene_plan 四区段合同校验
→ 合格区段按 generation / content revision / bundle / fingerprint 原子保存
→ 一次只请求一个 required_missing_section
→ 每次成功后重新计算剩余区段
→ 完整 Candidate 原子发布为 Active Plan
→ Generation Permit 再验证 Active Plan 与 ReleaseBundleIdentity
→ 才允许进入付费图片、全景或视频生成
```

影视资产链：

```text
Story Beat
→ 确定性 1:N Shot Coverage
→ 摄影设计（景别、机位、轴线、视线、运镜）
→ Scene Core（master / atlas）
→ Active 基础场景
→ layout / reverse / interaction / detail / panorama 增强层
```

增强失败只保留待续 checkpoint，不得使已发布基础场景失效。

发布链：

```text
冻结源码
→ 一次构建不可变 artifact
→ 完整依赖闭包与逐文件哈希
→ 候选 release 目录
→ 迁移 dry-run / apply
→ /opt/vido/current 原子切换
→ PM2 使用固定 Node 20.20.2
→ API / UI / task / checkpoint / bundle 六方身份核对
```

旧客户端写请求返回 426；旧 bundle、旧 lease、旧缓存、旧 checkpoint 和旧 Active Plan 均不能静默进入当前链路。

## 3. 代码和文件变更清单

代码快照提交共 167 个文件，新增 14,739 行、删除 1,045 行；完整清单使用：

```powershell
git show --stat --oneline 5837a83076396d0d5d8fdfc95b95ce0e92d35687
git show --name-status --format= 5837a83076396d0d5d8fdfc95b95ce0e92d35687
```

核心分类：

- `src/services/newStoryAd/`：Story Facts、确定性拓扑、Active Plan、精确区段恢复、checkpoint lineage、生成许可、场景 Core/增强层、Beat→Shot 1:N 覆盖。
- `src/services/pipelineModelService.js` 与 `modelGateway.js`：新增模型阶段登记、候选策略与诊断保真。
- `public/story-ad/`：旧计划 UI 阻断、恢复状态、场景/人物资料与工作流展示。
- `scripts/`：不可变构建/部署、迁移、模型管理审计、平台/并发/恢复/商业隔离回归。
- `config/story-ad-release.json`、`config/story-ad-runtime-manifest.json`、`public/story-ad/release-manifest.json`：v126 发布身份和完整闭包。
- `src/services/seeds/`：通用场景扩展、镜头叙事、轴线/视线和 Core/增强解耦知识；无行业或单任务写死。
- `docs/research/2026-07-29-pipeline-capability-audit.md`：8 月 9 日生成的模型能力审计证据。

以下内容明确未纳入 Git：`.env`、SSH 密钥、Token、`outputs/`、数据库、媒体、缓存、`node_modules/`、临时目录、备份和五个本轮以前遗留的未跟踪旧文档。

## 4. 提交、分支与公司电脑拉取

- 目标分支：`codex/story-ad-v3-upgrade`
- 周五起点提交：`b15e44830528f3ceb7a9cace2d67e61ae0302f54`
- v72–v126 原子代码快照：`5837a83076396d0d5d8fdfc95b95ce0e92d35687`
- 主远端：`origin`（Gitee）；`gitee` 与 `origin` 指向同一仓库。
- GitHub 为同步镜像，不作为生产运行代码权威。
- 交接时 `origin` 与 `gitee` 已核对到相同最新提交，ahead/behind 均为 `0/0`。
- GitHub HTTPS 443 连续连接失败；SSH 443 的 Ed25519 主机指纹已与 GitHub 官方公布值核对一致，但本机没有获 GitHub 授权的 SSH 公钥，认证被拒绝。最后成功获取的镜像引用停在 `c6b9d00dc227fb549dddddcd8369a7cddf3c74b3`，因此 GitHub 镜像与主 Git **不一致**。明日必须从 `origin` 拉取，不能从 GitHub 镜像拉取本次交接。

公司电脑执行：

```powershell
cd <VIDO目录>
git status --short
git fetch --all --prune
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
npm install
npm run platform:upgrade:test
node src/server.js
```

禁止执行 `git reset --hard`；如果公司电脑存在未提交修改，先保存或提交后再 pull。

## 5. 本地、Git、生产三方一致性

| 核对项 | 本地 | 主 Git（origin/Gitee） | 生产 | 结论 |
|---|---|---|---|---|
| 分支/代码快照 | `codex/story-ad-v3-upgrade` / `5837a830` | 代码快照已推送 | 以不可变 artifact 为准 | 一致 |
| Build | `20260810-platform-release-migration-v126` | v126 清单已提交 | v126 | 一致 |
| Artifact | `60583f3d464ad6b92d71a8b9b5aa87a5ec5d9eeceb9b8478adae65b0229a140e` | v126 清单已提交 | 同值 | 一致 |
| Bundle | `be5cc25c1af4a3a384daf84582e51a89434872ae2fb8f0edc507afeb24b7e445` | v126 清单已提交 | 同值 | 一致 |
| Runtime hash | `8ab5ffc375abdca2100c0c27df89734389dce518af10f0b7a9c62db0e63da848` | v126 清单已提交 | 同值 | 一致 |
| Source snapshot | `d856041a35db278c0652ec329993a28f01ad6f5cedf28b4285bb53158fc1e899` | v126 清单已提交 | 同值 | 一致 |
| Runtime 文件 | manifest 640 项 | 清单和源码已提交 | 640 项逐文件 mismatch 0 | 一致 |
| Public 文件 | manifest 45 项 | 清单和源码已提交 | mismatch 0 / extra 0 | 一致 |
| Release 闭包 | 641 项 | 闭包源码已提交 | missing 0；摘要一致 | 一致 |

生产 release 目录额外存在 `docs/logs/README.md`。该文件 SHA 与本地同文件一致，由 `dailyLearnService` 启动初始化生成，不是旧代码或混合上传；但“运行时向不可变 release 目录写文件”仍是后续需要处理的架构薄弱点。

## 6. 实际执行的验证

- v126 部署器完整门禁：656 秒，通过。
- `platform:upgrade:test`：520.8 秒，通过。
- 交接前重跑 `story-ad:release:test`：integrity 11 项、transport 7 项、atomicity、closure 641 文件全部通过。
- 交接前重跑 `story-ad:v111:test`：通过。
- 40 类题材、10,000 固定种子、400 组语义变形、50 并发任务：通过，重复 permit 0、付费调用 0。
- v120→v126 迁移定向回归：34/34，通过；partial 未错误晋升 Active、商业 Active 保留、旧 plan ID 轮换、回滚与幂等通过。
- 精确区段恢复：商业边界 7 项、20 并发只执行 1 次、成功区段哈希不变、旧 bundle 不复用、付费调用 0。
- 模型管理审计：101 阶段，未分类 0。
- 真实文本合同：生产默认路由 42/42 有效且首候选通过；v126 未重复付费调用，使用此前有效回放。
- 暂存内容凭证扫描：167 文件，疑似凭证文件 0、匹配 0；`git diff --check` 通过。
- 生产 `/opt/vido/current` 指向 v126；PM2 仅 `vido`，PID 11287，固定 Node v20.20.2，restart/unstable 0。
- 内外网 health、版本接口、SQLite quick check 均通过；release control active/allowed，epoch 11。
- 活动生成任务 0、未知计费 0、v126 部署后模型调用 0。

## 7. 目标任务状态、费用与数据边界

目标任务 `3f14e285-67d7-4656-9bec-6bff7af7ec84`（星月神话故事）：

- producer bundle、content revision、fingerprint、content mode 与 v126 兼容，compatibility issues 为 0。
- 已验证并迁移：`story_seed`、`scene_plan`。
- 当前缺失：`cast_profiles`、`prop_plan`。
- 未迁移旧 Active Plan；恢复只能显式触发并按缺失区段执行。

旧任务 `901b2297-1bd9-41ec-a83b-179212f5b3f5` 保持 legacy read-only，不能进入新付费链路。

未执行项：

- 用户尚未完成 v126 页面业务验收。
- 未执行真实图片、360、视频或 6DoF 端到端付费验收。
- v126 未重新调用 42 次真实模型，使用此前合格回放；不得误写为“v126 新调用 42 次”。

剩余风险：

- 恢复目标任务会产生文本模型调用，必须由用户显式操作并监控调用计数。
- 外部 deYun 模型当前存在无响应体 HTTP 400，生产默认禁用；其他供应商仍可能超时或返回无效结构，但平台会失败关闭。
- 当前只有结构化 3D 导演预演和渐进全景合同，未取得真实 6DoF 供应商已配置证据。
- `dailyLearnService` 会在不可变 release 目录生成 `docs/logs/README.md`，需要后续迁移到持久数据目录。

## 8. 明日继续顺序

1. 先执行 `git status --short`，确认公司电脑没有未提交内容，再按第 4 节命令拉取。
2. 核对 `git log -2 --oneline`，确认包含 v126 代码快照和本交接文档。
3. 启动本地 3007，验证 `/api/health` 和剧情广告页面。
4. 只读核对生产 v126 的 build、bundle、runtime、PM2、SQLite、活动任务和未知计费。
5. 用户显式恢复目标任务时，确认不重跑主规划，只请求 `cast_profiles`、`prop_plan`；每段成功后 checkpoint 立即更新，失败即停止。
6. 完整 Active Plan 形成后，再验一个全新纯剧情任务和一个商业边界任务。
7. 最后做低成本 Scene Core 验收；图片、360、视频和真实 6DoF 必须另行确认费用授权。

## 9. SSH 续接提醒

公司电脑需要使用自己的 SSH 私钥；不得从 Git、交接文档或其他电脑复制私钥。若尚未授权，先生成独立公钥并由已授权电脑追加到服务器。

```powershell
ssh -o BatchMode=yes vido-prod
```

交接文档和代码中不包含服务器密码、API Key、Token 或 SSH 私钥。
