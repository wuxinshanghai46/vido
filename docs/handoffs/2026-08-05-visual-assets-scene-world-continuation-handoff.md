# VIDO 2026-08-05 人物场景联合生成与场景世界续接交接

> 生成时间：2026-08-05 00:51（Asia/Shanghai）
> 目标分支：`codex/story-ad-v3-upgrade`
> Git 权威远端：`origin`（Gitee），GitHub 为同步镜像
> 生产主机：`43.98.167.151`，应用目录 `/opt/vido/app`
> 生产运行版本：`20260804-visual-assets-sync-v23 / reference-director-v3`

## 1. 当日目标与用户决策

本轮把“参考理解确认 → 人物和场景视觉资产 → 场景世界与生产清单”的动作顺序和并发链路闭环：

1. 页面所有下一步主动作统一放在上方，避免用户在长页面底部寻找入口。
2. 场景世界、世界观、360 和生产清单必须位于场景资产之后；只有真实场景视觉资产生成后才能开放，文字规划不能伪装为已完成场景。
3. 人物和场景恢复同步生成，但必须分别显示进度、分别保存阶段成果；任一分支失败不能删除另一分支已完成资产。
4. 人物模型错误必须区分连接中断、计费待核对、内容审核和质量失败，不能把所有失败都显示为“审核未通过”。
5. 所有逻辑保持行业无关，不按家具、走廊或其他具体业务关键词写死。
6. 用户明天在公司电脑拉取当前分支后继续体验和优化；拉取前必须保护公司电脑上的未提交内容。

本次交接只进行只读核对和文档提交，不修改生产业务数据、不部署新代码、不触发模型或媒体调用。

## 2. 修改前后的完整数据流

### 修改前

```text
参考理解确认
  → 浏览器分别提交人物生成与场景生成
  → 任务级单作业锁接受第一个请求、把第二个判定为重复
  → 前端仍把 accepted=false 的重复响应当成成功
  → 人物与场景各自覆盖同一份 generation_progress/context
  → 用户看到“已提交”，实际只有一个分支运行
  → 场景仍只有文字规划时，场景世界和生产清单已经提前出现
```

人物图片供应商在响应头前断开连接时，旧错误分类还会落入未知失败，页面容易误报为内容审核失败；对已提交但未确认计费的请求贸然重试还可能重复付费。

### 修改后

```text
用户确认“同时生成人物与场景”
  → POST /api/new-story-ad/tasks/:id/visual-assets
  → 一个 visual_assets 父作业取得任务锁
  → subjects 与 scenes 两条进度通道并行运行
      ├─ 人物档案按素材保存检查点
      └─ 多场景内部串行，避免场景并发失控
  → 所有图片调用进入共享 provider 并发池（默认并发 2）
  → 两个分支延迟写入共享 context
  → Promise.allSettled 汇总结果
  → 只合并各分支拥有的字段并一次保存权威 context
  → 一边失败时保留另一边及本分支已经成功的阶段结果
  → 只有存在真实场景视觉资产时才投影 SceneWorld、360 与生产清单
```

上游连接中断现在归类为 `TIMEOUT_OR_NETWORK`；已提交但计费未知的批次保持阻断，不自动重试。

## 3. 代码和文件变更清单

### 联合生成与状态合并

- `src/routes/newStoryAd.js`：新增 `visual-assets` 联合入口、人物/场景并行通道、部分成功保留和最终权威上下文合并。
- `src/services/newStoryAd/visualAssetProgressService.js`：父任务及 subjects/scenes 双通道进度。
- `src/services/newStoryAd/subjectAssetBundleService.js`、`personAssetLifecycleService.js`：支持延迟共享上下文提交。
- `src/services/newStoryAd/sceneAssetService.js`：支持延迟发布、既有场景累积和部分场景成功返回。
- `src/services/newStoryAd/mediaAdapter.js`：人物与场景图片调用统一进入共享供应商并发池。
- `src/services/newStoryAd/jobService.js`、`modelGateway.js`：联合阶段预算、部分结果状态和上游连接中断分类。

### 页面交互与场景世界门禁

