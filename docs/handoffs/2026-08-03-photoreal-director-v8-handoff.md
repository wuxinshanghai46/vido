# VIDO 人物真实感与 3D 导演台升级交接

> 日期：2026-08-03  
> 分支：`codex/story-ad-v3-upgrade`  
> 生产功能提交：`c5431e5f88371192681afddd353061126f15d3b8`  
> 生产版本：`20260803-photoreal-director-v8 / director-scene-v1`

## 目标与通用性

本轮升级适用于所有行业、人物数量、商品类型和场景，不包含按客厅、汽车、美妆等具体业务写死的生成分支。行业差异继续来自用户输入、参考材料、人物/场景权威资产和镜头内容。

## 修改前后数据流

修改前：用户输入 → 人物四类低分辨率图集/场景五图 → 固定优先级截取少量参考 → 关键帧/视频；场景世界的机位和人物分配没有编译为逐镜参考，页面版本依赖散落的静态常量。

修改后：用户输入 → 现有人物/场景补齐 → 人物四类图集 + 原生脸部/全身主图 → 人物/场景真实感 QA → DirectorScene 仅引用权威实体 ID、revision、机位、FOV、变换和轨迹 → ShotReferencePack 按镜头编译人物/场景/商品/机位参考 → 关键帧 → 1080p 视频 → 时间连续性、真实感、人体结构与最终 QA。

发布链路：单一 release 配置 → 构建生成 `release.js` 和 SHA-256 manifest → 服务启动前完整性校验 → HTML/未版本化模块 no-store → 带版本资源 immutable → 长开标签页版本心跳 → 旧客户端写入 HTTP 426。

## 主要变更

- 人物：新增原生脸部和全身主图、皮肤/毛发/脸部锐度/光照融合/跨帧漂移门禁，并保留既有服装、鞋履、饰品和年龄权威输入。
- 场景与导演台：新增通用 3D 场景代理、人物/商品位置、机位 FOV、轨迹、截图和 revision 冲突保护；不复制第二份人物或场景正文。
- 逐镜参考：人物、商品、场景、机位和导演截图按当前 revision 编译，旧资产可查看但不会被新生成静默复用。
- 媒体查看：人物、场景和其他主卡统一支持原尺寸、缩放、平移和同组切换。
- 视频：新项目默认最终 1080p，已有项目显式分辨率保持不变；新增时间连续性、真实感和人体结构 QA。
- 性能：首屏核心 gzip 98,739B；3D 依赖 gzip 195,689B，仅在点击 3D 导演台后懒加载。

## Git、生产与三方一致性

| 项目 | 结论 |
|---|---|
| 本地 / Gitee | 功能提交 `c5431e5` 已推送，发布前后核对 ahead/behind 0/0 |
| GitHub 镜像 | `codex/story-ad-v3-upgrade` 已同步到 `c5431e5` |
| 生产运行文件 | 发布清单 63/63 SHA-256 与本地一致，差异 0 |
| 生产仓库 HEAD | 历史 detached HEAD 不作为运行代码权威；运行文件以发布清单哈希为准 |
| 未跟踪文档 | 用户原有 5 个研究文档未修改、未提交、未覆盖 |

续接命令：

```powershell
git status --short
git fetch --all --prune
git switch codex/story-ad-v3-upgrade
git pull --ff-only origin codex/story-ad-v3-upgrade
npm install
npm run platform:upgrade:test
node src/server.js
```

本地访问：<http://localhost:3007>  
生产访问：<https://vido.smsend.cn/story-ad/>

## 验证过程

- 47 个修改/新增 JS 文件语法检查通过，`git diff --check` 通过。
- `story-ad:dossier:test`、`story-ad:v6:test`、`story-ad:v2:test`、平台加载/能力与视频画布测试全部通过。
- 120 镜性能回归：轮询载荷 744B；Director 工作区 120 镜分页载荷 59,393B，无机位字段泄漏。
- 真实浏览器：3D 模块动态加载成功、2 个 canvas 渲染、模块错误 0；媒体弹窗缩放 100% → 125%。
- 生产隔离完整平台回归退出码 0；发布前后活动任务均 0，真实模型调用 0。
- 生产 PM2 online；内外网健康 ok；数据库 ok；SQLite `quick_check=ok`；build/contract 正确。
- 缓存和旧版本：版本化资源 immutable、未版本化资源 no-store、旧客户端写请求 HTTP 426。

未执行项：未执行真实人物、场景或视频生成，避免重复计费和覆盖业务资产。该项不阻塞功能验收；用户验收时应使用新建测试项目或明确可重生成的测试资产。

剩余风险：Three.js 属于按需加载的第三方依赖，低性能设备首次打开 3D 导演台仍会产生约 195KB gzip 下载；不影响首屏和二维资产流程。生产回滚备份为 `/opt/vido/backups/story-ad-photoreal-director-v8-20260803151728`。
