CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_kv (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT,
  phone TEXT,
  email TEXT,
  password_hash TEXT,
  role TEXT,
  status TEXT DEFAULT 'active',
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  type TEXT NOT NULL,
  title TEXT,
  status TEXT,
  current_step TEXT,
  locked_step TEXT,
  source TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_steps (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  step_key TEXT NOT NULL,
  status TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  locked_at TEXT,
  completed_at TEXT,
  data_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, step_key),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  source_step TEXT,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, version_no),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS generation_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  user_id TEXT,
  module TEXT NOT NULL,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER DEFAULT 0,
  provider TEXT,
  model TEXT,
  input_json TEXT,
  output_json TEXT,
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  task_id TEXT,
  type TEXT NOT NULL,
  file_path TEXT,
  public_url TEXT,
  mime_type TEXT,
  size INTEGER,
  hash TEXT,
  width INTEGER,
  height INTEGER,
  duration REAL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS luxury_ad_projects (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  brand TEXT,
  product TEXT,
  audience TEXT,
  style TEXT,
  status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS luxury_ad_briefs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  requirement_text TEXT,
  selling_points_json TEXT,
  constraints_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS luxury_ad_characters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT,
  role TEXT,
  gender TEXT,
  age_range TEXT,
  wardrobe_style TEXT,
  appearance_json TEXT,
  prompt TEXT,
  image_artifact_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (image_artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS luxury_ad_scenes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT,
  location TEXT,
  atmosphere TEXT,
  props_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS luxury_ad_script_segments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  segment_no INTEGER NOT NULL,
  duration REAL,
  narration TEXT,
  dialogue TEXT,
  action TEXT,
  objective TEXT,
  scene_id TEXT,
  character_ids_json TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, segment_no),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (scene_id) REFERENCES luxury_ad_scenes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS luxury_ad_keyframes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  segment_id TEXT,
  shot_no INTEGER NOT NULL,
  purpose TEXT,
  camera TEXT,
  action TEXT,
  prompt TEXT,
  status TEXT,
  image_artifact_id TEXT,
  qa_status TEXT,
  qa_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, shot_no),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (segment_id) REFERENCES luxury_ad_script_segments(id) ON DELETE SET NULL,
  FOREIGN KEY (image_artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS luxury_ad_videos (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  keyframe_id TEXT,
  video_artifact_id TEXT,
  provider TEXT,
  model TEXT,
  status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (keyframe_id) REFERENCES luxury_ad_keyframes(id) ON DELETE SET NULL,
  FOREIGN KEY (video_artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  category TEXT NOT NULL,
  name TEXT,
  source TEXT,
  status TEXT,
  artifact_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS actor_assets (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  actor_type TEXT,
  gender TEXT,
  age_range TEXT,
  wardrobe_style TEXT,
  style_tags_json TEXT,
  prompt TEXT,
  consistency_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS voices (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT,
  provider TEXT,
  voice_key TEXT,
  asset_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS model_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  model_key TEXT NOT NULL,
  display_name TEXT,
  capability TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER DEFAULT 0,
  cost_config_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider_id, model_key),
  FOREIGN KEY (provider_id) REFERENCES model_providers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pipeline_routes (
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  step_key TEXT NOT NULL,
  provider_model_id TEXT NOT NULL,
  fallback_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (provider_model_id) REFERENCES provider_models(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  collection_id TEXT,
  title TEXT NOT NULL,
  content TEXT,
  tags_json TEXT,
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (collection_id) REFERENCES knowledge_collections(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding_ref TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(document_id, chunk_index),
  FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  project_id TEXT,
  task_id TEXT,
  provider TEXT,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  image_count INTEGER DEFAULT 0,
  video_seconds REAL DEFAULT 0,
  cost_estimate REAL DEFAULT 0,
  status TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_user_updated ON projects(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_projects_type_status ON projects(type, status);
CREATE INDEX IF NOT EXISTS idx_steps_project_locked ON project_steps(project_id, locked);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON generation_tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_updated ON generation_tasks(updated_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_project_type ON artifacts(project_id, type);
CREATE INDEX IF NOT EXISTS idx_luxury_segments_project_no ON luxury_ad_script_segments(project_id, segment_no);
CREATE INDEX IF NOT EXISTS idx_luxury_keyframes_project_shot ON luxury_ad_keyframes(project_id, shot_no);
CREATE INDEX IF NOT EXISTS idx_assets_user_category ON assets(user_id, category);
CREATE INDEX IF NOT EXISTS idx_usage_project_time ON usage_records(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_type, target_id);

