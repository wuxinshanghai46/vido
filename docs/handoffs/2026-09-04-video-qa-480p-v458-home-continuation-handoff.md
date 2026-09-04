# VIDO 视频 QA、续生与 480P V458 回家续接交接

> 日期：2026-09-04
> 当前分支：`codex/story-ad-systemic-remediation`
> 目标任务：`b83fa67c-244a-4869-b3cc-df282fad5c59`
> 当前结论：代码候选 V458 已提交并同步 Git；生产仍安全运行 V450，尚未部署 V458，也尚未迁移目标任务的剩余视频分辨率。

## 一、当日目标与用户决策

本轮围绕生产视频流程完成或推进以下事项：

1. 旁白不得按人物口型一致性判定，只有画面中人物对白才检查口型。
2. 统一页面间距、按钮尺寸、选中态、竖屏视频完整预览。
3. 点击剧情、人物、场景、分镜、视频生成后立即显示进度；所有进度条有持续动画和耗时。
4. 批量生成分镜只显示总进度，单镜重生才显示单镜进度。
5. 成片剪辑从生成主流程拆出，作为独立工具；首页“爆款复刻”改为“工具项”。
6. 授权账号能识别供应商余额不足、鉴权、限流和上游错误，普通用户继续看到脱敏提示。
7. 视频生成成功但视觉 QA 基础设施不可用时保留已付费视频，继续生成剩余镜头，不重复生成已经成功的镜头。
8. 全平台视频分辨率默认改为 480P，用户仍可主动选择更高分辨率；当前任务保留第 1 个既有视频，后续 6 镜改用 480P。
9. 用户在 18:52 要求停止耗时发布，生成交接文件并回家续接。此后没有继续运行发布器、模型或媒体任务。

## 二、修改前后的完整数据流

### 修改前

`用户提交视频生成` → `供应商生成视频` → `视觉 QA 路由依次调用 Claude/Gemini/Claude` → `视觉 QA 全部不可用` → `整批立即失败` → `已经生成的视频虽在任务中，但前端继续按钮仍按总镜头数显示 7` → `再次提交可能把已经成功的镜头纳入计划`。

默认分辨率在剧情广告、数字人和通用视频链路中分散为 720P/1080P；只改任务顶层分辨率会让已生成镜头谱系失配，并可能误使第 1 镜失效。

### 修改后（V458 候选，尚未上线）

`用户提交视频生成` → `立即创建可见进度` → `根据当前镜头产物和逐镜谱系计算待生成集合` → `仅生成缺失镜头` → `供应商视频成功后持久化产物` → `执行视频 QA`。

- 内容质量确实不合格：仍按内容失败停机，不能绕过审片。
- 视觉/音频 QA 基础设施不可用：记录待复审状态，保留已生成视频并继续后续镜头；最终明确提示“视频已保留，先重试审核，不会重复生成”。
- 前端按 `generated / passed / failed / pending / remaining` 展示。已有 1 镜、总计 7 镜时，按钮显示“继续生成剩余分镜视频（6）”，不再显示 7。
- 新任务及缺失视频默认使用 480P；已有第 1 镜继续沿用其原分辨率谱系，因此不会被覆盖或重做。

Claude 调用属于 `new_story_ad.video_frame_qa` 视觉审片路由，不是 Seedance 视频生成。生产失败证据中的实际回退顺序是：`smscrw/claude-opus-4-8`（UNKNOWN）→ `webang-maas/gemini-2.5-pro`（TIMEOUT_OR_NETWORK）→ `deyunai/claude-opus-4-7`（UNKNOWN）。只能确认 QA 路由全部不可用；UNKNOWN 的供应商内部根因没有充分证据，不能断言为具体模型故障。Seedance 的第 1 镜生成本身成功。

## 三、代码和文件变更清单

核心新增或修改：

