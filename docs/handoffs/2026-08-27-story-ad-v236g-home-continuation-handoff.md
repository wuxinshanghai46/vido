# 剧情广告 V236g 当日优化与续接交接

> 日期：2026-08-27  
> 用途：另一台电脑拉取后继续验证和优化  
> 权威分支：`codex/story-ad-systemic-remediation`  
> 应用代码基线：`338b5760fe3050cb3345b64014c1bd7d511768b2`  
> 生产构建：`20260827-production-v236g`

## 1. 当日目标与用户决策

今天围绕剧情广告人物、场景、工作流画布和多模型生成链完成了以下闭环：

1. 微众 MaaS 改用生产地址 `https://tk.iserviceapi.com/api`，凭证只保存在生产私有配置，不写入本文档、Git 或日志。
2. SMSCRW 继续使用原有密钥；用户提供的新密钥当前不启用。
3. 图片生成增加画质与清晰度合同；当前厂商能力未确认的 4K 禁用，不允许静默降级。
4. 人物生成由“数量”改为“生成类型”：三视图、四视图、全局整图；广告默认三视图，剧情默认全局整图，每组固定生成 1 张组合图。
5. 场景画面必须为空镜，随机人物、手、剪影、模特或人物倒影均判定 QA 失败；人物站位和轨迹由场景后的独立模块处理。
6. 360 原地环视不是场景默认产物；没有几何/空间模型时 6DoF 全部置灰。
7. 同步 HTTP 5XX 且没有厂商任务号、请求号或结果句柄时，认定为“未提交、未计费的终止失败”，允许切换独立备用模型；存在厂商句柄时继续保持人工核账门禁。
8. 已生成成功的场景图必须保留，只补缺失视图，禁止整组覆盖重生。
9. 工作流画布顺序固定为输入 → 剧情 → 身份资产 → 场景/导演；旧任务保存的倒置坐标只迁移一次，之后尊重用户自由拖动。
10. 场景卡普通态、悬停态和真实选中态必须严格区分；普通按钮不使用持续紫色高亮。

## 2. 修改前后的完整数据流

### 2.1 剧情与工作流加载

修改前：

`进入剧情/画布 → 读取完整 bundle → 前端再次请求完整 graph/bundle → 历史制品逐个跨进程读取 → 页面长时间停留“正在加载工作区”`

修改后：

`进入剧情 → 按需读取 summary/story → 首个工作区 bundle 同步返回 graph → SQLite 先按 task_id + kind 筛选候选 → 仅解析目标制品 → 页面渲染`

主要效果：移除重复全量请求；生产证据中旧分镜历史扫描约 6.1 秒的路径已改为定向筛选，工作流图投影本身约 2ms。

### 2.2 画布顺序、布局与节点详情

修改前：

`新默认坐标 → 与旧 workspace_graph_layout 合并 → 旧资产列坐标覆盖剧情前置顺序 → 首节点被舞台左边界锁住 → 详情显示为细长侧栏`

修改后：

`投影权威阶段顺序 → 合并旧布局 → 检测剧情/资产倒置 → 仅一次整组换列并拉开间距 → 保存 spacing_version → 后续允许负坐标自由拖动`

节点点击后使用中央聚焦详情，保留背景画布；支持完整提示词、分区收缩、右上角关闭和 Esc 关闭。剧情及分镜编辑仍写回各自权威数据，不在图投影内另存一份业务副本。

### 2.3 人物生成类型与设置

修改前：

`人物表单选择生成数量 → 提示词固定组合图 → 下游无法区分身份锚点/视图类型 → 广告也可能生成过多人物图`

修改后：

`识别项目内容类型 → 默认生成类型（广告三视图 / 剧情全局整图）→ 用户可选三视图、四视图、全局整图 → 编译器生成对应视图合同 → 运行时验证 → 类型进入缓存指纹 → 下游按身份锚点与视图语义消费`

- 三视图：正面、侧面、背面。
- 四视图：正面、侧面、背面、动作。
- 全局整图：完整人物、动作、饰品、服饰及剧情制作所需信息。
- 已有合格人物档案不会因为默认值变化自动重生。

### 2.4 画质、清晰度与比例

修改前：

`前端展示分辨率 → 后端未形成统一厂商合同 → 存在选项与真实请求不一致的风险`

修改后：

