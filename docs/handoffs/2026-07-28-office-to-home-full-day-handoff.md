# VIDO 剧情广告 2026-07-28 公司 → 回家完整交接

> 交接日期：2026-07-28（Asia/Shanghai）  
> 目标分支：`codex/story-ad-v3-upgrade`  
> 功能基线：`14ed129956552d4d46f47b137fde2ea20972fc36`  
> 用途：回家后拉取目标分支最新 HEAD，继续优化剧情广告流程  
> 安全说明：本文不包含服务器密码、数据库密码、API Key、Token、Cookie 或其他凭证

## 一、交接结论

今天完成了剧情广告六步流程、剧情与表演 AI 辅写、长文本持久化、Logo 上传与场景融合结尾、明确镜头数保护、按钮指向反馈、真实并发进度、旧进度隔离和失败状态持久显示。

交接完成时的验收基准：

- 本地分支与 Gitee `origin/codex/story-ad-v3-upgrade` 指向同一提交；
- 本地 ahead/behind 为 `0 / 0`；
- 生产发布清单逐文件 SHA-256 与本地一致；
- PM2 `vido` 为 `online`；
- 生产数据库状态为 `ok`；
- 生产内网与公网健康接口均为 HTTP 200；
- 活动剧情广告生成任务为 0；
- 最终浏览器缓存版本为 `20260728-story-step-v50`；
- 核对和部署过程没有触发文本、图片、视频模型或媒体生成；
- 核对过程没有写入生产任务。

生产仓库使用历史 detached HEAD 加文件级原子发布，因此判断运行代码是否一致，应以“本地/Gitee 提交一致 + 生产发布清单哈希一致”为准，不能只比较生产服务器的 Git HEAD。

## 二、今天最终确定的六步流程

```text
1. 广告需求
2. 场景配置（人物 / 主体 / 场景资产）
3. 剧情与表演（呈现方式 / AI 辅写 / 可选 Logo）
4. 剧本生成
5. 分镜生成（分镜审核 / 真实画面）
6. 广告合成（视频 / 配音 / 字幕 / 最终成片）
```

关键规则：

- 人物、主体和场景资产确认后，才进入剧情与表演；
- 第 3 步只负责剧情呈现方式、表演要求和可选 Logo；
- “生成剧本”位于第 3 步标题栏右侧，不放在内容面板底部；
- 第 4 步是独立剧本页面，确认后才生成分镜；
- 镜头数量优先服从用户明确写出的镜头分段；
- 第 5 步真实画面按依赖层并行生成，不是全串行；
- 第 6 步在所有真实画面审核通过后才允许生成整条广告。

## 三、今日完成的主要修复

### 3.1 六步流程与按钮语义

- “剧情与表演”成为独立第 3 步；
- 剧本生成顺延为第 4 步；
- 删除“生成剧本前最后一步”等多余提示；
- 主操作统一为“生成剧本”；
- “生成剧本”移动到第 3 步标题栏；
- 进入第 3 步不等于确认，点击生成时才确认并进入第 4 步；
- 主按钮默认保持中性，只有 hover/focus 才显示青绿渐变和光晕；
- 第 4 步“重新生成剧本”和“确认剧本，生成分镜”补齐独立 hover/focus 反馈。

### 3.2 AI 辅写剧情与表演

- AI 辅写会读取第一步广告需求；
- 同时读取已确认人物、宠物、主体和场景；
- 已确认宠物不再被误判为未确认人物；
- 不允许新增未确认人物、场景或道具；
- 输出按剧情走向、情绪与表演、关键动作、台词、节奏、结尾和禁止项自动分段；
- 输出使用真实换行和空行，不再压成一个长段落。

### 3.3 刷新后文本格式变化

完整根因：

```text
前端多行正文
→ 自动保存
→ 服务端通用 cleanText 折叠全部空白
→ 数据库存成单行
→ 刷新只能恢复单行
```

修复后：

- 广告需求和剧情表演正文使用多行清洗；
- 保留真实换行和空行；
- 历史被压平内容按栏目、数字编号和项目符号恢复显示分段；
- 显示排版与服务端权威原文分离；
- 未编辑时保存仍使用权威原文，不会因为自动排版误增内容修订；
- 用户真实编辑后才提交文本框新值。

### 3.4 Logo 上传与最终品牌结尾

Logo 不是交给图片/视频模型生成的视觉元素，正确路径为：

