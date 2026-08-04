# VIDO 参考理解 V6 与通用导演画布交接

> 交接时间：2026-08-04 00:38（Asia/Shanghai）
> 交接方向：家中电脑 → 公司电脑
> 目标分支：`codex/story-ad-v3-upgrade`

## 1. 当晚目标与用户决策

本轮从 2026-08-03 晚间持续到 2026-08-04 凌晨，目标是完成以下闭环：

1. 对参考视频和链接进行更深的故事理解，不能只给一句简单广告摘要。
2. 补齐与竞品方向相近、但不做 1:1 复刻的工作流导演台；画布创建和原有流程创建必须同步。
3. 保留当天已经完成的人物、服装、鞋履、饰品、场景、机位和真实感增强，禁止新增第二套事实源。
4. 所有能力必须支持任意行业和场景，不按汽车、家居或某个固定案例写死。
5. 控制代码冗余和首屏加载体积，3D 与深度报告按需加载。
6. 强制用户使用最新前端，避免旧页面继续覆盖新数据。
7. 完成开发、完整回归、真实浏览器验证、生产部署和本地/Git/生产三方核对后，再交给用户验收。

## 2. 修改前后的完整数据流

### 修改前

```text
参考视频/链接
  → 画面/语音分析
  → 短摘要、人物/场景/镜头提示
  → 项目 context
  → 资产中心、剧情、分镜

场景/人物正文
  → 场景世界与资产卡
  → 3D 导演信息分散在原流程
  → 镜头生成端可能继续复用旧 revision
```

主要问题：深度故事结构不足；画布缺少参考理解、DirectorScene 和运动节点；导演状态与原流程没有统一可见入口；丰富摘要可能被短 logline 覆盖；陈旧实体版本缺少逐镜编译阻断。

### 修改后

```text
参考视频/链接
  → 镜头感知证据 + 转写证据
  → ReferenceUnderstanding V6
       ├─ story_summary
       ├─ causal_chain
       ├─ characters / scenes
       ├─ brand_role / audio_visual
       └─ facts / inferences / unknowns + evidence refs
  → 用户确认内容 revision 与 analysis fingerprint
  → 同一项目权威 context
  → 人物、商品、场景、剧情、分镜

权威人物/商品/场景 revision
  → DirectorScene（只保存 ID、revision、变换、机位、FOV、轨迹）
  → 画布入口与原流程入口打开同一个 DirectorScene
  → ShotReferencePack 编译
  → 陈旧 source/entity revision 拒绝进入生成链路
```

前端发布链路：

```text
单一 build/contract 配置
  → release manifest 哈希
  → 带版本资源 immutable
  → HTML/未版本资源 no-store
  → 页面心跳核对版本
  → 旧客户端写请求 HTTP 426
```

## 3. 当晚代码与文件变更

### 参考理解 V6

- `src/services/newStoryAd/referenceUnderstandingService.js`
  - 输出完整故事总述、因果链、人物状态、场景职责、品牌作用、音画对应和事实/推断/未知。
  - 所有证据使用稳定的帧/转写引用；无独立证据的动机降级为推断。
- `src/services/newStoryAd/referenceVideoAnalysisService.js`
  - 接入 V6 合同；支持已有完整镜头证据的零模型调用重编译。
- `src/services/storyAdWorkspace/referenceUnderstandingConfirmationService.js`
  - 绑定内容 revision、analysis ID、结构完整性和 fingerprint；重复确认幂等且不触发生成。
- `src/services/storyAdWorkspace/referenceUnderstandingProjectionService.js`
  - 收敛轻量投影，避免 `projectBundleService` 膨胀。
- `public/story-ad/views/referenceUnderstandingView.js`
  - 第一页新增七类深度报告、事实/推断/未知标记、证据定位和权威输入确认。
- `public/story-ad/views/briefView.js`
  - 分析完成后按需加载深度报告；未确认时阻止进入资产创建。
- `public/story-ad/store/projectStore.js`
  - 修复丰富 `generated_brief` 被短 logline 覆盖，同时保留用户手工编辑内容。

