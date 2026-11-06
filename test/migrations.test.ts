import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Store } from "../src/db.js";
import { LATEST_VERSION, MIGRATIONS, runMigrations, schemaVersion, type Migration } from "../src/migrations.js";

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "xl-mig-"));
}

test("DB mới tạo lên thẳng phiên bản mới nhất, đủ bảng và cột", () => {
  const db = new DatabaseSync(":memory:");
  const result = runMigrations(db, ":memory:");
  assert.equal(result.from, 0);
  assert.equal(result.to, LATEST_VERSION);
  assert.equal(schemaVersion(db), LATEST_VERSION);
  assert.ok(columns(db, "mentions").includes("tag"));
  assert.ok(columns(db, "alerts").includes("time_window_minutes"));
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>;
  assert.ok(indexes.some((i) => i.name === "mentions_topic_url"));
});

test("chạy lại khi đã mới nhất thì không làm gì", () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db, ":memory:");
  const again = runMigrations(db, ":memory:");
  assert.deepEqual(again, { from: LATEST_VERSION, to: LATEST_VERSION });
});

test("DB cũ chưa có số phiên bản, thiếu cột, vẫn lên được và giữ dữ liệu, có sao lưu", () => {
  const dir = tempDir();
  try {
    const path = join(dir, "old.db");
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE topics (id TEXT PRIMARY KEY, name TEXT NOT NULL, query TEXT NOT NULL,
        exclude_reposts INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1,
        since_id TEXT, last_listened_at TEXT, last_error TEXT, created_at TEXT NOT NULL);
      INSERT INTO topics (id, name, query, created_at) VALUES ('t1', 'Cũ', 'abc', '2026-01-01T00:00:00Z');
    `);
    old.close();

    const store = Store.open(path);
    assert.equal(store.migration.from, 0);
    assert.equal(store.migration.to, LATEST_VERSION);
    assert.equal(store.migration.backup, `${path}.bak-v0`);
    assert.ok(existsSync(`${path}.bak-v0`));
    const topic = store.listTopics().find((t) => t.id === "t1");
    assert.equal(topic?.name, "Cũ");
    store.close();

    const reopened = Store.open(path);
    assert.equal(reopened.migration.from, LATEST_VERSION);
    assert.equal(reopened.migration.backup, undefined);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("DB của bản mới hơn thì từ chối mở thay vì đoán", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA user_version = ${LATEST_VERSION + 5}`);
  assert.throws(() => runMigrations(db, ":memory:"), /mới hơn/);
});

test("migration lỗi thì hoàn tác, giữ nguyên phiên bản cũ", () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db, ":memory:");
  const broken: Migration[] = [
    ...MIGRATIONS,
    {
      version: LATEST_VERSION + 1,
      name: "hỏng",
      up: (d) => {
        d.exec("CREATE TABLE half_done (id INTEGER)");
        d.exec("THIS IS NOT SQL");
      },
    },
  ];
  assert.throws(() => runMigrations(db, ":memory:", broken), /hỏng/);
  assert.equal(schemaVersion(db), LATEST_VERSION);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
  assert.ok(!tables.some((t) => t.name === "half_done"));
});

test("phiên bản trong danh sách tăng dần liên tục", () => {
  MIGRATIONS.forEach((m, i) => assert.equal(m.version, i + 1));
});
