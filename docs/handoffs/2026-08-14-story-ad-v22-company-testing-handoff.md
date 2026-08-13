# 2026-08-14 VIDO V22 公司测试交接

> 交接目的：在公司电脑从权威 Git 拉取今天的最终代码，启动本地服务并开展 V22 验收测试。  
> 核对时间：2026-08-14 05:32（Asia/Shanghai）  
> 目标分支：`codex/story-ad-systemic-remediation`  
> 本次不涉及 UI/UX 改动，仅执行三方代码、生产状态与交接核对。

## 1. 结论

服务器、权威 Git（origin/Gitee）和本地运行代码一致，统一为：

- build：`20260814-sr14-v22`
- artifact：`84234a3086f29e8fba655a40b6159d845342f4030717a59a95f74329a3c3dbc6`
- runtime hash：`3b41f87d52c41b37b06ce6aaf5bd47927cfa796e1f8ae472169edcb672504a2a`
- 运行源码提交：`0d0320668b40dbff8c6f86bc80a28056c173536d`
- 运行源码树：`fd438d59bb7a89a7b6bbdb96b5b5d51c27300780`
- release bundle：`3fbcc818fa489c81c7044c5a3e688d4f01836e0fea0082becfa0e56e1dab4da5`

本交接生成前 Git HEAD 为 `6572ee0d2f1f30b04ddf66d4c8ce1e5a4cfbeb58`，其相对运行源码提交只增加 V22 构建清单和交接文档，不改变生产业务源码。本文提交后，公司电脑应以 origin/Gitee 上该分支的最新 HEAD 为拉取点。

## 2. 三方一致性证据

| 核对项 | 本地 | origin/Gitee | 生产服务器 | 结论 |
|---|---|---|---|---|
| 分支/来源 | `codex/story-ad-systemic-remediation` | 同名分支 | release 记录同一 source ref | 一致 |
| build | V22 | V22 清单已提交 | V22 | 一致 |
| artifact | `84234a...3dbc6` | runtime manifest 同值 | `84234a...3dbc6` | 一致 |
| runtime hash | `3b41f8...04a2a` | release bundle 同值 | `3b41f8...04a2a` | 一致 |
| source revision | `0d032066...3536d` | 已包含于最新分支 | `0d032066...3536d` | 一致 |
| 运行文件 | 本地 runtime manifest | 709 项哈希清单 | 709/709 mismatch 0 | 一致 |
| runtime manifest SHA-256 | `bad05581...6792a` | 已纳入构建提交 | `bad05581...6792a` | 一致 |

发布闭包共 710 个文件：runtime manifest 内记录并核验 709 项，另加 runtime manifest 文件自身。生产 `/opt/vido/current` 指向：

`/opt/vido/releases/84234a3086f29e8fba655a40b6159d845342f4030717a59a95f74329a3c3dbc6`

## 3. Git 状态

- 权威远端：`origin`，地址为 Gitee。
- 本地与 origin/Gitee：`ahead/behind = 0/0`（生成本文前核对）。
- Gitee 同名 remote 与 origin 指向同一仓库，均已 fetch 到最新提交。
- 非权威 GitHub 镜像仍停在 `59e31a5bda386bc84d7f916a236f664744b22eb2`；本轮两次通过 443 连接均失败，未能追平。
- 公司电脑必须从 `origin`/Gitee 拉取，不能从 GitHub 镜像拉取本次测试代码。
- 本地保留 5 个用户历史未跟踪文件，未纳入本轮提交、未覆盖、未删除；它们不属于 V22 运行闭包。

## 4. 生产状态

- PM2 应用：`vido`，状态 `online`。
- PID：`12927`。
- restart：`0`；unstable restart：`0`。
- exec cwd：V22 不可变 release 目录。
- 内网 `/api/health`：`status=ok`，数据库 `ok`。
- 公网 `https://vido.smsend.cn/api/health`：`status=ok`，数据库 `ok`。
- SQLite：`PRAGMA quick_check=ok`。
- release control：`active`，运行 bundle 与 active bundle 一致。
- 旧 6,399 行客户端文件在生产 release 中不存在。

## 5. 生产权威数据只读审计

- task：31
- lineage enforced：31；missing：0
- Work：31
- Work event：62
- outputs：229
- manifests：31
- artifacts：1394
- generation runs：60；active generation：0
- 历史 unknown billing：60；active unknown billing：0
- orphan output task：0

60 条历史未知计费已隔离，不会自动重提。本次三方核对没有触发模型、图片或视频供应商调用，没有新增费用或业务写入。