```text
上传已授权 Logo
→ 勾选使用与发布授权
→ 在最终镜头预留与场景融合的安全区
→ 图片/视频模型生成无 Logo 的自然场景
→ 完整视频播放结束
→ 冻结最终场景最后一帧
→ 追加停留时长
→ FFmpeg 原样叠加授权 Logo
```

已完成：

- 上传区显示 PNG/JPG/JPEG/WebP、最大 10MB；
- 非法格式或过大文件在请求前拒绝；
- 上传后显示缩略图；
- 缩略图上提供放大和图标删除操作；
- 没有上传 Logo 时，不生成品牌结尾合同；
- 上传但没有确认授权时，阻止继续生成；
- Logo 只在最终镜头和最终成片结尾生效；
- Logo 变更会使剧本、分镜、关键帧和视频等创意下游失效；
- 最终停留时长计入成片技术质检。

### 3.5 明确镜头数被模型缩减

已确认的旧问题链：

```text
用户明确写 9 镜
→ 模型初稿只返回 6 镜
→ 第一次结构修复得到 9 镜
→ 质量润色失败
→ 旧检查点恢复为 6 镜
→ 第二次随机修复只得到 4 镜
```

修复后：

- 解析完整需求中的 `[镜头N]`、镜头类型、画面和可选旁白；
- 以用户明确分段作为镜头结构权威来源；
- 模型返回数量不足时按用户分段确定性对齐；
- 覆盖最长 18 镜和超过 6000 字输入；
- 识别 `旁白 (VO)` 与 `旁白（VO）`；
- 没有用户台词的镜头固定为静默或环境声；
- 不再自动补满轨虚构台词；
- 精修失败或镜头数不完整时，不再重新付费执行整个剧本阶段；
- 内容没有变化时重复确认不再误增创意修订。

### 3.6 真实画面并发显示

服务端原本就按依赖层并行。例如当前任务中独立根镜头 1、3、6 曾并发提交，其余镜头等待对应前置镜头。

页面看似串行的根因是轻量轮询投影删除了：

- `active_indexes`
- `queued_indexes`
- `configured_concurrency`
- `effective_concurrency`
- `peak_concurrency`
- `wave_number`

修复后，页面会显示当前真实活动镜头及并发数，例如：

```text
并行生成真实画面：第 1、3、6 镜（共 9 镜）
正在并行生成第 1、3、6 镜（并发 3）
```

数组经过排序、去重和长度限制，不会使轻量轮询响应无限增大。120 镜边界测试的轮询载荷为 599 bytes。

### 3.7 未点击生成却瞬间显示旧 90%

根因：

- 新操作点击后到 POST 返回新 `generation_id` 之间存在提交窗口；
- 旧实现只对关键帧阶段隔离旧进度；
- 分镜、剧本等阶段会接受上一轮相同阶段的终态进度；
- 旧分镜审核恰好停在 90%，因此新操作刚开始就显示 90%。

修复后：

- 场景、剧本、分镜、关键帧、视频、媒体和合成统一使用提交隔离；
- 新阶段先显示 0% 或“准备中”；
- 服务器返回新的生成编号后才接收真实进度；
- 旧 `generation_id` 的迟到轮询结果不能覆盖新批次；
- 保存响应也不能把上一轮终态重新写回当前页面。

### 3.8 生成提示消失并恢复成 0/9

当前生产任务并不是无故回退。真实失败为：

- 第 1 镜：供应商 `400 / AuditSubmitIllegal`，内容审核拒绝；
- 第 3、6 镜：供应商 `500 / UNKXXXO004IFR`，无法确定是审核还是服务故障；
- 第 2、4、5、7、8、9 镜：因依赖根镜头没有可用结果而停止；
- 最终结果：已处理 9/9、成功 0、失败 9。

旧页面在终态后隐藏进度区，又没有关键帧失败持久卡片，因此看起来像“过一会儿自己恢复成 0/9”。

修复后，失败卡片会持续显示：

- “真实分镜生成未完成”；
- 支持编号；
- 错误代码；
- 已处理、可用、失败数量；
- 成功图片会保留；
- 不会自动重复提交；
- 刷新后仍然存在。

## 四、当前生产任务状态

目标任务：

```text
d36055d2-890d-444f-9a6b-33d23bb2e2bc
```

当前只读状态：

- `status: failed`
- `stage: keyframes_failed`
- `active_generation_id: 空`
- 真实分镜：0/9
- 活动生成任务：0
- 最近关键帧支持编号：`a76b59c7-9589-4ce9-aced-4dee6de96e79`
- 错误代码：`KEYFRAME_BATCH_PARTIAL_FAILURE`

