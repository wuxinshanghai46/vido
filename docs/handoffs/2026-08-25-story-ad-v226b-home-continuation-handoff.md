# 2026-08-25 剧情广告 V226b 回家续接交接

> 交接时间：2026-08-25 18:25（Asia/Shanghai）  
> 分支：`codex/story-ad-systemic-remediation`  
> 生产权威目录：`/opt/vido/current`  
> 生产版本：`20260825-production-v226b`

## 一、当前结论

- 今天的剧情广告优化已经同步到 Gitee，并以不可变制品发布到生产。
- 本地发布闭包、Gitee 源码提交和生产运行制品三方一致；生产 843 个运行文件逐项 SHA-256 差异为 0。
- 本轮最后修复了“人物动作说明被当成外貌提示词、人物详细提示词缺失、有效模型响应被误判无效”的根因。
- 生产目标任务 `b83fa67c-244a-4869-b3cc-df282fad5c59` 已完成一次只生成文字、不生成图片的受控人物方案验证：陈默的外貌、服装、发妆、禁止项均完整，质量规则通过；动作说明独立保存在 `performanceText`。
- 旧的 `MODEL_ATTEMPTS_EXHAUSTED` 失败状态已经清除，任务恢复为 `done / blueprint_done`。人物图片尚未生成，回家后可在页面核对文字方案，再决定是否触发图片生成。

## 二、今天完成的主要优化

### 1. 参考视频与模型容灾（V205–V207a）

- 恢复 `new_story_ad.assist` 的微众 `gpt-5.6-terra` 路由，避免发布迁移再次覆盖。
- 参考视觉加入跨供应商候选；Apismile 真实探针仍返回 429，因此没有伪装成首选可用模型。
- 429 按供应商返回等待时间或默认冷却处理，并按端点、账号、凭证共享冷却。
- 同一失败域增加单飞提交，关闭并发批次在首个 429 建立冷却前重复提交的窗口。
- 失败/取消后恢复输入、跳过、重试和停止动作；“手动编辑”缩为草稿旁紧凑按钮。

### 2. 进度与对话收口（V208–V211）

- 参考链接轮询立即启动，实时订阅与服务器终态成为权威，解决长时间错误显示 3%。
- 未知下载长度显示已读取 MB 心跳。
- “我觉得可以”等自然确认会消费上一轮方案；缺项继续问，齐全后进入脚本确认。
- 商业主题全部完成后确定性收口，模型异常恢复不再回到第一题或重复提问。

### 3. 背景人物、运行进程和旧代码退役（V212–V213）

- 背景出镜人物统一为 `single / 1`，不再被误判为 0 人。
- 蓝图、上下文、质量门禁、资产方案、分镜和工作区统一沿用同一人物合同。
- 视频画布 worker 监听父进程断开并优雅退出；历史 151 个孤儿 worker 已在无活动任务时清理。
- 旧 `/opt/vido/app` 已退役为拒绝启动壳；正常运行唯一权威为 `/opt/vido/current`。

### 4. 人物身份、声音语义与剧情页 UI（V214–V224）

- 未赋名背景人物使用中性标签；蓝图一旦赋予稳定姓名，人物、动作、对白和角色档案继续沿用该姓名。
- 修复“通过”等语法词被误识别为中文姓名的问题。
- 剧情页标题、按钮和编辑入口缩小并优化布局。
- 声音列明确为 `旁白：内容` 或 `人物名：对白`；对白未选择人物时禁止保存。
- 旁白限定为客观介绍、说明或总结；人物感受、判断、提问不得伪装成旁白。

### 5. 纯旁白与年龄权威（V225）

- 当前项目使用纯旁白权威模式：人物陈默只出镜执行动作，不开口；TTS 使用 narrator，视频不要求人物口型。
- 蓝图推断年龄标记为 `blueprint_inference`，不再伪装成用户明确年龄。
- “30岁左右”及其他合理年龄/年龄区间可由蓝图推断进入人物方案；用户明确填写仍按确切年龄或规范区间校验。

### 6. 人物详细提示词根修（V226b）

修改前的数据流：

`背景人物 description（动作职责） → 被回退为 appearanceText → UI 显示成外貌 → 图片合同缺少真实外貌/服装/发妆/禁止项 → 模型有效内容还可能因嵌套造型字段未提升而被误判无效`

修改后的数据流：

`description/performanceText（动作）` 与 `appearanceText / wardrobeText / hairMakeupText / negativeText（视觉身份）` 全链路分离；独立人物规划器只补齐四个视觉字段，先规范化模型响应并提升首套造型字段，再执行详细质量校验；四项不完整时禁止进入图片生成。

同时完成：

- `subjectProfileTextService`、上下文、人物投影、辅助补齐、身份合同均不再用通用 `description` 冒充外貌。
- 保存和读取链路显式传递 `performanceText`、`continuityText`。
- UI 单列展示“表演与动作（不属于外貌提示词）”和“人物跨镜一致性要求”。
- 人物模型请求改为结构化 JSON；原始响应先规范化再做业务质量检查。
- 首套造型中的服装、发妆、禁止项会提升到人物级权威字段。
- 旧人物方案按钮和旧测试合同继续保持退役，不允许恢复旧链路。

## 三、生产目标任务验证

任务：`b83fa67c-244a-4869-b3cc-df282fad5c59`

