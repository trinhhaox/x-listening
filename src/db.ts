import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "./migrations.js";
import { alertReason, type AlertKind, type AlertRule } from "./alerts.js";
import type { DigestPost } from "./digest.js";

export type { AlertRule };
import type { HitNotice } from "./notify.js";
import { classifySentiment, type Sentiment } from "./sentiment.js";
import { classifyMentionRuleBased } from "./ai.js";
import type { Role } from "./users.js";
import { isEncrypted, isSecretSetting, type SettingsCipher } from "./secrets.js";

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
  /** Số lượt quét lỗi liên tiếp; về 0 khi quét được. */
  fail_count: number;
  /** 1 khi đã báo “nguồn lỗi” ra webhook và chưa báo “đã chạy lại”. */
  health_alerted: number;
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
  assigned_to: string;
  tag: string;
  /** Ai chấm cảm xúc: lexicon (đếm từ), ai, manual (người sửa tay). */
  sentiment_source: SentimentSource;
  sentiment_reason: string;
  /** Nháp câu trả lời người trực đang soạn. */
  reply_draft: string;
  /** Lần đầu bài được nhận xử lý (Đang xử lý hoặc Đã xong). */
  reading_at: string | null;
  /** Lúc bài được đánh dấu Đã xong; trống khi mở lại. */
  done_at: string | null;
};

export type SentimentSource = "lexicon" | "ai" | "manual";

export type MentionView = "wire" | "new" | "reading" | "done" | "starred" | "hidden";
export type QueueState = "new" | "reading" | "done";

export type ListMentionsOptions = {
  topicId?: string;
  limit?: number;
  view?: MentionView;
  search?: string;
  sentiment?: string;
  minLikes?: number;
  assignedTo?: string;
  tag?: string;
};