### 通用导演工作流画布

- `public/story-ad/views/workflowDirectorNodes.js`
  - 新增参考理解、人物、场景、商品、DirectorScene、DirectorAnimation、镜头等端口合同与节点交互。
- `public/story-ad/views/workflowView.js`
  - 画布按真实项目数据动态投影；从节点打开同一 3D 导演台。
- `src/services/storyAdWorkspace/graphProjectionService.js`
  - 统一节点和关系；详情只传 ID、revision、计数与摘要，不复制实体正文。
- `src/services/storyAdWorkspace/directorSceneService.js`
  - 投影导演场景摘要并核对场景、人物和商品 revision。
- `src/services/newStoryAd/shotReferencePackService.js`
  - 拒绝包含陈旧人物、商品或场景版本的导演快照。
- `public/story-ad/views/directorStudioView.js`
  - 继续复用通用 3D 导演台；人物、商品、机位、FOV、轨迹和截图进入同一权威对象。

### 真实感、查看与发布链路

- 保留并发布人物原生脸部/全身参考、皮肤/毛发/锐度/光照融合/跨帧漂移 QA。
- 保留场景真实图片优先、动态机位和 DirectorScene 编译链路。
- 人物、场景及其他媒体主卡统一支持原尺寸灯箱、滚轮/按钮缩放、拖动平移和同组切换。
- `scripts/deploy-story-ad-release.js` 收敛为按 build ID 隔离的通用原子发布脚本。
- 当前发布版本：`20260803-reference-director-v9`。
- 当前合同版本：`reference-director-v2`。

## 4. 当晚提交记录

| 提交 | 时间 | 内容 |
|---|---|---|
| `c5431e5` | 2026-08-03 23:16 | 人物/场景真实感、原图灯箱、DirectorScene 与发布完整性 |
| `17741c7` | 2026-08-03 23:25 | 真实感导演台部署与交接记录 |
| `cebcd70` | 2026-08-04 00:14 | ReferenceUnderstanding V6 与通用导演画布 |
| `e21e918` | 2026-08-04 00:23 | V9 生产部署日志 |
| `2134085` | 2026-08-04 00:41 | 本交接文件初版与三方核对日志 |

交接文件初版已提交并同步到 origin/Gitee 与 GitHub；公司电脑不需要手工指定提交，直接对目标分支执行 `git pull --ff-only`，即可取得本文及其最终状态修订。

## 5. 本地、Git、生产三方一致性

核对时间：2026-08-04 00:38。

| 核对项 | 结果 |
|---|---|
| 本地分支 | `codex/story-ad-v3-upgrade` |
| 交接前应用/部署日志 HEAD | `e21e918c68e5a7141e96d3638ddf534e9fffcdfd` |
| 交接文件初版提交 | `21340857993e72cc13f90eb5e37558135483b1b2` |
| origin / Gitee | 交接初版与本地相同，`ahead 0 / behind 0` |
| GitHub 镜像 | 交接初版实时 compare 结果 `identical`，`ahead 0 / behind 0` |
| 本地服务 | `http://localhost:3007`，健康 `ok` |
| 本地 build / contract | `20260803-reference-director-v9 / reference-director-v2` |
| 生产发布清单 | 78/78 个文件 SHA-256 一致，差异 0 |
| 生产 PM2 | `vido` online |
| 生产内网/公网健康 | `ok / ok` |
| 生产数据库 | `ok`，SQLite `quick_check=ok` |
| 活动生成任务 | 0 |
| 生产 build / contract | `20260803-reference-director-v9 / reference-director-v2` |
| 旧客户端 | 写入返回 426，旧剧情广告 UI 未启用 |

说明：生产采用发布清单逐文件原子发布，不能用生产目录的 detached Git HEAD 判断运行代码。生产权威结论是 78 个发布文件与本地逐文件哈希一致。最终交接文档提交只改变 `docs/`，不需要重复部署生产。

当前工作树中的 5 个未跟踪研究文档是用户既有文件，本轮未修改、未删除、未纳入交接提交。