`项目真实比例 + 画质档位 → 自动过滤/联动可用清晰度 → 保存人物设置或随场景提交 → 写入生成指纹 → mediaAdapter 按厂商能力映射参数 → 不支持项在 UI 禁用`

场景支持 720P、1K、2K；4K 在当前模型能力未确认时禁用。生成数量不再作为人物多图成本放大器。

### 2.5 场景空镜、污染资产与空间能力

修改前：

`场景提示词允许厂商自由补人物 → 旧图缺少人物 QA 证据仍作为成功视图复用 → 污染俯视图进入空间展示`

修改后：

`场景提示词加入中英文零人物硬约束 → 厂商生成 → 视觉 QA 检查人物/手/剪影/模特/倒影 → 污染视图保留审计和费用事实但退出复用 → 仅该视图进入缺失队列 → 干净视图继续复用`

两个目标场景中发现的两张污染布局图已退出复用，未覆盖其他成功图，也未自动重新付费生成。导演台中人物改为头、躯干和四肢组成的虚拟人，商品及其他物体改为半透明 3D 线框；无几何模型时 6DoF 不可操作。

### 2.6 多模型失败、计费与并行状态

修改前：

`单视图调用 → 任意同步 5XX → 即使明确 submission_rejected/not_billed 仍触发未知计费熔断 → 阻断备用模型；并行任务中一个视图失败 → 整体状态过早写 failed → 自动刷新短暂显示“已停止”`

修改后：

`单视图调用 → 检查厂商任务/请求/结果句柄 → 无句柄同步 5XX 写 PROVIDER_5XX_NOT_SUBMITTED + submission_rejected + not_billed → 允许下一独立候选；有句柄才进入未知计费保护`

并行进度改为：

`单元失败只累计失败数 → 其他视图/候选仍运行时总体保持 running → 只有编排所有者终结总体状态 → 前端在 active_target_generations 非空时不显示终止失败横幅`

成功图片始终按视图保留，修复计划只包含缺失视图。

### 2.7 场景卡操作

修改前：

`进入场景位于卡片底部或内联展开 → 按钮持续紫色且尺寸过大 → 待生成状态与操作顺序混乱`

修改后：

`卡片标题区：待生成状态 → 紧凑“进入场景”按钮 → 弹窗查看空间；卡片底部保留质量、清晰度和生成动作`

普通态为低强调中性样式，悬停才出现紫色反馈；只有 `aria-pressed=true` 或 `.is-selected` 才保持真实选中样式。按钮统一为约 30px 高，移动端不强制撑满宽度。

## 3. 主要代码与文件变更

### 接入、参考图与生成合同

- `src/services/newStoryAd/mediaAdapter.js`：平台自产参考图使用 960px WebP 厂商派生地址；无句柄同步 5XX 统一为未提交/未计费；质量映射。
- `src/services/settingsService.js`、`src/services/videoService.js`、`src/routes/settings.js`、`src/routes/digitalHuman.js`：微众生产地址与历史测试地址兼容迁移。
- `docs/integrations/weizhong-maas.md`：生产接入地址说明。
- `src/services/newStoryAd/personGenerationPromptService.js`、`personDossierCompiler.js`、`personGenerationRuntimeContractService.js`、`personIdentityContractService.js`、`subjectAssetBundleService.js`：三视图、四视图、全局整图合同。
- `src/services/newStoryAd/generationBillingGuardService.js`：明确未提交/未计费 5XX 不再触发未知计费熔断。
- `src/services/newStoryAd/sceneAssetService.js`：并行单元失败不提前终结整体任务；场景质量、分辨率和比例进入请求及指纹。

### 加载、画布与投影

- `public/story-ad/app.js`、`src/routes/storyAdWorkspace.js`：剧情按需加载，首个 bundle 返回 graph。
- `src/services/storyAdWorkspace/contentRecordRepository.js`、相关 `storageService` 路径：任务和制品类型前置筛选，避免扫描全部历史制品。
- `src/services/storyAdWorkspace/graphProjectionService.js`、`graphLayoutService.js`：剧情前置、旧布局一次迁移、阶段间距和自由坐标。
- `public/story-ad/views/workflowView.js`、`public/story-ad/workflow.css`：画布就地编辑、中央聚焦详情、分区收缩、负坐标拖动。
- `public/story-ad/components/ui.js`：活动目标参与运行态判断，消除自动刷新时的假失败横幅。