生产浏览器已经确认加载 `20260728-story-step-v50`，并持续显示失败卡片和 9/9、0、9 的统计。

注意：界面状态错误已经修复，但供应商审核拒绝和 5xx 是独立的真实外部失败。在调整第 1 镜提示内容或确认供应商恢复前，不建议直接点击“补齐未生成镜头（9）”，否则仍可能失败并产生费用。

## 五、当前剧本/分镜仍需继续优化的内容

当前任务的分镜质量审核曾失败，主要包括：

- 第 5、6、9 镜动作描述过短；
- 第 5～9 镜部分结构化场景区域缺失；
- 多个镜头仍含“先看……”等占位式旁白；
- 没有台词的镜头应明确为静默或环境声；
- 第 5 镜镜头规格曾不完整；
- 当前恢复的 9 镜结构数量正确，但文案质量不能视为最终通过。

回家后若继续优化，应先解决分镜内容和供应商审核输入，不要把“页面进度已修复”等同于“这 9 张图一定可以成功生成”。

## 六、今日主要提交

```text
1059ffe  六步流程、剧情与表演及 AI 辅写
a311db9  精简生成剧本文案
6dada70  更新六步 UI 缓存
175d0fa  六步生产交接
1a1015e  生成剧本移到第 3 步标题栏
aa8df37  多行正文持久化
37be5af  显示排版与权威文本分离
d5446d5  Logo 标准上传组件
c0c046e  证据图恢复与场景融合 Logo 结尾
0919cc1  明确镜头结构确定性保护
84826c8  第 4 步按钮 hover/focus
734c537  生成进度隔离、并发投影和失败持久卡片
14ed129  生成进度发布校验脚本
```

回家后只拉取目标分支最新 HEAD，不要逐个检出中间提交。

## 七、关键代码位置

### 流程与前端状态

- `public/digital-human.html`
- `public/css/digital-human-wizard.css`
- `public/js/new-story-ad/bootstrap.js`
- `public/js/new-story-ad/button-state.js`
- `public/js/new-story-ad/story-setup.js`
- `public/js/new-story-ad/state-sync.js`
- `public/js/new-story-ad/progress.js`
- `public/js/new-story-ad/task-store.js`
- `public/js/new-story-ad/generation-flow.js`
- `public/js/new-story-ad-legacy-ui.js`

### AI 辅写、文本和结构

- `src/services/newStoryAd/assistCreativeDirectionService.js`
- `src/services/newStoryAd/contextBuilder.js`
- `src/services/newStoryAd/blueprintService.js`
- `src/services/newStoryAd/textStageRecoveryService.js`
- `src/services/newStoryAd/storySetupService.js`
- `src/services/newStoryAd/revisionService.js`

### Logo、分镜与合成

- `public/js/new-story-ad/brand-overlay.js`
- `src/services/newStoryAd/brandEndingService.js`
- `src/services/newStoryAd/temporalEvidenceGraphService.js`
- `src/services/newStoryAd/storyboardTableService.js`
- `src/services/newStoryAd/storyAdService.js`
- `src/services/newStoryAd/composeService.js`

### 进度与任务

- `src/services/newStoryAd/taskProgressProjectionService.js`
- `src/services/newStoryAd/taskProgressSaveService.js`
- `src/services/newStoryAd/jobService.js`
- `src/routes/newStoryAd.js`

### 回归、诊断与发布

- `scripts/test-new-story-ad-story-setup-flow.js`
- `scripts/test-new-story-ad-display-format-authority.js`
- `scripts/test-new-story-ad-brand-logo-upload-ui.js`
- `scripts/test-new-story-ad-brand-ending-contract.js`
- `scripts/test-new-story-ad-blueprint-quality.js`
- `scripts/test-new-story-ad-blueprint-lifecycle.js`
- `scripts/test-new-story-ad-progress.js`
- `scripts/test-new-story-ad-v2-performance.js`
- `scripts/test-new-story-ad-task-resume.js`
- `scripts/test-new-story-ad-keyframe-parallel.js`
- `scripts/inspect-new-story-ad-stuck.js`
- `scripts/audit-new-story-ad-content-lineage-release.js`
- `scripts/deploy-new-story-ad-subject-scene-recovery.js`
- `scripts/deploy-new-story-ad-keyframe-progress.js`

## 八、已执行验证

### 本地

- 相关 JavaScript `node --check`：通过；
- `git diff --check`：通过；
- 生成进度定向回归：通过；
- 任务恢复和失败卡片回归：通过；
- 120 镜轻量轮询边界：通过，响应 599 bytes；
- 完整 `npm run story-ad:v3:test`：全部通过；
- 本地健康接口：HTTP 200。

