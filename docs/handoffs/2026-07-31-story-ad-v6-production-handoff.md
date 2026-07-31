# 2026-07-31 剧情广告 V6 独立模块生产交接

> 日期：2026-07-31
> 目标分支：`codex/story-ad-v3-upgrade`
> Git 远端：`origin`（Gitee）
> 生产：`43.98.167.151:/opt/vido/app`
> PM2：`vido`

## 1. 当日目标与用户决策

今天完成了剧情广告模块从竞品分析、完整交互方案到正式代码、平台入口和生产发布的闭环。

用户确认的关键决策：

- 剧情广告从数字人模块中完全独立，首页提供单独入口。
- 工作流画布对全部剧情广告用户可见，不再设置超管权限。
- 工作流画布支持画布平移、缩放、节点详情和真实任务关系投影。
- 创建项目不强制上传视频；参考视频、公开链接、人物、动物、商品、LOGO、场景和脚本均为可选材料。
- 人物、动物、商品、LOGO、道具、场景与机位必须分别建档，多主体通过组合关系绑定。
- 剧情、文字分镜、线稿、镜头参数、关键帧、视频与衔接分别展示并保留版本关系。
- 正式界面禁止出现原型样例内容，只读取当前账号的真实任务或显示空状态。
- 删除首页“图生视频”和“图片生成”两个独立展示模块，但保留工作流和画布继续复用的底层生成能力。
- 剧情广告主题必须继承平台主题；任务中心和项目页均提供“返回工作台”。
- 授权、参考链接和生成确认全部使用平台统一弹窗，不再使用浏览器原生弹窗。

## 2. 修改前后的完整数据流

### 修改前

```text
首页 / 数字人宿主页
  -> 旧剧情广告大脚本
  -> 多个顺序加载文件与历史页面状态
  -> 参考分析轮询可能复用上一任务内存
  -> 人物、场景、剧情、分镜和视频分散在旧步骤内
  -> 工作流关系仅以状态列表呈现
```

主要问题：

- 剧情广告与数字人页面耦合，入口和权限语义不清。
- 首页与同页模块可能同时呈现，形成页面叠加。
- 新建任务时旧 bundle 和旧参考分析轮询存在短暂复用风险。
- 资产、剧情、分镜和镜头之间缺少统一只读投影。
- 原生浏览器弹窗不符合平台风格，也不随主题切换。

### 修改后

```text
平台首页 /dashboard
  -> 独立入口 /story-ad/
  -> 任务中心读取当前账号真实项目
  -> /story-ad/projects/:id?view=<workspace>
  -> Project Bundle 聚合现有任务、参考、资产、剧情、分镜、镜头和成片
  -> 各工作区通过现有 API 写回同一任务
  -> Graph Projection 只读投影为可平移缩放的工作流画布
```

参考材料链路：

```text
上传视频或公开链接（可选）
  -> 平台统一授权确认
  -> 创建或确认当前任务 ID
  -> 返回明确 analysis_id
  -> 当前任务轮询该 analysis_id
  -> 终态结构化事实只写回当前任务
  -> 后续资产、剧情和镜头读取同一 Project Bundle
```

跨任务隔离变化：

- 进入新建页立即清空旧 bundle、任务进度轮询和参考分析轮询。
- 参考分析必须同时绑定当前任务 ID 与明确分析 ID。
- 前端不再整包覆盖资产数组；材料按角色追加或替换。
- 新模块不建立第二套生成服务，继续复用现有任务、资产、模型、费用预检和媒体生成能力。

## 3. 代码和文件变更清单

### 独立剧情广告前端

- `public/story-ad/index.html`
- `public/story-ad/app.js`
- `public/story-ad/api.js`
- `public/story-ad/store/projectStore.js`
- `public/story-ad/components/ui.js`
- `public/story-ad/components/dialog.js`
- `public/story-ad/views/briefView.js`
- `public/story-ad/views/assetCenterView.js`
- `public/story-ad/views/plotRoomView.js`
- `public/story-ad/views/storyboardView.js`
- `public/story-ad/views/shotDesignerView.js`
- `public/story-ad/views/finalView.js`
- `public/story-ad/views/workflowView.js`
- `public/story-ad/styles.css`
- `public/story-ad/workspace.css`
- `public/story-ad/workflow.css`

### 服务端薄聚合与投影层

- `src/routes/storyAdWorkspace.js`
- `src/services/storyAdWorkspace/projectBundleService.js`
- `src/services/storyAdWorkspace/graphProjectionService.js`
- `src/services/storyAdWorkspace/storyboardSketchService.js`

这些模块只负责聚合、投影和线稿状态，不复制模型调用、资产生成或视频生成服务。

### 平台入口与路由

- `public/index.html`
- `public/js/app.js`
- `public/js/dashboard-workbench.js`
- `public/css/style.css`
- `public/css/dashboard-workbench.css`
- `src/routes/dashboard.js`
- `src/server.js`
- `package.json`

### 测试与发布

- `scripts/test-story-ad-workspace-v6.js`
- `scripts/check-story-ad-workspace-v6-boundaries.js`
- `scripts/test-platform-module-navigation.js`
- `scripts/test-new-story-ad-task-resume.js`
- `scripts/deploy-2026-07-31-story-ad-v6.js`

### 研究与原型

- `docs/research/2026-07-31-liblib-asset-graph-deep-dive-and-vido-v2-plan.md`
- `docs/research/2026-07-31-story-ad-v4-*`
- `docs/research/2026-07-31-story-ad-v5-*`
- `docs/research/2026-07-31-story-ad-v6-*`

