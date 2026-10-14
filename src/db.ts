import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { alertReason, type AlertKind, type AlertRule } from "./alerts.js";
import type { DigestPost } from "./digest.js";

export type { AlertRule };
import { classifySentiment, type Sentiment } from "./sentiment.js";

export type Topic = {
  id: string;
  name: string;
  query: string;
  source: string;
  phrase: string;
  exclude_reposts: number;
  active: number;
  since_id: string | null;
  last_listened_at: string | null;
  last_error: string | null;
  created_at: string;
};

export type Mention = {
  id: string;
  topic_id: string;
  text: string;
  author_username: string;
  author_name: string;
  created_at: string;
  lang: string;
  like_count: number;
  repost_count: number;
  reply_count: number;
  quote_count: number;
  url: string;
  sentiment: string;
  sentiment_score: number;
  sample: number;
  fetched_at: string;
  starred: number;
  hidden: number;
  note: string;
  queue: QueueState;
};

export type MentionView = "wire" | "new" | "reading" | "done" | "starred" | "hidden";
export type QueueState = "new" | "reading" | "done";

const HEARD = "lower(author_username) NOT IN (SELECT username FROM muted_authors)";
const HEARD_M = "lower(m.author_username) NOT IN (SELECT username FROM muted_authors)";

export function muteKey(username: string): string | null {
  const clean = username.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_.]{1,64}$/.test(clean)) return null;
  return clean;
}

export type AlertHitRow = {
  id: string;
  alert_id: string;
  alert_name: string;
  reason: string;
  mention_id: string;
  topic_id: string;
  topic_name: string;
  author_name: string;
  text: string;
  created_at: string;
};

export type Voice = {
  author_name: string;
  author_username: string;
  posts: number;
  engagement: number;
};

export type MentionRow = Mention & { topic_name: string };

export type NewMention = {
  id: string;
  topicId: string;
  text: string;
  authorUsername: string;
  authorName: string;
  createdAt: string;
  lang: string;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  url?: string;
  sample?: boolean;
};

export class Store {
  constructor(private readonly db: DatabaseSync) {}