### 生产

- 本轮进度修复原子发布文件哈希：17/17；
- 生产定向进度、任务恢复和 120 镜边界测试：通过；
- 生产完整 `npm run story-ad:v3:test`：全部通过；
- PM2 `vido`：online；
- 内网健康：HTTP 200；
- 公网健康：HTTP 200；
- 数据库：ok；
- 活动生成任务：0；
- 浏览器缓存：`20260728-story-step-v50`；
- 浏览器失败卡片：支持编号、错误代码、9/9、0、9 均正确显示；
- 模型/媒体调用：0；
- 生产任务写入：0。

生产备份：

```text
/opt/vido/backups/new-story-ad-subject-scene-recovery-20260728071353
/opt/vido/backups/blueprint-structure-fix-20260728082028
/opt/vido/backups/blueprint-structure-fix-20260728090040
/opt/vido/backups/new-story-ad-keyframe-progress-20260728094643
```

## 九、回家后的拉取与启动

在项目目录执行：

```powershell
git fetch origin
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
git status --short
git rev-list --left-right --count HEAD...origin/codex/story-ad-v3-upgrade
npm install
npm run story-ad:v3:test
node src/server.js
```

正确结果：

- `git pull --ff-only` 成功；
- ahead/behind 输出 `0 0`；
- 完整回归退出码 0；
- 本地开发服务访问地址为 `http://localhost:3007`。

注意：

- 不要使用 `git reset --hard`；
- 不要删除本地未跟踪文件；
- 如果回家电脑已有自己的未提交修改，先确认并保存，再拉取；
- 静态查看、刷新页面和只读审计不会产生模型费用；
- AI 辅写、生成剧本、生成图片和生成视频会产生真实调用，不要连续重复点击。

## 十、回家后建议的优化顺序

1. 先拉取最新 HEAD 并跑完整回归。
2. 用 `Ctrl+F5` 强制刷新本地页面。
3. 检查第 3 步“生成剧本”默认与 hover/focus 状态。
4. 检查第 4 步两个按钮默认与 hover/focus 状态。
5. 验证长文本刷新前后换行保持一致。
6. 对当前 9 镜分镜清理占位旁白和过短动作。
7. 修正第 1 镜可能触发供应商内容审核的生成描述。
8. 使用模拟进度验证并发标题，不触发真实图片生成。
9. 如需真实重试，先做单镜或最小范围预检，避免直接重跑 9 镜。
10. 有已授权 Logo 时，再验证最终一帧冻结、场景融合和 Logo 叠加。

## 十一、未执行项与剩余风险

未执行项：

- 本轮没有再次触发真实 AI 辅写；
- 没有重新生成剧本或分镜；
- 没有重新生成 9 张真实画面；
- 没有生成视频或最终成片；
- 没有上传真实 Logo。

原因：避免重复计费、覆盖当前失败证据或污染生产任务。

剩余风险：

- 供应商内容审核策略可能继续拒绝第 1 镜；
- 两个供应商未分类 5xx 的实时可用性无法由本地代码保证；
- 当前恢复分镜数量正确，但文案质量审核并未最终通过；
- 真实 Logo 的视觉比例、可读性和最终场景融合仍需授权素材人工验收；
- 生产采用文件级发布，后续仍须使用哈希审计，不能只看服务器 Git HEAD。

## 十二、三方只读核对

从安全渠道取得凭证后执行：

```powershell
$env:VIDO_DEPLOY_HOST = '服务器地址'
$env:VIDO_DEPLOY_PORT = '2222'
$env:VIDO_DEPLOY_PASSWORD = '从安全渠道取得'
node scripts/audit-new-story-ad-content-lineage-release.js
```

期望结果：

```text
status: PASS
ahead_behind: 0 0
release_hash_mismatches: []
active_generation_count: 0
pm2.status: online
private_health_http: 200
public_health.status: 200
database.status: ok
model_or_media_calls_triggered: 0
task_writes: 0
```

## 十三、公司电脑当前未纳入本次提交的文档状态

以下状态在开始本轮交接前已经存在，已原样保留，没有覆盖或提交：

- `docs/handoffs/2026-07-24-office-to-home-complete.md`：本地工作区为删除状态；
- `docs/handoffs/[仓库交接文档].md`：本地未跟踪文件。

它们不是今天业务代码的一部分，也不会随本次交接提交自动出现在回家电脑。需要这些文件时，应另行确认是否提交，不能用强制重置覆盖。
