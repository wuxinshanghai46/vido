# VIDO 剧情广告晚间更新与公司续作交接（2026-07-28 → 2026-07-29）

> 交接时间：2026-07-28（Asia/Shanghai）
> 目标分支：`codex/story-ad-v3-upgrade`
> 最终功能修复基线：`5d3c6f1`
> 用途：2026-07-29 到公司后拉取最新代码，继续优化剧情广告流程

## 一、交接结论

今晚完成了剧情广告“资产确认后再写剧情”的流程重排、剧情呈现方式说明、剧情与表演 AI 辅写、前后端状态门禁以及顶部下一步按钮的权威状态修复。

交接前已完成两轮三方核对：

- 本地与 `origin/codex/story-ad-v3-upgrade` 指向同一提交；
- 本地 ahead/behind 为 `0 / 0`；
- 本地 tracked 工作区无未提交修改；
- 生产按发布清单逐文件核对 SHA-256；
- PM2 `vido` 在线；
- 生产数据库状态正常；
- 生产内网与公网健康接口均为 HTTP 200；
- 活动剧情广告生成任务为 0；
- 核对过程模型或媒体调用为 0；
- 核对过程任务写入为 0。

生产服务器仓库仍是历史 detached HEAD，项目采用文件级发布，因此不能用生产服务器的 Git 提交号直接判断运行代码是否一致。三方一致性的有效标准是：

```text
本地 HEAD = origin 分支 HEAD
且
生产发布清单 100/100 个文件 SHA-256 = 本地对应文件
```

## 二、今晚确定的正确业务流程

### 2.1 修改前

原页面把“剧情与表演要求”“品牌 Logo 后期落版”等内容放在场景资产生成之前，用户还没有看到并确认人物、主体和场景形象，就要先决定人物怎么演，流程顺序不合理。

### 2.2 修改后

```text
广告需求
→ 生成人物 / 主体 / 完整场景形象
→ 所有人物、主体、场景资产通过并锁定
→ 点击顶部“下一步：编写剧情与表演”
→ 选择剧情呈现方式
→ 手写或使用 AI 辅写“剧情与表演要求”
→ 可选：配置已授权品牌 Logo 后期落版
→ 确认剧情设置并生成剧本
→ 分镜、关键帧、视频与合成
```

关键边界：

- 第一步负责“做什么广告、需要什么人物/主体/场景”；
- 人物、主体、场景生成并确认后，才决定“人物怎么演、剧情怎么推进”；
- 生成模型不负责生成或浮现品牌 Logo；
- 已授权 Logo 作为后期合成素材叠加；
- 资产或剧情设置发生变化后，旧确认不能继续复用。

## 三、今晚完成的功能

### 3.1 “视频基础信息”改为“剧情呈现方式”

这个设置不是装饰字段，也不是图片/视频 QA 开关。它会进入剧本生成上下文，用于决定叙事和表演组织方式。

修改后名称为“剧情呈现方式”，放在资产确认之后的剧情设置步骤中，避免用户误解其用途。

### 3.2 “剧情与表演要求”新增独立 AI 辅写

用户既可以手写，也可以点击 AI 辅写。AI 辅写不是自由扩写，它必须服从已确认资产：

- 不新增未确认人物；
- 不新增未确认场景；
- 不新增未确认道具；
- 不篡改商品事实；
- 不覆盖人物身份和场景稳定 ID；
- 与无人广告、人物数量、场景数量等约束冲突时，在模型调用前阻断。

该动作属于真实文本模型调用。测试时点击一次即可，不要连续重复点击。

### 3.3 前后端统一剧情设置门禁

新增前端剧情设置模块和后端 `storySetupService`。完整状态流为：

```text
人物/主体/场景资产状态
→ 资产就绪判断
→ 进入剧情设置
→ 剧情设置确认
→ story_setup_confirmed
→ 允许生成剧本包
```

以下变化会使原确认失效：

- 商品或主体来源变化；
- 人物资产变化；
- 场景资产变化；
- 剧情呈现方式变化；
- 剧情与表演要求变化；
- Logo 落版配置变化。

后端不只依赖前端按钮状态。未满足 `story_setup_confirmed` 时，剧本、分镜和脚本包入口都会被阻断，避免绕过页面直接生成。

### 3.4 顶部“下一步”按钮

“下一步：编写剧情与表演”已移动到步骤 2 标题栏右上角。页面底部只保留资产准备状态摘要，不再重复放操作按钮。

按钮只有在人物、主体和全部场景资产均完成确认后才可用。不可用时显示灰色；可用时使用与系统主要下一步按钮相同的渐变、文字颜色、阴影和鼠标指针。

### 3.5 按钮样式问题的真实根因与修复

第一次样式修改只改到了兼容层 `new-story-ad-legacy-ui.js`。生产运行时，权威按钮状态模块 `public/js/new-story-ad/button-state.js` 随后又覆盖了 `disabled` 和样式状态，因此页面仍显示灰色。

这说明末端 CSS 不是根因，真正的数据流是：

