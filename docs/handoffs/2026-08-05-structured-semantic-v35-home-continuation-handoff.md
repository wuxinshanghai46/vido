# VIDO v35 参考语义合同 · 回家续接交接

> 日期：2026-08-05
> 目标分支：`codex/story-ad-v3-upgrade`
> 生产主机：`43.98.167.151`，应用目录 `/opt/vido/app`，PM2 `vido`，端口 `4600`
> 安全边界：本文不包含密码、Token、API Key 或 SSH 私钥。

## 1. 当日目标与用户决策

- 参考视频需要一次点击完成竞品/内容分析；多人物、叙事型宠物和多物理场景应自动进入后续人物与场景方案。
- 商品不能只作为输入框，需要区分独立商品、材料/表面、空间成果与数字服务，并进入逐镜商品证明和最终 QA。
- 语义分析不能因为某一个字段失败而丢弃全部成功结果；必须保留检查点、只补缺失合同。
- 必须跨行业通用，禁止把家居、服装、汽车等具体行业写死；同时控制前端载荷、DOM 数量和代码边界。
- 目标成片时长已扩展到 5—10 分钟，并通过章节批处理、最多 120 镜、语音断点、分层合成和分页渲染控制性能。
- 2026-08-05 晚间线上验收产生了新的 `failed/81%` 结果，因此撤回“参考分析可以继续重复测试”的结论；回家后先诊断，不要再次点击同一任务。

## 2. 修改前后的完整数据流

### 修改前

```text
参考视频 → 镜头检测/抽帧 → 8 批视觉证据
         → 单次大语义合同 → 全有或全无校验
         → 任一人物/场景字段缺失即整体失败
         → 再点一次又重新消耗语义候选
```

问题边界：视觉证据已经完整，但部分有效语义候选没有按字段所有权合并；非标准 JSON 在确定性修复前可能被拒绝；失败时没有稳定展示每类合同的保留状态。

### v35 设计后的目标数据流

```text
自适应镜头证据 → 可复用视觉检查点
                → 故事 / 时间线 / 人物宠物 / 物理场景 / 品牌声音 五类合同
                → 供应商 JSON Schema/JSON Object
                → 本地确定性 JSON 修复
                → 每类合同独立保存、独立补缺、最终统一校验
                → 参考理解报告
                → 人物、宠物、场景、商品职责方案
                → 用户确认后才进入付费视觉生成
```

性能边界：大体积镜头缓存和私有语义检查点只留在服务端；页面轮询只投影五类轻量状态。前端进度模块 111 行，合同提示模块 159 行，检查点服务 629 行，`briefView.js` 545 行。

## 3. 代码和文件变更清单

### v35 结构化语义恢复

- `src/services/newStoryAd/providerAdapterRegistry.js`：结构化输出能力声明、JSON Object/Schema 参数与显式不支持时的安全降级。
- `src/services/newStoryAd/modelGateway.js`：结构化响应解析、候选诊断、说明文字/代码围栏/尾逗号/截断 JSON 的确定性修复。
- `src/services/newStoryAd/referenceSemanticContractPromptService.js`：五类行业无关合同、字段范围与证据压缩。
- `src/services/newStoryAd/referenceSemanticRecoveryService.js`：字段所有权、合同候选合并、幂等尝试账本、旧 v1 检查点迁移和 512KB 有界压缩。
- `src/services/newStoryAd/referenceVideoAnalysisService.js`：复用视觉证据、按缺失合同修复、时间线与场景依赖修复、最终统一质量门。
- `public/story-ad/views/referenceProgressCard.js`、`reference-progress.css`：五类合同进度、保留/缺失状态和重复点击锁。
- `src/services/storyAdWorkspace/projectTimingProjectionService.js`：刷新时只投影轻量合同进度。
- `scripts/test-new-story-ad-structured-output.js`、`test-new-story-ad-reference-semantic-recovery.js`、`test-new-story-ad-reference-semantic-production-replay.js`：结构化输出、极限规模和生产同型回放。

### 当日关联能力

- v29：自适应镜头证据、多人物/宠物/场景连续性、商品身份与逐镜证明合同。
- v34：180/240/300/360/480/600 秒时长、最多 120 镜、语音断点续跑、分层合成和分页渲染。
- v35：五合同结构化语义恢复与前端进度。

## 4. 提交、分支与回家拉取

关键提交：

- `b3b25fc`：600 秒长视频生产链路。
- `1f791bb`：v34 生产验证记录。
- `e61581f`：五类语义合同与结构化输出功能。
- `7f322b5`：v35 生产验证记录。
- 本交接文件提交：以拉取后的最新 `HEAD` 为准。

回家后先检查工作树，再快进拉取：

```powershell
cd <你的 VIDO 目录>
git status --short
git fetch --all --prune
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
npm install
npm run story-ad:release:build
npm run platform:upgrade:test
node src/server.js
```

访问本地：http://localhost:3007

禁止使用 `git reset --hard` 覆盖家庭电脑已有未提交内容。家庭电脑连接生产必须使用自己的 SSH 私钥授权，不能通过 Git 复制公司电脑私钥。

## 5. 本地、Git、生产三方一致性

