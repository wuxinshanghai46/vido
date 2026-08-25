# 2026-08-26 剧情广告 V229a 公司续接交接

> 交接时间：2026-08-26 02:25（Asia/Shanghai）  
> 分支：`codex/story-ad-systemic-remediation`  
> 生产权威目录：`/opt/vido/current`  
> 生产版本：`20260826-production-v229a`

## 一、当前结论

- 今天的人物提示词、人物生成交互、实际生成参数显示，以及“人物生成到 99% 后无图片”的根因修复均已同步到 Gitee 并发布生产。
- 本地运行清单、Gitee 源码和生产不可变制品闭包一致：生产清单 846 个运行文件缺失 0、SHA-256 差异 0。
- 目标任务 `b83fa67c-244a-4869-b3cc-df282fad5c59` 当前人物为陈默，完整人物提示词已在剧情完成后形成，随身道具为“无”；档案大图、造型图和原子素材尚未生成。
- 用户此前真实点击生成时，后台误判“图片已齐全”，只调用了 1 次人物文字模型，图片模型调用为 0，页面停在 99%。V229a 已修复这一错误路径；生产只读核对确认陈默现在会进入待生图目标。
- 本轮没有代用户再次点击生图，避免产生 6 组图片请求及相应费用。公司电脑可先拉取、打开页面核对文字和交互，再由用户决定是否付费生图。

## 二、当日目标与用户决策

用户明确要求：

1. 人物提示词交互接近竞品的单一完整提示词体验：剧情生成完成后内容已经写好，点击人物即可查看和修改。
2. 随身道具必须进入同一提示词；没有道具时明确显示“随身道具：无”，不保留独立参考上传或独立道具生成流程。
3. 删除与人物生成无关的空间/机位字段，不让用户理解多套分散表单。
4. 底部模型、比例、素材数量等必须展示 VIDO 的真实合同，不能照抄竞品参数。
5. 超管保留可核对的技术失败原因；不能用泛化提示掩盖服务端错误。
6. 发现 99% 无图片问题后，先完成根因修复、发布和验证，再做三方一致性及交接。

## 三、修改前后的完整数据流

### 1. 人物提示词与编辑

修改前：

`剧情人物结构化字段 → 多段分散表单/独立道具与参考入口 → 用户看不到最终生图提示词 → 保存与实际生成消费内容不容易核对`

修改后：

`剧情蓝图完成 → 编译并持久化唯一权威人物生成提示词 → 人物卡点击打开单一可编辑提示词 → 保存后以服务端规范化回读为准 → 人物图片生成直接消费同一提示词`

提示词固定包含：名称、描述、服装、发型妆造、特征、随身道具、构图规范、视觉限制、视觉风格。无道具写为“随身道具：无”，有道具则写入实际名称和外观用途。多套造型保持独立，不让旧服装或表演动作污染当前外貌。

### 2. 99% 无图片根因

修改前：

`点击生成人物 → 人物文字方案成功 → 路由读取普通 publicTaskBundle（不含 assets.people） → subject_targets 被错误算成空数组 → 后台误判人物图片已齐全 → 图片模型调用 0 → 任务标记成功但 generation_progress 留在 running/99%`

修改后：

`点击生成人物 → 从 projectBundleService 读取 summary + assets 权威投影 → 逐个人物检查档案图/造型图是否真实存在 → 缺图或本地 404 资源进入 subject_targets → 有效已完成资产继续复用 → 图片生成任务成功后持久化 done/complete/100%`

历史已经成功但仍保存为 99% 的记录，在只读任务投影时规范为 `done / complete / 100%`，不覆盖历史任务内容，也不会自动重试或重复付费。

## 四、代码和文件变更

### 人物提示词与真实交互（V228–V228f）

- 建立并持久化单一权威完整人物提示词；人物详情改为点击后直接查看和编辑。
- 随身道具合并到最终提示词，无道具显示“无”，不再使用独立上传参考和独立生成表单。
- 保存后使用服务端规范化回读，人物生图消费同一提示词；多造型提示词隔离。
- 修复负向约束格式差异导致已付费成功素材被无效的问题；语义未变继续复用，真实服装/饰品变化仍正确失效。
- 人物工具栏按 VIDO 实际合同显示：GPT Image 2、完整人物档案、`1:1 / 3:2 / 3:4`、6 组生图、22 项素材、3 条可用通道。
- `mediaAdapter` 对横向人物图使用真实支持的 3:2 映射，不显示或承诺竞品的 2:1、高画质、2K、1 张伪参数。