## 6. 已实际执行的验证

### 开发与完整回归

- `npm run story-ad:v6:test`：通过。
- `npm run story-ad:v3:test`：通过。
- 生产隔离目录 `npm run platform:upgrade:test`：通过。
- 参考分析：185 项通过。
- 链接输入：61 项通过。
- ReferenceUnderstanding V6：26 项通过，模型调用 0。
- 理解确认：11 项通过，`industry_hardcoding=false`、重复付费调用 0。
- 深度报告 UI：40 项通过，7 个标签页。
- DirectorScene：19 项通过，陈旧 source/entity 均被阻断。
- 工作流导演节点：37 项通过；120 镜头投影为 246 节点、247 关系。
- 发布完整性：4 项通过，陈旧 release 被阻止。

### 性能与浏览器

- 首屏 JS：72,531 bytes。
- 核心 gzip：生产回归约 98.9 KiB。
- 新增功能按需模块 gzip：约 13.1 KiB。
- 3D 模块仅在打开导演台时加载，gzip 约 194.9 KiB。
- 本地真实项目画布：80 个真实节点、227 条关系。
- 画布打开同一 DirectorScene：`sync_status=current`、`stale_refs=[]`。
- 本地与生产页面浏览器控制台：应用警告/错误 0。

### 生产只读复核

- 78 个发布文件重新逐文件计算 SHA-256，差异 0。
- PM2、内外网健康、数据库与 SQLite 正常。
- 活动生成任务 0。
- 未执行模型、媒体调用或业务写入。

## 7. 未执行项、风险和数据边界

1. 未执行真实付费人物、场景或视频生成，避免重复计费和覆盖已有项目；最终模型画面审美仍需用户做一次受控验收。
2. 新代码强制刷新并阻止旧客户端写入，但不会自动改写用户历史业务内容。历史参考分析只有在已有证据完整时才能零模型调用重编译；明日验收旧项目时应确认是否需要补充迁移入口或提示。
3. GitHub HTTPS 在本次核对中连续三次连接失败；随后通过 GitHub Git Database API 上传并逐项验证相同 blob、tree 和 commit SHA，交接初版实时 compare 为 `identical`。这是当前电脑到 `github.com` 的瞬时网络限制，不是镜像内容差异。
4. 生产数据库和既有项目均未因本次交接核对被写入或覆盖。

## 8. 明天公司电脑续接步骤

先确认公司电脑没有未提交修改：

```powershell
cd E:\AI\VIDO
git status --short
```

如果输出为空或只有已确认保留的个人未跟踪文档，再执行：

```powershell
git fetch --all --prune
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
npm install
npm run platform:upgrade:test
node src/server.js
```

本地访问：<http://localhost:3007/story-ad/>
生产访问：<https://vido.smsend.cn/story-ad/>

禁止使用 `git reset --hard` 覆盖公司电脑上可能存在的未提交内容。

## 9. 明日验收与继续优化顺序

1. 新建一个低成本验收项目，分别测试参考视频上传和链接输入。
2. 核对第一步是否完整展示故事总述、因果链、人物、场景、品牌作用、音画、事实/推断/未知，并能定位证据。
3. 未确认深度理解前应禁止进入资产创建；确认后进入下一步且不重复调用模型。
4. 从工作流画布打开一个场景的 3D 导演台，再从原有流程打开同一场景，核对 DirectorScene ID、revision、人物/商品引用、机位和轨迹一致。
5. 核对人物、场景主卡原图灯箱的缩放、平移、左右切换和关闭。
6. 修改人物或场景后确认旧 DirectorScene/ShotReferencePack 被标记陈旧或阻止继续生成。
7. 最后再决定是否执行一组真实付费人物/场景/视频样本；执行前先记录模型调用计数和项目 revision，避免重复付费。
8. 若旧项目仍显示历史简版参考理解，优先设计“零模型调用升级已有证据”的显式入口，不要自动覆盖用户已编辑内容。

## 10. 明日开始时的最小只读核对

