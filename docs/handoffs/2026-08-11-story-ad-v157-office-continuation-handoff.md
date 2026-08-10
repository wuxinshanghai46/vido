# VIDO 剧情资产提示修复 v157 · 公司续接交接

> 日期：2026-08-11（Asia/Shanghai）
> 分支：`codex/story-ad-v3-upgrade`
> 生产：`43.98.167.151` / PM2 `vido`
> 本轮只执行任务与相邻模块的定向验证，没有在家庭电脑运行完整平台回归。

## 1. 当日目标与用户决策

- 剧情项目不应把空的“商品 / 展示主体、LOGO”等广告资产类别提示为缺失项。
- 合同未通过时只向用户说明“版本合同未通过”，不暴露“付费生成已锁定”、Active Plan、模型调用锁等内部实现术语。
- 家庭电脑 `LAPTOP-LDFOL0GT` 只运行本任务、相邻成功/失败路径和必要发布健康检查，不运行完整平台回归。
- 修复需发布生产，再核对本地、目标 Git、生产运行制品，并提交本交接文件供公司电脑续接。

## 2. 修改前后的完整数据流

### 修改前

`projectBundleService` 根据内容模式投影资产 → 剧情模式的商品/LOGO数组合法为空 → `assetCenterView.renderSections()` 遍历固定分组并把所有空数组推断为“尚未建立” → 剧情用户看到广告专属缺失提示。

版本合同状态由后端 `navigation.asset_plan_eligibility` 返回 → 前端正确阻止不满足合同的生成入口 → 状态卡却显示“付费生成已锁定”和 Active Plan 等内部词汇。

### 修改后

`projectBundleService` 的资产投影和合同权威状态不变 → 前端不再从空数组自行推断合同缺项 → 剧情项目只按实际资产与权威合同状态展示；剧情确认范围使用“人物、动物与场景”，商业模式仍可包含商品。

`asset_plan_eligibility.eligible` 仍是唯一合同门禁 → 未通过时按钮保持禁用 → 用户卡片仅显示“版本合同未通过”和下一步处理建议；付费、Active Plan、模型调用锁等内部实现细节不再暴露。

## 3. 代码与文件变更

- `public/story-ad/views/assetCenterView.js`：删除基于固定分组空数组生成的缺失横条；增加内容模式感知的资产范围；合同卡仅展示版本合同结果。
- `scripts/test-story-ad-workspace-v6-ui-regressions.js`：覆盖剧情模式无广告缺失横条、无付费锁文案、有合同状态及剧情资产范围。
- `scripts/test-story-ad-platform-narrative-release-v111.js`：同步合同门禁语义断言，保留权威合同状态验证。
- `scripts/deploy-story-ad-immutable-release.js`：家庭电脑发布前只运行已批准的定向门禁；其他机器仍保留原完整门禁。
- `scripts/test-story-ad-immutable-deploy-transport.js`：覆盖家庭电脑定向门禁选择与输出状态。
- v157 发布配置、runtime/public 清单及静态资源版本引用：生成不可变发布身份与逐文件哈希。

## 4. 提交记录与公司电脑续接

- `26046b64` — `fix(story-ad): align asset notices with content contract`
- `517e3796` — `test(story-ad): align narrative contract gate`（v157 代码发布基线）
- 交接 MD 随本轮最终文档提交推送到同一分支；公司电脑应以远端最新 HEAD 为准。

```powershell
git status --short
git fetch --all --prune
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
git log -3 --oneline
npm install
node src/server.js
```

拉取前如有未提交内容，先保存或提交；不要执行 `git reset --hard`。

## 5. 本地、Git、生产三方一致性

| 核对项 | 本地 | 目标 Git | 生产 | 结论 |
|---|---|---|---|---|
| 代码基线 | `517e37968f499bb9e39d83415d76e09b96dad9c5` | origin、gitee 同 SHA，`0/0` | 以不可变运行清单为准 | 代码已同步 |
| Build | `20260811-ui-v157` | v157 清单已提交 | `20260811-ui-v157` | 一致 |
| Artifact | `5177c4f0288bce80a26a4101d18523b0fee42f9ae41c7123f3228a1cd7cfdf99` | runtime manifest 同值 | 当前 release 目录同值 | 一致 |
| Runtime | 642 项，hash `23e36bc55187ee20faac8b13af8e635c08149691de03c8ee894ff9e82d393c34` | runtime manifest 同值 | 642 项逐文件通过、hash 同值 | 一致 |
| Story-ad Public | 47 项逐文件通过 | release manifest 同值 | 47 项逐文件通过 | 一致 |
| GitHub 镜像 | 本地相对镜像 ahead 60 / behind 0 | 镜像仍在 `c6b9d00d` | 不作为生产发布权威源 | 尚未同步，不影响 origin/gitee/生产一致性 |

工作树中仍保留 5 个本轮开始前即存在的未跟踪文档，没有删除、覆盖或纳入本次提交。

## 6. 实际执行的验证

- 静态检查：修改脚本 `node --check` 通过。
- UI 定向回归：`test-story-ad-workspace-v6-ui-regressions.js` 通过。
- 剧情合同/相邻路径：`test-story-ad-platform-narrative-release-v111.js` 通过；3 场、6 个节拍、合同状态矩阵 8、并发任务 50、重复许可 0、付费供应商调用 0、发布文件检查 643。
- 发布传输：`test-story-ad-immutable-deploy-transport.js` 13 项通过，含 10,000 文件合成清单边界与家庭电脑定向门禁选择。
- 模块边界与发布闭环：workspace v6 边界、release integrity/transport/atomicity/closure/assist route 均通过。
- 不可变生产发布：643 文件上传、逐项校验、候选启动、原子切流和发布后核验通过。
- 生产健康：PM2 `vido` 在线（PID 25554）；内网、公网 health 均 `ok`；数据库 `ok`；SQLite quick check `ok`。
- 生产安全边界：切流前后活动任务 0、未知计费任务 0；迁移模型调用 0、付费调用 0。
- 生产静态资源：旧 `asset-missing-strip` 与“付费生成已锁定”均不存在；“版本合同未通过”“人物、动物与场景”与 `contractDisabled` 均存在。

## 7. 未执行项、剩余风险、费用与数据边界

- 未执行完整平台回归：遵循用户对家庭电脑的明确限制；公司电脑如需发布其他模块，再按对应范围补跑。
- 浏览器自动化可打开生产 `/story-ad/`，但两次进入指定历史项目详情页均在 60 秒内加载超时；因此本轮没有把项目详情页人工可见截图列为已通过。生产静态资源、合同 DOM 回归、制品哈希和健康接口均已通过。
- 本轮没有触发人物、场景、图片、视频或其他模型生成，没有新增费用，也没有覆盖任务数据。
- 既有供应商 500 后“提交已发生但计费未知”的安全核账/自动恢复问题不在本次 UI 文案修复范围内，仍不可盲目自动重提。
- v155/v156 仅为本地构建中间版本，未部署；生产直接从 v154 原子切换到 v157。

## 8. 下次继续优化入口

1. 公司电脑拉取远端最新 HEAD，先复查工作树和 v157 build 身份。
2. 使用已登录浏览器打开剧情项目资产中心，人工确认：无广告缺失横条；合同失败卡仅显示版本合同结果。
3. 若继续处理供应商 500，先完成请求 ID/供应商任务/账单核对契约，再实现“明确未计费后只重试缺失项”；禁止对计费未知的已提交请求盲目重放。
4. 若改动超出本次资产中心模块，再根据实际影响选择公司电脑上的相应回归范围。
