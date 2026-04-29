import type Database from "better-sqlite3";

interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: "初始建表：tasks, segments, douyin_videos, video_snapshots, bloggers, voices",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          original_path TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          total_segments INTEGER DEFAULT 0,
          completed_segments INTEGER DEFAULT 0,
          result TEXT,
          error TEXT,
          duration_seconds REAL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);

        CREATE TABLE IF NOT EXISTS segments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          segment_index INTEGER NOT NULL,
          file_path TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          start_time REAL NOT NULL DEFAULT 0,
          end_time REAL,
          result TEXT,
          error TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_segments_task ON segments(task_id);

        CREATE TABLE IF NOT EXISTS douyin_videos (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          url TEXT NOT NULL DEFAULT '',
          thumbnail TEXT NOT NULL DEFAULT '',
          duration INTEGER DEFAULT 0,
          like_count INTEGER DEFAULT 0,
          comment_count INTEGER DEFAULT 0,
          share_count INTEGER DEFAULT 0,
          collect_count INTEGER DEFAULT 0,
          uploader TEXT NOT NULL DEFAULT '',
          uploader_id TEXT NOT NULL DEFAULT '',
          uploader_avatar TEXT NOT NULL DEFAULT '',
          upload_date TEXT NOT NULL DEFAULT '',
          video_url TEXT NOT NULL DEFAULT '',
          local_path TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS video_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          video_id TEXT NOT NULL,
          like_count INTEGER DEFAULT 0,
          comment_count INTEGER DEFAULT 0,
          share_count INTEGER DEFAULT 0,
          collect_count INTEGER DEFAULT 0,
          view_count INTEGER DEFAULT 0,
          snapshot_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_snapshots_video ON video_snapshots(video_id);

        CREATE TABLE IF NOT EXISTS bloggers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          unique_id TEXT NOT NULL DEFAULT '',
          avatar TEXT NOT NULL DEFAULT '',
          sec_uid TEXT NOT NULL DEFAULT '',
          url TEXT NOT NULL DEFAULT '',
          follower_count INTEGER DEFAULT 0,
          video_count INTEGER DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS voices (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          audio_path TEXT NOT NULL,
          ref_text TEXT NOT NULL DEFAULT '',
          duration_seconds REAL,
          cosyvoice_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 2,
    description: "添加 view_count 字段到 douyin_videos",
    up(db) {
      // 安全地添加列（如果不存在）
      const cols = db.prepare("PRAGMA table_info(douyin_videos)").all() as { name: string }[];
      if (!cols.some(c => c.name === "view_count")) {
        db.exec("ALTER TABLE douyin_videos ADD COLUMN view_count INTEGER DEFAULT 0");
      }
    },
  },
  {
    version: 3,
    description: "添加 auto_fetch_enabled 字段到 bloggers",
    up(db) {
      const cols = db.prepare("PRAGMA table_info(bloggers)").all() as { name: string }[];
      if (!cols.some(c => c.name === "auto_fetch_enabled")) {
        db.exec("ALTER TABLE bloggers ADD COLUMN auto_fetch_enabled INTEGER DEFAULT 0");
      }
      if (!cols.some(c => c.name === "last_fetched_at")) {
        db.exec("ALTER TABLE bloggers ADD COLUMN last_fetched_at TEXT");
      }
    },
  },
];

export function runMigrations(db: Database.Database): void {
  // 创建迁移版本表
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      description TEXT,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const currentVersion = (db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null })?.v ?? 0;

  const pending = migrations.filter(m => m.version > currentVersion);
  if (!pending.length) return;

  console.log(`[DB] 当前版本 v${currentVersion}，待执行 ${pending.length} 个迁移`);

  for (const m of pending) {
    console.log(`[DB] 执行迁移 v${m.version}: ${m.description}`);
    db.transaction(() => {
      m.up(db);
      db.prepare("INSERT INTO schema_version (version, description) VALUES (?, ?)").run(m.version, m.description);
    })();
  }

  console.log(`[DB] 迁移完成，当前版本 v${pending[pending.length - 1].version}`);
}