原型文件只进入 Git 研究目录，没有进入生产发布清单，正式页面不会加载原型数据。

## 4. 提交记录与续接命令

功能提交：

- `f34e9f8f9ecfb1db92a14e5e4ec3c5a1ae2353ec` `feat(story-ad): launch standalone production workspace`
- `66d54b2d70e1ef07b205ff329537b66cc44beaf1` `fix(deploy): validate browser modules as esm`

另一台电脑续接：

```powershell
git status --short
git fetch --all --prune
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
npm install
npm run platform:upgrade:test
node src/server.js
```

执行 `git pull` 前必须先确认没有需要保留的未提交修改，禁止使用 `git reset --hard` 覆盖本地工作。

## 5. 本地、Git、生产三方一致性

| 核对对象 | 结果 | 证据 |
|---|---|---|
| 本地分支 | 一致 | `codex/story-ad-v3-upgrade` |
| 本地与 origin | 一致 | `ahead/behind 0/0` |
| 功能代码 HEAD | 一致 | `66d54b2d70e1ef07b205ff329537b66cc44beaf1` |
| 生产运行文件 | 一致 | 发布清单 `33/33` SHA-256 一致，差异 `0` |
| PM2 | 正常 | `vido` 为 `online`，发布后 PID `12625` |
| 内网健康 | 正常 | `http://127.0.0.1:4600/api/health` 返回 `status=ok` |
| 公网健康 | 正常 | `https://vido.smsend.cn/api/health` HTTP 200 |
| 数据库 | 正常 | SQLite `enabled=true`、`status=ok` |
| 活动生成任务 | 无 | 发布前 `0`，发布后 `0` |

生产仍采用历史 detached HEAD 加文件级发布，因此生产 Git HEAD 不是运行文件一致性的判断依据；本次以 33 项发布清单逐文件 SHA-256 为准。

## 6. 实际执行的验证

### 本地静态与定向验证

- 所有新增和修改 JavaScript 语法检查通过。
- 剧情广告目录原生 `alert/confirm/prompt` 命中 `0`。
- `platform:navigation:test` 通过。
- `story-ad:v6:test`：服务测试 `24` 项通过。
- V6 边界门禁通过：首屏 JS `35,846` 字节，全部新模块 JS `106,218` 字节。
- 正式模块原型样例词门禁通过。

### 本地完整回归

- `npm run platform:upgrade:test` 退出码 `0`。
- 30 个 HTML 页面加载检查通过。
- VideoCanvas、剧情广告 V2/V3/V6 回归全部通过。
- 参考视频分析 `117` 项、参考链接 `61` 项、人物 UI `92` 项、导演工作区 `38` 项通过。
- 真实模型调用 `0`。

### 浏览器验证

- `/story-ad/` 可正常访问，不再出现重定向循环。
- 任务中心读取真实项目，没有原型样例数据。
- 任务中心和项目页均显示“返回工作台”。
- 亮色工作台进入剧情广告后保持亮色。
- 暗色和亮色统一弹窗均正常；取消不会继续创建任务或触发生成。

### 生产发布与验证

- 发布前活动任务 `0`，数据库健康。
- 生产备份：`/opt/vido/backups/story-ad-v6-20260731101848`。
- 33 个运行文件通过隔离 staging、语法检查、逐文件原子替换。
- 生产完整 `platform:upgrade:test` 通过。
- 发布过程中真实模型调用 `0`，没有图片或视频提交。
- PM2 重载成功，内网和公网健康均正常。
- 发布后再次独立核对 `33/33` SHA-256 一致，差异 `0`。
- 公网 `/story-ad/` 未登录访问只重定向 `1` 次到登录页，最终 HTTP 200，没有循环。

## 7. 未执行项、剩余风险与费用边界

未执行项：

- 没有使用真实账号在生产创建新剧情广告任务，以避免写入业务数据。
- 没有在生产上传参考视频、生成图片、关键帧或视频。
- 当前仓库只配置了 `origin`（Gitee），没有单独的 GitHub remote，因此本轮无法同步 GitHub 镜像。

费用与数据边界：

- 本轮部署和验证真实模型调用为 `0`。
- 没有覆盖或修改现有生产任务数据。
- 视频生成仍需通过现有费用预检和最终人工确认。
- 线稿生成、人物资产生成等可能计费的操作仍保留统一确认弹窗。

剩余风险：

- 未执行生产真实账号端到端创建，因此生产业务写入链路仍建议由用户在确认预算后做一次小任务验收。
- 工作树中仍保留用户此前的 7 月 24 日交接文件变动和未提交的 7 月 29 日研究资料；本轮没有修改、删除或纳入提交。

## 8. 下一次继续优化的入口与顺序

1. 从平台首页进入“剧情广告”，用一个低成本真实任务核对创建、保存和恢复。
2. 先验证参考视频或公开链接是否只绑定当前任务，再确认结构化事实摘要。
3. 验证单人、双人、多人、人物与宠物、商品、LOGO、多场景和机位资产建档。
4. 验证剧情蓝图、文字分镜和逐镜线稿之间的版本回流。
5. 验证镜头参数、前后镜衔接和关键帧合同。
6. 最后才进入付费关键帧和视频生成，并逐次确认费用。

本轮功能代码、Git 远端和生产运行清单已经完成一致性闭环。