```powershell
git rev-parse HEAD
git rev-list --left-right --count origin/codex/story-ad-v3-upgrade...HEAD
Invoke-RestMethod http://localhost:3007/api/story-ad/version
Invoke-RestMethod https://vido.smsend.cn/api/story-ad/version
```

预期结果：Git `0 0`，本地与生产均为 `20260803-reference-director-v9 / reference-director-v2`。
+

## 11. 2026-08-04 当日补充：存储治理与重新识别可靠性修复

- 系统盘历史备份、旧应用/输出副本和 BridgeLLM 备份已迁移到数据盘并校验；运行中的 `/opt/vido/app/outputs` 未切换。清理 Docker 无用数据和过期系统日志后，系统盘占用由 90% 降至 25%。
- 重新识别启动改为 HTTP 202 立即受理，项目重置和分析在后台顺序执行；浏览器不再重复绑定内容版本，失败/取消由服务端同步终态，轮询中断会冻结本地耗时并自动重连。
- 语义候选必须在合并逐帧证据后通过深层质量门；缺失的结构字段可由确定性证据补齐，空泛或不合格故事会继续切换候选。失效 OpenAI 提供商已禁用，并在数据盘保留权限受限的回滚备份。
- 功能提交 `f6309bb`、发布清单提交 `1bb090a` 已推送。生产版本为 `20260804-reference-reanalysis-reliability-v13 / reference-director-v2`，86 个发布文件 SHA-256 差异 0。
- 本地与服务器完整 `platform:upgrade:test` 均退出码 0；发布前后活动生成任务均为 0，PM2、内外网健康、数据库和 SQLite quick_check 正常。
- 目标任务当前为权威失败终态，8/8 视觉证据批次保留，可从页面点击“复用完整证据重新整理”。本轮修复前后该分析的模型调用数均为 21，未自动重新识别、未新增付费调用。

## 12. 2026-08-04 下午补充：重新识别启动反馈与语义模型路由 v14

- 15:16:40 的重新整理请求已在服务端受理，但首个新进度到 15:17:04 才写出，约 24.7 秒耗在后台项目状态清理和 SQLite/JSON 投影；此前响应虽已调用 `res.json`，同一事件循环随后执行同步投影，浏览器可能在 socket 真正刷出前继续等待。
- 本次失败不在镜头识别：30 张证据帧和 8/8 视觉批次完整保留。失败发生在语义总编阶段：`webang-maas/gemini-2.5-pro` 返回令牌过期，`deyunai/deepseek-r1` 与 `deyunai/gemini-3.1-flash-lite-preview` 均返回无正文 HTTP 400。
- 根因是语义候选按静态配置优先级取前三个，两个从未成功的模型占满了 3 次预算，近期有成功记录的 DeyunAI `gemini-2.5-flash`、`gemini-2.5-pro`、`gpt-4o` 排在第 6～8 位而未被尝试。
- v14 为 HTTP 202 预留 100ms 刷出窗口，并在后台投影前写入“任务已受理，正在准备项目状态”；失败/取消再次启动时进度统一重置为 1%，不继承内部旧进度。
- 参考视频语义总编改为近期成功模型优先；无正文 HTTP 400 识别为 `PROVIDER_REQUEST_REJECTED` 并对单个模型冷却 30 分钟，不再以 `UNKNOWN` 重复占用候选预算。发布清单补入此前遗漏的 `modelGateway.js`。
- 提交 `df9a8f333c5986f8ffda8ff797f6ae760d20709d` 已推送。生产版本为 `20260804-reference-model-routing-v14 / reference-director-v2`，87/87 文件 SHA-256 差异 0。
- 本地完整回归 234.8 秒退出码 0；服务器完整回归和发布后健康检查通过，活动任务前后 0，PM2 online，内外网健康、数据库、SQLite quick_check 正常。
- 线上语义候选现为：1) `deyunai/gemini-2.5-flash`，2) `deyunai/gemini-2.5-pro`，3) `deyunai/gpt-4o`。目标分析保持 failed，8/8 证据保留；失败后及本次发布后新增模型调用均为 0，未自动重跑。
