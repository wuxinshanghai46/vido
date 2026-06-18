# VIDO 模块到数据库表映射

> 本文件作为迁移任务清单。新增模块必须先补映射，再写迁移和 repository。

## JSON 文件映射

| 当前存储 | 目标表 |
| --- | --- |
| `outputs/auth_db.json` | `users`, `user_sessions`, `audit_logs` |
| `outputs/project_db.json` | `projects`, `project_steps`, `project_versions`, `artifacts` |
| `outputs/luxury_ad_projects.json` | `luxury_ad_projects`, `luxury_ad_briefs`, `luxury_ad_characters`, `luxury_ad_scenes`, `luxury_ad_script_segments`, `luxury_ad_keyframes`, `luxury_ad_videos`, `generation_tasks`, `artifacts` |
| `outputs/i2v_db.json` | `generation_tasks`, `artifacts`, `projects` |
| `outputs/novel_db.json` | `projects`, `generation_tasks`, `artifacts` |
| `outputs/asset_db.json` | `assets`, `artifacts` |
| `outputs/comic_db.json` | `projects`, `generation_tasks`, `artifacts` |
| `outputs/portrait_db.json` | `assets`, `actor_assets`, `artifacts` |
| `outputs/avatar_db.json` | `projects`, `generation_tasks`, `artifacts` |
| `outputs/publish_db.json` | `projects`, `artifacts`, `audit_logs` |
| `outputs/voice_db.json` | `voices`, `assets`, `artifacts` |
| `outputs/monitor_db.json` | `projects`, `generation_tasks`, `audit_logs` |
| `outputs/content_db.json` | `projects`, `assets`, `audit_logs` |
| `outputs/subscription_db.json` | `app_kv`, `audit_logs` |
| `outputs/replicate_db.json` | `generation_tasks`, `task_events`, `artifacts` |
| `outputs/ai_characters.json` | `assets`, `actor_assets` |
| `outputs/ai_scenes.json` | `assets` |
| `outputs/ai_styles.json` | `app_kv` |
| `outputs/knowledge_base.json` | `knowledge_collections`, `knowledge_documents`, `knowledge_chunks` |
| `outputs/token_usage.json` | `usage_records` |
| `outputs/usage_log.jsonl` | `usage_records`, `task_events` |
| `outputs/drama_db.json` | `projects`, `project_steps`, `generation_tasks`, `artifacts` |
| `outputs/settings.json` | `model_providers`, `provider_models`, `pipeline_routes`, `app_kv` |
| `outputs/workflow_db.json` | `projects`, `project_steps`, `generation_tasks`, `task_events`, `artifacts` |
| `outputs/pipeline_model_config.json` | `pipeline_routes`, `provider_models`, `app_kv` |
| `outputs/search_providers.json` | `app_kv` |
| `outputs/daily_learn_state.json` | `app_kv`, `audit_logs` |

## 媒体目录映射

| 当前目录 | 数据库记录 |
| --- | --- |
| `outputs/assets/` | `artifacts`, `assets` |
| `outputs/portraits/` | `artifacts`, `actor_assets` |
| `outputs/jimeng-assets/` | `artifacts`, `generation_tasks` |
| `outputs/dh-assets/` | `artifacts`, `generation_tasks` |
| `outputs/workflow-assets/` | `artifacts`, `generation_tasks` |
| `outputs/music/` | `artifacts` |
| `outputs/voice/` | `artifacts`, `voices` |
| `outputs/dramas/` | `artifacts`, `projects` |
| `outputs/comics/` | `artifacts`, `projects` |

## 优先级

1. 基础表、迁移系统、配置开关。
2. 剧情广告模块。
3. 统一任务和产物。
4. 素材库、演员包、声音库。
5. 模型配置、知识库、使用量。
6. 旧 JSON 降级为导出和备份。