- `src/services/newStoryAd/videoQaAvailabilityService.js`：统一识别 QA 基础设施不可用并生成待复审状态。
- `src/services/newStoryAd/storyAdService.js`：保存已成功视频；QA 基础设施失败时继续生成剩余镜头；默认分辨率改为 480P。
- `src/services/newStoryAd/videoArtifactWorkflowService.js`：逐镜分辨率谱系，保留已有旧分辨率产物，缺失镜头采用 480P。
- `src/services/newStoryAd/publicFailureProjectionService.js`：授权错误分类与“保留视频、只重试审核”的提示。
- `public/story-ad/views/clipReviewPresentation.js`、`public/story-ad/views/finalView.js`：按实际状态显示数量及剩余生成按钮。
- `scripts/migrate-story-ad-task-video-resolution-v451.js`：目标任务 480P 定向迁移，支持 dry-run/`--apply`，拒绝活动任务并保留已生成镜头索引。
- `scripts/test-story-ad-video-qa-resume-v451.js`：17 项回归，覆盖 QA 延后、仅生成缺失镜头和旧镜头分辨率谱系。
- 剧情广告、数字人和通用视频的默认配置、表单与服务端兜底已统一为 480P，用户主动选择高分辨率仍保留。
- `public/story-ad/styles.css`、`public/story-ad/workspace.css`：在不改变主题语义的前提下压缩空白，使核心前端 gzip 保持在 51,200 字节门限内。
- 历史 CSS/最终媒体测试已改为验证等价选择器和当前委托模块，不再以空格格式或旧模块位置阻塞新合同。

此前当天已上线的 V430–V450 内容包括旁白 QA、页面布局和按钮、立即进度、进度动画与耗时、独立剪辑工具、授权错误分类。V458 新增的“QA 不可用仍续生”和“全平台默认 480P”尚未上线。

## 四、提交记录、分支与家庭电脑拉取

当前 Git：

- 分支：`codex/story-ad-systemic-remediation`
- HEAD：`131b0c3a57f5f704a42ff42e76fde8c2374d2023`
- V458 源码修订：`948b58bad48d002a6a87e53faa079a9eee0642e0`
- V458 制品：`f27968c0bb7a3a20d8bd995618b5e3dfe3077de7da47d9ef620afff935356372`
- 本轮交接生成前，HEAD 与 `origin/codex/story-ad-systemic-remediation` 为 `0/0`；交接文件和日志将在同一分支追加提交并推送。

V450 之后的主要提交：

- `fa138dff2` preserve videos when QA is unavailable
- `3aa2f5e70` preserve theme contracts within bundle budget
- `19fb99b18` follow delegated final video renderer
- `948b58bad` parse equivalent compact selectors
- `131b0c3a5` publish V458 artifact

家庭电脑续接命令：

```powershell
git status --short
git fetch --all --prune
git switch codex/story-ad-systemic-remediation
git pull --ff-only origin codex/story-ad-systemic-remediation
npm install
node src/server.js
```

执行 `git pull` 前必须先看工作树，不能用 `git reset --hard` 覆盖家庭电脑的未提交内容。

## 五、本地、Git、生产三方一致性

| 位置 | 当前状态 | 结论 |
|---|---|---|
| 公司电脑 `RD-fuxing` | V458 候选，HEAD `131b0c3a5`，清单 1005 个运行文件 | 代码候选完整 |
| Git origin | 交接前与本地 HEAD `ahead/behind=0/0`；交接提交后再次核对 | 家庭电脑权威续接来源 |
| 生产 `43.98.167.151` | 仍为 V450，release `5e526729...`，manifest SHA `9c9f851b...` | 故意未与 V458 一致，未部署新修复 |

三方当前不应被描述为“运行版本一致”：本地/Git 保存 V458 候选，生产继续运行已验收的 V450。这样做是用户要求停止后的安全状态。

## 六、实际验证

已经真实执行：

- V452 阶段完整 `npm run story-ad:release:predeploy` 通过，包括 release:test、V111 固定种子 10,000、400 组变形样本、50 并发任务、重复许可 0、付费调用 0。
- 当前代码重构后 `npm run story-ad:systemic:test` 通过，`storyAdService.js` 恰为 3800 行。
- V243、视频 QA 续生 17 项、视频反馈、视频编排、供应商合同、直接提交、合成门禁、Brief 权威、工作区 UI、视频帧 QA、视频 UX、最终 QA、视频审片交互 19 项均通过。
- 前端核心 gzip 为 51,196 字节，低于 51,200 字节门限；工作区 V6 边界、主题和历史资产动作测试通过。
- V458 候选清单完整性、源码身份校验通过；本地 `http://localhost:3007/api/health` 为 HTTP 200/status ok。
- 2026-09-04 18:52 再次核对：Git fetch 成功，分支与 origin 为 `0/0`，工作树干净。
- 生产只读核对：PM2 `vido` PID 21229，内网和公网 `/api/health` 均 HTTP 200/status ok，SQLite 状态 ok，活动生成 0，活动未知计费 0；历史未知计费 70 条保持隔离。