```text
资产状态
→ readiness
→ storySetupConfirmed / busy
→ button-state.js 权威计算
→ disabled / hidden / className
→ CSS 渲染
```

最终修复：

- 在 `button-state.js` 中统一计算按钮可用状态；
- 接入 `readiness`、`storySetupConfirmed` 和 `busy`；
- 统一设置 `is-next` 主按钮类；
- 把 `button-state.js` 纳入生产发布清单；
- 更新页面缓存版本，避免浏览器继续使用旧模块。

## 四、今晚发生过但已撤回的未通过版本

在最终修复前，曾有一个版本只修改兼容 UI 层。它通过了局部代码检查，但生产浏览器验证仍显示灰色按钮，因此该版本的“已完成”结论已经撤回，不能作为明天的测试基线。

最终有效基线是功能修复提交 `5d3c6f1` 及其后的交接/发布清单提交。明天只拉取目标分支最新 HEAD，不要检出中间提交。

## 五、相关代码位置

### 前端

- `public/digital-human.html`
  - 页面步骤顺序、顶部按钮、剧情设置区和缓存版本
- `public/css/digital-human-wizard.css`
  - 剧情设置、顶部操作区和主按钮视觉状态
- `public/js/new-story-ad/bootstrap.js`
  - 页面模块装配与状态刷新
- `public/js/new-story-ad/button-state.js`
  - 按钮权威启用/禁用/隐藏/样式状态
- `public/js/new-story-ad/story-setup.js`
  - 进入剧情设置、AI 辅写、确认与交互逻辑
- `public/js/new-story-ad/state-sync.js`
  - 剧情设置状态同步与恢复
- `public/js/new-story-ad/brand-overlay.js`
  - 已授权 Logo 后期叠加配置

### 后端

- `src/services/newStoryAd/storySetupService.js`
  - 资产就绪、确认指纹、失效和服务端门禁
- `src/services/newStoryAd/assistCreativeDirectionService.js`
  - 剧情与表演 AI 辅写及冲突约束
- `src/services/newStoryAd/contextBuilder.js`
  - 剧情设置进入生成上下文
- `src/services/newStoryAd/storyAdService.js`
  - 剧本包生成入口和状态验证
- `src/services/newStoryAd/revisionService.js`
  - 修改后的确认失效和下游影响

### 测试与发布

- `scripts/test-new-story-ad-story-setup-flow.js`
- `scripts/test-new-story-ad-scene-lock-ui-binding.js`
- `scripts/test-new-story-ad-compose-gate-autosave.js`
- `scripts/test-new-story-ad-storyboard-ui.js`
- `scripts/audit-new-story-ad-content-lineage-release.js`
- `scripts/deploy-new-story-ad-subject-scene-recovery.js`

## 六、与此前“等待进度条、预算耗尽、Logo 权利”问题的关系

此前同一轮升级还完成了以下链路修复：

- 点击生成后立即进入可见进度状态，不再等后端长步骤完成后才出现；
- 结构修复沿用主模型路由，不再误走不可用的候选模型；
- 主剧本初稿成功后保存检查点，结构修复失败重试时复用初稿，不重复支付主初稿费用；
- “实际尝试 3/31”明确区分候选池数量与真实调用次数；
- 品牌 Logo 从生成提示词中移出，改为上传已授权素材并在最终合成阶段叠加。

Logo 权利问题不是场景配置故障，也不应靠提示词要求图片/视频模型生成 Logo。正确路径是：

```text
上传已授权 Logo
→ 勾选授权确认
→ 设置位置、宽度、结尾展示时长
→ 成片阶段 FFmpeg 后期叠加
```

## 七、已执行验证

### 7.1 本地回归

执行：

```powershell
npm run story-ad:v3:test
```

最终结果：全部注册回归通过，命令退出码 0。

回归过程中曾发现 `test-new-story-ad-scene-lock-ui-binding.js` 的历史测试夹具仍假设“恢复任务无需确认剧情设置即可生成分镜”。没有跳过测试，而是把夹具更新为显式提供“资产就绪 + 剧情设置已确认”，随后定向回归和完整回归均通过。

### 7.2 生产浏览器状态

最终权威状态修复后，生产按钮计算样式为：

- `disabled: false`
- `hidden: false`
- class 包含 `is-next`
- 背景为青绿渐变
- 文字为深色
- `cursor: pointer`
- 主按钮阴影已生效

浏览器自动化移动鼠标到按钮的动作发生超时，因此没有保留独立 hover 截图。代码已统一使用其他主按钮相同的 `is-next` 样式路径，但明天仍建议人工悬停确认一次视觉反馈。

### 7.3 生产只读核对

交接前核对标准：

- `status: PASS`
- 本地 HEAD 与 origin HEAD 一致
- `ahead_behind: 0 0`
- tracked 工作区无修改
- `release_files_checked: 100`
- `release_hash_mismatches: []`
- `active_generation_count: 0`
- PM2 `vido`: `online`
- 内网与公网健康：HTTP 200
- 数据库：`ok`
- 模型或媒体调用：0
- 任务写入：0