export type ResponseTemplate = {
  id: string;
  name: string;
  content: string;
  created_at: string;
};

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
  private cipher: SettingsCipher | undefined;
  /** Các khóa bí mật có trong DB nhưng không giải mã được (khóa mã hóa đã đổi). */
  readonly unreadableSecrets = new Set<string>();
  /** Kết quả cập nhật cấu trúc DB lúc mở (phiên bản trước/sau, file sao lưu nếu có). */
  migration: { from: number; to: number; backup?: string } = { from: 0, to: 0 };

  constructor(private readonly db: DatabaseSync) {}

  /**
   * Bật mã hóa cho các cài đặt bí mật. Giá trị cũ còn ở dạng chữ thường được mã hóa lại ngay.
   */
  useSettingsCipher(cipher: SettingsCipher): void {
    this.cipher = cipher;
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    for (const row of rows) {
      if (!isSecretSetting(row.key)) continue;
      if (row.value && !isEncrypted(row.value)) this.setSetting(row.key, row.value);
      else if (row.value && cipher.decrypt(row.value) === undefined) this.unreadableSecrets.add(row.key);
    }
  }

  private readSetting(key: string, stored: string): string | undefined {
    if (!isSecretSetting(key) || !isEncrypted(stored)) return stored;
    const plain = this.cipher?.decrypt(stored);
    if (plain === undefined) this.unreadableSecrets.add(key);
    return plain;
  }

  static open(path: string): Store {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    const migration = runMigrations(db, path);
    const store = new Store(db);
    store.migration = migration;
    return store;
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
    source?: "x" | "facebook" | "threads" | "youtube" | "web";
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
      .prepare(
        `UPDATE topics SET since_id = COALESCE(?, since_id), last_listened_at = ?, last_error = ?,
           fail_count = CASE WHEN ? IS NULL THEN 0 ELSE fail_count + 1 END
         WHERE id = ?`,
      )
      .run(sinceId, at, error, error, id);
  }

  insertMention(mention: NewMention, fetchedAt: string): boolean {
    if (this.isMuted(mention.authorUsername)) return false;
    // Cùng một đường link trong cùng tần số là cùng một bài, kể cả khi mã bài đổi cách tính
    // (ví dụ bài báo lưu bằng mã băm cũ). Tránh lưu trùng.
    if (mention.url) {
      const sameLink = this.db
        .prepare("SELECT 1 AS ok FROM mentions WHERE topic_id = ? AND url = ? AND id <> ? LIMIT 1")
        .get(mention.topicId, mention.url, mention.id);
      if (sameLink) return false;
    }
    const feeling = classifySentiment(mention.text, this.lexiconBundle());
    const existed = Boolean(
      this.db.prepare("SELECT 1 AS ok FROM mentions WHERE id = ? AND topic_id = ?").get(mention.id, mention.topicId),
    );
    const initialRouting = classifyMentionRuleBased(mention.text);
    const result = this.db
      .prepare(
        `INSERT INTO mentions (
           id, topic_id, text, author_username, author_name, created_at, lang,
           like_count, repost_count, reply_count, quote_count, url,
           sentiment, sentiment_score, sample, fetched_at, tag, assigned_to
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id, topic_id) DO UPDATE SET
           like_count = excluded.like_count,
           repost_count = excluded.repost_count,
           reply_count = excluded.reply_count,
           quote_count = excluded.quote_count,
           url = excluded.url,
           text = excluded.text,
           sentiment = CASE WHEN mentions.sentiment_source = 'lexicon' THEN excluded.sentiment ELSE mentions.sentiment END,
           sentiment_score = CASE WHEN mentions.sentiment_source = 'lexicon' THEN excluded.sentiment_score ELSE mentions.sentiment_score END`,
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
        initialRouting.tag,
        initialRouting.assignedTo,
      );
    if (!existed) this.recordHits(mention, feeling.sentiment, fetchedAt);
    return result.changes > 0;
  }

  listMentions(
    topicOrOptions?: string | ListMentionsOptions,
    limit = 80,
    view: MentionView = "wire",
  ): MentionRow[] {
    let topicId = "";
    let actualLimit = limit;
    let actualView: MentionView = view;
    let search = "";
    let sentiment = "";
    let minLikes = 0;
    let assignedTo = "";
    let tag = "";

    if (typeof topicOrOptions === "object" && topicOrOptions !== null) {
      topicId = topicOrOptions.topicId ?? "";
      actualLimit = topicOrOptions.limit ?? 80;
      actualView = topicOrOptions.view ?? "wire";
      search = (topicOrOptions.search ?? "").trim().toLowerCase();
      sentiment = (topicOrOptions.sentiment ?? "").trim();
      minLikes = Number(topicOrOptions.minLikes ?? 0);
      assignedTo = (topicOrOptions.assignedTo ?? "").trim();
      tag = (topicOrOptions.tag ?? "").trim();
    } else if (typeof topicOrOptions === "string") {
      topicId = topicOrOptions;
    }

    const visibility = mentionFilter(actualView);
    const heard = actualView === "hidden" ? "1 = 1" : HEARD_M;
    const conditions: string[] = [visibility, heard];
    const params: (string | number)[] = [];

    if (topicId) {
      conditions.push("m.topic_id = ?");
      params.push(topicId);
    }

    if (sentiment && (sentiment === "positive" || sentiment === "negative" || sentiment === "neutral")) {
      conditions.push("m.sentiment = ?");
      params.push(sentiment);
    }

    if (minLikes > 0) {
      conditions.push("m.like_count >= ?");
      params.push(minLikes);
    }

    if (assignedTo) {
      conditions.push("lower(m.assigned_to) LIKE ?");
      params.push(`%${assignedTo.toLowerCase()}%`);
    }

    if (tag) {
      conditions.push("lower(m.tag) LIKE ?");
      params.push(`%${tag.toLowerCase()}%`);
    }

    if (search) {
      conditions.push("(lower(m.text) LIKE ? OR lower(m.author_username) LIKE ? OR lower(m.author_name) LIKE ?)");
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern);
    }

    params.push(actualLimit);

    const sql = `SELECT m.*, t.name AS topic_name
         FROM mentions m JOIN topics t ON t.id = m.topic_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY m.created_at DESC
         LIMIT ?`;

    return this.db.prepare(sql).all(...params) as MentionRow[];
  }

  getMention(topicId: string, mentionId: string): Mention | null {
    const row = this.db
      .prepare("SELECT * FROM mentions WHERE topic_id = ? AND id = ?")
      .get(topicId, mentionId) as Mention | undefined;
    return row ?? null;
  }

  /** Gán bài cho người này nếu chưa có ai phụ trách. */
  claimMention(topicId: string, mentionId: string, assignee: string): boolean {
    const result = this.db
      .prepare("UPDATE mentions SET assigned_to = ? WHERE topic_id = ? AND id = ? AND assigned_to = ''")
      .run(assignee.slice(0, 60), topicId, mentionId);
    return Number(result.changes) > 0;
  }

  setMentionAssignee(topicId: string, mentionId: string, assignee: string): boolean {
    const result = this.db
      .prepare("UPDATE mentions SET assigned_to = ? WHERE topic_id = ? AND id = ?")
      .run(assignee.slice(0, 60), topicId, mentionId);
    return result.changes > 0;
  }

  setMentionTag(topicId: string, mentionId: string, tag: string): boolean {
    const result = this.db
      .prepare("UPDATE mentions SET tag = ? WHERE topic_id = ? AND id = ?")
      .run(tag.slice(0, 60), topicId, mentionId);
    return result.changes > 0;
  }

  autoClassifyMention(
    topicId: string,
    mentionId: string,
    classification: { tag: string; assignedTo: string },
  ): boolean {
    const result = this.db
      .prepare("UPDATE mentions SET tag = ?, assigned_to = ? WHERE topic_id = ? AND id = ?")
      .run(classification.tag.slice(0, 60), classification.assignedTo.slice(0, 60), topicId, mentionId);
    return result.changes > 0;
  }

  listUnclassifiedMentions(limit = 100, topicId?: string): MentionRow[] {
    let sql = `SELECT m.*, t.name AS topic_name
               FROM mentions m
               JOIN topics t ON t.id = m.topic_id
               WHERE m.hidden = 0 AND ${HEARD_M} AND (m.tag = '' OR m.tag = 'Chung' OR m.assigned_to = '')`;
    const params: (string | number)[] = [];
    if (topicId) {
      sql += " AND m.topic_id = ?";
      params.push(topicId);
    }
    sql += ` ORDER BY m.created_at DESC LIMIT ?`;
    params.push(limit);
    return this.db.prepare(sql).all(...params) as MentionRow[];
  }

  listMentionsForCloud(sinceIso: string, topicId?: string): Array<{ text: string; sentiment: string }> {
    let sql = `SELECT text, sentiment FROM mentions WHERE hidden = 0 AND ${HEARD} AND created_at >= ?`;
    const params: string[] = [sinceIso];
    if (topicId) {
      sql += " AND topic_id = ?";
      params.push(topicId);
    }
    return this.db.prepare(sql).all(...params) as Array<{ text: string; sentiment: string }>;
  }

  listMentionsForHashtags(
    sinceIso: string,
    topicId?: string,
  ): Array<{
    text: string;
    sentiment: string;
    like_count: number;
    repost_count: number;
    reply_count: number;
    quote_count: number;
    author_username: string;
  }> {
    let sql = `SELECT text, sentiment, like_count, repost_count, reply_count, quote_count, author_username
               FROM mentions
               WHERE hidden = 0 AND ${HEARD} AND created_at >= ?`;
    const params: string[] = [sinceIso];
    if (topicId) {
      sql += " AND topic_id = ?";
      params.push(topicId);
    }
    return this.db.prepare(sql).all(...params) as Array<{
      text: string;
      sentiment: string;
      like_count: number;
      repost_count: number;
      reply_count: number;
      quote_count: number;
      author_username: string;
    }>;
  }

  listTemplates(): ResponseTemplate[] {
    return this.db.prepare("SELECT * FROM response_templates ORDER BY created_at DESC").all() as ResponseTemplate[];
  }

  insertTemplate(input: { id: string; name: string; content: string; createdAt: string }): void {
    this.db
      .prepare("INSERT INTO response_templates (id, name, content, created_at) VALUES (?, ?, ?, ?)")
      .run(input.id, input.name.slice(0, 80), input.content.slice(0, 2000), input.createdAt);
  }

  deleteTemplate(id: string): void {
    this.db.prepare("DELETE FROM response_templates WHERE id = ?").run(id);
  }

  setMentionQueue(topicId: string, mentionId: string, queue: QueueState, at = new Date().toISOString()): boolean {
    const result = this.db
      .prepare(
        `UPDATE mentions SET
           queue = ?1,
           reading_at = CASE WHEN ?1 = 'new' THEN reading_at ELSE COALESCE(reading_at, ?2) END,
           done_at = CASE WHEN ?1 = 'done' THEN CASE WHEN queue = 'done' THEN COALESCE(done_at, ?2) ELSE ?2 END ELSE NULL END
         WHERE topic_id = ?3 AND id = ?4`,
      )
      .run(queue, at, topicId, mentionId);
    return result.changes > 0;
  }

  setReplyDraft(topicId: string, mentionId: string, draft: string): boolean {
    const result = this.db
      .prepare("UPDATE mentions SET reply_draft = ? WHERE topic_id = ? AND id = ?")
      .run(draft.trim().slice(0, 2000), topicId, mentionId);
    return result.changes > 0;
  }

  /** Bài tiêu cực (thật, không ẩn) được thấy trong khoảng [since, until), để đo tốc độ xử lý. */
  listNegativeForResponse(sinceIso: string, untilIso: string): Array<{ queue: QueueState; assigned_to: string; fetched_at: string; done_at: string | null }> {
    return this.db
      .prepare(
        `SELECT queue, assigned_to, fetched_at, done_at FROM mentions
         WHERE sentiment = 'negative' AND sample = 0 AND hidden = 0 AND ${HEARD}
           AND fetched_at >= ? AND fetched_at < ?`,
      )
      .all(sinceIso, untilIso) as Array<{ queue: QueueState; assigned_to: string; fetched_at: string; done_at: string | null }>;
  }

  // ---- Tài khoản ----

  listUsers(): UserRow[] {
    return (this.db.prepare(`SELECT * FROM users ORDER BY active DESC, CASE role WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, name COLLATE NOCASE`).all() as unknown as UserRow[]).map(toUser);
  }

  getUser(id: string): UserRow | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as UserRow | undefined;
    return row ? toUser(row) : undefined;
  }

  getUserByPhone(phone: string): UserRow | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE phone = ?").get(phone) as unknown as UserRow | undefined;
    return row ? toUser(row) : undefined;
  }

  insertUser(input: { phone: string; name: string; role: Role; passwordHash: string; at: string }): UserRow {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO users (id, phone, name, role, password_hash, active, session_version, created_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?)")
      .run(id, input.phone, input.name, input.role, input.passwordHash, input.at);
    return this.getUser(id)!;
  }

  /** Đổi tên/số/vai trò/trạng thái. Hạ quyền hoặc khóa thì phiên đang mở bị đăng xuất. */
  updateUser(id: string, changes: { name?: string; phone?: string; role?: Role; active?: boolean }): boolean {
    const user = this.getUser(id);
    if (!user) return false;
    const next = {
      name: changes.name ?? user.name,
      phone: changes.phone ?? user.phone,
      role: changes.role ?? user.role,
      active: changes.active ?? user.active,
    };
    const revoke = next.role !== user.role || next.active !== user.active || next.phone !== user.phone;
    this.db
      .prepare("UPDATE users SET name = ?, phone = ?, role = ?, active = ?, session_version = session_version + ? WHERE id = ?")
      .run(next.name, next.phone, next.role, next.active ? 1 : 0, revoke ? 1 : 0, id);
    return true;
  }

  /** Đặt mật khẩu mới và đăng xuất mọi phiên cũ của người này. */
  setUserPassword(id: string, passwordHash: string): boolean {
    const result = this.db.prepare("UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?").run(passwordHash, id);
    return Number(result.changes) > 0;
  }

  touchUserLogin(id: string, at: string): void {
    this.db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(at, id);
  }

  deleteUser(id: string): boolean {
    return Number(this.db.prepare("DELETE FROM users WHERE id = ?").run(id).changes) > 0;
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
    // Bài đã được AI hoặc người chấm thì giữ nguyên, từ vựng mới không ghi đè.
    const rows = this.db
      .prepare("SELECT id, topic_id, text, sentiment, sentiment_score FROM mentions WHERE sentiment_source = 'lexicon'")
      .all() as Array<{
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
                m.created_at, m.sentiment, m.starred, m.url,
                (m.like_count + m.repost_count + m.reply_count + m.quote_count) AS engagement
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
      url: string | null;
      engagement: number | null;
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
      url: row.url ?? "",
      engagement: Number(row.engagement ?? 0),
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
    thresholdCount?: number;
    timeWindowMinutes?: number;
    createdAt: string;
  }): number {
    const threshold = input.thresholdCount ?? (input.kind === "velocity" ? 3 : 0);
    const windowMin = input.timeWindowMinutes ?? (input.kind === "velocity" ? 60 : 0);
    this.db
      .prepare(
        `INSERT INTO alerts (id, topic_id, name, kind, phrase, min_likes, threshold_count, time_window_minutes, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        input.id,
        input.topicId,
        input.name,
        input.kind,
        input.phrase,
        input.minLikes,
        threshold,
        windowMin,
        input.createdAt,
      );
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

  listPendingNotices(limit = 10): HitNotice[] {
    const rows = this.db
      .prepare(
        `SELECT h.id, a.name AS alert_name, h.reason, m.author_name, t.name AS topic_name, m.text
         FROM alert_hits h
         JOIN alerts a ON a.id = h.alert_id
         JOIN mentions m ON m.id = h.mention_id AND m.topic_id = h.topic_id
         JOIN topics t ON t.id = h.topic_id
         WHERE h.seen = 0 AND h.notified = 0 AND ${HEARD_M}
         ORDER BY h.created_at ASC
         LIMIT ?`,
      )
      .all(limit) as Array<{ id: string; alert_name: string; reason: string; author_name: string; topic_name: string; text: string }>;
    return rows.map((row) => ({
      id: row.id,
      alertName: row.alert_name,
      reason: row.reason,
      authorName: row.author_name,
      topicName: row.topic_name,
      text: row.text,
    }));
  }

  markNotified(ids: string[]): void {
    const update = this.db.prepare("UPDATE alert_hits SET notified = 1 WHERE id = ?");
    for (const id of ids) update.run(id);
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

  /** Bài chưa được AI/người chấm cảm xúc, mới nhất trước. Bỏ bài mẫu và bài đã giấu. */
  listMentionsForAiSentiment(limit: number, sinceIso: string): Array<{ id: string; topic_id: string; text: string; sentiment: string }> {
    return this.db
      .prepare(
        `SELECT id, topic_id, text, sentiment FROM mentions
         WHERE sentiment_source = 'lexicon' AND sample = 0 AND hidden = 0 AND created_at >= ? AND length(trim(text)) > 0
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(sinceIso, Math.max(1, Math.floor(limit))) as Array<{ id: string; topic_id: string; text: string; sentiment: string }>;
  }

  countMentionsForAiSentiment(sinceIso: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM mentions WHERE sentiment_source = 'lexicon' AND sample = 0 AND hidden = 0 AND created_at >= ?")
      .get(sinceIso) as { n: number };
    return Number(row.n) || 0;
  }

  /**
   * Ghi cảm xúc do AI hoặc người chấm. Bài đã được người sửa tay thì AI không ghi đè.
   * Khi bài chuyển sang tiêu cực, chạy lại chuông; khi bài thôi tiêu cực, gỡ hồi chuông
   * “nghiêng xấu” chưa kịp gửi đi (báo động giả của bộ đếm từ).
   */
  applySentiment(
    topicId: string,
    mentionId: string,
    value: { sentiment: Sentiment; reason?: string; source: "ai" | "manual" },
    at = new Date().toISOString(),
  ): boolean {
    const row = this.db.prepare("SELECT * FROM mentions WHERE id = ? AND topic_id = ?").get(mentionId, topicId) as Mention | undefined;
    if (!row) return false;
    if (value.source === "ai" && row.sentiment_source === "manual") return false;
    const score = value.sentiment === "positive" ? 2 : value.sentiment === "negative" ? -2 : 0;
    this.db
      .prepare("UPDATE mentions SET sentiment = ?, sentiment_score = ?, sentiment_source = ?, sentiment_reason = ? WHERE id = ? AND topic_id = ?")
      .run(value.sentiment, score, value.source, (value.reason ?? "").slice(0, 200), mentionId, topicId);
    if (row.sentiment === value.sentiment) return true;
    if (row.sentiment === "negative") {
      this.db
        .prepare(
          `DELETE FROM alert_hits WHERE mention_id = ? AND topic_id = ? AND notified = 0
             AND alert_id IN (SELECT id FROM alerts WHERE kind IN ('negative', 'velocity'))`,
        )
        .run(mentionId, topicId);
    }
    if (value.sentiment === "negative" && row.hidden === 0) {
      this.recordHits(
        {
          id: row.id,
          topicId: row.topic_id,
          text: row.text,
          authorUsername: row.author_username,
          authorName: row.author_name,
          createdAt: row.created_at,
          lang: row.lang,
          likeCount: row.like_count,
          repostCount: row.repost_count,
          replyCount: row.reply_count,
          quoteCount: row.quote_count,
          url: row.url,
        },
        "negative",
        at,
        ["negative", "velocity"],
      );
    }
    return true;
  }

  setTopicHealthAlerted(id: string, alerted: boolean): void {
    this.db.prepare("UPDATE topics SET health_alerted = ? WHERE id = ?").run(alerted ? 1 : 0, id);
  }

  private recordHits(mention: NewMention, sentiment: string, at: string, onlyKinds?: string[]): void {
    for (const rule of this.listAlerts()) {
      if (rule.active !== 1) continue;
      if (rule.topic_id && rule.topic_id !== mention.topicId) continue;
      if (onlyKinds && !onlyKinds.includes(rule.kind)) continue;

      if (rule.kind === "velocity") {
        if (sentiment === "negative") {
          const windowMinutes = rule.time_window_minutes > 0 ? rule.time_window_minutes : 60;
          const threshold = rule.threshold_count > 0 ? rule.threshold_count : 3;
          const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
          const countSql = rule.topic_id
            ? `SELECT COUNT(*) AS total FROM mentions WHERE topic_id = ? AND sentiment = 'negative' AND hidden = 0 AND created_at >= ?`
            : `SELECT COUNT(*) AS total FROM mentions WHERE sentiment = 'negative' AND hidden = 0 AND created_at >= ?`;
          const countParams = rule.topic_id ? [rule.topic_id, windowStart] : [windowStart];
          const row = this.db.prepare(countSql).get(...countParams) as { total: number };
          if (row && row.total >= threshold) {
            const reason = `Bùng nổ: ${row.total} bài nghiêng xấu trong ${windowMinutes} phút`;
            this.insertHit(rule.id, mention.id, mention.topicId, reason, at);
          }
        }
        continue;
      }

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
    if (!rule || rule.active !== 1) return 0;

    if (rule.kind === "velocity") {
      const windowMinutes = rule.time_window_minutes > 0 ? rule.time_window_minutes : 60;
      const threshold = rule.threshold_count > 0 ? rule.threshold_count : 3;
      const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
      const countSql = rule.topic_id
        ? `SELECT COUNT(*) AS total FROM mentions WHERE topic_id = ? AND sentiment = 'negative' AND hidden = 0 AND created_at >= ?`
        : `SELECT COUNT(*) AS total FROM mentions WHERE sentiment = 'negative' AND hidden = 0 AND created_at >= ?`;
      const countParams = rule.topic_id ? [rule.topic_id, windowStart] : [windowStart];
      const row = this.db.prepare(countSql).get(...countParams) as { total: number };
      if (row && row.total >= threshold) {
        const latestSql = rule.topic_id
          ? `SELECT id, topic_id FROM mentions WHERE topic_id = ? AND sentiment = 'negative' AND hidden = 0 ORDER BY created_at DESC LIMIT 1`
          : `SELECT id, topic_id FROM mentions WHERE sentiment = 'negative' AND hidden = 0 ORDER BY created_at DESC LIMIT 1`;
        const latestParams = rule.topic_id ? [rule.topic_id] : [];
        const latest = this.db.prepare(latestSql).get(...latestParams) as { id: string; topic_id: string } | undefined;
        if (latest && this.insertHit(rule.id, latest.id, latest.topic_id, `Bùng nổ: ${row.total} bài nghiêng xấu trong ${windowMinutes} phút`, at)) {
          return 1;
        }
      }
      return 0;
    }

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

  /**
   * Xóa bài cũ hơn mốc. Giữ lại bài đã ghim, có ghi chú hoặc đang xử lý, vì đó là bài người
   * vận hành đã đụng tới. Nhãn và người gán không tính: bài nào cũng được gắn tự động. Hồi chuông của bài bị xóa cũng xóa theo.
   */
  pruneMentions(beforeIso: string): number {
    this.db.exec("BEGIN");
    try {
      const result = this.db
        .prepare(
          `DELETE FROM mentions
           WHERE created_at < ? AND starred = 0 AND note = '' AND queue != 'reading'`,
        )
        .run(beforeIso);
      this.db.exec(
        `DELETE FROM alert_hits WHERE NOT EXISTS (
           SELECT 1 FROM mentions m WHERE m.id = alert_hits.mention_id AND m.topic_id = alert_hits.topic_id)`,
      );
      this.db.exec("COMMIT");
      return Number(result.changes);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getSetting(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? this.readSetting(key, row.value) : undefined;
  }

  setSetting(key: string, value: string): void {
    if (isSecretSetting(key)) {
      this.unreadableSecrets.delete(key);
      if (value && this.cipher) value = this.cipher.encrypt(value);
    }
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, new Date().toISOString());
  }

  /** Đường lấy tin X lần gần nhất (xem XRoute trong xcookie.ts). */
  setXRoute(route: string, cookieConfigured: boolean, at = new Date().toISOString()): void {
    this.setSetting("X_LAST_ROUTE", JSON.stringify({ route, cookieConfigured, at }));
  }

  getXRoute(): { route: string; cookieConfigured: boolean; at: string } | undefined {
    const raw = this.getSetting("X_LAST_ROUTE");
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as { route?: unknown; cookieConfigured?: unknown; at?: unknown };
      if (typeof parsed.route !== "string" || typeof parsed.at !== "string") return undefined;
      return { route: parsed.route, cookieConfigured: parsed.cookieConfigured === true, at: parsed.at };
    } catch {
      return undefined;
    }
  }

  /** Xóa các khóa cài đặt có tiền tố cho trước và nhỏ hơn mốc (ví dụ bản nhận định AI cũ theo ngày). */
  pruneSettings(prefix: string, belowKey: string): number {
    const result = this.db
      .prepare("DELETE FROM settings WHERE substr(key, 1, ?) = ? AND key < ?")
      .run(prefix.length, prefix, belowKey);
    return Number(result.changes);
  }

  getAllSettings(): Record<string, string> {
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      const value = this.readSetting(row.key, row.value);
      if (value !== undefined) result[row.key] = value;
    }
    return result;
  }

  private insertHit(alertId: string, mentionId: string, topicId: string, reason: string, at: string): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO alert_hits (id, alert_id, mention_id, topic_id, reason, created_at, seen, notified)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0)
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

export type UserRow = {
  id: string;
  phone: string;
  name: string;
  role: Role;
  password_hash: string;
  active: boolean;
  session_version: number;
  created_at: string;
  last_login_at: string | null;
};

function toUser(row: UserRow): UserRow {
  return { ...row, active: Boolean(Number(row.active)), session_version: Number(row.session_version) };
}
