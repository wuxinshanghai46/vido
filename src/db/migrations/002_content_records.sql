CREATE TABLE IF NOT EXISTS content_records (
  id TEXT NOT NULL,
  collection TEXT NOT NULL,
  user_id TEXT,
  project_id TEXT,
  account_id TEXT,
  type TEXT,
  status TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS idx_content_records_collection_updated ON content_records(collection, updated_at);
CREATE INDEX IF NOT EXISTS idx_content_records_user_collection ON content_records(user_id, collection);
CREATE INDEX IF NOT EXISTS idx_content_records_project_collection ON content_records(project_id, collection);
CREATE INDEX IF NOT EXISTS idx_content_records_type_status ON content_records(collection, type, status);