- 生产操作前已备份任务数据到服务器私有备份目录；备份未写入 Git，未包含凭证。
- 受控调用只执行 `storyAdService.updatePersonPlan`，没有调用人物图片路由。
- 新增文字模型记录：1；提供方/模型：Apismile `gpt-5.5`；状态：success。
- 新增图片模型调用：0。
- 人物：陈默；年龄：30岁；角色：背景出镜人物。
- 质量结果：通过，缺失字段 0。
- 字段长度：外貌 89、服装 72、发妆 64、禁止项 96。
- 动作说明与外貌内容不相同，`appearance_contains_performance_only=false`。
- 旧失败检查点已删除，任务顶层错误码已清空。

## 四、本地 / Git / 生产三方核对

| 核对项 | 本地 / Gitee | 生产 | 结论 |
|---|---|---|---|
| 分支 | `codex/story-ad-systemic-remediation` | 发布清单记录同分支 | 一致 |
| 代码/发布提交 | `50a1ff6727ea17ab9c3efa812708e3c25d474c0a` | 制品来源提交 `19a5b6ae02806f6bcb926473387c13187fc2fd5a`，发布提交为其生成清单后继 | 合同一致 |
| ahead / behind | `0 / 0`（交接文件提交前） | 不适用 | Gitee 已同步 |
| build | `20260825-production-v226b` | `20260825-production-v226b` | 一致 |
| artifact | `c36d2954b131f8ca594391f0635830084114a44e958207daebd5ffb392291f0b` | 同值 | 一致 |
| source tree | `e13c6c23734aa9ee6e068844b7908beed50f33d5` | 同值 | 一致 |
| runtime hash | `5b90338a6a5115e8897f0947023e41f31109299c4ac667d07dbfbcc83565a3538` | 同值 | 一致 |
| release bundle | `0abd2dcdb0b22a10722a298b05968fb21b98747a1c7131c41d17e073e11b0edd` | 同值 | 一致 |
| 运行文件 | 843 个清单文件 | 843 个，SHA-256 差异 0 | 一致 |

说明：本地工作树仍保留用户原有的无关修改、删除和未跟踪文件，未纳入本轮提交。这里的“一致”指 Git 跟踪的 V226b 发布闭包与生产不可变制品一致，不代表工作树全局干净。

## 五、实际执行的验证

### 人物提示词定向回归

- `test-story-ad-person-prompt-separation-v226.js`：19 项通过，付费模型调用 0。
- `test-new-story-ad-person-assist-completeness.js`：通过。
- `test-story-ad-independent-person-plan-v197.js`：通过。
- `test-story-ad-background-performer-flow-v212.js`：通过，真实模型调用 0。
- `test-story-ad-person-age-save-v132.js`：通过。
- `test-story-ad-workspace-v6-ui-regressions.js`：通过。
- `test-new-story-ad-subject-assets.js`：通过。
- `test-new-story-ad-generation-spec-completion.js`：通过。
- `test-new-story-ad-current-input-authority.js`：通过。
- `test-story-ad-asset-plan-section-recovery-platform.js`：通过。
- `test-story-ad-product-entry-taxonomy-v64.js`：通过。
- `test-story-ad-production-editor-v166.js`：36 项通过，模型/媒体调用 0。
- `test-story-ad-person-plan-submit-ui-v52.js`：并发提交 1、取消 0、失败恢复通过。

### 影响范围发布门禁

- `story_content`：通过，19.158 秒。
- `asset_plan`：通过，17.348 秒。
- `workspace_ui`：通过，15.102 秒。
- `release_core`：通过，35.550 秒。
- 发布器再次核对时命中上述 4 组精确缓存；没有运行跨版本全平台回归。

### 部署后核对

- 不可变发布：844 个上传/审计对象全部验签（843 个运行文件 + 运行清单）。
- PM2：`vido` online，restart 0，cwd 指向 V226b 不可变发布目录。
- 公网 `http://43.98.167.151:4600/api/health`：`ok`。
- 发布控制：`allowed=true`。
- SQLite `PRAGMA quick_check`：`ok`。
- 活动生成：0；活动未知计费：0；历史未知计费：62，继续隔离。
- 数据孤儿：0。

### 明确未执行

- 未执行全平台或跨版本完整回归：家庭电脑规则只允许本功能影响范围测试。
- 两次误触发的完整发布门禁均在跨版本门禁开始前主动停止，不能算作通过证据；最终只采用上述 4 组定向门禁。
- 未生成或验证人物图片、视频、真 360 全景；本轮人物生产验证只生成文字方案，避免重复付费。

## 六、回家后的拉取与续接步骤

```powershell
git status --short
git fetch --all --prune
git switch codex/story-ad-systemic-remediation
git pull --ff-only origin codex/story-ad-systemic-remediation
npm install
node src/server.js
```

访问：`http://localhost:3007`

建议续接顺序：

1. 强制刷新生产页面，打开上述目标任务，先核对陈默的四组详细提示词及独立动作字段。
2. 确认文字人物方案符合要求后，再点击人物图片生成；此前没有替用户生成图片。
3. 图片生成时重点检查不同年龄/年龄区间、人物四视图一致性、服装与饰品固定、人物闭口和旁白权威。
4. 若继续开发，只运行涉及人物方案、人物资产、工作区投影、旁白权威的定向回归，不在家庭电脑运行全平台回归。

## 七、剩余限制与风险

- 文本人物规划器已在生产真实成功一次，但外部图片供应商尚未在 V226b 下真实调用；图片质量和供应商可用性仍需下一轮用户明确触发后验证。
- 真 360 全景需要独立 2:1 等距柱状投影、水平环缝连续与几何一致能力，当前仍未接入，普通图片模型不能冒充。
- 62 条历史未知计费记录保持隔离，不属于活动阻塞项；不得自动重试。
- 本轮没有改动或清理用户工作树中的无关历史文件。