发布尝试与停止原因：

- V452/V455 首次被前端 gzip 51,330 > 51,200 拦截，未切换生产。
- 一次过度 CSS 压缩被浅色主题静态门禁拦截，已恢复并改成语义安全压缩，未进入生产。
- V457 完整门禁约运行 1,170 秒后，被旧测试对选择器空格的格式断言拦截；已改为语义解析。
- V458 发布门禁已启动，systemic 通过；用户要求停止时约运行 150 秒，已手动终止，生产未切换。

## 七、未执行项、风险、费用和数据边界

未执行：

- V458 尚未完成最终不可变发布门禁，尚未部署生产。
- 目标任务 480P 迁移脚本尚未在生产 dry-run 或 `--apply`；生产 V450 不包含该脚本。
- 尚未在生产页面验证“剩余（6）”、待复审数量和 480P 新默认。
- 尚未由用户点击继续生成，因此没有验收后续 6 个真实视频的动作效果。
- 本轮没有触发真实模型、视频或媒体调用，没有新增付费调用，也没有覆盖第 1 个既有视频。
- 全库系统性审计脚本读取巨大数据库时曾因 Python 桥输出缓冲区 `ENOBUFS` 失败；小型活动任务检查和健康检查通过。这是审计工具的规模限制，不是 SQLite 健康失败。

已知风险：

- 生产仍是 V450，所以当前页面仍可能显示旧的“继续生成 7”行为；不要在 V458 上线和任务迁移前点击付费生成。
- QA 路由 UNKNOWN 的外部供应商根因未明；V458 的作用是正确保存产物并继续/待复审，不是假装 QA 已通过。
- 发布器当前按候选树变化使缓存失效并重复运行跨版本完整回归，安全但耗时。文件/依赖级缓存和只重跑受影响组尚未实现。

## 八、回家后的继续顺序

家庭电脑主机若为 `LAPTOP-LDFOL0GT`，按用户规则只执行当前模块的静态、定向、相邻失败/恢复回归和必要健康检查；不要运行 `platform:upgrade:test`、`story-ad:v2:test`、`story-ad:v3:test`、`story-ad:v6:test`，也不要直接运行会隐式触发完整平台回归的 `npm run story-ad:release:deploy`。

建议顺序：

1. 按上方命令拉取分支，确认工作树干净，启动 3007 服务并检查 `/api/health`。
2. 运行定向测试：

```powershell
node scripts/test-story-ad-video-qa-resume-v451.js
node scripts/test-story-ad-video-review-interaction-v427.js
node scripts/test-new-story-ad-final-qa.js
node scripts/test-story-ad-historical-asset-actions-v61.js
node scripts/test-new-story-ad-knowledge-policy-performance.js
node scripts/check-story-ad-workspace-v6-boundaries.js
npm run story-ad:systemic:test
```

3. 在允许执行发布门禁的非家庭主机上完成 V458 不可变发布；切换前再次确认活动生成数为 0。
4. V458 上线后，先对目标任务做生产 dry-run：

```bash
cd /opt/vido/current
node scripts/run-with-pm2-env.js vido node scripts/migrate-story-ad-task-video-resolution-v451.js --task=b83fa67c-244a-4869-b3cc-df282fad5c59 --resolution=480p
```

5. dry-run 必须确认：活动任务 0、已有视频索引仅 `[1]`、计划保留该视频、待生成 6 镜；确认后才追加 `--apply`。
6. 迁移后再次 dry-run/只读核对：运行上下文为 480P、generated 仍为 1、remaining 为 6、模型调用数未变化。
7. 强制刷新生产页面，只读确认按钮为“继续生成剩余分镜视频（6）”且已有第 1 镜保留。不要代替用户点击付费生成；由用户完成真实效果验收。