  static open(path: string): Store {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
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
    `);
    ensureColumn(db, "mentions", "starred", "starred INTEGER NOT NULL DEFAULT 0");
    ensureColumn(db, "mentions", "hidden", "hidden INTEGER NOT NULL DEFAULT 0");
    ensureColumn(db, "mentions", "note", "note TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, "mentions", "queue", "queue TEXT NOT NULL DEFAULT 'new'");
    ensureColumn(db, "mentions", "url", "url TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, "topics", "source", "source TEXT NOT NULL DEFAULT 'x'");
    ensureColumn(db, "topics", "phrase", "phrase TEXT NOT NULL DEFAULT ''");
    return new Store(db);
  }

  close(): void {
    this.db.close();
  }

  listTopics(): Topic[] {
    return this.db.prepare("SELECT * FROM topics ORDER BY created_at ASC").all() as Topic[];
  }

  getTopic(id: string): Topic | undefined {
    return this.db.prepare("SELECT * FROM topics WHERE id = ?").get(id) as Topic | undefined;
  }

  insertTopic(input: {
    id: string;
    name: string;
    query: string;
    excludeReposts: boolean;
    createdAt: string;
    source?: "x" | "facebook";
    phrase?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO topics (id, name, query, exclude_reposts, active, created_at, source, phrase)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        input.query,
        input.excludeReposts ? 1 : 0,
        input.createdAt,
        input.source ?? "x",
        (input.phrase ?? "").slice(0, 80),
      );
  }

  setTopicActive(id: string, active: boolean): void {
    this.db.prepare("UPDATE topics SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
  }

  deleteTopic(id: string): void {
    this.db.prepare("DELETE FROM topics WHERE id = ?").run(id);
  }

  markTopicListened(id: string, sinceId: string | null, error: string | null, at: string): void {
    this.db
      .prepare("UPDATE topics SET since_id = COALESCE(?, since_id), last_listened_at = ?, last_error = ? WHERE id = ?")
      .run(sinceId, at, error, id);
  }

  insertMention(mention: NewMention, fetchedAt: string): boolean {
    if (this.isMuted(mention.authorUsername)) return false;
    const feeling = classifySentiment(mention.text, this.lexiconBundle());
    const existed = Boolean(
      this.db.prepare("SELECT 1 AS ok FROM mentions WHERE id = ? AND topic_id = ?").get(mention.id, mention.topicId),
    );
    const result = this.db
      .prepare(
        `INSERT INTO mentions (
           id, topic_id, text, author_username, author_name, created_at, lang,
           like_count, repost_count, reply_count, quote_count, url,
           sentiment, sentiment_score, sample, fetched_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id, topic_id) DO UPDATE SET
           like_count = excluded.like_count,
           repost_count = excluded.repost_count,
           reply_count = excluded.reply_count,
           quote_count = excluded.quote_count,
           url = excluded.url,
           text = excluded.text,
           sentiment = excluded.sentiment,
           sentiment_score = excluded.sentiment_score`,
      )
      .run(
        mention.id,
        mention.topicId,
        mention.text,
        mention.authorUsername,
        mention.authorName,
        mention.createdAt,
        mention.lang,
        mention.likeCount,
        mention.repostCount,
        mention.replyCount,
        mention.quoteCount,
        mention.url ?? "",
        feeling.sentiment,
        feeling.score,
        mention.sample ? 1 : 0,
        fetchedAt,
      );
    if (!existed) this.recordHits(mention, feeling.sentiment, fetchedAt);
    return result.changes > 0;
  }

  listMentions(topicId?: string, limit = 80, view: MentionView = "wire"): MentionRow[] {
    const visibility = mentionFilter(view);
    const heard = view === "hidden" ? "1 = 1" : HEARD_M;
    return this.db
      .prepare(
        `SELECT m.*, t.name AS topic_name
         FROM mentions m JOIN topics t ON t.id = m.topic_id
         WHERE (? = '' OR m.topic_id = ?) AND ${visibility} AND ${heard}
         ORDER BY m.created_at DESC
         LIMIT ?`,
      )
      .all(topicId ?? "", topicId ?? "", limit) as MentionRow[];
  }

  setMentionQueue(topicId: string, mentionId: string, queue: QueueState): boolean {
    const result = this.db
      .prepare("UPDATE mentions SET queue = ? WHERE topic_id = ? AND id = ?")
      .run(queue, topicId, mentionId);
    return result.changes > 0;
  }

  listMuted(): string[] {
    return (this.db.prepare("SELECT username FROM muted_authors ORDER BY username ASC").all() as Array<{ username: string }>).map(
      (row) => row.username,
    );
  }

  isMuted(username: string): boolean {
    const key = muteKey(username);
    if (!key) return false;
    return Boolean(this.db.prepare("SELECT 1 AS ok FROM muted_authors WHERE username = ?").get(key));
  }

  muteAuthor(username: string, at: string): boolean {
    const key = muteKey(username);
    if (!key) return false;
    this.db.prepare("INSERT INTO muted_authors (username, created_at) VALUES (?, ?) ON CONFLICT(username) DO NOTHING").run(key, at);
    return true;
  }

  listLexicon(): { word: string; polarity: Sentiment }[] {
    return this.db.prepare("SELECT word, polarity FROM lexicon ORDER BY word ASC").all() as { word: string; polarity: Sentiment }[];
  }

  setLexiconWord(word: string, polarity: Sentiment, at: string): number {
    this.db
      .prepare(
        `INSERT INTO lexicon (word, polarity, created_at) VALUES (?, ?, ?)
         ON CONFLICT(word) DO UPDATE SET polarity = excluded.polarity`,
      )
      .run(word, polarity, at);
    return this.reclassifyMentions();
  }

  deleteLexiconWord(word: string): number {
    this.db.prepare("DELETE FROM lexicon WHERE word = ?").run(word);
    return this.reclassifyMentions();
  }

  private lexiconBundle(): { positive: string[]; negative: string[] } {
    const rows = this.listLexicon();
    return {
      positive: rows.filter((row) => row.polarity === "positive").map((row) => row.word),
      negative: rows.filter((row) => row.polarity === "negative").map((row) => row.word),
    };
  }

  private reclassifyMentions(): number {
    const bundle = this.lexiconBundle();
    const rows = this.db.prepare("SELECT id, topic_id, text, sentiment, sentiment_score FROM mentions").all() as Array<{
      id: string;
      topic_id: string;
      text: string;
      sentiment: string;
      sentiment_score: number;
    }>;
    const update = this.db.prepare("UPDATE mentions SET sentiment = ?, sentiment_score = ? WHERE id = ? AND topic_id = ?");
    let changed = 0;
    for (const row of rows) {
      const feeling = classifySentiment(row.text, bundle);
      if (feeling.sentiment === row.sentiment && feeling.score === row.sentiment_score) continue;
      update.run(feeling.sentiment, feeling.score, row.id, row.topic_id);
      changed += 1;
    }
    return changed;
  }

  unmuteAuthor(username: string): void {
    const key = muteKey(username);
    if (!key) return;
    this.db.prepare("DELETE FROM muted_authors WHERE username = ?").run(key);
  }

  listHeardSince(sinceIso: string): DigestPost[] {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.topic_id, t.name AS topic_name, m.text, m.author_username, m.author_name,
                m.created_at, m.sentiment, m.starred
         FROM mentions m JOIN topics t ON t.id = m.topic_id
         WHERE m.hidden = 0 AND ${HEARD_M} AND m.created_at >= ?
         ORDER BY m.created_at ASC`,
      )
      .all(sinceIso) as Array<{
      id: string;
      topic_id: string;
      topic_name: string;
      text: string;
      author_username: string;
      author_name: string;
      created_at: string;
      sentiment: string;
      starred: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      topicId: row.topic_id,
      topicName: row.topic_name,
      text: row.text,
      authorUsername: row.author_username,
      authorName: row.author_name,
      createdAt: row.created_at,
      sentiment: row.sentiment,
      starred: row.starred,
    }));
  }

  listFirstSeen(): { username: string; firstAt: string }[] {
    return (
      this.db
        .prepare(
          `SELECT author_username AS username, MIN(created_at) AS firstAt
           FROM mentions
           WHERE hidden = 0 AND ${HEARD}
           GROUP BY lower(author_username)`,
        )
        .all() as { username: string; firstAt: string }[]
    );
  }

  countNew(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM mentions WHERE hidden = 0 AND queue = 'new' AND ${HEARD}`)
      .get() as { count: number };
    return row.count;
  }

  toggleMention(topicId: string, mentionId: string, field: "starred" | "hidden"): boolean {
    const result = this.db
      .prepare(`UPDATE mentions SET ${field} = CASE WHEN ${field} = 1 THEN 0 ELSE 1 END WHERE topic_id = ? AND id = ?`)
      .run(topicId, mentionId);
    return result.changes > 0;
  }

  setMentionNote(topicId: string, mentionId: string, note: string): boolean {
    const result = this.db
      .prepare("UPDATE mentions SET note = ? WHERE topic_id = ? AND id = ?")
      .run(note.slice(0, 280), topicId, mentionId);
    return result.changes > 0;
  }

  listAlerts(): AlertRule[] {
    return this.db.prepare("SELECT * FROM alerts ORDER BY created_at ASC").all() as AlertRule[];
  }

  insertAlert(input: {
    id: string;
    topicId: string | null;
    name: string;
    kind: AlertKind;
    phrase: string;
    minLikes: number;
    createdAt: string;
  }): number {
    this.db
      .prepare(
        `INSERT INTO alerts (id, topic_id, name, kind, phrase, min_likes, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(input.id, input.topicId, input.name, input.kind, input.phrase, input.minLikes, input.createdAt);
    return this.scanAlert(input.id, input.createdAt);
  }

  deleteAlert(id: string): void {
    this.db.prepare("DELETE FROM alerts WHERE id = ?").run(id);
  }

  listOpenHits(limit = 20): AlertHitRow[] {
    return this.db
      .prepare(
        `SELECT h.id, h.alert_id, a.name AS alert_name, h.reason, h.mention_id, h.topic_id,
                t.name AS topic_name, m.author_name, m.text, h.created_at
         FROM alert_hits h
         JOIN alerts a ON a.id = h.alert_id
         JOIN mentions m ON m.id = h.mention_id AND m.topic_id = h.topic_id
         JOIN topics t ON t.id = h.topic_id
         WHERE h.seen = 0 AND ${HEARD_M}
         ORDER BY h.created_at DESC
         LIMIT ?`,
      )
      .all(limit) as AlertHitRow[];
  }

  seeHit(id: string): void {
    this.db.prepare("UPDATE alert_hits SET seen = 1 WHERE id = ?").run(id);
  }

  topVoices(sinceIso: string, limit = 5): Voice[] {
    return this.db
      .prepare(
        `SELECT author_name, author_username, COUNT(*) AS posts,
                COALESCE(SUM(like_count + repost_count + reply_count + quote_count), 0) AS engagement
         FROM mentions
         WHERE hidden = 0 AND ${HEARD} AND created_at >= ?
         GROUP BY author_username
         ORDER BY posts DESC, engagement DESC
         LIMIT ?`,
      )
      .all(sinceIso, limit) as Voice[];
  }

  stats(sinceIso: string): { mentions: number; authors: number; engagement: number; positive: number; negative: number; neutral: number } {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS mentions,
           COUNT(DISTINCT author_username) AS authors,
           COALESCE(SUM(like_count + repost_count + reply_count + quote_count), 0) AS engagement,
           SUM(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) AS positive,
           SUM(CASE WHEN sentiment = 'negative' THEN 1 ELSE 0 END) AS negative,
           SUM(CASE WHEN sentiment = 'neutral' THEN 1 ELSE 0 END) AS neutral
         FROM mentions
         WHERE hidden = 0 AND ${HEARD} AND created_at >= ?`,
      )
      .get(sinceIso) as {
      mentions: number;
      authors: number;
      engagement: number;
      positive: number | null;
      negative: number | null;
      neutral: number | null;
    };
    return {
      mentions: row.mentions,
      authors: row.authors,
      engagement: row.engagement,
      positive: row.positive ?? 0,
      negative: row.negative ?? 0,
      neutral: row.neutral ?? 0,
    };
  }

  volumeByDay(days: number): { day: string; count: number }[] {
    return this.db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
         FROM mentions
         WHERE hidden = 0 AND ${HEARD} AND created_at >= datetime('now', ?)
         GROUP BY day
         ORDER BY day ASC`,
      )
      .all(`-${days} days`) as { day: string; count: number }[];
  }

  seedSamples(now = new Date()): number {
    const created = now.toISOString();
    const topics = this.listTopics();
    const topic = topics[0] ?? {
      id: "sample-topic",
      name: "Quán cà phê giấy",
      query: "\"cà phê giấy\" OR giaycafe lang:vi",
    };
    if (!topics[0]) {
      this.insertTopic({
        id: topic.id,
        name: topic.name,
        query: topic.query,
        excludeReposts: true,
        createdAt: created,
      });
    }
    const samples: NewMention[] = [
      {
        id: "sample-1",
        topicId: topic.id,
        text: "Sáng nay ghé quán cà phê giấy trên đường Pasteur, nước ổn, chỗ ngồi hơi chật giờ tan tầm.",
        authorUsername: "lan_be",
        authorName: "Lan Bê",
        createdAt: new Date(now.getTime() - 1000 * 60 * 40).toISOString(),
        lang: "vi",
        likeCount: 12,
        repostCount: 1,
        replyCount: 3,
        quoteCount: 0,
        sample: true,
      },
      {
        id: "sample-2",
        topicId: topic.id,
        text: "Thất vọng với cà phê giấy lần này: gọi 20 phút mới có ly, đá tan hết.",
        authorUsername: "minhquang",
        authorName: "Minh Quang",
        createdAt: new Date(now.getTime() - 1000 * 60 * 95).toISOString(),
        lang: "vi",
        likeCount: 4,
        repostCount: 0,
        replyCount: 6,
        quoteCount: 1,
        sample: true,
      },
      {
        id: "sample-3",
        topicId: topic.id,
        text: "Cảm ơn quán, bánh mì chảo vẫn đáng tiền. Sẽ ghé lại cuối tuần.",
        authorUsername: "ha.notes",
        authorName: "Hà Notes",
        createdAt: new Date(now.getTime() - 1000 * 60 * 180).toISOString(),
        lang: "vi",
        likeCount: 21,
        repostCount: 2,
        replyCount: 1,
        quoteCount: 0,
        sample: true,
      },
    ];
    let inserted = 0;
    for (const sample of samples) {
      if (this.insertMention(sample, created)) inserted += 1;
    }
    return inserted;
  }

  clearSamples(): number {
    this.db.prepare("DELETE FROM alert_hits WHERE mention_id IN (SELECT id FROM mentions WHERE sample = 1)").run();
    const result = this.db.prepare("DELETE FROM mentions WHERE sample = 1").run();
    this.db.prepare("DELETE FROM topics WHERE id = 'sample-topic'").run();
    return Number(result.changes);
  }

  private recordHits(mention: NewMention, sentiment: string, at: string): void {
    for (const rule of this.listAlerts()) {
      const reason = alertReason(rule, {
        topicId: mention.topicId,
        text: mention.text,
        sentiment,
        likeCount: mention.likeCount,
      });
      if (!reason) continue;
      this.insertHit(rule.id, mention.id, mention.topicId, reason, at);
    }
  }

  private scanAlert(alertId: string, at: string): number {
    const rule = this.listAlerts().find((item) => item.id === alertId);
    if (!rule) return 0;
    const mentions = this.db.prepare(`SELECT * FROM mentions WHERE hidden = 0 AND ${HEARD}`).all() as Mention[];
    let hits = 0;
    for (const mention of mentions) {
      const reason = alertReason(rule, {
        topicId: mention.topic_id,
        text: mention.text,
        sentiment: mention.sentiment,
        likeCount: mention.like_count,
      });
      if (!reason) continue;
      if (this.insertHit(rule.id, mention.id, mention.topic_id, reason, at)) hits += 1;
    }
    return hits;
  }

  private insertHit(alertId: string, mentionId: string, topicId: string, reason: string, at: string): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO alert_hits (id, alert_id, mention_id, topic_id, reason, created_at, seen)
         VALUES (?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(alert_id, mention_id, topic_id) DO NOTHING`,
      )
      .run(randomUUID(), alertId, mentionId, topicId, reason, at);
    return result.changes > 0;
  }
}

function mentionFilter(view: MentionView): string {
  if (view === "hidden") return "m.hidden = 1";
  if (view === "starred") return "m.starred = 1 AND m.hidden = 0";
  if (view === "new" || view === "reading" || view === "done") return `m.hidden = 0 AND m.queue = '${view}'`;
  return "m.hidden = 0";
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}
