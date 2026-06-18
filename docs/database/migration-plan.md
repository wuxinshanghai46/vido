# VIDO SQLite 迁移步骤

## 阶段 0：确认边界

- 不改现有接口返回结构。
- 不删除任何 JSON 文件。
- 不直接改线上数据。
- 所有迁移脚本必须支持 dry run。
- 所有写库逻辑必须通过 repository。

## 阶段 1：数据库底座

- 安装 SQLite 驱动。
- 新增 `src/db/sqlite.js`。
- 新增 `src/db/migrations/001_init.sql`。
- 新增 migration runner。
- 新增配置读取：`DB_ENABLED`, `DB_PATH`, `DB_READ_PRIMARY`, `DB_DUAL_WRITE`, `DB_JSON_FALLBACK`。
- 本阶段不切业务读写。

验收：

- `node scripts/db/run-migrations.js --dry-run` 可列出待执行 migration。
- `DB_ENABLED=true node scripts/db/run-migrations.js` 可创建数据库。
- 重复执行 migration 不重复写入。

## 阶段 2：双写基础能力

- 新增基础 repository。
- 每个 repository 支持 SQLite 写入和 JSON 旧写入。
- 默认 `DB_DUAL_WRITE=false`。
- 单模块开启双写必须单独配置。

验收：

- JSON 写入结果和旧逻辑一致。
- SQLite 写入失败时请求不得静默成功，必须写错误日志并返回可排查错误。

## 阶段 3：剧情广告入库

- 迁移 `luxury_ad_projects.json`。
- 拆分需求、人物、场景、剧本段落、分镜、视频。
- 接入 `project_steps` 锁定。
- 列表、详情、保存接口通过 repository。

验收：

- 老项目可完整读取。
- 分镜、剧本、人物数量一致。
- 进入下一步后，上一步后端不可修改。
- 页面刷新后状态一致。

## 阶段 4：统一任务和产物

- 所有生成类模块写入 `generation_tasks`。
- 生成过程写入 `task_events`。
- 文件路径写入 `artifacts`。

验收：

- 任一项目能追踪完整生成链路。
- 失败任务能看到 provider、model、error。

## 阶段 5：素材和配置

- 素材库入 `assets`。
- 演员包入 `actor_assets`。
- 声音入 `voices`。
- 模型配置入 `model_providers`, `provider_models`, `pipeline_routes`。
- API Key 仍优先来自环境变量，数据库不强制保存明文密钥。

## 阶段 6：知识库和使用量

- 知识库入 `knowledge_*`。
- 使用量入 `usage_records`。
- 旧 jsonl 保留为审计源。

## 阶段 7：切换主读

- 单模块开启 `DB_READ_PRIMARY=true`。
- 保持 `DB_JSON_FALLBACK=true` 至少一个完整业务周期。
- 校验无误后关闭 JSON fallback。

## 阶段 8：备份和归档

- 每日备份 SQLite。
- JSON 导出变成手动备份能力。
- 历史 JSON 不再作为主业务写入目标。