### 人物、场景与交互

- `public/story-ad/views/assetCenterPersonForm.js`、`personPromptAutosave.js`：人物生成类型、画质和清晰度保存。
- `public/story-ad/views/assetCenterStageView.js`：人物页隔离历史场景 5XX。
- `src/services/newStoryAd/sceneVisualPromptService.js`、`sceneSpaceContractService.js`：全视图无人硬约束和空间能力合同。
- `src/services/newStoryAd/sceneGenerationCheckpointService.js`：污染视图退出复用，成功视图继续保留。
- `public/story-ad/views/sceneWorldView.js`、`scenePromptPreview.js`、`sceneCardInteractions.js`、`sceneDossierCardSettings.js`：顶部弹窗入口、720P、画质联动、紧凑操作和状态顺序。
- `public/story-ad/views/directorStudioView.js`：虚拟人和 3D 线框对象表达。
- `public/story-ad/dialogue-theme.css`、`workspace-ux.css`、`workspace.css`：普通/悬停/选中态及场景布局样式。
- `scripts/invalidate-new-story-ad-scene-view.js`：污染单视图只读预演与显式作废工具，活动生成期间拒绝修改。

### 关键回归

- `scripts/test-visual-asset-recovery-v50.js`
- `scripts/test-deyunai-image-submission-billing.js`
- `scripts/test-new-story-ad-multi-space-cast-recovery.js`
- `scripts/test-story-ad-workspace-v6.js`
- `scripts/test-story-ad-workspace-v6-ui-regressions.js`
- `scripts/test-new-story-ad-knowledge-policy-performance.js`
- 微众接入、人物类型、场景无人、空间能力、画质联动和污染资产相关定向回归。

## 4. 提交与发布记录

今天的提交范围从 `6ece3fb2` 到应用代码基线 `338b5760`。主要里程碑提交：

- `92059813`：参考图轻量化与微众生产地址。
- `3f3dffbc`：工作区加载、生成类型和质量设置。
- `97e0b921`：旧画布剧情/资产倒置迁移。
- `a2a25b97`：场景恢复、空间控制、空镜和 UI 表达。
- `d1c5a245`：工作流历史扫描提速与无句柄同步 5XX 容灾。
- `b141a191`：污染视图拒收与场景入口上移。
- `b15d01d0`：自由画布布局与聚焦节点详情。
- `2724eb4b`：历史无句柄同步 500 账务状态统一。
- `cd7e2f6e`：场景操作普通/悬停/选中 CSS 与紧凑布局。
- `0025f2de`：并行场景部分恢复保持运行态。
- `e49ee4ce`：在不放宽 50 KiB 门限的前提下恢复首屏体积通过。
- `338b5760`：冻结不可变 V236g 发布清单。

生产不可变身份：

- build：`20260827-production-v236g`
- release bundle：`eb5a0599808f75d04acffe21d2f03d126943f009f752c3269096db548ae9842e`
- artifact：`5ca0d8dc30d6e9a9e660c1e46e8140e04cd4e2b0d9d6ab23c3242bbb92aea395`
- runtime hash：`8a44d0a38511bf74e331ffb7aec4ba70455cbe5f30289b6543f24971df621e8e`
- runtime manifest SHA-256：`717027b279b8a1d77c8eb5ecc3addb82f079d496d45e57160cc2a698dafbb20f`

## 5. 本地、Git、生产三方一致性

| 核对项 | 本地 | Gitee `origin` | 生产 | 结论 |
|---|---|---|---|---|
| 分支 | `codex/story-ad-systemic-remediation` | 同名分支 | 发布清单记录同名 source/upstream | 一致 |
| 应用代码基线 | `338b5760…` | `338b5760…` | artifact 内 source revision `e49ee4ce…`，冻结清单提交为其后一提交 | 一致 |
| ahead/behind | `0/0` | `0/0` | 不适用 | 一致 |
| build | V236g | V236g 清单已推送 | V236g | 一致 |
| artifact | `5ca0d8dc…` | `5ca0d8dc…` | `5ca0d8dc…` | 一致 |
| 运行清单 | 859 个清单内文件 + 清单本身 | 同一提交 | 859 个清单内文件 + 清单本身 | 860 项一致 |
| 文件 SHA-256 | 差异 0 | 由同一 HEAD 提供 | 差异 0 | 一致 |
| manifest SHA-256 | `717027b2…` | `717027b2…` | `717027b2…` | 一致 |