### 99% 无图片根修（V229a）

- `src/routes/newStoryAd/personPlanGenerationRoute.js`
  - 改用 `projectBundleService.buildProjectBundle(..., { sections: 'summary,assets' })` 取得真实人物资产投影。
  - 空人物画像安全处理；使用本地资产存在性检查拒绝失效的本地 404 URL。
  - 缺图人物成为生成目标，有效完整人物资产继续复用。
- `src/services/newStoryAd/jobService.js`
  - 成功后台任务将同一 generation ID 的进度持久化为 `done / complete / 100%`，补齐完成数量和时间。
- `src/services/newStoryAd/taskViewService.js`
  - 历史已终态但停留 99% 的进度在只读投影中收口到 100%。
- 新增/更新回归测试：
  - `scripts/test-story-ad-person-plan-production-target-v229.js`
  - `scripts/test-story-ad-person-plan-unified-generation-v179.js`
  - `scripts/test-new-story-ad-generation-unit-job-integration.js`
  - `scripts/test-story-ad-character-library-v183.js`

## 五、提交记录与目标分支

目标分支：`codex/story-ad-systemic-remediation`  
目标远端：`origin`（Gitee：`https://gitee.com/fu-xing46/newvido.git`）

今天人物提示词主线关键提交：

- `885ff88c` `fix(story-ad): unify person generation prompt`
- `7e2f2a7e` `refactor(story-ad): isolate person prop projection`
- `df920020` `fix(story-ad): preserve paid assets on negative rebase`
- `b9dfc50f` `fix(story-ad): normalize prompt resume semantics`
- `654282b3` `fix(story-ad): show actual person generation contract`
- `20a930cd` `fix(story-ad): generate missing person assets`
- `b7124a68` `fix(story-ad): terminalize historical generation progress`
- `3ed2ca83` `build(release): publish story-ad v229a manifest`

`3ed2ca83` 是交接文档生成前的代码/发布清单 HEAD；本交接文件作为其后继文档提交推送，不改变 V229a 运行闭包。

## 六、本地 / Git / 生产三方一致性

| 核对项 | 本地 / Gitee | 生产 | 结论 |
|---|---|---|---|
| 分支 | `codex/story-ad-systemic-remediation` | 发布清单记录同分支 | 一致 |
| 代码/发布清单 HEAD | `3ed2ca837ed48169059bccdbd0e5fd4b40a0ae61`（交接提交前） | 制品来源提交 `e495bc00b6eff58e89ef39faa06a85f54922fa2e`；后继提交只生成清单/文档 | 运行代码一致 |
| ahead / behind | 交接文件首次提交并推送后复核 `0 / 0`；最终以该分支远端 HEAD 为准 | 不适用 | Gitee 已同步 |
| build | `20260826-production-v229a` | `20260826-production-v229a` | 一致 |
| artifact | `d627059908703fdd6a3d3e490edcab0a8086eec7b258718a84ce901befd77cda` | 同值 | 一致 |
| source tree | `87aa41684a88a0a7abdf9adb53ea6519dc90e3ad` | 同值 | 一致 |
| runtime hash | `a25dba26a77f3352155b3839548ff2e74cb9240fc40079cc4a92b3a5e67520a0` | 同值 | 一致 |
| release bundle | `b3a731ce0e9407fdc73589dd46b16760a8f09dca95649e4933e2d83ae7c37da6` | 同值 | 一致 |
| 运行清单 SHA-256 | `13fa9215a94b897602d8eb4bf37bfdd5685631650033f5e6e6a96ffff581b416` | 同值 | 一致 |
| 运行文件 | 清单 846 个文件 | 缺失 0、SHA-256 差异 0 | 一致 |

生产通过不可变制品运行，不要求生产目录 Git HEAD 与文档提交相同；权威判断是 source tree、runtime hash、release bundle 和逐文件哈希。本地工作树另有 5 个用户原有未跟踪文件，未修改、未纳入提交，也不属于 V229a 发布闭包。

## 七、实际执行的验证

### 静态与定向回归

