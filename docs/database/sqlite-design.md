# VIDO SQLite 数据库化设计

> 目标：整个平台结构化数据全面入库，现有业务不中断，迁移过程可验证、可回滚、可审计。

## 执行原则

- 不影响现有业务：数据库化初期不改变现有 API 响应结构，不删除 JSON 存储。
- 不兜底乱写：任何迁移失败都必须暴露错误和校验报告，不静默吞掉数据异常。
- 不写死业务值：数据库路径、启用状态、读写模式、迁移批次均通过环境变量或 migrations 管理。
- 媒体不入库：图片、音频、视频继续放文件系统或对象存储，数据库只保存路径、URL、hash 和元数据。
- 先双写再切读：先 SQLite + JSON 双写，数据校验通过后再按模块切换 SQLite 主读。
- 只追加迁移：schema 变更必须新增 migration，不直接修改已应用 migration。

## 运行配置

本地默认数据库路径：

```text
outputs/vido-dev.sqlite
```

生产建议数据库路径：

```text
/opt/vido/data/vido.sqlite
```

环境变量：

```text
DB_TYPE=sqlite
DB_PATH=/opt/vido/data/vido.sqlite
DB_ENABLED=false
DB_DUAL_WRITE=false
DB_READ_PRIMARY=false
DB_JSON_FALLBACK=true
```

含义：

- `DB_ENABLED`：是否初始化 SQLite。
- `DB_DUAL_WRITE`：是否在保持 JSON 写入的同时写入 SQLite。
- `DB_READ_PRIMARY`：是否优先从 SQLite 读取。
- `DB_JSON_FALLBACK`：SQLite 未命中时是否允许回退 JSON。

生产切换顺序必须是：

```text
DB_ENABLED=true
DB_DUAL_WRITE=true
DB_READ_PRIMARY=false
DB_JSON_FALLBACK=true
```

校验通过后再切：

```text
DB_ENABLED=true
DB_DUAL_WRITE=true
DB_READ_PRIMARY=true
DB_JSON_FALLBACK=true
```

稳定后最后切：

```text
DB_ENABLED=true
DB_DUAL_WRITE=false
DB_READ_PRIMARY=true
DB_JSON_FALLBACK=false
```

## SQLite 参数

启动时统一设置：

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

## 数据分层

```text
routes
  -> services
    -> repositories
      -> src/db/sqlite.js
```

路由层不得直接拼 SQL。业务模块必须通过 repository 写入。

## 表分组

- 系统：`schema_migrations`, `app_kv`
- 用户：`users`, `user_sessions`
- 项目：`projects`, `project_steps`, `project_versions`
- 任务：`generation_tasks`, `task_events`
- 产物：`artifacts`
- 剧情广告：`luxury_ad_projects`, `luxury_ad_briefs`, `luxury_ad_characters`, `luxury_ad_scenes`, `luxury_ad_script_segments`, `luxury_ad_keyframes`, `luxury_ad_videos`
- 素材：`assets`, `actor_assets`, `voices`
- 模型：`model_providers`, `provider_models`, `pipeline_routes`
- 知识库：`knowledge_collections`, `knowledge_documents`, `knowledge_chunks`
- 使用量：`usage_records`
- 审计：`audit_logs`

## 步骤锁定

所有流程模块统一使用 `project_steps.locked` 控制前后端修改权限。前端禁用只是体验层，后端必须二次校验。

规则：

```text
进入第 2 步：锁第 1 步
进入第 3 步：锁第 1、2 步
进入第 4 步：锁第 1、2、3 步
进入第 5 步：锁第 1、2、3、4 步
```

如果用户需要修改已锁步骤，应创建新版本或复制项目，不允许覆盖当前链路。

## 版本保留

剧本、分镜、视频等关键阶段变更前，写入 `project_versions`，保存快照和来源步骤。

## 回滚

上线初期回滚只改环境变量：

```text
DB_READ_PRIMARY=false
DB_JSON_FALLBACK=true
DB_DUAL_WRITE=true
```

这样读取立即回到 JSON，同时继续保留数据库写入，便于排查。