说明：生产运行代码以不可变 artifact 和逐文件哈希为权威，不以服务器 Git detached HEAD 判断。交接文档本身属于文档，不进入生产运行清单，也不需要为文档提交重新部署应用。

## 6. 实际验证

### 今天发布阶段已经执行

- 系统安全、全平台跨版本、V6 工作区、并发场景恢复、发布核心和黄金合同均通过。
- 固定种子 10,000 个、变形样本 400 组、并发任务 50 个、重复许可 0。
- V236f 首次候选因首屏 gzip 51,220 字节超 50 KiB 门限 20 字节而在切流前回滚；未放宽门禁。
- V236g 将首屏 gzip 降至 51,185 字节后通过。
- 生产发布时 860 项制品校验通过，真实付费调用 0。

### 本次交接重新执行的只读核对

- `git fetch --all --prune` 后，本地与 `origin` HEAD 均为 `338b5760…`，ahead/behind `0/0`。
- 本地和生产分别复算 859 个清单内运行文件，SHA-256 差异均为 0；运行清单自身 SHA-256 也一致，合计 860 项。
- 本地开发服务 `http://localhost:3007` 健康接口 HTTP 200。
- 生产 PM2 `vido`：online，PID 6311，restart 0，工作目录为当前不可变 artifact。
- 生产内网健康 HTTP 200、生产公网健康 HTTP 200；内外网版本均为 V236g，release control 为 active/allowed。
- SQLite `quick_check=ok`，健康接口数据库状态 `ok`。
- 目标任务 `b83fa67c-244a-4869-b3cc-df282fad5c59`：`done / scene_asset_done`，模型调用 86，未知计费 0，活动未知计费 0，活动生成 0。
- 本次交接核对未触发模型、媒体调用或生产业务写入。

## 7. 当前目标任务与剩余风险

目标任务当前有两个场景：

- 现代高端家居展示厅：成功 4/5，缺 1 个视图。
- 高端商业展台：成功 3/5，缺 2 个视图。
- 共保留 7 张成功场景图，缺失 3 张；修复计划只补缺失视图，不会重生已有成功图。

最新外部厂商事实：

- SMSCRW：原有账号返回余额不足；按用户决定继续保留旧密钥，新密钥不启用。
- 微众 MaaS：模型列表只读请求 HTTP 200，54 个模型可见；最近一次图片同步请求返回无句柄 504，已按“未提交、未计费”结束。
- 漫路/DeyunAI：返回内容审核拒绝 `AuditSubmitIllegal / submit is illegal`。

因此平台内部的错误分类、备用路由、成功资产保护和并行状态已经修复，但三个缺失视图能否立即成功仍受厂商余额、504 稳定性和内容审核影响。下一台电脑不应直接批量重试；应先确认至少一个图片供应商具备可用额度和稳定性，再以单个缺失视图做受控验证。

未执行项：本次交接没有再次运行完整平台回归，因为 V236g 发布阶段已经完成完整门禁，本轮只新增交接文档、没有修改运行代码；没有执行真实付费生图；没有修改生产业务数据。

## 8. 下一次续接顺序

1. 拉取本交接所在的最新提交，确认工作树中的个人未提交内容不被覆盖。
2. 启动本地服务并确认 `http://localhost:3007/api/health` 为 HTTP 200。
3. 只读检查 SMSCRW 旧账号额度、微众模型列表和近期 504 状态；不要在密钥或厂商状态不明确时批量生成。
4. 选择一个缺失视图做单次受控生成，记录调用前后模型调用数、账务状态、厂商句柄和成功资产数。
5. 若单次成功，再依次补剩余两个缺失视图；每次确认 7 张既有成功图未被覆盖。
6. 场景达到 5/5 后，核对场景卡、进入场景弹窗、工作流画布和人物/场景投影同步，再继续线稿、分镜、镜头与合成流程。

## 9. 另一台电脑拉取命令

```powershell
cd D:\VIDO
git status --short
git fetch --all --prune
git switch codex/story-ad-systemic-remediation
git pull --ff-only origin codex/story-ad-systemic-remediation
node src/server.js
```

如果另一台电脑已有未提交内容，先保留在独立分支或确认与远端变更不重叠；禁止使用 `git reset --hard` 覆盖本地工作。