| 核对项 | 结果 |
|---|---|
| 当前本地分支 | `codex/story-ad-v3-upgrade` |
| 核对时本地/Gitee HEAD | `7f322b5a52bc98dd6ddb28cdf04ec38ee7aa451f` |
| ahead/behind | `0/0` |
| Git 远端 | `origin=https://gitee.com/fu-xing46/newvido.git` |
| GitHub 镜像 | 本机未配置 GitHub remote，本轮未独立核对 |
| 生产 build/contract | `20260805-structured-semantic-contracts-v35 / reference-director-v3` |
| 生产发布文件 | `138/138`，missing `0`，mismatch `0` |
| release manifest SHA-256 | 本地/生产均为 `de6735752b23a4769d7f847d5c9d3d3f0ea723626dbda646a00cc7dbfd014b6c` |
| PM2 | `vido` online，核对时 PID `14436` |
| 健康与数据库 | 内网、公网均 `ok`；数据库 `ok`；SQLite `quick_check=ok` |
| 活动生成任务 | `0` |

结论：本地已提交运行代码、Gitee/Origin 与生产发布清单一致。生产采用文件级原子发布，运行代码以 138 个文件的 SHA-256 为权威，不以服务器 detached HEAD 判断。

公司电脑仍保留用户原有工作树内容：两个已跟踪交接文档删除、8 月 3/4 日日志换行修改、两个未跟踪中文交接草稿和五个未跟踪研究文档。它们没有运行代码，也没有纳入本轮提交；家庭电脑不会通过 Git 收到这些未提交内容。

## 6. 实际执行的验证

- 结构化输出、五合同恢复、人物/宠物/场景连续性、参考主链 198 项、UI 46 项、工作区入口 158 项均通过。
- 生产旧失败记录离线回放：视觉证据重新读取 `0` 批，语义模拟调用 `2` 次，最终 `5/5` 合同完成。
- 本地完整 `npm run platform:upgrade:test` 退出码 `0`，耗时 `304.2` 秒。
- 发布构建、发布完整性 4 项、V3/V6 边界、改动 JS 语法和浏览器 v35 页面加载检查通过。
- 服务器完整平台回归退出码 `0`；原子发布后 138 个文件逐一复核无差异。
- 本次交接只读复核再次确认 138/138 哈希、PM2、内外网、数据库、SQLite 和活动任务状态。
- 上述自动测试没有调用真实供应商模型或付费媒体生成。

## 7. 当前线上失败、未执行项与风险

### 已确认事实

- 用户在 v35 上执行了一次真实验收；目标分析 `ref_video_992ce771-4e45-4b37-bb70-453f2b00c215` 当前为 `failed/81%`，更新时间 `2026-08-05T09:41:21.514Z`。
- 8/8 视觉证据批次仍完整，没有再次读取视觉证据。
- 语义阶段实际尝试 `deyunai/gemini-2.5-flash`、`deyunai/gemini-2.5-pro`、`deyunai/gpt-4o`，三者均被分类为 `PROVIDER_RESPONSE_INVALID`，最终 `MODEL_ATTEMPTS_EXHAUSTED`。
- 失败后活动任务为 0；没有进入人物、场景、商品图片或视频生成。
- 生产记录中的语义检查点仍显示旧 `reference-semantic-recovery-v1`，没有留下 v35 合同完成/失败明细，这是需要修复的诊断与持久化缺口。

### 尚未确认

- 现有日志没有保存合规脱敏后的响应结构诊断，不能确认三家供应商是拒绝 `response_format`、返回空正文、返回非 JSON，还是返回 JSON 但不满足当前子合同。
- 本轮没有再次发起真实模型调用来区分上述情况，避免重复费用。
- GitHub 镜像未核对，因为本机没有配置 GitHub remote。

### 费用与数据边界

- 本次真实验收已经发生 3 个语义候选尝试，具体供应商计费状态未在记录中公开，按未知处理。
- 在取得更细诊断并补齐失败检查点持久化前，不要重复点击同一分析。
- 现有 8/8 视觉证据必须继续保留，修复不得删除、覆盖或重新付费读取。

## 8. 回家后的继续优化顺序

1. 拉取最新分支并完成 `story-ad:release:build`，确认本地启动显示 v35。
2. 通过已授权 SSH 只读保存当前 81% 失败记录到本机临时目录；禁止把记录、用户素材路径或模型正文提交 Git。
3. 在 `modelGateway`/供应商适配器中增加脱敏结构诊断：请求的结构化模式、HTTP 状态、正文是否为空、JSON 解析阶段、schema 缺失字段；不记录密钥和完整用户内容。
4. 修复失败边界：在任何模型调用前先把 v1 迁移为 v2 并持久化；即使 gateway 内部候选耗尽，也要按当前合同写入失败模型、错误类别和保留结果。
5. 新增“Flash/Pro/GPT-4o 全部 `PROVIDER_RESPONSE_INVALID`”回归，断言 8/8 证据不重读、检查点升级、失败明细可见、重复点击幂等。
6. 取得明确根因后再调整供应商结构化参数或解析路径，不要只提高候选数量或重试次数。
7. 依次执行定向回归、完整平台回归、浏览器验收；全部通过后再原子部署，并再次核对 138 个以上发布文件哈希。
8. 只有部署后状态、数据库、活动任务和旧错误隔离全部通过，才允许再进行一次真实付费验收。

### 生产只读连接

```powershell
ssh -o BatchMode=yes vido-prod
```

若家庭电脑尚未授权 SSH 公钥，应先在家庭电脑生成独立密钥并由管理员添加公钥；不要复制或提交私钥。
