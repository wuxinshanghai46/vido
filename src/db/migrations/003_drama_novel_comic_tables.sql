CREATE TABLE IF NOT EXISTS novels (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  project_id TEXT,
  type TEXT,
  status TEXT,
  title TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comic_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  project_id TEXT,
  type TEXT,
  status TEXT,
  title TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drama_projects (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  project_id TEXT,
  type TEXT,
  status TEXT,
  title TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drama_episodes (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  project_id TEXT,
  type TEXT,
  status TEXT,
  title TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_novels_user_updated ON novels(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_comic_tasks_user_updated ON comic_tasks(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_drama_projects_user_updated ON drama_projects(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_drama_episodes_project_updated ON drama_episodes(project_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_drama_episodes_user_status ON drama_episodes(user_id, status);
