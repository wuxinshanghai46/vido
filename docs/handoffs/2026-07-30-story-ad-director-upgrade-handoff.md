# VIDO 剧情广告导演工作流升级与次日续接交接

> 日期：2026-07-30  
> 分支：`codex/story-ad-v3-upgrade`  
> 代码提交：`9b4fe04`  
> 用途：次日在公司电脑拉取今晚更新，继续做真实任务效果验收与后续优化。

## 一、今晚完成的升级

### 1. 六步导演工作流

剧情广告主流程调整为：

1. 参考与需求；
2. 人物与场景档案；
3. 剧情蓝图；
4. 导演故事板；
5. 关键帧与候选视频；
6. 成片审核。

默认页面只让用户看到人物、动作、场景、剧情、内容描述、逐镜行动和候选结果。机位、运镜和素材血缘等技术信息保留在系统内部或高级折叠区，不再误导用户继续填写拍摄参数。

### 2. 人物档案与动作资产

- 人物档案支持身份视图、外观、服装和角色信息。
- 每个人物增加起始动作、关键动作、结束动作、手部接触、表情和道具状态。
- 重型人物档案、真人形象和演员库模块只在进入第 2 步时加载。
- 慢网络下提前悬停第 2 步时，先等待核心工作台完成，再加载人物模块，避免并发竞态。

### 3. 场景档案与剧情状态

- 场景保留空间结构、区域、互动锚点、人物移动路线和关键物件。
- 新增场景剧情状态时间线，表达动作发生前、发生中和发生后的空间变化。
- `storyStates`、`interactionAnchors` 和 `routes` 已贯通场景辅助生成、完整性补齐、上下文构建和导演工作台。

### 4. 剧情蓝图与导演故事板

- 剧情按建立情境、矛盾/需求、行动、结果和品牌收束组织。
- 用户工作台显示因果关系、人物表演、场景状态变化和逐镜行动。
- 候选关键帧与视频按镜头分页展示，并保留来源血缘与连续性结论。

### 5. 性能结构

- 新增轻量只读导演工作台接口，按 `people/scenes/story/shots/candidates/continuity` 分区读取。
- 120 镜任务每页默认最多 20 镜，每镜候选最多 3 个。
- 图片使用浏览器懒加载，接口请求有短时缓存和并发去重。
- 启动器从 215 行拆分到 176 行，低于 180 行结构门禁。

## 二、修改前后数据流

修改前：

```text
参考视频/广告需求
→ 长文本与分散结构
→ 旧任务整体恢复
→ 技术表单和旧 UI
→ 用户难以确认人物、场景和剧情是否正确
```

修改后：

```text
参考视频/广告需求
→ 结构化人物档案 + 动作包
→ 结构化场景档案 + 状态/路线
→ 剧情因果蓝图
→ 轻量导演工作台分页投影
→ 逐镜行动、关键帧和候选视频
→ 连续性与成片审核
```

## 三、关键文件

- `src/services/newStoryAd/directorWorkspaceService.js`
- `src/routes/newStoryAd.js`
- `src/services/newStoryAd/contextBuilder.js`
- `src/services/newStoryAd/assistScenePlanService.js`
- `src/services/newStoryAd/sceneAssistCompletenessService.js`
- `public/js/new-story-ad/director-workspace.js`
- `public/css/new-story-ad-director-workspace.css`
- `public/js/new-story-ad/bootstrap-asset-loader.js`
- `public/js/new-story-ad/bootstrap.js`
- `public/digital-human.html`
- `scripts/test-new-story-ad-director-workspace.js`

## 四、今晚已执行验证

- `npm run story-ad:v3:director-workspace`：38 项通过。
  - 120 镜任务分页：20；
  - 每镜候选上限：3；
  - 测试响应：59,393 bytes；
  - 机位字段泄漏：无；
  - 人物重型模块按需加载：通过。
- `npm run story-ad:v3:test`：完整通过。
- `npm run platform:upgrade:test`：完整通过。
  - 30 个 HTML 页面加载检查通过；
  - 平台能力路由通过；
  - 视频画布回归通过；
  - 剧情广告完整 V2/V3 链路通过。
- 关键 JavaScript `node --check`：通过。
- `git diff --check`：通过。
- 本地浏览器验收：
  - 新六步流程可见；
  - 首屏无机位输入；
  - `real-person-dossier.js` 和 `actor-library.js` 未提前加载。
- 自动验证真实模型调用：`0`。
- 自动验证图片、视频、语音和合成付费提交：`0`。

## 五、Git 与提交

代码提交：

| 提交 | 内容 |
|---|---|
| `9b4fe04` | 导演工作台、人物/场景/剧情投影、按需加载、SSH 密钥交接协议 |

目标分支：

```text
codex/story-ad-v3-upgrade
```

`origin`、`gitee` 和 `github` 均使用同名分支。交接文档提交后，应以远端分支最新 HEAD 为最终拉取基线。

## 六、长期交接与服务器连接协议

