import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

/**
 * Cập nhật cấu trúc DB theo số phiên bản, lưu ở PRAGMA user_version.
 * Thêm thay đổi mới bằng cách nối một mục vào cuối MIGRATIONS; không sửa mục đã phát hành.
 */
export type Migration = { version: number; name: string; up: (db: DatabaseSync) => void };

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "baseline: bảng gốc và các cột thêm dần trước khi có migration",
    // Viết kiểu idempotent để DB cũ (user_version = 0, đã có một phần bảng/cột) cũng lên được.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS topics (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          query TEXT NOT NULL,
          exclude_reposts INTEGER NOT NULL DEFAULT 1,
          active INTEGER NOT NULL DEFAULT 1,
          since_id TEXT,
          last_listened_at TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS mentions (
          id TEXT NOT NULL,
          topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
          text TEXT NOT NULL,
          author_username TEXT NOT NULL,
          author_name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          lang TEXT NOT NULL DEFAULT '',
          like_count INTEGER NOT NULL DEFAULT 0,
          repost_count INTEGER NOT NULL DEFAULT 0,
          reply_count INTEGER NOT NULL DEFAULT 0,
          quote_count INTEGER NOT NULL DEFAULT 0,
          sentiment TEXT NOT NULL,
          sentiment_score INTEGER NOT NULL,
          sample INTEGER NOT NULL DEFAULT 0,
          fetched_at TEXT NOT NULL,
          PRIMARY KEY (id, topic_id)
        );
        CREATE INDEX IF NOT EXISTS mentions_created ON mentions(created_at DESC);
        CREATE TABLE IF NOT EXISTS alerts (
          id TEXT PRIMARY KEY,
          topic_id TEXT REFERENCES topics(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          phrase TEXT NOT NULL DEFAULT '',
          min_likes INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS alert_hits (
          id TEXT PRIMARY KEY,
          alert_id TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
          mention_id TEXT NOT NULL,
          topic_id TEXT NOT NULL,
          reason TEXT NOT NULL,
          created_at TEXT NOT NULL,
          seen INTEGER NOT NULL DEFAULT 0,
          UNIQUE (alert_id, mention_id, topic_id)
        );
        CREATE TABLE IF NOT EXISTS muted_authors (
          username TEXT PRIMARY KEY,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS lexicon (
          word TEXT PRIMARY KEY,
          polarity TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS response_templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      ensureColumn(db, "mentions", "starred", "starred INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "mentions", "hidden", "hidden INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "mentions", "note", "note TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, "mentions", "queue", "queue TEXT NOT NULL DEFAULT 'new'");
      ensureColumn(db, "mentions", "url", "url TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, "mentions", "assigned_to", "assigned_to TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, "mentions", "tag", "tag TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, "topics", "source", "source TEXT NOT NULL DEFAULT 'x'");
      ensureColumn(db, "topics", "phrase", "phrase TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, "alert_hits", "notified", "notified INTEGER NOT NULL DEFAULT 1");
      ensureColumn(db, "alerts", "threshold_count", "threshold_count INTEGER NOT NULL DEFAULT 3");
      ensureColumn(db, "alerts", "time_window_minutes", "time_window_minutes INTEGER NOT NULL DEFAULT 60");
    },
  },
  {
    version: 2,
    name: "index (topic_id, url) để lọc bài trùng URL",
    up: (db) => {
      db.exec("CREATE INDEX IF NOT EXISTS mentions_topic_url ON mentions(topic_id, url)");
    },
  },
  {
    version: 3,
    name: "nguồn chấm cảm xúc (từ vựng/AI/sửa tay) và sức khỏe tần số",
    up: (db) => {
      ensureColumn(db, "mentions", "sentiment_source", "sentiment_source TEXT NOT NULL DEFAULT 'lexicon'");
      ensureColumn(db, "mentions", "sentiment_reason", "sentiment_reason TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, "topics", "fail_count", "fail_count INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "topics", "health_alerted", "health_alerted INTEGER NOT NULL DEFAULT 0");
      db.exec("CREATE INDEX IF NOT EXISTS mentions_sentiment_source ON mentions(sentiment_source, created_at)");
    },
  },
  {
    version: 4,
    name: "nháp câu trả lời và mốc thời gian xử lý bài",
    up: (db) => {
      ensureColumn(db, "mentions", "reply_draft", "reply_draft TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, "mentions", "reading_at", "reading_at TEXT");
      ensureColumn(db, "mentions", "done_at", "done_at TEXT");
    },
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return Number(row.user_version) || 0;
}

/**
 * Chạy các migration còn thiếu, mỗi bản một transaction.
 * Với DB trên đĩa đã có dữ liệu, sao lưu một bản `<file>.bak-v<cũ>` trước khi đổi.
 */
export function runMigrations(db: DatabaseSync, path: string, migrations: Migration[] = MIGRATIONS): { from: number; to: number; backup?: string } {
  const from = schemaVersion(db);
  const latest = migrations[migrations.length - 1]?.version ?? 0;
  if (from > latest) {
    throw new Error(`DB đang ở phiên bản ${from}, mới hơn bản ứng dụng này hiểu (${latest}). Hãy cập nhật x-listening.`);
  }
  const pending = migrations.filter((m) => m.version > from);
  if (pending.length === 0) return { from, to: from };

  let backup: string | undefined;
  if (path !== ":memory:" && hasUserTables(db)) {
    backup = `${path}.bak-v${from}`;
    if (!existsSync(backup)) db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
  }

  for (const migration of pending) {
    db.exec("BEGIN IMMEDIATE");
    try {
      migration.up(db);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${migration.version} (${migration.name}) thất bại: ${reason}`);
    }
  }
  return { from, to: pending[pending.length - 1]!.version, backup };
}

function hasUserTables(db: DatabaseSync): boolean {
  const row = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get() as { n: number };
  return Number(row.n) > 0;
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}
