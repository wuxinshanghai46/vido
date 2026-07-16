CREATE TABLE IF NOT EXISTS video_canvas_projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  domain_pack TEXT NOT NULL DEFAULT 'blank',
  status TEXT NOT NULL DEFAULT 'active',
  current_revision_id TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  legacy_workflow_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS video_canvas_graph_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  revision_no INTEGER NOT NULL,
  base_revision_id TEXT,
  graph_schema_version INTEGER NOT NULL DEFAULT 1,
  graph_json TEXT NOT NULL,
  graph_fingerprint TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, revision_no),
  FOREIGN KEY(project_id) REFERENCES video_canvas_projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS video_canvas_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  plan_fingerprint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  requested_nodes_json TEXT NOT NULL DEFAULT '[]',
  estimated_cost_min REAL NOT NULL DEFAULT 0,
  estimated_cost_max REAL NOT NULL DEFAULT 0,
  confirmed_cost_limit REAL NOT NULL DEFAULT 0,
  actual_cost REAL NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  queued_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, idempotency_key),
  FOREIGN KEY(project_id) REFERENCES video_canvas_projects(id) ON DELETE CASCADE,
  FOREIGN KEY(revision_id) REFERENCES video_canvas_graph_revisions(id)
);

CREATE TABLE IF NOT EXISTS video_canvas_node_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  node_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  dependency_ids_json TEXT NOT NULL DEFAULT '[]',
  reused_from_node_run_id TEXT,
  artifact_ids_json TEXT NOT NULL DEFAULT '[]',
  estimated_cost REAL NOT NULL DEFAULT 0,
  actual_cost REAL NOT NULL DEFAULT 0,
  billing_state TEXT NOT NULL DEFAULT 'not_submitted',
  retryable INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  queued_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, node_id),
  FOREIGN KEY(run_id) REFERENCES video_canvas_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS video_canvas_node_attempts (
  id TEXT PRIMARY KEY,
  node_run_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  provider_task_id TEXT,
  billing_state TEXT NOT NULL DEFAULT 'not_submitted',
  estimated_cost REAL NOT NULL DEFAULT 0,
  actual_cost REAL NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE(node_run_id, attempt_no),
  FOREIGN KEY(node_run_id) REFERENCES video_canvas_node_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS video_canvas_provider_tasks (
  id TEXT PRIMARY KEY,
  node_attempt_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  provider_task_id TEXT,
  request_fingerprint TEXT NOT NULL,
  submission_state TEXT NOT NULL,
  provider_status TEXT NOT NULL,
  billing_state TEXT NOT NULL DEFAULT 'unknown',
  request_summary_json TEXT NOT NULL DEFAULT '{}',
  response_summary_json TEXT NOT NULL DEFAULT '{}',
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_task_id),
  FOREIGN KEY(node_attempt_id) REFERENCES video_canvas_node_attempts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS video_canvas_artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  node_run_id TEXT,
  kind TEXT NOT NULL,
  storage_path TEXT,
  public_url TEXT,
  sha256 TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  duration_sec REAL NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  input_fingerprint TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES video_canvas_projects(id) ON DELETE CASCADE,
  FOREIGN KEY(node_run_id) REFERENCES video_canvas_node_runs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS video_canvas_artifact_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_artifact_id TEXT NOT NULL,
  target_artifact_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES video_canvas_projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS video_canvas_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_run_id TEXT,
  sequence_no INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(run_id, sequence_no),
  FOREIGN KEY(run_id) REFERENCES video_canvas_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS video_canvas_cost_ledger (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_run_id TEXT,
  node_attempt_id TEXT,
  entry_type TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  amount_usd REAL NOT NULL DEFAULT 0,
  billing_state TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  unit TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES video_canvas_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS video_canvas_idempotency_keys (
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  run_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS video_canvas_worker_leases (
  node_run_id TEXT PRIMARY KEY,
  lease_owner TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  FOREIGN KEY(node_run_id) REFERENCES video_canvas_node_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS video_canvas_settings (
  user_id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vc_projects_user_updated ON video_canvas_projects(user_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vc_projects_legacy ON video_canvas_projects(user_id, legacy_workflow_id);
CREATE INDEX IF NOT EXISTS idx_vc_revisions_project_created ON video_canvas_graph_revisions(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vc_runs_project_created ON video_canvas_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vc_runs_status_queued ON video_canvas_runs(status, queued_at);
CREATE INDEX IF NOT EXISTS idx_vc_node_runs_status_priority ON video_canvas_node_runs(status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_vc_node_runs_run ON video_canvas_node_runs(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_vc_attempts_node ON video_canvas_node_attempts(node_run_id, attempt_no);
CREATE INDEX IF NOT EXISTS idx_vc_provider_status ON video_canvas_provider_tasks(provider_status, last_checked_at);
CREATE INDEX IF NOT EXISTS idx_vc_artifacts_project_created ON video_canvas_artifacts(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vc_artifacts_sha ON video_canvas_artifacts(sha256);
CREATE INDEX IF NOT EXISTS idx_vc_events_run_sequence ON video_canvas_events(run_id, sequence_no);
CREATE INDEX IF NOT EXISTS idx_vc_cost_run ON video_canvas_cost_ledger(run_id, created_at);