项目已新增 `docs/handoffs/HANDOFF_PROTOCOL.md`，并写入 `AGENTS.md`。以后只要提出“生成交接 MD”或“明天继续”，系统必须自动完成：

- Git fetch、分支、工作树和 ahead/behind 核对；
- 当日变更提交与推送；
- 生产服务器连接、发布文件哈希、PM2、健康、数据库和活动任务核对；
- 本地、Git、生产三方一致性表；
- 未执行项、剩余风险和费用边界。

固定无密码连接信息：

```text
SSH 别名：vido-prod
服务器：43.98.167.151
用户：root
生产目录：/opt/vido/app
PM2：vido
服务端口：4600
```

连接命令：

```powershell
ssh -o BatchMode=yes vido-prod
```

安全规则：

- 本交接文件不包含服务器密码、数据库密码、Token、API Key 或 SSH 私钥。
- 当前家庭电脑已通过独立 SSH 公钥授权，以后无需重复提供密码。
- 公司电脑必须使用自己的 SSH 公钥；第一次授权完成后，以后同样无需密码。
- 禁止通过 Git、MD、聊天或网盘复制 SSH 私钥。

## 七、明天在公司电脑续接

先检查公司电脑是否有未提交修改：

```powershell
git status --short
```

确认安全后执行：

```powershell
git fetch --all --prune
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
npm install
npm run platform:upgrade:test
node src/server.js
```

本地入口：

- `http://localhost:3007`
- `http://localhost:3007/digital-human.html?tab=new-story-ad`

生产核对：

```powershell
ssh -o BatchMode=yes vido-prod
```

如果公司电脑提示 `Permission denied (publickey)`，表示该电脑的公钥尚未加入服务器。应给公司电脑单独授权公钥，不能把密码补写进交接 MD。

## 八、建议的人工验收顺序

1. 新建任务，不续用旧的错误中间状态。
2. 读取一个可公开访问的视频或本地视频。
3. 检查第一步只显示人物、场景、剧情和内容描述。
4. 检查人物档案是否包含身份视图及起始/关键/结束动作。
5. 检查场景是否保留真实产品、材质、空间区域、路线和剧情状态变化。
6. 检查剧情蓝图是否有明确因果、行动、结果和品牌收束。
7. 检查导演故事板是否按镜头表达人物行动与场景状态变化。
8. 在确认关键帧和候选视频之前，不点击付费视频生成。

下午的复古任务仍保存旧中间状态，不建议直接续做。应保留为对照，在视觉供应商成功可用后新建任务重新读取原视频。

## 九、已知边界

- 自动回归不能替代真实视觉模型效果验收。
- 登录态、DRM 或平台限制抓取的视频链接不能保证自动读取。
- 真实参考视频识别此前仍受视觉供应商空响应、鉴权或限流影响；重新验证前应先确认至少一个视觉通道可用。
- 本轮自动测试没有产生模型费用，但人工点击图片、视频、语音或合成生成仍可能计费。

## 十、三方一致性

发布前核对：

| 对象 | 状态 |
|---|---|
| 本地代码提交 | `9b4fe04` |
| Gitee/GitHub | 代码提交已推送 |
| 生产服务器 | 发布前仍为上一版运行文件，尚未与今晚升级一致 |

首次发布结果：

- 首次发布因新增 `scripts/lib/` 的服务器父目录尚不存在而在 SFTP 上传阶段失败。
- 发布器自动回滚；回滚后新运行文件不存在、服务健康 HTTP 200，线上没有保留半发布状态。
- 根因修复为：发布前按完整清单自动计算并创建全部远端父目录，不再为单个目录增加例外。

第二次发布与独立审计：

| 检查项 | 最终结果 |
|---|---|
| 目标分支 | `codex/story-ad-v3-upgrade` |
| 代码提交 | `9b4fe04` |
| 完整发布清单 | `205/205` SHA-256 一致，差异 `0` |
| 独立运行文件审计 | `45/45` 哈希一致 |
| 服务器 JavaScript 检查 | `42/42` 通过 |
| 服务器完整回归 | `npm run platform:upgrade:test` 通过 |
| PM2 `vido` | `online` |
| 生产内网健康 | HTTP `200` |
| 生产公网健康 | HTTP `200` |
| SQLite | `enabled=true`、`status=ok` |
| 只读任务核对 | 17 个任务，活动任务 `0` |
| 模型或媒体调用 | `0` |
| 业务任务写入 | `0` |
| 生产备份 | `/opt/vido/backups/new-story-ad-subject-scene-recovery-20260729180419` |

最终一致性口径：

- 本地、Gitee、GitHub：以本文件提交后目标分支最新 HEAD 与 `ahead/behind=0/0` 为准。
- 生产运行代码：205 项完整发布清单与本轮本地文件一致；45 项独立运行文件二次审计一致。
- 生产仓库仍为历史 detached HEAD，`git status` 中存在文件级发布差异，这是既有部署方式，不代表运行文件不一致。
- 当前结论：今晚代码、目标 Git 分支和生产运行文件已完成同步；交接文档最终提交与远端/服务器正文哈希将在本文件提交后再次核对。