- `public/story-ad/views/briefView.js`、`reference-understanding.css`：确认和下一步动作置顶，避免底部重复 CTA。
- `public/story-ad/views/assetCenterView.js`：顶部联合生成入口；场景世界移至场景资产之后。
- `public/story-ad/views/sceneWorldView.js`：没有真实场景视觉资产时显示锁定说明，不渲染世界观和生产操作。
- `public/story-ad/components/ui.js`：区分连接、计费、审核和质量失败，并显示联合通道进度。
- `public/story-ad/store/projectStore.js`：`accepted=false` 不再误报成功。

### 测试与发布

- `scripts/test-story-ad-visual-assets-sync-v21.js`：联合通道、场景门禁、错误分类、共享并发池和防重复提交回归。
- `scripts/test-story-ad-scene-world-v1.js`：增加文字规划不能开启场景世界的回归。
- `scripts/deploy-story-ad-release.js`：新增联合进度服务和回归脚本进入生产发布清单。
- `config/story-ad-release.json`、`public/story-ad/release-manifest.json`：版本更新为 v23，并统一静态资源缓存标识。

## 4. 提交记录、目标分支和公司电脑拉取命令

关键提交按时间顺序：

- `64f167d9`：参考理解可编辑及有参考时条件折叠。
- `e5b8c247`：场景全景权威、360/3DoF 边界及模型能力管理。
- `bc55f214`：确认参考理解后继续进入人物与场景方案。
- `91249e06`：人物与场景联合生成、场景世界门禁和人物错误语义修复。
- `d93e60c2`：记录 v23 生产发布与验证结果。

本交接文件提交后，以公司电脑执行 `git rev-parse HEAD` 的远端结果为准；精确交接提交号同时写在本次交付消息中。

公司电脑先检查工作树：

```powershell
cd E:\AI\VIDO
git status --short
```

确认不会覆盖需要保留的本地改动后执行：

```powershell
git fetch --all --prune
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
npm install
npm run platform:upgrade:test
node src/server.js
```

禁止使用 `git reset --hard`。如果公司电脑有未提交内容，先提交到自己的分支或安全备份，再执行 `pull --ff-only`。

## 5. 本地、Git、生产三方一致性

| 核对对象 | 权威标识 | 2026-08-05 00:45-00:51 实测结果 |
|---|---|---|
| 本地已提交代码 | `codex/story-ad-v3-upgrade`，核对前 HEAD `d93e60c2` | 与两个远端一致，运行代码无未提交修改 |
| origin/Gitee | `origin/codex/story-ad-v3-upgrade` | 与本地 HEAD 相同，ahead/behind `0/0` |
| GitHub 镜像 | `github/codex/story-ad-v3-upgrade` | 与本地 HEAD 相同，ahead/behind `0/0` |
| 本地开发服务 | `http://localhost:3007` | HTTP 200，运行 v23 / `reference-director-v3` |
| 生产运行代码 | 生产发布清单 SHA-256 | 110/110 文件一致，缺失 0、差异 0 |
| 生产服务 | PM2 `vido`，端口 4600 | online；内网、公网 health 均为 ok |
| 生产数据库 | `/data/vido/db/vido.sqlite` | database status ok；`PRAGMA quick_check=ok` |

生产采用文件级原子发布，一致性以发布清单逐文件 SHA-256 为准，不以生产目录的 Git detached HEAD 判断。交接文档和日志不会部署到生产，因此交接提交完成后 Git HEAD 会比生产功能提交多一个纯文档提交，但 110 个运行文件仍与本地相同。

本地保留 5 个既有未跟踪用户文档，其中包括商业加固计划、综合审计报告及 3 个历史中文命名文档/HTML。本次未覆盖、删除或纳入提交。

## 6. 实际执行的静态、定向、完整和生产验证

### 本轮交接实际执行