## 八、明天到公司的拉取步骤

在项目目录执行：

```powershell
git fetch origin
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
git status --short
git rev-list --left-right --count HEAD...origin/codex/story-ad-v3-upgrade
npm install
npm run story-ad:v3:test
$env:PORT = '3007'
node src/server.js
```

正确结果：

- `git pull --ff-only` 成功；
- ahead/behind 输出 `0 0`；
- tracked 文件无修改；
- 完整回归退出码为 0；
- 本地访问 `http://localhost:3007`。

注意：

- 不要使用 `git reset --hard`；
- 不要删除本地未跟踪文件；
- 若公司电脑存在自己的未提交修改，先保存或提交，再执行拉取；
- 只拉取目标分支最新 HEAD，不要切换到今晚的中间提交。

## 九、明天建议的人工验收顺序

1. 启动本地服务并用 `Ctrl+F5` 强制刷新。
2. 打开一个人物、主体和场景资产都已锁定的剧情广告任务。
3. 确认顶部右侧显示“下一步：编写剧情与表演”，且可用时为统一主按钮样式。
4. 人工悬停按钮，确认指针、渐变和阴影反馈一致。
5. 只点击一次“下一步”，确认进入剧情设置，而不是直接生成剧本。
6. 检查“剧情呈现方式”的名称和说明是否清楚。
7. 手写一段剧情与表演要求，确认保存后状态正确。
8. 如需验证 AI 辅写，只点击一次，并记录调用结果或支持编号。
9. 如有授权 Logo，上传素材、勾选授权并配置落版；没有则跳过。
10. 点击确认并生成剧本一次，检查剧本是否只使用已确认人物、主体和场景。
11. 修改任一人物、主体、场景或剧情要求，确认旧剧情设置状态立即失效。

静态页面、按钮状态、保存与门禁检查不会产生模型费用。AI 辅写和生成剧本会产生真实文本模型调用；图片、视频与成片生成可能产生更高费用。不要连续重复点击。

## 十、明天继续优化时优先观察

- 老任务恢复后，顶部按钮是否立即从真实资产状态得到正确结果；
- 人物或场景变化后，剧情设置确认是否可靠失效；
- AI 辅写是否严格引用已确认资产，不引入新角色、新地点或虚构商品信息；
- 模型供应商失败时是否显示真实尝试数，并复用已保存的成功初稿；
- Logo 后期落版是否只在授权确认后进入最终合成；
- 浏览器 hover/active/focus 视觉是否与其他主要按钮完全一致。

## 十一、未执行项与剩余风险

未执行项：

- 本轮代码验收没有发起真实 AI 辅写或剧本生成，避免重复付费和污染任务；
- 没有发起图片、视频或最终合成任务；
- 自动化 hover 动作超时，没有保留 hover 截图。

剩余风险：

- AI 辅写的文案质量和供应商实时可用性仍需一次受控人工验收；
- 真实 Logo 合成效果需要准备已授权素材后验证；
- 生产采用文件级发布，今后仍应使用发布清单哈希审计，不能仅看服务器 Git 元数据。

## 十二、只读三方核对命令

```powershell
$env:VIDO_DEPLOY_HOST = '服务器地址'
$env:VIDO_DEPLOY_PASSWORD = '从安全渠道取得'
node scripts/audit-new-story-ad-content-lineage-release.js
```

该脚本只读，不调用模型或媒体服务，不写任务数据。

## 十三、安全说明

本文不包含服务器密码、数据库密码、API Key、Token、Cookie 或供应商凭证。凭证继续只从安全渠道或环境变量读取。

## 十四、10:58 剧情设置六步流程修正

- 最终提交：`6dada7043aa63a6faf07b4c0e1ac962e8e6b76a7`
- 分支：`codex/story-ad-v3-upgrade`
- 流程调整为：广告需求 → 场景配置 → 剧情与表演 → 剧本生成 → 分镜生成 → 广告合成。
- “剧情与表演”是独立第 3 步；进入该页不会提前确认，点击“生成剧本”时才确认并进入第 4 步。
- 第 2 步“下一步：编写剧情与表演”默认保持中性样式，仅在鼠标指向或键盘聚焦时高亮。
- 已删除“生成剧本前最后一步”，主操作只显示“生成剧本”。
- AI 辅写继续携带第一步广告需求、已确认人物、宠物、主体和场景；已确认宠物资产不会再被误判为未确认人物。
- AI 辅写输出按剧情走向、情绪与表演、关键动作、台词、节奏、结尾和禁止项使用真实换行与空行自动分段。
- 浏览器缓存版本：`20260728-story-step-v41`。
- 本地及生产完整剧情广告回归均通过；生产发布清单 105 个文件 SHA-256 无差异，运行时审计 34/34 一致。
- 生产 PM2 online，内网与公网健康检查均为 HTTP 200，数据库状态 ok。
- 本轮验收未触发文本模型、图片模型、视频模型或任务写入。
- 最新生产备份：`/opt/vido/backups/new-story-ad-subject-scene-recovery-20260728025717`。