## 6. 今天已完成的核心整改

- 广告、剧情、漫剧收敛到共享 Work 聚合、稳定身份、字段级依赖和生成/计费内核。
- 31 个生产历史任务全部迁移为 authoritative Work，14 个补齐 lineage。
- 清理 147 条已被 Work 接管的旧核心输出；迁移前数据库已有可恢复备份。
- 60 条历史未知计费全部隔离，禁止自动重试。
- 物理删除不可达的 6,399 行旧客户端及 16 个过期发布/核查脚本；22 个相关回归迁移到现行 `/story-ad/` 工作区或后端权威模块。
- V22 二次迁移验证幂等：新建 Work 0、补 lineage 0、隔离计费 0、权威提升 0、旧输出再次清理 0、模型/付费调用 0。

完整背景和根因记录见：

- `docs/handoffs/2026-08-13-story-ad-systemic-remediation-master-plan-handoff.md`
- `参考样式/系统性整改总方案.md`（本机参考副本，不纳入 Git）
- `参考样式/[生产事实交接].md`（本机参考副本，不纳入 Git）

## 7. 公司电脑拉取与启动

先检查公司电脑是否有未提交修改，不要执行 `git reset --hard`：

```powershell
cd D:\VIDO
git status --short
git fetch origin --prune
git switch codex/story-ad-systemic-remediation
git pull --ff-only origin codex/story-ad-systemic-remediation
git status --short
git rev-parse HEAD
npm install
node src/server.js
```

启动后访问：`http://localhost:3007/story-ad/`

核对本地版本：

```powershell
Invoke-RestMethod http://localhost:3007/api/story-ad/version | ConvertTo-Json -Depth 5
```

必须看到：

- `build_id = 20260814-sr14-v22`
- artifact 为 `84234a3086f29e8fba655a40b6159d845342f4030717a59a95f74329a3c3dbc6`
- runtime hash 为 `3b41f87d52c41b37b06ce6aaf5bd47927cfa796e1f8ae472169edcb672504a2a`

## 8. 公司测试顺序

### 第一阶段：只读冒烟

1. 打开首页和 `/story-ad/`，确认无 404、白屏、乱码或旧页面跳转。
2. 打开已有项目，核对人物、动物、商品、场景、Active Plan、剧情、分镜和成片记录。
3. 刷新、退出重进、跨步骤返回，确认状态未丢失、没有换 ID 或回到旧方案。
4. 核对媒体列表分页、缩略图和按需查看速度。

### 第二阶段：零付费编辑

1. 新建广告、剧情、漫剧各一个草稿，只填写基础信息，不触发生成。
2. 保存并重进，验证内容类型和用户目标不被参考材料或 AI 建议覆盖。
3. 对方案执行候选重规划，确认未确认候选不会替换 Active Plan。
4. 修改剧情或单个场景，确认只失效真实依赖的下游，不清空无关人物、场景和资产。

### 第三阶段：费用前检查

1. 在任何图片/视频生成前先检查当前任务是否存在 active generation 或 unknown billing。
2. 未知计费必须人工确认；禁止刷新后盲目重试、批量重提或更换供应商重提。
3. 视频成片按用户决定由用户自行操作；本交接不授权自动触发新的付费视频调用。

## 9. 验证过程与未执行项

本轮实际执行：

- `git fetch --all --prune`，origin/Gitee 最新分支核对。
- 本地与 origin `ahead/behind=0/0`。
- 本地、公网 `/api/story-ad/version` 完整身份对比。
- 生产 709 项 runtime manifest 文件 SHA-256 逐项核对，mismatch 0；manifest 自身 SHA 与本地相同。
- SSH 核对 `/opt/vido/current`、PM2、内外网健康、SQLite 和系统性数据审计。
- GitHub 镜像推送与远端读取重试，均因当前网络无法连接 `github.com:443` 失败。

未执行项：

- 未运行全平台/跨版本完整回归；当前家庭电脑 `LAPTOP-LDFOL0GT` 按既定硬门禁只允许相关定向验证。
- 本轮仅做交接核对，没有重复执行已通过的 V22 发布门禁，也没有重新部署生产。
- 未触发任何模型、图片、视频或付费任务。

剩余风险：

- GitHub 非权威镜像落后，务必从 origin/Gitee 拉取。
- 11 个历史任务仍有“未知计费待人工复核”警告，但均已隔离，不会自动重提。
- 广告和漫剧的真实视频成片未在本轮付费验证；剧情已有三段真实视频及 20 秒可播放合成证据，但不等于三类生产成片全部验收。

