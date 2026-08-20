# VIDO 剧情广告工作台 UX V100 回家续接交接

> 日期：2026-08-20  
> 当前分支：`codex/story-ad-systemic-remediation`  
> 生产版本：`20260820-workspace-ux-v100`

## 一、当日目标与用户决策

本轮按用户确认的顺序完成以下工作：

1. 保留并闭环周六的唯一 Active、旧执行链禁用和 SQLite 事务改造。
2. 将剧情广告流程调整为“对话立项 → 详细剧情与对白 → 人物 → 场景 → 线稿与分镜 → 镜头与合成”。
3. 按已确认 Demo 风格重做正式工作区，并修复首页旧界面闪现、视频悬停预览不可见。
4. 针对实际截图继续修复首屏过长、剧情难编辑、单场景卡片留白和分镜表横向溢出。
5. 完成 Git、生产和本地运行态核对，并留下家庭电脑续接入口。

## 二、修改前后的数据流

### 修改前

- 立项页把完整历史创意同时铺在对话和确认单中，输入区被推到首屏之外。
- 剧情页把所有情节点一次性展开为大表单；参考视频只形成空情节点，没有清晰的“生成完整剧情与对白”主动作。
- 场景队列只有一个卡片时仍固定窄列，右侧出现大块空白。
- 文字分镜表缺少时长列，长文本会撑宽整个页面；后端对象型错误有机会显示为 `[object Object]`。
- 历史只读步骤依赖旧 DOM 测试桩时，新增 CSS 状态直接调用 `classList.add` 会破坏兼容回归。

### 修改后

- 对话立项仍以项目合同为唯一数据源，但历史长创意先生成短摘要；用户需要时再展开全文。对话区限制高度，输入区保持在首屏内。
- 已确认的历史步骤显示明确的只读说明和“开启编辑”入口，不再让用户误以为页面损坏。
- 剧情页先展示故事概览，再用顺序表呈现情节点；默认折叠，点击“编辑”才展开六项字段。参考草稿提供“AI 补全剧情、动作与对白”主动作。
- 场景队列采用自适应列；单卡片占满可用宽度。
- 分镜表增加时长列和表格内部横向滚动，长文本截断在单元格内，页面本身不横向溢出。
- 门禁消息先做类型归一化，非法对象不再直接进入 UI；历史只读宿主的 CSS 标记改为可选能力调用，同时保留真实 DOM 上的样式效果。
- 首页旧 Hub DOM/运行入口已删除；视频卡悬停时封面淡出、静音视频播放，移出后暂停并复位。

## 三、主要代码与文件变更

- `public/story-ad/views/briefView.js`：长创意折叠、首屏输入和历史只读入口。
- `public/story-ad/views/briefDialoguePanel.js`、`briefSettingsSummary.js`：对话与确认单摘要同步。
- `public/story-ad/views/plotRoomView.js`：剧情概览、顺序表和完整剧情生成主动作。
- `public/story-ad/views/plotBeatEditor.js`：拆出的情节点编辑器，避免主模块继续膨胀。
- `public/story-ad/views/sceneWorldView.js`：场景队列自适应布局。
- `public/story-ad/views/storyboardView.js`：时长列、文本约束和分镜状态归一化。
- `public/story-ad/app.js`：历史只读视觉状态及兼容边界。
- `public/story-ad/workspace-ux.css`：本轮工作台 UX 样式；`workspace.css` 保持模块边界预算。
- `scripts/test-story-ad-workspace-ux-v95.js`：15 项本轮 UX 根因回归，当前 scope 为 v100。
- `config/story-ad-release.json`、运行时清单和 `public/story-ad/release-manifest.json`：V100 不可变发布身份。

## 四、提交记录与家庭电脑拉取

本轮关键提交：

- `42b2ea72`：重建工作台编辑体验。
- `3975471d` / `cf6fe2d8` / `aeb3a32e`：分镜门禁反馈归一化，过滤非法对象文本。
- `a48c1ba7`：拆分工作台 UX 模块。
- `af1f095c`：修复历史只读宿主兼容边界。
- `5388b21d`：V100 权威源码提交，也是生产清单的 `source_revision`。
- `9fd1e6a0`：V100 不可变发布构建提交。

家庭电脑执行：