- `git fetch --all --prune`：完成；本地、origin/Gitee、GitHub 核对前 SHA 均为 `d93e60c2c32b9f2f49239e719c53528c2fb6fb17`。
- ahead/behind：origin `0/0`，GitHub `0/0`。
- 本地健康与版本：HTTP 200；`20260804-visual-assets-sync-v23 / reference-director-v3`。
- 生产文件哈希：110/110 一致，mismatches 为空。
- PM2：`vido` online；核对时累计 restart 593，本次核对没有重启服务。
- 内网与公网健康：均为 `ok`；数据库状态 `ok`；SQLite quick_check `ok`。
- 本轮核对触发的模型调用、媒体调用和业务写入：均为 0。

### v23 发布时已经执行并记录

- 本地完整 `npm run platform:upgrade:test`：退出码 0，约 275.9 秒。
- 生产隔离完整平台回归：退出码 0，发布过程约 260 秒，真实模型调用 0。
- 发布完整性：110/110 文件哈希一致。
- 发布前后活动生成任务：均为 0。
- 生产备份：`/opt/vido/backups/story-ad-20260804-visual-assets-sync-v23-20260804163536`。

### 本轮未执行

- 未再次运行完整平台回归：本轮只生成交接文档，没有修改运行代码；采用 00:40 已完成的本地和生产完整回归结果。
- 未执行真实浏览器点击验收：浏览器控制插件当前不可用。
- 未重新提交人物、场景、图片、全景或视频生成，避免重复付费和覆盖当前任务。
- 未部署代码或重载 PM2：生产运行文件已经与本地一致，无需重复发布。

## 7. 剩余风险、活动任务、费用与数据覆盖边界

1. 核对期间生产存在 1 个用户侧活动联合生成任务：任务 `d4d9d5e9-81c7-4660-8de2-6b7b9a460547`，generation `8e4a6485-2fea-4133-839d-eeea67e3b868`，阶段 `visual_assets`。
2. 00:49 实测人物通道已完成 6/6，联合进度 86%；场景通道仍为 0/1，等待供应商响应。该状态在交接生成时仍未进入终态。
3. 不要在公司电脑对同一任务再次点击联合生成或人物/场景单独生成；先只读刷新并确认活动任务已完成或失败，避免重复提交和重复费用。
4. 该任务早前曾出现供应商“响应头前连接中断”，部分请求的计费状态未知。新链路会保留检查点并阻断不安全自动重试，但供应商外部可用性仍是剩余风险。
5. 当前核对没有停止、取消、重试或修复该业务任务，也没有覆盖其数据；活动状态是真实业务运行状态，不是代码三方不一致。
6. 生产和 Git 的运行代码没有已知差异；尚未完成的是用户对新版页面和真实付费生成结果的最终体验验收。

## 8. 明天继续优化的明确入口和顺序

1. 拉取后先访问本地版本接口，确认 v23，再打开生产当前任务只读查看终态。
2. 首先核对联合进度：人物和场景两条通道是否均进入终态，部分成功资产是否仍存在；不要先点重试。
3. 核对资产中心顶部唯一主动作、场景区位置及“真实场景生成前锁定场景世界”的交互是否符合预期。
4. 如果场景通道失败，先记录错误码、供应商提交状态和计费状态，再决定是否人工重试；不要通过关键词或末端文案兜底。
5. 如果联合任务成功，继续检查权威 context 是否同时包含人物资产和场景资产，SceneWorld 是否只消费真实场景图。
6. 再优化世界观、360、人物×场景、走位与镜头衔接的交互层级；始终保持行业无关和按需加载。
7. 最后执行定向回归、完整平台回归、生产发布和三方哈希核对，再进入下一轮真实付费验收。

## 9. 最小续接核对

```powershell
git status --short
git rev-parse HEAD
git rev-list --left-right --count HEAD...origin/codex/story-ad-v3-upgrade
Invoke-RestMethod http://localhost:3007/api/story-ad/version
Invoke-RestMethod https://vido.smsend.cn/api/story-ad/version
ssh -o BatchMode=yes vido-prod
```

预期：Git ahead/behind 为 `0 0`；本地与生产均为 `20260804-visual-assets-sync-v23 / reference-director-v3`。SSH 如果失败，说明公司电脑尚未授权独立公钥；只复制公钥授权，不要通过 Git 或交接文档传递私钥或密码。