- 所有本轮修改 JavaScript 文件 `node --check`：通过。
- `test-story-ad-person-plan-production-target-v229.js`：6 项通过；缺图人物目标 1；失效本地 404 资产被拒绝；完整资产继续复用；模型/媒体调用 0。
- `test-story-ad-person-plan-unified-generation-v179.js`：17 项通过；模型/媒体调用 0。
- `test-new-story-ad-generation-unit-job-integration.js`：通过；覆盖新任务及历史任务 99% → 100%。
- `test-story-ad-person-prompt-v228.js`：46 项通过；覆盖道具为空/存在、旧服装阻断、负向约束重基、多造型、单提示词 UI 和真实运行合同。
- `test-story-ad-production-editor-v166.js`：36 项通过；模型/媒体调用 0。
- 人物资产、工作区投影、工作区 UI、失败恢复、恢复预检、发布门禁规划、工作区边界及人物档案边界相关回归：全部通过。
- 视觉资产失败恢复定向回归：通过；核心人物模拟调用 6，详情 2，授权重试 1，未知计费重新提交 0（均为测试替身，不是生产付费调用）。

### 影响范围发布门禁

- V229 初次发布门禁：`systemic` 27.163 秒、`workspace_ui` 18.436 秒、`release_core` 85.665 秒；部署时 `asset_plan` 27.619 秒，全部通过。
- V229a 最终发布门禁：`systemic` 29.769 秒、`workspace_ui` 18.298 秒、`release_core` 86.922 秒，全部通过。
- 家庭电脑按既定规则未运行 `platform_full` 或跨版本全平台回归。

### 部署后只读核对

- `/opt/vido/current` 指向不可变目录 `/opt/vido/releases/d627059908703fdd6a3d3e490edcab0a8086eec7b258718a84ce901befd77cda`。
- PM2 `vido`：online，PID 8736，restart 0，cwd 为同一不可变目录。
- 内网和公网健康：HTTP 200，状态 `ok`；公网版本接口返回 V229a 且发布控制 `allowed=true / active`。
- SQLite `PRAGMA quick_check`：`ok`。
- 生产数据审计：任务 33、活动生成 0、活动未知计费 0、孤儿输出任务 0；历史未知计费 62 条继续隔离。
- 生产运行清单：846 个文件，缺失 0、哈希差异 0。
- 目标任务只读投影：原始旧进度仍是 running/99%，当前权威投影为 done/complete/100%；陈默 `subject_targets=1`，人物图片模型历史调用 0。
- 修复验证及部署过程真实模型调用 0、真实媒体调用 0；仅用户此前失败点击产生 1 次已确认计费的人物文字模型调用。

## 八、公司电脑拉取与续接

先确认公司电脑没有未提交工作，再执行：

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

1. 强制刷新页面，打开任务 `b83fa67c-244a-4869-b3cc-df282fad5c59`，点击陈默，核对单一完整提示词、服装及“随身道具：无”。
2. 先确认页面显示真实合同：GPT Image 2、完整人物档案、1:1/3:2/3:4、6 组生图、22 项素材、3 条可用通道。
3. 只有接受实际供应商费用后再点击“保存并生成人物”；这一步会真正发起图片生成，不能作为只读检查执行。
4. 生成后重点核对档案大图、每套造型图、原子素材的数量和可访问性，并在超管技术详情中记录供应商原始失败码（如有）。
5. 若继续优化，先保留真实失败证据，再沿“请求 → 提交 → 轮询 → 下载/持久化 → 资产投影 → UI”全链路定位，不在末端叠加兜底。

## 九、未执行项、限制与风险

- 未代用户执行修复后的真实付费人物图片生成，因此外部供应商实际出图质量、耗时和失败返回尚未在 V229a 生产真实验证。
- 用户截图中的浏览器 404 没有包含请求 URL，Nginx 只读日志也未找到可归属的应用 404；不能把该 404 的具体资源写成已确认结论。已确认并修复的是同一次操作中“图片调用为 0、任务错误成功、进度停 99%”的服务端根因。
- 未人为制造一次真实供应商失败，所以超管详细错误投影本轮仅由既有回归覆盖，没有新增真实失败样本。
- 未执行全平台或跨版本完整回归：当前家庭电脑规则要求只执行本任务影响范围的静态、定向、失败恢复和必要健康检查。
- 历史未知计费记录 62 条保持隔离，活动未知计费为 0；不得自动重试。
- 本轮没有覆盖或清理用户工作树中的 5 个无关未跟踪文件。