```powershell
cd D:\VIDO
git status --short
git fetch --all --prune
git switch codex/story-ad-systemic-remediation
git pull --ff-only origin codex/story-ad-systemic-remediation
npm install
$env:PORT='3007'
node src/server.js
```

如果家庭电脑存在未提交修改，先自行提交或暂存；禁止用 `git reset --hard` 覆盖。

## 五、本地、Git、生产三方一致性

| 核对项 | 本地 | Git / Gitee | 生产 |
|---|---|---|---|
| build | `20260820-workspace-ux-v100` | V100 清单已提交 | `20260820-workspace-ux-v100` |
| release bundle | `2791ffcbe8b3fb927dfd7f3d6101b1794fe9f166375ba7304c7b8f1bb8214fb7` | 清单一致 | 同左 |
| runtime hash | `82a81feb9e58947264146bc43ee49de8c4446b91fdffdb325d7956574dd08d44c` | 清单一致 | 同左 |
| artifact | 本地发布清单对应 `aa35a14eb901aa787a823e90f785da7d4144762354ed966edbf7ede854a915a0` | 788 文件构建已提交 | 同一 artifact，788 文件逐项验证 |
| source revision | `5388b21d2f003e3180ed35347734619dfddf744e` | 远端存在 | 生产版本接口同值 |
| release commit | `9fd1e6a0e29067a1c329e5c9662a11fe52092fc8` | 推送后 0/0 | 生产以不可变清单而非 Git HEAD 判定 |

说明：交接文件会作为文档提交追加在发布提交之后；该文档提交不改变生产运行制品。

## 六、实际验证

- 本轮 UX 根因回归：15/15 通过。
- 工作台交互：32 项通过；参考资料入口：158 项通过；后端投影：57 项通过。
- 历史只读控件和历史资产动作回归均通过；首次发布正是被后者拦截并自动回滚，修复后在完整发布链路中再次通过。
- 模块边界通过：initial JS 79,865 bytes；core gzip 104,236 bytes；拆出的情节点编辑器仍受独立预算约束。
- 完整平台门禁通过：10,000 固定种子样本、400 组变形、50 并发任务，重复 permit 0，付费 provider 调用 0。
- 发布完整性、黄金合同、事务回滚、唯一 Active、旧执行链禁用、场景/人物/分镜/视频编排组合回归全部通过。
- 生产 artifact 788 个文件逐项验证；内网健康、公网健康、SQLite quick check 均为 `ok`。
- PM2 `vido`：online，PID 2541，发布后重启计数 0。
- SSH 只读审计：31 个任务、活动生成 0、活动未知计费 0、孤儿输出 0；60 条历史 unknown billing 继续隔离保留，不会自动执行。
- 生产浏览器确认 app.js 和全部剧情广告 CSS 加载 v100；首屏对话/折叠设想可见，剧情页为 11 条顺序表且具备 AI 完整补全动作，页面横向溢出为 0。

## 七、未执行项、费用与剩余风险

- 未执行真实 AI 剧情生成、图片生成或视频生成；原因是这些动作可能产生费用或覆盖业务数据，本轮只做无费用回归和只读生产核验。
- 当前生产项目仍保留真实的“人物与动物资产内容审核未通过”业务状态；本轮没有伪造为通过，也没有重跑其付费资产。
- 60 条历史 unknown billing 已全部隔离，活动 unknown billing 为 0；后续如需清理必须单独人工核账。
- 工作树中原有 `.gitattributes`、旧日志、旧交接删除和研究文档等用户修改未被本轮提交或覆盖。
- Node 的 `MODULE_TYPELESS_PACKAGE_JSON` 与 `punycode` 弃用提示仍存在，但不阻塞当前功能和发布；后续可单独做依赖治理，不能和业务优化混在一次发布里。

## 八、回家后继续优化顺序

1. 从生产同一项目只读复看对话立项、剧情、场景、分镜四页的间距和文案，记录仍显拥挤的位置。
2. 优先优化剧情自动生成后的内容质量与编辑效率；不要先扩展人物或场景生成。
3. 再对照竞品的大型镜头表，评估列宽、行高、批量编辑和资产 @ 引用；保持表格内部滚动，不能恢复整页横向溢出。
4. 最后处理历史业务状态的用户解释层；底层审计和计费隔离不得删除。
5. 每次修改继续使用新的 build_id，不得覆盖 V100；部署前先运行本轮 UX、历史只读和模块边界定向回归。
